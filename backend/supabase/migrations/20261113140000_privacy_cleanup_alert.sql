-- Privacy cleanup alerts (docs/admin-analytics/runbook.md "Privacy cleanup alerts", api-contract.md "Phase 5").
-- Incident 2026-11-10: three account deletions failed every night from 2026-11-04, privacy_cleanup_health froze and
-- guest uploads paused after 30 hours; nothing reported it. This adds it to the existing in-app alert system:
-- - analytics.privacy_cleanup_health: one-row, alertable kpi metric over public.privacy_cleanup_health and
--   public.privacy_jobs (existing columns only). Aggregates only: no user, auth or job ids, no manifests, no paths.
-- - Three small, opt-in extensions of the alert engine, all driven by MetricMeta (no table or signature changes):
--   * "point_in_time": true marks a metric that reports the current state and ignores the range. Rules on it must use
--     window `today` with gt / lt (validate_alert_rule), so they are checked hourly and re-fire after their cooldown
--     while the condition holds; their message omits the window days.
--   * "alert_detail": "<text column>" names a text output column whose value is appended to the event message
--     (analytics_private.alert_detail). A failing detail read never stops the event.
--   * measures.<key>.severity = "high" prefixes the message with "[High severity] "; the admin app shows a pill.
--   evaluate_alerts and validate_alert_rule are replaced with the 20261104120000 bodies plus these branches; nothing
--   changes for metrics without the new keys (their messages stay byte-identical).
-- - Two rules are seeded, enabled: "Privacy cleanup unhealthy" (cleanup_unhealthy > 0, cooldown 24 h) and
--   "Account deletion overdue" (deletions_overdue > 0, cooldown 12 h). Admins can edit or disable them on Alerts.
-- analytics_api reaches the new metric only through EXECUTE (default privileges); it still cannot read the privacy
-- tables. No browser role can execute anything here (final revoke; contract_violations checks it).

-- ---------------------------------------------------------------------------
-- analytics.privacy_cleanup_health
-- ---------------------------------------------------------------------------

create function analytics.privacy_cleanup_health(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  cleanup_unhealthy bigint,
  last_run_failures bigint,
  hours_since_success numeric,
  hours_since_attempt numeric,
  deletions_overdue bigint,
  oldest_deletion_hours numeric,
  exports_overdue bigint,
  guest_backlog bigint,
  alert_detail text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  h record;
  v_success_ref timestamptz;
  v_attempt_ref timestamptz;
  v_since_success numeric;
  v_since_attempt numeric;
  v_failures bigint;
  v_unfinished boolean;
  v_reasons text[] := '{}';
  v_del_open bigint;
  v_del_overdue bigint;
  v_del_oldest timestamptz;
  v_del_attempts integer;
  v_del_retry timestamptz;
  v_del_steps text;
  v_exp_overdue bigint;
  v_parts text[] := '{}';
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array[]::text[]);

  -- Account deletions not complete (pending, or working with a lease). Overdue = created more than 24 hours ago.
  -- Step names are code constants; anything unexpected is reported as `other`, so no free text leaves the table.
  select count(*), count(*) filter (where j.created_at < v_now - interval '24 hours'), min(j.created_at),
         max(j.attempts) filter (where j.created_at < v_now - interval '24 hours'),
         min(j.retry_at) filter (where j.created_at < v_now - interval '24 hours')
  into v_del_open, v_del_overdue, v_del_oldest, v_del_attempts, v_del_retry
  from public.privacy_jobs j
  where j.kind = 'deletion' and j.status <> 'complete';
  select string_agg(s.step || ' ' || s.n, ', ' order by s.n desc, s.step) into v_del_steps
  from (select case when j.step ~ '^[a-z_]{1,32}$' then j.step else 'other' end as step, count(*) as n
        from public.privacy_jobs j
        where j.kind = 'deletion' and j.status <> 'complete' and j.created_at < v_now - interval '24 hours'
        group by 1) s;
  select count(*) into v_exp_overdue from public.privacy_jobs j
  where j.kind = 'export' and j.status <> 'complete' and j.created_at < v_now - interval '24 hours';

  deletions_overdue := v_del_overdue;
  oldest_deletion_hours := round(extract(epoch from v_now - v_del_oldest)::numeric / 3600, 1);
  exports_overdue := v_exp_overdue;

  select c.* into h from public.privacy_cleanup_health c where c.id;
  if h.id is null then
    cleanup_unhealthy := 1;
    alert_detail := 'public.privacy_cleanup_health has no row, so the cleanup state is unknown.';
    return next;
    return;
  end if;

  -- Never succeeded / never attempted: measured from when the health row was created.
  v_success_ref := coalesce(h.last_success_at, h.initialized_at);
  v_attempt_ref := coalesce(h.last_attempt_at, h.initialized_at);
  v_since_success := round(extract(epoch from v_now - v_success_ref)::numeric / 3600, 1);
  v_since_attempt := round(extract(epoch from v_now - v_attempt_ref)::numeric / 3600, 1);
  v_failures := h.failures;
  -- runCleanup sets last_attempt_at when it starts and last_success_at when it ends without failures, so an attempt
  -- newer than the last success that is over 15 minutes old (a run lasts at most 20 s) failed or was killed.
  v_unfinished := h.last_attempt_at is not null
                  and h.last_attempt_at > coalesce(h.last_success_at, '-infinity'::timestamptz)
                  and h.last_attempt_at < v_now - interval '15 minutes';

  if v_failures > 0 then
    v_reasons := v_reasons || format('the last run reported %s failure%s', v_failures, case when v_failures = 1 then '' else 's' end);
  elsif v_unfinished then
    v_reasons := v_reasons || 'the last run did not finish'::text;
  end if;
  if extract(epoch from v_now - v_success_ref) > 24 * 3600 then
    v_reasons := v_reasons || format('no successful run for %s h', v_since_success);
  end if;
  if extract(epoch from v_now - v_attempt_ref) > 26 * 3600 then
    v_reasons := v_reasons || format('no run attempted for %s h (the cron is not firing)', v_since_attempt);
  end if;

  cleanup_unhealthy := case when cardinality(v_reasons) > 0 then 1 else 0 end;
  last_run_failures := v_failures;
  hours_since_success := v_since_success;
  hours_since_attempt := v_since_attempt;
  guest_backlog := h.backlog;

  v_parts := v_parts || case when cardinality(v_reasons) > 0
    then 'Cleanup unhealthy: ' || array_to_string(v_reasons, '; ') || '.'
    else 'Cleanup healthy.' end;
  v_parts := v_parts || format('Last run %s; last success %s.',
    case when h.last_attempt_at is null then 'never'
         else to_char(h.last_attempt_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC (' || v_since_attempt || ' h ago)' end,
    case when h.last_success_at is null then 'never'
         else to_char(h.last_success_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC (' || v_since_success || ' h ago)' end);
  if extract(epoch from v_now - v_success_ref) > 30 * 3600 then
    v_parts := v_parts || 'Guest uploads are paused (503) until a run succeeds.'::text;
  elsif extract(epoch from v_now - v_success_ref) > 24 * 3600 then
    v_parts := v_parts || format('Guest uploads pause in %s h.', round(30 - v_since_success, 1));
  end if;
  v_parts := v_parts || case
    when v_del_overdue > 0 then format('%s account deletion%s pending over 24 h, oldest %s h; steps: %s; attempts up to %s; next retry %s UTC.',
      v_del_overdue, case when v_del_overdue = 1 then '' else 's' end, oldest_deletion_hours, v_del_steps, v_del_attempts,
      to_char(v_del_retry at time zone 'UTC', 'YYYY-MM-DD HH24:MI'))
    when v_del_open > 0 then format('No account deletion pending over 24 h (%s in progress).', v_del_open)
    else 'No account deletion pending.' end;
  if v_exp_overdue > 0 then
    v_parts := v_parts || format('%s data export%s pending over 24 h.', v_exp_overdue, case when v_exp_overdue = 1 then '' else 's' end);
  end if;
  if h.backlog > 0 then
    v_parts := v_parts || format('Guest-upload cleanup backlog: %s%s.', h.backlog,
      case when h.oldest_expired_at is not null
           then ' (oldest expired ' || to_char(h.oldest_expired_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' else '' end);
  end if;
  if cleanup_unhealthy = 1 or v_del_overdue > 0 or v_exp_overdue > 0 then
    v_parts := v_parts || 'Check public.privacy_jobs (step, attempts, retry_at) and the backend logs, then re-run /api/v1/guest-imports/cleanup from Vercel > cv-builder-backend > Settings > Cron Jobs (runbook: Privacy cleanup alerts).'::text;
  end if;
  alert_detail := left(array_to_string(v_parts, ' '), 900);
  return next;
end $$;

comment on function analytics.privacy_cleanup_health(date, date, text, text, boolean, text, jsonb) is
'{"title":"Privacy cleanup health","definition":"The current state of the daily privacy cleanup (Vercel cron /api/v1/guest-imports/cleanup at 03:00 UTC, PrivacyService.runCleanup), read from public.privacy_cleanup_health and public.privacy_jobs at the time of the call; the range, grain and currency do not apply. cleanup_unhealthy is 1 when any of: the last run reported failures (failures > 0); the last run did not finish (last_attempt_at newer than last_success_at and over 15 minutes old); no successful run for more than 24 hours (since initialized_at if none ever succeeded; guest uploads pause at 30 hours); no run attempted for more than 26 hours (the cron is not firing). deletions_overdue: account-deletion jobs (privacy_jobs kind deletion, status pending or working) created more than 24 hours ago; erasure is a legal obligation. oldest_deletion_hours: age of the oldest incomplete account deletion. exports_overdue: data-export jobs incomplete after 24 hours. guest_backlog: expired guest uploads still awaiting cleanup at the last run. alert_detail: a summary without personal data (counts, ages, step names, run times) appended to alert messages.","unit":"count","shape":"kpi","breakdowns":[],"filters":[],"consent_scoped":false,"alertable":true,"point_in_time":true,"alert_detail":"alert_detail","measures":{"cleanup_unhealthy":{"label":"Cleanup unhealthy (1 = yes)","unit":"count","description":"Last run failed or did not finish, no success for 24 h, or no run for 26 h"},"last_run_failures":{"label":"Failures in the last run","unit":"count"},"hours_since_success":{"label":"Hours since the last successful run","unit":"count","description":"Guest uploads pause at 30 hours"},"hours_since_attempt":{"label":"Hours since the last run","unit":"count"},"deletions_overdue":{"label":"Account deletions pending over 24 h","unit":"count","severity":"high","description":"Erasure requests are a legal obligation"},"oldest_deletion_hours":{"label":"Oldest pending account deletion (hours)","unit":"count","severity":"high"},"exports_overdue":{"label":"Data exports pending over 24 h","unit":"count"},"guest_backlog":{"label":"Expired guest uploads awaiting cleanup","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- Alert engine: point-in-time metrics, message detail, severity
-- ---------------------------------------------------------------------------

-- The text of a kpi metric's meta.alert_detail column for p_from..p_to, or null when the metric declares none. The
-- metric is re-checked against the catalog and the column must be one of its text output columns before both names are
-- formatted into the call with %I (as analytics_private.alert_value). Capped at 700 characters.
create function analytics_private.alert_detail(p_metric text, p_params jsonb, p_from date, p_to date)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_oid oid := analytics_private.metric_oid(p_metric);
  v_meta jsonb := analytics_private.try_jsonb(pg_catalog.obj_description(v_oid, 'pg_proc'));
  v_column text := v_meta ->> 'alert_detail';
  v_text text;
begin
  if v_oid is null or v_column is null
     or v_meta ->> 'alertable' is distinct from 'true' or v_meta ->> 'shape' is distinct from 'kpi' then
    return null;
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes) a(name, typ, mode)
    where p.oid = v_oid and a.mode = 't' and a.name = v_column and a.typ = 'text'::regtype
  ) then
    raise exception 'alert_detail % is not a text column of %', v_column, p_metric using errcode = '22023';
  end if;
  execute format(
    'select left(m.%I, 700) from analytics.%I(p_from => $1, p_to => $2, p_grain => ''day'', p_currency => $3, '
    'p_include_internal => $4, p_breakdown => null, p_filters => $5) m', v_column, p_metric)
  into strict v_text
  using p_from, p_to, coalesce(p_params ->> 'currency', 'usd'),
        coalesce((p_params ->> 'include_internal')::boolean, false), coalesce(p_params -> 'filters', '{}'::jsonb);
  return v_text;
exception
  when no_data_found then
    return null;
  when too_many_rows then
    raise exception 'metric % returned more than one row', p_metric using errcode = '22023';
end $$;

-- validate_alert_rule from 20261104120000_analytics_alerts.sql, unchanged except: a point-in-time metric
-- (meta.point_in_time = true) only takes window `today` with gt / lt (22023 otherwise).
create or replace function analytics_private.validate_alert_rule(
  p_name text, p_metric text, p_measure text, p_params jsonb, p_window text, p_condition text,
  p_threshold numeric, p_cooldown_hours integer
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_oid oid := analytics_private.metric_oid(p_metric);
  v_meta jsonb;
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_filters jsonb;
  v_key text;
  v_value jsonb;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if v_oid is null then
    raise exception 'unknown metric: %', p_metric using errcode = '22023';
  end if;
  v_meta := analytics_private.try_jsonb(pg_catalog.obj_description(v_oid, 'pg_proc'));
  if v_meta is null or v_meta ->> 'alertable' is distinct from 'true' or v_meta ->> 'shape' is distinct from 'kpi' then
    raise exception 'metric % is not alertable', p_metric using errcode = '22023';
  end if;
  if p_measure is null or not (p_measure = any (analytics_private.numeric_output_columns(v_oid))) then
    raise exception 'measure must be a numeric column of %', p_metric using errcode = '22023';
  end if;

  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'params must be an object' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(v_params) k where k not in ('currency', 'include_internal', 'filters') limit 1;
  if v_key is not null then
    raise exception 'unsupported params key: %', v_key using errcode = '22023';
  end if;
  if v_params ? 'currency' and (jsonb_typeof(v_params -> 'currency') <> 'string'
                                or v_params ->> 'currency' not in ('native', 'usd', 'try')) then
    raise exception 'currency must be native, usd or try' using errcode = '22023';
  end if;
  if v_params ? 'include_internal' and jsonb_typeof(v_params -> 'include_internal') <> 'boolean' then
    raise exception 'include_internal must be a boolean' using errcode = '22023';
  end if;
  v_filters := coalesce(v_params -> 'filters', '{}'::jsonb);
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'filters must be an object' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(v_filters) loop
    if not (v_meta -> 'filters' ? v_key) then
      raise exception 'unsupported filter for %: %', p_metric, v_key using errcode = '22023';
    end if;
    if not (jsonb_typeof(v_value) in ('string', 'number', 'boolean')
            or (jsonb_typeof(v_value) = 'array'
                and jsonb_array_length(v_value) between 1 and 50
                and not exists (select 1 from jsonb_array_elements(v_value) e
                                where jsonb_typeof(e) not in ('string', 'number', 'boolean')))) then
      raise exception 'filter % must be a scalar or an array of 1 to 50 scalars', v_key using errcode = '22023';
    end if;
  end loop;

  if p_window is null or p_window not in ('today', '1d', '7d', '30d') then
    raise exception 'window must be today, 1d, 7d or 30d' using errcode = '22023';
  end if;
  if p_condition is null or p_condition not in ('gt', 'lt', 'pct_change_gt', 'pct_change_lt') then
    raise exception 'condition must be gt, lt, pct_change_gt or pct_change_lt' using errcode = '22023';
  end if;
  -- `today` is a partial day: against a whole previous day it would read as a drop every morning.
  if p_window = 'today' and p_condition like 'pct_change%' then
    raise exception '%% change conditions need a complete window (1d, 7d or 30d)' using errcode = '22023';
  end if;
  -- A point-in-time metric reports the current state: a window of past days or a change against one means nothing.
  if v_meta ->> 'point_in_time' = 'true' and (p_window <> 'today' or p_condition not in ('gt', 'lt')) then
    raise exception '% reports the current state: use window today with condition gt or lt', p_metric using errcode = '22023';
  end if;
  if p_threshold is null or p_threshold = 'NaN'::numeric or p_threshold in ('Infinity'::numeric, '-Infinity'::numeric) then
    raise exception 'threshold must be a finite number' using errcode = '22023';
  end if;
  if p_cooldown_hours is null or p_cooldown_hours not between 1 and 720 then
    raise exception 'cooldown_hours must be between 1 and 720' using errcode = '22023';
  end if;

  v_params := jsonb_build_object(
    'currency', coalesce(v_params ->> 'currency', 'usd'),
    'include_internal', coalesce((v_params ->> 'include_internal')::boolean, false),
    'filters', v_filters);
  if length(v_params::text) > 2000 then
    raise exception 'params must not exceed 2000 characters' using errcode = '22023';
  end if;
  return v_params;
end $$;

-- evaluate_alerts from 20261104120000_analytics_alerts.sql, unchanged except how the message of a firing rule is built:
-- - point-in-time metrics: '<rule>: <label> is <value>, above|below <threshold>.' (no window days);
-- - a metric with meta.alert_detail: its text is appended after a space (read in its own subtransaction; on an error
--   the message says 'Details unavailable (<SQLSTATE>).' and the event is still inserted);
-- - a measure with severity "high": the message starts with '[High severity] '.
-- The whole message is still capped at 1,000 characters. Metrics without these keys get exactly the old message.
create or replace function analytics_private.evaluate_alerts(
  p_now timestamptz default now(), p_budget interval default interval '10 minutes'
) returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_rule record;
  w record;
  v_meta jsonb;
  v_unit text;
  v_label text;
  v_value numeric;
  v_baseline numeric;
  v_change numeric;
  v_fire boolean;
  v_message text;
  v_detail text;
  v_fired integer := 0;
  v_state text;
  v_started timestamptz := clock_timestamp();
begin
  -- Concurrent evaluations (a manual call during the hourly job) would double-fire.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('analytics_private.evaluate_alerts', 0));

  for v_rule in
    select r.*
    from admin_app.alert_rules r
    where r.enabled
    order by r.last_evaluated_at nulls first, r.created_at, r.id
  loop
    exit when clock_timestamp() - v_started > p_budget;
    select * into w from analytics_private.alert_window(v_rule."window", p_now);
    v_value := null;
    v_baseline := null;
    v_change := null;
    begin
      v_value := analytics_private.alert_value(v_rule.metric, v_rule.measure, v_rule.params, w.from_day, w.to_day);
      if v_rule.condition like 'pct_change%' then
        v_baseline := analytics_private.alert_value(v_rule.metric, v_rule.measure, v_rule.params, w.prev_from, w.prev_to);
        v_change := (v_value - v_baseline) / nullif(abs(v_baseline), 0);
      end if;
    exception when others or query_canceled then
      get stacked diagnostics v_state = returned_sqlstate;
      update admin_app.alert_rules r
      set last_evaluated_at = p_now, last_value = null, last_error = left(v_state || ': ' || sqlerrm, 500)
      where r.id = v_rule.id;
      continue;
    end;

    update admin_app.alert_rules r
    set last_evaluated_at = p_now, last_value = v_value, last_error = null
    where r.id = v_rule.id;

    v_fire := coalesce(case v_rule.condition
                         when 'gt' then v_value > v_rule.threshold
                         when 'lt' then v_value < v_rule.threshold
                         when 'pct_change_gt' then v_change > v_rule.threshold
                         when 'pct_change_lt' then v_change < v_rule.threshold
                       end, false)
      -- Cooldown.
      and not exists (select 1 from admin_app.alert_events e
                      where e.rule_id = v_rule.id and e.fired_at > p_now - make_interval(hours => v_rule.cooldown_hours))
      -- A complete window is reported once.
      and (v_rule."window" = 'today'
           or not exists (select 1 from admin_app.alert_events e
                          where e.rule_id = v_rule.id and e.window_from = w.from_day and e.window_to = w.to_day));

    if v_fire then
      v_meta := analytics_private.try_jsonb(pg_catalog.obj_description(analytics_private.metric_oid(v_rule.metric), 'pg_proc'));
      v_unit := coalesce(v_meta -> 'measures' -> v_rule.measure ->> 'unit', v_meta ->> 'unit');
      v_label := coalesce(v_meta -> 'measures' -> v_rule.measure ->> 'label', v_rule.measure);
      v_detail := null;
      if v_meta ? 'alert_detail' then
        begin
          v_detail := analytics_private.alert_detail(v_rule.metric, v_rule.params, w.from_day, w.to_day);
        exception when others or query_canceled then
          get stacked diagnostics v_state = returned_sqlstate;
          v_detail := 'Details unavailable (' || v_state || ').';
        end;
      end if;
      if v_meta ->> 'point_in_time' = 'true' then
        v_message := format('%s: %s is %s, %s.',
          v_rule.name,
          v_label,
          analytics_private.alert_number(v_value, v_unit),
          case v_rule.condition
            when 'lt' then 'below ' || analytics_private.alert_number(v_rule.threshold, v_unit)
            else 'above ' || analytics_private.alert_number(v_rule.threshold, v_unit)
          end);
      else
        v_message := format('%s: %s is %s for %s%s, %s.',
          v_rule.name,
          v_label,
          analytics_private.alert_number(v_value, v_unit),
          analytics_private.alert_days(w.from_day, w.to_day),
          case when v_rule."window" = 'today' then ' (so far)' else '' end,
          case v_rule.condition
            when 'gt' then 'above ' || analytics_private.alert_number(v_rule.threshold, v_unit)
            when 'lt' then 'below ' || analytics_private.alert_number(v_rule.threshold, v_unit)
            else format('%s%s vs %s for %s (threshold %s%s)',
                   case when v_change > 0 then '+' else '' end,
                   analytics_private.alert_number(v_change, 'ratio'),
                   analytics_private.alert_number(v_baseline, v_unit),
                   analytics_private.alert_days(w.prev_from, w.prev_to),
                   case when v_rule.threshold > 0 then '+' else '' end,
                   analytics_private.alert_number(v_rule.threshold, 'ratio'))
          end);
      end if;
      if v_meta -> 'measures' -> v_rule.measure ->> 'severity' = 'high' then
        v_message := '[High severity] ' || v_message;
      end if;
      if v_detail is not null and v_detail <> '' then
        v_message := v_message || ' ' || v_detail;
      end if;
      v_message := left(v_message, 1000);
      insert into admin_app.alert_events (rule_id, fired_at, window_from, window_to, value, baseline, message)
      values (v_rule.id, p_now, w.from_day, w.to_day, v_value, v_baseline, v_message);
      v_fired := v_fired + 1;
    end if;
  end loop;
  return v_fired;
end $$;

-- ---------------------------------------------------------------------------
-- Seeded rules (enabled; checked by the hourly analytics_alerts job)
-- ---------------------------------------------------------------------------

-- Written directly, like a migration-owned fixture: there is no admin to audit. params are normalised by
-- validate_alert_rule so the rows match what create_alert_rule would store. An existing rule of the same name wins.
insert into admin_app.alert_rules (name, metric, measure, params, "window", condition, threshold, cooldown_hours, enabled,
                                   created_by, updated_by)
select v.name, 'privacy_cleanup_health', v.measure,
       analytics_private.validate_alert_rule(v.name, 'privacy_cleanup_health', v.measure, '{}'::jsonb, 'today', 'gt', 0, v.cooldown),
       'today', 'gt', 0, v.cooldown, true, 'migration 20261113140000', 'migration 20261113140000'
from (values ('Privacy cleanup unhealthy', 'cleanup_unhealthy', 24),
             ('Account deletion overdue', 'deletions_overdue', 12)) v(name, measure, cooldown)
on conflict do nothing;

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
