-- Admin analytics Phase 4A: pre-computed metric infrastructure and the Engagement metrics
-- (docs/admin-analytics/architecture.md §3.5, requirements.md FR5, metrics-plan.md "Phase 4" and "Phase 5"
-- data_freshness, api-contract.md).
--
-- Infrastructure
-- - admin_app.refresh_runs records every refresh of the materialized views (nightly, recompute, manual).
-- - analytics_private.refresh_all() refreshes every materialized view in analytics_private (dependencies first,
--   CONCURRENTLY when the view has a plain unique index) inside one subtransaction: all views move together or none
--   does, and a failure is recorded on the run instead of being raised.
-- - admin_app.request_recompute() queues a run; the 5-minute throttle lives here so it holds across serverless
--   instances. analytics_private.process_recompute_queue() (pg_cron, every minute) runs the oldest pending request.
-- - pg_cron jobs are scheduled only where the cron schema exists (Supabase); the local SQL test has no pg_cron.
--   Jobs run as the role that scheduled them (postgres on Supabase), which owns the views.
--
-- Engagement
-- - "Active" is the feature-event proxy of the KB customer_behavior queries (standard feature_events CTE): an AI
--   run, CV / cover-letter export, job status change, tailored or master CV, import, tailoring session start or
--   finish, or cover letter, by an analysis account, clamped to signup time. It covers all accounts and all history.
-- - stickiness is the exception: it uses user_activity_days (>= 1 authenticated request that UTC day), which exists
--   only for users with analytics consent and only from 2026-10-29, so it is consent-scoped.
-- - cohort_retention and growth_accounting read materialized views refreshed nightly (03:45 UTC) or on request;
--   active_users, stickiness and feature_adoption run live (small data, architecture §3.5).
-- - Materialized views are read only through these functions, which re-apply the privacy rules (analysis_users)
--   and the internal-account rule on every call, so flags set after the last refresh take effect immediately.

-- ---------------------------------------------------------------------------
-- Refresh runs and the recompute queue
-- ---------------------------------------------------------------------------

create table admin_app.refresh_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('nightly', 'recompute', 'manual')),
  requested_at timestamptz not null default now(),
  -- Admin email for a recompute request; 'pg_cron' or the database role otherwise.
  requested_by text not null check (length(requested_by) between 1 and 320),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  error text check (length(error) <= 2000),
  -- {"mvs": [{"name", "ms", "concurrently"}], "failed_mv"?}: per-view refresh timings.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  constraint refresh_runs_finished_check check ((status in ('done', 'failed')) = (finished_at is not null))
);
create index refresh_runs_requested_at_idx on admin_app.refresh_runs (requested_at desc);
-- At most one queued recompute; the queue processor and the throttle look up open runs.
create unique index refresh_runs_one_pending_idx on admin_app.refresh_runs (kind) where status = 'pending';
alter table admin_app.refresh_runs enable row level security;
revoke all on admin_app.refresh_runs from public, anon, authenticated, service_role;

-- The open (pending or running) run, if any, and the seconds until a new recompute is allowed: 5 minutes after the
-- latest recompute request or the latest finished run of any kind (0 when there has never been a run).
create function analytics_private.recompute_wait(out open_run_id bigint, out retry_after_seconds integer)
language sql stable set search_path = ''
as $$
  with last as (
    select greatest((select max(r.requested_at) from admin_app.refresh_runs r where r.kind = 'recompute'),
                    (select max(r.finished_at) from admin_app.refresh_runs r)) as at
  )
  select (select r.id from admin_app.refresh_runs r where r.status in ('pending', 'running') order by r.id limit 1),
         case when last.at is null then 0
              else greatest(0, least(300, ceil(extract(epoch from last.at + interval '5 minutes' - clock_timestamp()))))::integer
         end
  from last
$$;

-- Fails runs that can no longer finish, so nothing blocks the button or loops in the queue:
-- - pending for 30 minutes: no queue processor (pg_cron missing or stopped), or every attempt was killed before it
--   could record a result (the processor retries a pending run each minute until then);
-- - running for 30 minutes: only possible if a session committed mid-run.
-- They are dated at their deadline, so the 5-minute throttle does not restart.
create function analytics_private.expire_stale_runs() returns integer
language sql volatile set search_path = ''
as $$
  with stale as (
    select o.id from admin_app.refresh_runs o
    where (o.status = 'pending' and o.requested_at < clock_timestamp() - interval '30 minutes')
       or (o.status = 'running' and o.started_at < clock_timestamp() - interval '30 minutes')
    for update skip locked
  ),
  failed as (
    update admin_app.refresh_runs r
    set status = 'failed',
        finished_at = case when r.status = 'pending' then r.requested_at else r.started_at end + interval '30 minutes',
        error = case when r.status = 'pending'
                     then 'not processed within 30 minutes (is the analytics_recompute_queue pg_cron job running?)'
                     else 'did not finish within 30 minutes' end
    where r.id in (select stale.id from stale)
    returning 1
  )
  select count(*)::integer from failed
$$;

-- Queues a recompute of the pre-computed metrics. Returns {status: queued | throttled, run_id, retry_after_seconds}:
-- throttled while a run is pending or running (run_id = that run) or within 5 minutes of the latest request or
-- finished run. Writes the audit row itself (action recompute.request), so every request is audited.
create function admin_app.request_recompute(p_admin_email text) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_admin_email));
  v_wait record;
  v_id bigint;
  v_result jsonb;
begin
  if v_email is null or length(v_email) not between 3 and 320 or position('@' in v_email) < 2 then
    raise exception 'admin_email is required' using errcode = '22023';
  end if;
  -- Serialises concurrent requests, so the check and the insert act as one.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_app.request_recompute', 0));
  perform analytics_private.expire_stale_runs();

  select * into v_wait from analytics_private.recompute_wait();
  if v_wait.open_run_id is not null then
    v_result := jsonb_build_object('status', 'throttled', 'run_id', v_wait.open_run_id,
                                   'retry_after_seconds', greatest(60, v_wait.retry_after_seconds));
  elsif v_wait.retry_after_seconds > 0 then
    v_result := jsonb_build_object('status', 'throttled', 'run_id', null, 'retry_after_seconds', v_wait.retry_after_seconds);
  else
    insert into admin_app.refresh_runs (kind, requested_by, status) values ('recompute', v_email, 'pending')
    returning id into v_id;
    v_result := jsonb_build_object('status', 'queued', 'run_id', v_id, 'retry_after_seconds', 0);
  end if;

  perform admin_app.log_access(v_email, 'recompute.request', null, v_result, null);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Shared engagement definitions
-- ---------------------------------------------------------------------------

-- KB standard feature_events CTE (customer_behavior/*): one row per product action of a signed-up account.
-- format / status are kept for feature_adoption (export format, export and AI run success).
create view analytics_private.feature_events as
select r.user_id, r.started_at as event_at, 'ai_run'::text as source, null::text as format, r.status
from public.ai_runs r
where r.provider <> 'mock' and r.user_id is not null
union all
select e.user_id, e.created_at, 'cv_export', e.format, e.status from public.exports e
union all
select ce.user_id, ce.created_at, 'cover_letter_export', ce.format, ce.status from public.cover_letter_exports ce
union all
select j.user_id, h.changed_at, 'job_status_change', null, h.to_status
from public.job_status_history h
join public.jobs j on j.id = h.job_id
union all
select t.user_id, t.created_at, 'tailored_cv_created', null, null from public.tailored_cvs t
union all
select m.user_id, m.created_at, 'master_cv_created', null, null from public.master_cvs m
union all
select i.user_id, i.created_at, 'import', null, i.status from public.imports i
union all
select s.user_id, s.created_at, 'tailoring_session_started', null, s.status from public.tailoring_sessions s
union all
select s.user_id, s.finished_at, 'tailoring_session_finished', null, s.status
from public.tailoring_sessions s
where s.finished_at is not null
union all
select c.user_id, c.created_at, 'cover_letter_opened', null, c.status from public.cover_letters c;

-- Feature of a feature event (feature_adoption rows). CV exports are split by format (KB
-- export_volume_and_success_by_format).
create function analytics_private.feature_of(p_source text, p_format text) returns text
language sql immutable set search_path = ''
as $$
  select case p_source
    when 'import' then 'cv_import'
    when 'master_cv_created' then 'master_cv'
    when 'ai_run' then 'ai_actions'
    when 'tailored_cv_created' then 'tailored_cv'
    when 'tailoring_session_started' then 'tailoring_v2_started'
    when 'tailoring_session_finished' then 'tailoring_v2_finished'
    when 'cv_export' then 'cv_export_' || coalesce(p_format, 'unknown')
    when 'cover_letter_opened' then 'cover_letter'
    when 'cover_letter_export' then 'cover_letter_export'
    when 'job_status_change' then 'job_tracking'
  end
$$;

-- First UTC day covered by user_activity_days (deploy of 20261029120000_monetization_tracking, no backfill).
create function analytics_private.activity_days_start() returns date
language sql immutable set search_path = ''
as $$ select date '2026-10-29' $$;

-- Grain of a drill whose caller did not pass p_filters.grain: from the clicked bucket's range.
create function analytics_private.drill_grain(p_filters jsonb, p_from date, p_to date) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_grain text := p_filters ->> 'grain';
begin
  if p_filters ? 'grain' then
    if jsonb_typeof(p_filters -> 'grain') <> 'string' or v_grain not in ('day', 'week', 'month') then
      raise exception 'grain must be day, week or month' using errcode = '22023';
    end if;
    return v_grain;
  end if;
  return case
    when p_from = p_to then 'day'
    when date_trunc('week', p_from::timestamp) = date_trunc('week', p_to::timestamp) then 'week'
    else 'month'
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Materialized views (analytics_private, read only through the functions below)
-- ---------------------------------------------------------------------------

-- When the views were last rebuilt (refresh_all refreshes every view in one transaction, so now() is shared).
create materialized view analytics_private.refresh_snapshot as
select 1 as id, now() as as_of
with data;
create unique index refresh_snapshot_key on analytics_private.refresh_snapshot (id);

-- One row per analysis account x active period, for every grain: the account had at least one feature event in
-- that UTC day / ISO week / month (events clamped to signup time, as in the KB). Internal accounts are kept and
-- filtered per call; accounts pending deletion or with restricted processing are left out (and re-filtered per call).
create materialized view analytics_private.engagement_user_periods as
with ev as (
  select fe.user_id, (greatest(fe.event_at, u.created_at) at time zone 'UTC')::date as day
  from analytics_private.feature_events fe
  join public.users u on u.id = fe.user_id
  where fe.event_at is not null
    and u.deletion_requested_at is null
    and u.processing_restricted_at is null
),
daily as (
  select ev.user_id, ev.day, count(*)::bigint as events
  from ev
  group by ev.user_id, ev.day
)
select g.grain,
       date_trunc(g.grain, d.day::timestamp)::date as period,
       d.user_id,
       sum(d.events)::bigint as events,
       count(*)::integer as active_days
from daily d
cross join (values ('day'::text), ('week'), ('month')) g(grain)
group by g.grain, date_trunc(g.grain, d.day::timestamp)::date, d.user_id
with data;
create unique index engagement_user_periods_key on analytics_private.engagement_user_periods (grain, period, user_id);

-- Growth accounting state per account x period (KB weekly_growth_accounting, feature_events source):
-- new = first active period of the account; retained = active in this and the previous period; resurrected = active,
-- not new, not active in the previous period; churned = active in the previous period, not in this one (only up to
-- the period that contains the refresh time). One state per account and period.
create materialized view analytics_private.engagement_growth as
with p as (
  select up.grain, up.period, up.user_id, up.events,
         min(up.period) over (partition by up.grain, up.user_id) as first_period,
         lag(up.period) over w as prev_period,
         lag(up.events) over w as prev_events,
         lead(up.period) over w as next_period,
         (up.period + ('1 ' || up.grain)::interval)::date as following_period
  from analytics_private.engagement_user_periods up
  window w as (partition by up.grain, up.user_id order by up.period)
)
select p.grain, p.period, p.user_id,
       case when p.period = p.first_period then 'new'
            when p.prev_period = (p.period - ('1 ' || p.grain)::interval)::date then 'retained'
            else 'resurrected' end as state,
       p.events,
       case when p.prev_period = (p.period - ('1 ' || p.grain)::interval)::date then p.prev_events end as prev_events,
       p.period as last_active_period
from p
union all
select p.grain, p.following_period, p.user_id, 'churned', 0::bigint, p.events, p.period
from p
where (p.next_period is null or p.next_period > p.following_period)
  and p.following_period <= date_trunc(p.grain, now() at time zone 'UTC')::date
with data;
create unique index engagement_growth_key on analytics_private.engagement_growth (grain, period, user_id);

revoke all on analytics_private.feature_events, analytics_private.refresh_snapshot,
  analytics_private.engagement_user_periods, analytics_private.engagement_growth
  from public, anon, authenticated, service_role, analytics_api;

-- The latest run of any kind (one row, nulls when there is none), whether a run is open, the seconds until a new
-- recompute is allowed and the time the pre-computed metrics were built. The UI polls this after a request.
-- status is never 'running' for other sessions (refresh_all writes it in the same transaction as the result): a
-- queued run reads 'pending' until it is 'done' or 'failed'.
create function admin_app.recompute_status()
returns table (run_id bigint, kind text, status text, requested_at timestamptz, requested_by text,
               started_at timestamptz, finished_at timestamptz, duration_seconds numeric, error text,
               open_run_id bigint, retry_after_seconds integer, as_of timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.kind, r.status, r.requested_at, r.requested_by, r.started_at, r.finished_at,
         round(extract(epoch from r.finished_at - r.started_at)::numeric, 3), r.error,
         w.open_run_id, w.retry_after_seconds,
         (select s.as_of from analytics_private.refresh_snapshot s)
  from analytics_private.recompute_wait() w
  left join lateral (select x.* from admin_app.refresh_runs x order by x.id desc limit 1) r on true
$$;

-- ---------------------------------------------------------------------------
-- Refresh and queue processing
-- ---------------------------------------------------------------------------

-- Refreshes every materialized view in analytics_private and records the run.
-- - Order: a view after the views it reads directly (a view read through a plain view is not detected; reference it
--   directly). CONCURRENTLY when the view is populated and has a plain unique index, so dashboard reads never block.
-- - All-or-nothing: the refreshes run in one subtransaction. On any error, including a cancel (statement_timeout,
--   pg_cancel_backend) or a lock timeout, every view is rolled back and the run is marked failed with the error and
--   the failing view; the error is recorded, not raised. Only a killed backend leaves no record (a queued request then
--   stays pending, is retried each minute and expires after 30 minutes, see expire_stale_runs).
-- - Locks: concurrent calls wait for each other (advisory lock). Each refresh then holds an ACCESS SHARE lock on the
--   product tables it reads (ai_runs, exports, cover letters, CVs, imports, jobs, tailoring sessions, users) until the
--   whole refresh commits, which blocks only DDL / VACUUM FULL on them; lock_timeout is 5s inside the refresh, so a
--   pending DDL fails the run instead of queueing product traffic behind it.
-- - Time: statement_timeout cannot be raised from inside a function (it is armed when the calling statement starts),
--   so the pg_cron commands set it before calling (10 minutes).
-- - status 'running' is written in the same transaction as the result, so other sessions never see it: a queued run
--   reads 'pending' until it is 'done' or 'failed'.
-- With p_run_id it runs that queued request; otherwise it records a new run of p_kind.
create function analytics_private.refresh_all(p_kind text default 'manual', p_run_id bigint default null)
returns bigint
language plpgsql volatile set search_path = ''
as $$
declare
  v_id bigint := p_run_id;
  v_mv record;
  v_t timestamptz;
  v_done jsonb := '[]'::jsonb;
  v_current text;
  v_state text;
  v_lock_timeout text := current_setting('lock_timeout');
begin
  if v_id is null then
    if p_kind is null or p_kind not in ('nightly', 'recompute', 'manual') then
      raise exception 'kind must be nightly, recompute or manual' using errcode = '22023';
    end if;
    insert into admin_app.refresh_runs (kind, requested_by, started_at, status)
    values (p_kind, case when p_kind = 'nightly' then 'pg_cron' else current_user end, clock_timestamp(), 'running')
    returning id into v_id;
  else
    update admin_app.refresh_runs r set status = 'running', started_at = clock_timestamp()
    where r.id = v_id and r.status = 'pending';
    if not found then
      raise exception 'refresh run % is not pending', v_id using errcode = '22023';
    end if;
  end if;

  begin
    v_current := '(waiting for another refresh)';
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('analytics_private.refresh_all', 0));
    perform pg_catalog.set_config('lock_timeout', '5s', true);
    for v_mv in
      with recursive mvs as (
        select c.oid, c.relname, c.relispopulated
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'analytics_private' and c.relkind = 'm'
      ),
      deps as (
        select distinct rw.ev_class as mv, d.refobjid as dep
        from pg_catalog.pg_rewrite rw
        join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = rw.oid
        where rw.ev_class in (select oid from mvs)
          and d.refobjid in (select oid from mvs)
          and d.refobjid <> rw.ev_class
      ),
      lvl(oid, depth) as (
        select oid, 0 from mvs
        union all
        select deps.mv, lvl.depth + 1 from lvl join deps on deps.dep = lvl.oid where lvl.depth < 20
      )
      select m.relname,
             m.relispopulated and exists (
               select 1 from pg_catalog.pg_index i
               where i.indrelid = m.oid and i.indisunique and i.indisvalid and i.indpred is null
                 and not (0 = any (i.indkey::int2[]))) as concurrent
      from mvs m
      join (select oid, max(depth) as depth from lvl group by oid) l on l.oid = m.oid
      order by l.depth, m.relname
    loop
      v_current := v_mv.relname;
      v_t := clock_timestamp();
      if v_mv.concurrent then
        execute format('refresh materialized view concurrently analytics_private.%I', v_mv.relname);
      else
        execute format('refresh materialized view analytics_private.%I', v_mv.relname);
      end if;
      v_done := v_done || jsonb_build_object('name', v_mv.relname, 'concurrently', v_mv.concurrent,
        'ms', round(extract(epoch from clock_timestamp() - v_t)::numeric * 1000, 1));
    end loop;
  exception when others or query_canceled then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_catalog.set_config('lock_timeout', v_lock_timeout, true);
    update admin_app.refresh_runs r
    set status = 'failed', finished_at = clock_timestamp(),
        error = left(v_state || ': ' || sqlerrm, 2000),
        detail = jsonb_build_object('mvs', v_done, 'failed_mv', v_current)
    where r.id = v_id;
    return v_id;
  end;

  perform pg_catalog.set_config('lock_timeout', v_lock_timeout, true);
  update admin_app.refresh_runs r
  set status = 'done', finished_at = clock_timestamp(), detail = jsonb_build_object('mvs', v_done)
  where r.id = v_id;
  return v_id;
end $$;

-- Runs the oldest pending recompute request, if any (pg_cron, every minute). Stale runs are expired first, so a
-- request whose attempts keep being killed stops being retried after 30 minutes. A request already being processed
-- by another session is skipped. Returns the run id, or null when nothing was pending.
create function analytics_private.process_recompute_queue() returns bigint
language plpgsql volatile set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform analytics_private.expire_stale_runs();
  select r.id into v_id
  from admin_app.refresh_runs r
  where r.status = 'pending'
  order by r.requested_at, r.id
  limit 1
  for update skip locked;
  if v_id is null then
    return null;
  end if;
  return analytics_private.refresh_all(null, v_id);
end $$;

-- Schedules the jobs where pg_cron is installed (idempotent: existing jobs of the same name are replaced). Returns
-- the scheduled job names, or an empty array without pg_cron. Supabase runs pg_cron jobs as the scheduling role
-- (postgres), which owns the views. The refresh commands raise statement_timeout first (it cannot be raised from
-- inside the function). The every-minute queue job adds ~525k cron.job_run_details rows a year, so a daily job keeps
-- 7 days of history for the analytics_* jobs (only where pg_cron records run details).
create function analytics_private.schedule_refresh_jobs() returns text[]
language plpgsql volatile set search_path = ''
as $$
declare
  v_job record;
  v_names text[] := '{}';
begin
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    return v_names;
  end if;
  for v_job in
    select * from (values
      ('analytics_nightly', '45 3 * * *',
       'set statement_timeout = ''10min''; select analytics_private.refresh_all(''nightly'')', true),
      ('analytics_recompute_queue', '* * * * *',
       'set statement_timeout = ''10min''; select analytics_private.process_recompute_queue()', true),
      ('analytics_cron_history_purge', '20 4 * * *',
       'delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname like ''analytics\_%'' '
       || 'and d.end_time < now() - interval ''7 days''',
       pg_catalog.to_regclass('cron.job_run_details') is not null)
    ) j(name, schedule, command, wanted)
  loop
    execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using v_job.name;
    if v_job.wanted then
      execute 'select cron.schedule($1, $2, $3)' using v_job.name, v_job.schedule, v_job.command;
      v_names := v_names || v_job.name;
    end if;
  end loop;
  return v_names;
end $$;

do $$
begin
  if cardinality(analytics_private.schedule_refresh_jobs()) = 0 then
    raise notice 'pg_cron is not installed: analytics_nightly and analytics_recompute_queue are not scheduled';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Engagement metrics
-- ---------------------------------------------------------------------------

create function analytics.active_users(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, active_users bigint, ai_active_users bigint, exporting_users bigint,
               tailoring_users bigint, events bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'locale'], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with pop as (
    select u.id, u.created_at,
           case p_breakdown when 'market' then coalesce(m.market, 'unknown') when 'locale' then u.locale end as dim
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  ev as (
    select analytics_private.bucket(greatest(fe.event_at, pop.created_at), p_grain) as b, pop.dim, fe.user_id, fe.source
    from analytics_private.feature_events fe
    join pop on pop.id = fe.user_id
    where fe.event_at < analytics_private.utc_start(r.to_day + 1)
      and greatest(fe.event_at, pop.created_at) >= analytics_private.utc_start(r.from_day)
      and greatest(fe.event_at, pop.created_at) < analytics_private.utc_start(r.to_day + 1)
  ),
  agg as (
    select ev.b, ev.dim,
           count(distinct ev.user_id) as n_active,
           count(distinct ev.user_id) filter (where ev.source = 'ai_run') as n_ai,
           count(distinct ev.user_id) filter (where ev.source in ('cv_export', 'cover_letter_export')) as n_export,
           count(distinct ev.user_id) filter (where ev.source in ('tailored_cv_created', 'tailoring_session_started',
                                                                  'tailoring_session_finished')) as n_tailor,
           count(*) as n_events
    from ev
    group by ev.b, ev.dim
  ),
  dims as (
    select distinct ev.dim from ev
    union
    select null where p_breakdown is null
  )
  select k.b, d.dim, coalesce(a.n_active, 0), coalesce(a.n_ai, 0), coalesce(a.n_export, 0),
         coalesce(a.n_tailor, 0), coalesce(a.n_events, 0)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join agg a on a.b = k.b and a.dim is not distinct from d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.active_users(date, date, text, text, boolean, text, jsonb) is
'{"title":"Active users","definition":"Distinct accounts with at least one product action per period (UTC): the feature-event proxy of the KB customer_behavior queries (AI run except mock, CV or cover-letter export, job status change, tailored or master CV created, import, tailoring session started or finished, cover letter created), clamped to signup time. Day = DAU, week = WAU (ISO weeks), month = MAU; the first and last bucket count only days inside the range. Reading or editing without one of these actions is invisible, so this under-counts visits (see stickiness for real activity of consenting users). ai_active_users / exporting_users / tailoring_users split the same accounts by action (an account can be in several). Excludes accounts pending deletion or with restricted processing, and internal accounts unless included; erased accounts are gone (survivorship). Market is the locked market (unknown without one). Dashboard definition: feature events at every grain (the KB monthly_active_users counts non-zero usage_counters months, which only exist per month; metered actions are feature events too).","unit":"count","shape":"timeseries","breakdowns":["market","locale"],"filters":["market","locale"],"kb":"queries/monthly_active_users.md","consent_scoped":false,"alertable":false,"plot":["active_users","ai_active_users","exporting_users","tailoring_users"],"measures":{"active_users":{"label":"Active users","unit":"count","description":"Accounts with at least one product action"},"ai_active_users":{"label":"AI users","unit":"count","description":"Accounts with an AI run"},"exporting_users":{"label":"Exporting users","unit":"count","description":"Accounts with a CV or cover-letter export"},"tailoring_users":{"label":"Tailoring users","unit":"count","description":"Accounts that created a tailored CV or started / finished a tailoring session"},"events":{"label":"Product actions","unit":"count"}}}';

create function analytics.stickiness(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, stickiness numeric, dau numeric, wau numeric, mau numeric,
               active_users bigint, partial boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_start date := analytics_private.activity_days_start();
  v_today date := (now() at time zone 'UTC')::date;
  v_first date;
  v_last date;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array['market'], array['market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_first := greatest(r.from_day, v_start);
  v_last := least(r.to_day, v_today);

  return query
  with pop as (
    select u.id, case when p_breakdown = 'market' then coalesce(m.market, 'unknown') end as dim
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where u.analytics
      and (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
  ),
  act as (
    select d.user_id, d.activity_date, pop.dim
    from public.user_activity_days d
    join pop on pop.id = d.user_id
    where d.activity_date between v_first - 27 and v_last
  ),
  dims as (
    select distinct act.dim from act
    union
    select null where p_breakdown is null
  ),
  -- Distinct users active in a trailing window, without a users x days join: each activity day opens a span that
  -- lasts until the user's next activity day or the end of the window (7 / 28 days), whichever is first. A user's spans
  -- never overlap, so a running sum of +1 / -1 changes counts each user once per day.
  spans as (
    select a.dim, a.activity_date as d0,
           lead(a.activity_date) over (partition by a.user_id order by a.activity_date) as nxt
    from act a
  ),
  deltas as (
    select sp.dim, sp.d0 as day, 1 as c1, 1 as c7, 1 as c28 from spans sp
    union all select sp.dim, sp.d0 + 1, -1, 0, 0 from spans sp
    union all select sp.dim, least(sp.nxt, sp.d0 + 7), 0, -1, 0 from spans sp
    union all select sp.dim, least(sp.nxt, sp.d0 + 28), 0, 0, -1 from spans sp
  ),
  delta_day as (
    select dl.dim, dl.day, sum(dl.c1) as s1, sum(dl.c7) as s7, sum(dl.c28) as s28
    from deltas dl
    where dl.day <= v_last
    group by dl.dim, dl.day
  ),
  running as (
    select g::date as day, dm.dim,
           sum(coalesce(dd.s1, 0)) over w as d1,
           sum(coalesce(dd.s7, 0)) over w as d7,
           sum(coalesce(dd.s28, 0)) over w as d28
    from generate_series((v_first - 27)::timestamp, v_last::timestamp, interval '1 day') g
    cross join dims dm
    left join delta_day dd on dd.day = g::date and dd.dim is not distinct from dm.dim
    window w as (partition by dm.dim order by g)
  ),
  daily as (
    select rn.day, rn.dim, rn.d1, rn.d7, rn.d28 from running rn where rn.day >= v_first
  ),
  per_bucket as (
    select date_trunc(p_grain, dl.day::timestamp)::date as b, dl.dim,
           avg(dl.d1) as a1, avg(dl.d7) as a7, avg(dl.d28) as a28,
           min(dl.day) as first_day, max(dl.day) as last_day,
           bool_or(dl.day - 27 < v_start or dl.day = v_today) as incomplete
    from daily dl
    group by 1, 2
  ),
  period_active as (
    select date_trunc(p_grain, a.activity_date::timestamp)::date as b, a.dim, count(distinct a.user_id) as n
    from act a
    where a.activity_date between v_first and v_last
    group by 1, 2
  )
  select k.b, d.dim,
         round(pb.a1 / nullif(pb.a28, 0), 4),
         round(pb.a1, 2), round(pb.a7, 2), round(pb.a28, 2),
         case when pb.b is not null then coalesce(pa.n, 0) end,
         -- Partial: no covered day, a day whose 28-day window starts before the data, today, or days of the bucket
         -- inside the range that are not covered yet.
         coalesce(pb.incomplete
                  or pb.first_day > greatest(k.b, r.from_day)
                  or pb.last_day < least((k.b + ('1 ' || p_grain)::interval - interval '1 day')::date, r.to_day), true)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join per_bucket pb on pb.b = k.b and pb.dim is not distinct from d.dim
  left join period_active pa on pa.b = k.b and pa.dim is not distinct from d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.stickiness(date, date, text, text, boolean, text, jsonb) is
'{"title":"Stickiness","definition":"Real engagement of consenting users from user_activity_days (at least one authenticated request that UTC day; recorded only for users with analytics consent, from 2026-10-29, no backfill; withdrawing consent deletes a user''s days). For every day: DAU = active that day, WAU = active in the trailing 7 days, MAU = active in the trailing 28 days (L28, KB section A). A bucket shows the average of its days (a day bucket is the day itself) and stickiness = average DAU / average MAU (for a day: DAU / MAU). active_users = distinct users active in the bucket (inside the range). partial is true when the bucket has no data yet, includes today, starts before 2026-10-29, or a day''s 28-day window reaches before 2026-10-29 (MAU understated, stickiness overstated until 2026-11-25). Every number is of consenting users, who skew engaged: never compare with all-user counts. Excludes accounts pending deletion or with restricted processing, and internal accounts unless included. Market is the locked market (unknown without one; the KB writes GLOBAL). Dashboard definition: buckets average the daily DAU / WAU / MAU (the KB monthly section divides average DAU by calendar-month MAU); no plan breakdown (the KB rebuilds the plan per day from subscription_events).","unit":"ratio","shape":"timeseries","breakdowns":["market"],"filters":["market"],"kb":"new_analysis/customer_behavior/engagement_stickiness_dau_wau_mau.md","consent_scoped":true,"alertable":false,"min_group":5,"plot":["dau","wau","mau"],"flag_column":"partial","measures":{"stickiness":{"label":"Stickiness (DAU/MAU)","unit":"ratio","description":"Average DAU / average 28-day MAU"},"dau":{"label":"DAU","unit":"count","description":"Average daily active consenting users"},"wau":{"label":"WAU","unit":"count","description":"Average trailing 7-day active users"},"mau":{"label":"MAU (28 days)","unit":"count","description":"Average trailing 28-day active users"},"active_users":{"label":"Active in period","unit":"count","description":"Distinct consenting users active in the bucket"}}}';

create function analytics.cohort_retention(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (cohort date, period integer, cohort_size bigint, active bigint, rate numeric, is_partial_period boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
  v_as_of timestamptz;
  v_cur date;
  v_max integer;
  v_step interval;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  select s.as_of into v_as_of from analytics_private.refresh_snapshot s;
  v_cur := date_trunc(p_grain, v_as_of at time zone 'UTC')::date;
  v_max := case p_grain when 'day' then 30 when 'week' then 12 else 11 end;
  v_step := ('1 ' || p_grain)::interval;

  -- Whole cohort periods: the periods overlapping the range, so a cohort is never cut at the range edges (and matches
  -- drill_cohort_active_users).
  return query
  with cu as (
    select u.id, date_trunc(p_grain, u.created_at at time zone 'UTC')::date as c
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and u.created_at >= analytics_private.utc_start(date_trunc(p_grain, r.from_day::timestamp)::date)
      and u.created_at < analytics_private.utc_start((date_trunc(p_grain, r.to_day::timestamp) + v_step)::date)
      and u.created_at < v_as_of  -- accounts created after the snapshot have no activity in it yet
      and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  sizes as (
    select cu.c, count(*) as n from cu group by cu.c
  ),
  grid as (
    select s.c, s.n, g.k, (s.c + g.k * v_step)::date as cal
    from sizes s
    cross join generate_series(0, v_max) g(k)
    where (s.c + g.k * v_step)::date <= v_cur
  ),
  act as (
    select cu.c, up.period as cal, count(*) as n
    from cu
    join analytics_private.engagement_user_periods up
      on up.grain = p_grain and up.user_id = cu.id and up.period >= cu.c and up.period <= v_cur
    group by cu.c, up.period
  )
  select g.c, g.k, g.n, coalesce(a.n, 0), round(coalesce(a.n, 0)::numeric / g.n, 4), g.cal = v_cur
  from grid g
  left join act a on a.c = g.c and a.cal = g.cal
  order by g.c, g.k;
end $$;

comment on function analytics.cohort_retention(date, date, text, text, boolean, text, jsonb) is
'{"title":"Cohort retention","definition":"Signup cohorts (accounts created in the UTC days / ISO weeks / months = the grain that overlap the range; whole periods, so the first and last cohort are not cut at the range edges) and the share active in each later period: period n = calendar offset from the signup period (0 = the signup period itself; up to 30 days, 12 weeks or 11 months). Active = at least one product action in that period (the feature-event proxy of the KB, clamped to signup time; reading without acting is invisible). Pre-computed: activity comes from the nightly (03:45 UTC) or on-request rebuild, so cells stop at the period of the last rebuild (is_partial_period marks that still-open period) and accounts created after it are left out. Excludes accounts pending deletion or with restricted processing, and internal accounts unless included; erased accounts are gone, so older cohorts look smaller and better retained (survivorship). Market is the locked market. Dashboard definition: feature-events signal only, all segments together (the KB adds an activity_days signal and ever_paid / subscribed_never_paid / never_subscribed segments), and the monthly grid counts feature events only (no usage_counters visits).","unit":"ratio","shape":"cohort","breakdowns":[],"filters":["market","locale"],"kb":"new_analysis/customer_behavior/cohort_retention_triangle.md","consent_scoped":false,"alertable":false,"min_group":5,"drill":true,"precomputed":true,"measures":{"cohort_size":{"label":"Cohort size","unit":"count"},"active":{"label":"Active","unit":"count","description":"Cohort accounts with a product action in the period"},"rate":{"label":"Retention","unit":"ratio","description":"active / cohort_size"}}}';

create function analytics.growth_accounting(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, new_users bigint, retained_users bigint, resurrected_users bigint,
               churned_users bigint, active_users bigint, net_change bigint, quick_ratio numeric,
               retention_rate numeric, is_partial_period boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
  v_cur date;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'locale'], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  select date_trunc(p_grain, s.as_of at time zone 'UTC')::date into v_cur from analytics_private.refresh_snapshot s;

  return query
  with pop as (
    select u.id,
           case p_breakdown when 'market' then coalesce(m.market, 'unknown') when 'locale' then u.locale end as dim
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  st as (
    select g.period, pop.dim, g.state
    from analytics_private.engagement_growth g
    join pop on pop.id = g.user_id
    where g.grain = p_grain
      and g.period >= date_trunc(p_grain, r.from_day::timestamp)::date
      and g.period <= r.to_day
  ),
  agg as (
    select st.period, st.dim,
           count(*) filter (where st.state = 'new') as n_new,
           count(*) filter (where st.state = 'retained') as n_ret,
           count(*) filter (where st.state = 'resurrected') as n_res,
           count(*) filter (where st.state = 'churned') as n_churn
    from st
    group by st.period, st.dim
  ),
  dims as (
    select distinct st.dim from st
    union
    select null where p_breakdown is null
  ),
  grid as (
    select k.b, d.dim, k.b > v_cur as future,
           coalesce(a.n_new, 0) as n_new, coalesce(a.n_ret, 0) as n_ret,
           coalesce(a.n_res, 0) as n_res, coalesce(a.n_churn, 0) as n_churn
    from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
    cross join dims d
    left join agg a on a.period = k.b and a.dim is not distinct from d.dim
  )
  -- Buckets after the last rebuild have no data yet (null rather than zero).
  select g.b, g.dim,
         case when not g.future then g.n_new end,
         case when not g.future then g.n_ret end,
         case when not g.future then g.n_res end,
         case when not g.future then -g.n_churn end,
         case when not g.future then g.n_new + g.n_ret + g.n_res end,
         case when not g.future then g.n_new + g.n_res - g.n_churn end,
         case when not g.future then round((g.n_new + g.n_res)::numeric / nullif(g.n_churn, 0), 4) end,
         case when not g.future then round(g.n_ret::numeric / nullif(g.n_ret + g.n_churn, 0), 4) end,
         g.b = v_cur
  from grid g
  order by g.b, g.dim;
end $$;

comment on function analytics.growth_accounting(date, date, text, text, boolean, text, jsonb) is
'{"title":"Growth accounting","definition":"Active accounts per period (UTC day / ISO week / month) split by how they got there (KB weekly_growth_accounting, feature_events signal): new = first-ever active period of the account (not necessarily its signup period), retained = also active in the previous period, resurrected = active again after at least one inactive period, churned = active in the previous period but not in this one (shown negative). Active = at least one product action (AI run, export, job status change, tailored / master CV, import, tailoring session, cover letter), clamped to signup time; reading without acting is invisible, so churned can include users who still open the app. Identities: active_users = new + retained + resurrected; previous period active = retained - churned_users; net_change = new + resurrected + churned_users (the change in active users). quick_ratio = (new + resurrected) / churned (null when nobody churned; above 1 the base grows); retention_rate = retained / previous period active. Buckets are whole periods (not clipped to the range). Pre-computed: refreshed nightly (03:45 UTC) or on request; is_partial_period marks the period containing the last rebuild (its churn is inflated) and later buckets are null. Excludes accounts pending deletion or with restricted processing, and internal accounts unless included; erased accounts are gone (survivorship). Market is the locked market. Dashboard definition: feature events at every grain (the KB monthly section also counts non-zero usage_counters months, and offers an activity_days signal for consenting users).","unit":"count","shape":"timeseries","breakdowns":["market","locale"],"filters":["market","locale"],"kb":"new_analysis/customer_behavior/weekly_growth_accounting.md","consent_scoped":false,"alertable":false,"min_group":5,"drill":true,"precomputed":true,"plot":["new_users","retained_users","resurrected_users","churned_users"],"stacked":true,"flag_column":"is_partial_period","measures":{"new_users":{"label":"New","unit":"count","description":"First-ever active period"},"retained_users":{"label":"Retained","unit":"count","description":"Active in this and the previous period"},"resurrected_users":{"label":"Resurrected","unit":"count","description":"Active again after an inactive period"},"churned_users":{"label":"Churned","unit":"count","description":"Negative: active in the previous period, not in this one"},"active_users":{"label":"Active users","unit":"count","description":"new + retained + resurrected"},"net_change":{"label":"Net change","unit":"count","description":"new + resurrected - churned"},"quick_ratio":{"label":"Quick ratio","unit":"ratio","description":"(new + resurrected) / churned; not a percentage"},"retention_rate":{"label":"Period retention","unit":"ratio","description":"retained / previous period active"}}}';

create function analytics.feature_adoption(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (dimension text, users bigint, share_of_active numeric, events bigint, success_rate numeric,
               active_users bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with pop as (
    select u.id, u.created_at
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  ev as (
    select fe.user_id, analytics_private.feature_of(fe.source, fe.format) as feature, fe.source, fe.status
    from analytics_private.feature_events fe
    join pop on pop.id = fe.user_id
    where fe.event_at < analytics_private.utc_start(r.to_day + 1)
      and greatest(fe.event_at, pop.created_at) >= analytics_private.utc_start(r.from_day)
      and greatest(fe.event_at, pop.created_at) < analytics_private.utc_start(r.to_day + 1)
  ),
  total as (
    select count(distinct ev.user_id) as n from ev
  ),
  features(feature) as (
    values ('cv_import'), ('master_cv'), ('ai_actions'), ('tailored_cv'), ('tailoring_v2_started'),
           ('tailoring_v2_finished'), ('cv_export_pdf'), ('cv_export_docx'), ('cover_letter'),
           ('cover_letter_export'), ('job_tracking')
  ),
  agg as (
    select ev.feature,
           count(distinct ev.user_id) as n_users,
           count(*) as n_events,
           count(*) filter (where ev.status = 'completed') as n_ok,
           count(*) filter (where ev.status = 'failed') as n_failed
    from ev
    group by ev.feature
  )
  select f.feature,
         coalesce(a.n_users, 0),
         round(coalesce(a.n_users, 0)::numeric / nullif(t.n, 0), 4),
         coalesce(a.n_events, 0),
         case when f.feature like 'cv_export_%' or f.feature in ('cover_letter_export', 'ai_actions')
              then round(a.n_ok::numeric / nullif(a.n_ok + a.n_failed, 0), 4) end,
         t.n
  from (select feature from features union select agg.feature from agg) f
  cross join total t
  left join agg a on a.feature = f.feature
  order by coalesce(a.n_users, 0) desc, f.feature;
end $$;

comment on function analytics.feature_adoption(date, date, text, text, boolean, text, jsonb) is
'{"title":"Feature adoption","definition":"Accounts using each feature in the range (UTC) and their share of active users (accounts with any product action in the range, as in active_users; an account counts once per feature it used, so shares do not add up). Features: cv_import, master_cv (created), ai_actions (any non-mock AI run), tailored_cv (created), tailoring_v2_started / tailoring_v2_finished (sessions, from 2026-10-27), cv_export_pdf / cv_export_docx (CV export attempts by format, KB export_volume_and_success_by_format), cover_letter (created) and cover_letter_export (KB cover_letter_adoption), job_tracking (job status changes). events = actions in the range; success_rate = completed / (completed + failed) for exports and AI runs (in-flight ones excluded). Excludes accounts pending deletion or with restricted processing, and internal accounts unless included; erased accounts are gone (survivorship). Market is the locked market. Grain and currency do not apply. Dashboard definition: range-bound and per account (the KB cover_letter_adoption divides by every account ever created); template choice (KB template_popularity) is not a feature row.","unit":"count","shape":"breakdown","breakdowns":[],"filters":["market","locale"],"kb":"queries/cover_letter_adoption.md","consent_scoped":false,"alertable":false,"min_group":5,"drill":true,"measures":{"users":{"label":"Users","unit":"count","description":"Accounts that used the feature"},"share_of_active":{"label":"Share of active users","unit":"ratio","description":"users / active users in the range"},"events":{"label":"Actions","unit":"count"},"success_rate":{"label":"Success rate","unit":"ratio","description":"completed / (completed + failed); exports and AI runs only"},"active_users":{"label":"Active users","unit":"count","description":"Denominator: accounts with any product action in the range"}}}';

-- ---------------------------------------------------------------------------
-- Data freshness (Phase 5 Data health page)
-- ---------------------------------------------------------------------------

create function analytics.data_freshness(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (item text, label text, status text, value numeric, value_text text, at timestamptz, detail jsonb)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  run record;
  fx record;
  v_prev_final boolean;
  v_n bigint;
  v_at timestamptz;
  v_jobs text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array[]::text[]);

  -- Last nightly refresh (pg_cron, 03:45 UTC).
  select r.* into run from admin_app.refresh_runs r
  where r.kind = 'nightly' and r.status in ('done', 'failed') order by r.id desc limit 1;
  item := 'nightly_refresh'; label := 'Last nightly refresh of pre-computed metrics';
  status := case when run.id is null then 'warn' when run.status = 'failed' then 'error'
                 when run.finished_at < v_now - interval '26 hours' then 'warn' else 'ok' end;
  value := round(extract(epoch from run.finished_at - run.started_at)::numeric, 3);
  value_text := coalesce(run.status, 'never ran');
  at := run.finished_at;
  detail := case when run.id is not null then jsonb_build_object('run_id', run.id, 'started_at', run.started_at,
              'duration_seconds', value, 'error', run.error, 'mvs', run.detail -> 'mvs') end;
  return next;

  -- Last on-request recompute.
  select r.* into run from admin_app.refresh_runs r
  where r.kind = 'recompute' and r.status in ('done', 'failed') order by r.id desc limit 1;
  item := 'last_recompute'; label := 'Last recompute';
  status := case when run.id is null then 'info' when run.status = 'failed' then 'error' else 'ok' end;
  value := round(extract(epoch from run.finished_at - run.started_at)::numeric, 3);
  value_text := coalesce(run.status, 'never ran');
  at := run.finished_at;
  detail := case when run.id is not null then jsonb_build_object('run_id', run.id, 'requested_at', run.requested_at,
              'started_at', run.started_at, 'duration_seconds', value, 'error', run.error) end;
  return next;

  -- Queued recompute (the queue job runs every minute).
  select count(*), min(r.requested_at) into v_n, v_at from admin_app.refresh_runs r where r.status in ('pending', 'running');
  item := 'pending_recompute'; label := 'Pending recompute requests';
  status := case when v_at < v_now - interval '10 minutes' then 'warn' else 'ok' end;
  value := v_n; value_text := case when v_n > 0 then 'queued' else 'none' end; at := v_at;
  detail := jsonb_build_object('retry_after_seconds', (select w.retry_after_seconds from analytics_private.recompute_wait() w));
  return next;

  -- When the pre-computed metrics were built.
  select s.as_of into v_at from analytics_private.refresh_snapshot s;
  item := 'precomputed_as_of'; label := 'Pre-computed metrics built at';
  status := case when v_at is null or v_at < v_now - interval '26 hours' then 'warn' else 'ok' end;
  value := round(extract(epoch from v_now - v_at)::numeric / 3600, 2); value_text := 'hours old'; at := v_at;
  detail := jsonb_build_object('metrics', jsonb_build_array('cohort_retention', 'growth_accounting'));
  return next;

  -- Scheduler (pg_cron jobs).
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    execute 'select array_agg(j.jobname::text order by j.jobname) from cron.job j where j.jobname like ''analytics\_%'''
      into v_jobs;
  end if;
  item := 'scheduler'; label := 'Scheduled jobs (pg_cron)';
  status := case when v_jobs @> array['analytics_nightly', 'analytics_recompute_queue'] then 'ok' else 'warn' end;
  value := coalesce(cardinality(v_jobs), 0);
  value_text := case when not exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then 'pg_cron not installed'
                     else coalesce(array_to_string(v_jobs, ', '), 'no analytics jobs') end;
  at := null; detail := jsonb_build_object('jobs', to_jsonb(coalesce(v_jobs, '{}'::text[])));
  return next;

  -- Latest USD->TRY month and its finality.
  select f.rate_month, f.rate, f.is_final, f.updated_at into fx from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY' order by f.rate_month desc limit 1;
  select f.is_final into v_prev_final from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY' and f.rate_month = (v_month - interval '1 month')::date;
  item := 'fx_latest_month'; label := 'Latest USD/TRY rate month';
  status := case when fx.rate_month is null then 'error'
                 when fx.rate_month = v_month and coalesce(v_prev_final, false) then 'ok' else 'warn' end;
  value := fx.rate;
  value_text := case when fx.rate_month is null then 'no rates'
                     else to_char(fx.rate_month, 'YYYY-MM') || case when fx.is_final then ' final' else ' month-to-date' end end;
  at := fx.updated_at;
  detail := jsonb_build_object('rate_month', fx.rate_month, 'is_final', fx.is_final,
                               'current_month_loaded', fx.rate_month = v_month, 'previous_month_final', v_prev_final);
  return next;

  -- Catalog snapshots written by the 03:30 refresh.
  select count(*), max(c.refreshed_at) into v_n, v_at from public.billing_price_catalog c;
  item := 'billing_price_catalog'; label := 'Stripe price catalog refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'prices'; at := v_at;
  detail := jsonb_build_object('configured', (select count(*) from public.billing_price_catalog c where c.is_configured));
  return next;

  select count(*), max(c.refreshed_at) into v_n, v_at from public.billing_plan_catalog c;
  item := 'billing_plan_catalog'; label := 'Plan catalog refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'plans'; at := v_at; detail := null;
  return next;

  select count(*), max(p.refreshed_at) into v_n, v_at from public.ai_model_prices p;
  item := 'ai_model_prices'; label := 'AI model prices refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'model prefixes'; at := v_at; detail := null;
  return next;

  -- Unpriced AI runs of the last 30 days (analytics.ai_cost population): costs are lower bounds while > 0.
  select count(*) into v_n from analytics_private.run_cost rc
  where rc.started_at >= v_now - interval '30 days'
    and rc.cost_usd is null and rc.has_tokens
    and not rc.is_guest and rc.is_analysis_user
    and (p_include_internal or not rc.is_internal_user);
  item := 'unpriced_ai_runs_30d'; label := 'Unpriced AI runs (last 30 days)';
  status := case when v_n > 0 then 'warn' else 'ok' end;
  value := v_n; value_text := 'runs'; at := null;
  detail := jsonb_build_object('models', (
    select coalesce(jsonb_object_agg(x.model, x.n), '{}'::jsonb) from (
      select coalesce(rc.model_name, 'unknown') as model, count(*) as n from analytics_private.run_cost rc
      where rc.started_at >= v_now - interval '30 days' and rc.cost_usd is null and rc.has_tokens
        and not rc.is_guest and rc.is_analysis_user and (p_include_internal or not rc.is_internal_user)
      group by 1) x));
  return next;

  -- Function contract and privilege model (expected 0).
  select count(*) into v_n from analytics_private.contract_violations();
  item := 'contract_violations'; label := 'Analytics contract violations';
  status := case when v_n > 0 then 'error' else 'ok' end;
  value := v_n; value_text := 'violations'; at := null; detail := null;
  return next;
end $$;

comment on function analytics.data_freshness(date, date, text, text, boolean, text, jsonb) is
'{"title":"Data freshness","definition":"One row per freshness check, with status ok / warn / error / info. nightly_refresh: the last nightly rebuild of the pre-computed metrics (warn when none or older than 26 hours, error when it failed; value = duration in seconds). last_recompute: the last on-request rebuild. pending_recompute: queued requests (warn when one waits more than 10 minutes, i.e. the queue job is not running). precomputed_as_of: when cohort_retention and growth_accounting were built (value = hours old). scheduler: the pg_cron jobs analytics_nightly and analytics_recompute_queue. fx_latest_month: latest USD/TRY month (value = TRY per USD; ok when the current month is loaded and the previous one is final). billing_price_catalog / billing_plan_catalog / ai_model_prices: rows and last refresh by the 03:30 job (warn after 48 hours or when empty). unpriced_ai_runs_30d: AI runs of the last 30 days with tokens but no stored cost and no model price (analytics.ai_cost population; costs are lower bounds while > 0; internal accounts only when included). contract_violations: analytics_private.contract_violations() rows (error when > 0). The range, grain and currency do not apply.","unit":"count","shape":"table","breakdowns":[],"filters":[],"kb":"new_analysis/acquisition/data_quality_health_checks.md","consent_scoped":false,"alertable":false,"measures":{"value":{"label":"Value","unit":"count","description":"Per check: seconds for refresh runs, hours for the build age, TRY per USD for FX, otherwise a count"}}}';

-- ---------------------------------------------------------------------------
-- Drill-down keys (analytics_people.drill_users convention, api-contract.md "Drill-down")
-- ---------------------------------------------------------------------------

-- Growth accounting: accounts that churned in the clicked period(s).
create function analytics_private.drill_churned_users(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_grain text;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['grain', 'market', 'locale']);
  v_grain := analytics_private.drill_grain(p_filters, p_from, p_to);
  return query
  select distinct on (g.user_id)
         g.user_id, g.prev_events::numeric,
         jsonb_build_object('grain', v_grain, 'churned_period', g.period, 'last_active_period', g.last_active_period,
                            'events_in_last_active_period', g.prev_events, 'signup_at', u.created_at,
                            'market', coalesce(m.market, 'unknown'), 'locale', u.locale),
         g.prev_events::text
  from analytics_private.engagement_growth g
  join public.users u on u.id = g.user_id
  left join public.billing_markets m on m.user_id = g.user_id
  where g.grain = v_grain and g.state = 'churned'
    and g.period >= date_trunc(v_grain, p_from::timestamp)::date
    and g.period <= p_to
    and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
    and (v_locales is null or u.locale = any (v_locales))
  order by g.user_id, g.period desc;
end $$;

comment on function analytics_private.drill_churned_users(date, date, jsonb, integer, text) is
'{"description":"Accounts that churned (active in the previous period, no product action in this one) in the periods overlapping the range, from the pre-computed growth accounting; the most engaged before churning first. grain (day / week / month) should be passed; without it, a one-day range is a day, a range inside one ISO week a week, otherwise months.","metric":"growth_accounting","filters":["grain","market","locale"],"value":"product actions in the last active period","unit":"count","order":"most actions before churning first","detail":["grain","churned_period","last_active_period","events_in_last_active_period","signup_at","market","locale"]}';

-- Cohort retention: accounts of one cohort active in one period.
create function analytics_private.drill_cohort_active_users(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_grain text;
  v_cohort date;
  v_period integer;
  v_cal date;
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['cohort', 'period', 'grain', 'market', 'locale']);
  if jsonb_typeof(p_filters -> 'cohort') is distinct from 'string' or (p_filters ->> 'cohort') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'cohort (YYYY-MM-DD) is required' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_filters -> 'period'), '') not in ('number', 'string') or (p_filters ->> 'period') !~ '^\d{1,3}$' then
    raise exception 'period (0 or more) is required' using errcode = '22023';
  end if;
  begin
    v_cohort := (p_filters ->> 'cohort')::date;
  exception when others then
    raise exception 'cohort (YYYY-MM-DD) is required' using errcode = '22023';
  end;
  v_period := (p_filters ->> 'period')::integer;
  -- Without a grain: a first-of-month cohort is monthly, a Monday weekly, otherwise daily.
  v_grain := case when p_filters ? 'grain' then analytics_private.drill_grain(p_filters, p_from, p_to)
                  when extract(day from v_cohort) = 1 then 'month'
                  when extract(isodow from v_cohort) = 1 then 'week'
                  else 'day' end;
  if date_trunc(v_grain, v_cohort::timestamp)::date <> v_cohort then
    raise exception 'cohort is not the start of a %', v_grain using errcode = '22023';
  end if;
  v_cal := (v_cohort + v_period * ('1 ' || v_grain)::interval)::date;
  -- Same cohort as analytics.cohort_retention: the whole cohort period, accounts created before the snapshot.
  return query
  select up.user_id, up.events::numeric,
         jsonb_build_object('grain', v_grain, 'cohort', v_cohort, 'period', v_period, 'calendar_period', v_cal,
                            'events', up.events, 'active_days', up.active_days, 'signup_at', u.created_at,
                            'market', coalesce(m.market, 'unknown'), 'locale', u.locale),
         up.events::text
  from public.users u
  join analytics_private.engagement_user_periods up on up.user_id = u.id and up.grain = v_grain and up.period = v_cal
  left join public.billing_markets m on m.user_id = u.id
  where u.created_at >= analytics_private.utc_start(v_cohort)
    and u.created_at < analytics_private.utc_start((v_cohort + ('1 ' || v_grain)::interval)::date)
    and u.created_at < (select s.as_of from analytics_private.refresh_snapshot s)
    and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
    and (v_locales is null or u.locale = any (v_locales));
end $$;

comment on function analytics_private.drill_cohort_active_users(date, date, jsonb, integer, text) is
'{"description":"Accounts of one signup cohort with a product action in period n after signup (the pre-computed cohort_retention cell), most active first. cohort (YYYY-MM-DD) and period are required; grain should be passed (without it a first-of-month cohort is monthly, a Monday weekly, otherwise daily). The range does not apply.","metric":"cohort_retention","filters":["cohort","period","grain","market","locale"],"value":"product actions in the period","unit":"count","order":"most actions first","detail":["grain","cohort","period","calendar_period","events","active_days","signup_at","market","locale"]}';

-- Feature adoption: accounts that used one feature in the range.
create function analytics_private.drill_feature_users(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_feature text := p_filters ->> 'dimension';
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['dimension', 'market', 'locale']);
  if jsonb_typeof(p_filters -> 'dimension') is distinct from 'string' or v_feature !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'dimension (a feature) is required' using errcode = '22023';
  end if;
  return query
  select fe.user_id, count(*)::numeric,
         jsonb_build_object('feature', v_feature, 'events', count(*), 'first_at', min(greatest(fe.event_at, u.created_at)),
                            'last_at', max(greatest(fe.event_at, u.created_at)),
                            'market', coalesce(min(m.market), 'unknown'), 'locale', min(u.locale)),
         count(*)::text
  from analytics_private.feature_events fe
  join public.users u on u.id = fe.user_id
  left join public.billing_markets m on m.user_id = fe.user_id
  where analytics_private.feature_of(fe.source, fe.format) = v_feature
    and fe.event_at < analytics_private.utc_start(p_to + 1)
    and greatest(fe.event_at, u.created_at) >= analytics_private.utc_start(p_from)
    and greatest(fe.event_at, u.created_at) < analytics_private.utc_start(p_to + 1)
    and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets))
    and (v_locales is null or u.locale = any (v_locales))
  group by fe.user_id;
end $$;

comment on function analytics_private.drill_feature_users(date, date, jsonb, integer, text) is
'{"description":"Accounts that used one feature (a feature_adoption row, passed as dimension) in the range, most actions first.","metric":"feature_adoption","filters":["dimension","market","locale"],"value":"actions with the feature in the range","unit":"count","order":"most actions first","detail":["feature","events","first_at","last_at","market","locale"]}';

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
