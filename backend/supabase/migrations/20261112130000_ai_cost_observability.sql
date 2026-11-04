-- AI cost observability (docs/admin-analytics/metrics-inventory.md "AI cost"):
--   1. public.ai_usage_events: append-only ledger with one row per provider HTTP attempt (retries, timeouts, errors,
--      refusals and fallbacks included), written by the backend and scripts. Rows survive guest cleanup and account
--      erasure (links are set null), so the dashboard can be reconciled with the provider bill.
--   2. A subject segment for every run and attempt: external, internal (admin accounts), guest, restricted (pending
--      deletion or restricted processing), script (source script/test) and unattributed (an app attempt without a
--      subject). The p_filters key ai_segment selects segments; without it every metric keeps its previous
--      population (external accounts, plus internal ones when p_include_internal), so existing callers, alerts and
--      kpi_overview are unchanged. The dashboard sends every segment by default ("Include all AI costs").
--   3. analytics.ai_spend: the ledger-based total (ai_runs before the ledger started); analytics.ai_ledger_health
--      for the Data health page.
--   4. Model prices gain an optional cache-write rate; runs that reported tokens but no cost get an estimated
--      cost_usd (ai_runs.cost_usd_estimated) once their model is priced.

-- ---------------------------------------------------------------------------
-- Prices and estimated run costs
-- ---------------------------------------------------------------------------

-- Prompt-cache write rate (USD per 1M tokens); null bills cache writes at the input rate.
alter table public.ai_model_prices add column cache_write_usd numeric check (cache_write_usd >= 0);

-- cost_usd was re-priced from tokens after the run (backfill), not computed when it ran.
alter table public.ai_runs add column cost_usd_estimated boolean not null default false;

-- Stores the token re-priced cost on non-mock runs with tokens but no cost_usd whose model now has a price. Called by
-- the 03:30 refresh after the price sync and once below. Runs of accounts pending deletion or with restricted
-- processing are skipped (guard_ai_result rejects writes to them; run_cost still re-prices them at read time), and
-- a run the guard rejects for any other reason is skipped rather than failing the whole backfill.
create function public.backfill_ai_run_cost_estimates() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_run record;
  v_done integer := 0;
begin
  for v_run in
    select r.id,
           round(((coalesce(r.input_tokens, 0) - least(coalesce(r.cached_input_tokens, 0), coalesce(r.input_tokens, 0))) * p.input_usd
                  + least(coalesce(r.cached_input_tokens, 0), coalesce(r.input_tokens, 0)) * coalesce(p.cached_input_usd, p.input_usd)
                  + coalesce(r.output_tokens, 0) * p.output_usd) / 1e6, 6) as cost
    from public.ai_runs r
    cross join lateral (
      select mp.input_usd, mp.cached_input_usd, mp.output_usd
      from public.ai_model_prices mp
      where starts_with(r.model_name, mp.model_prefix)
      order by length(mp.model_prefix) desc
      limit 1
    ) p
    where r.cost_usd is null
      and r.provider <> 'mock'
      and (coalesce(r.input_tokens, 0) > 0 or coalesce(r.output_tokens, 0) > 0)
      and (r.user_id is null or exists (
        select 1 from public.users u
        where u.id = r.user_id and u.deletion_requested_at is null and u.processing_restricted_at is null))
  loop
    begin
      update public.ai_runs set cost_usd = v_run.cost, cost_usd_estimated = true
      where id = v_run.id and cost_usd is null;
      v_done := v_done + 1;
    exception when others then
      null;
    end;
  end loop;
  return v_done;
end $$;
revoke all on function public.backfill_ai_run_cost_estimates() from public, anon, authenticated;
grant execute on function public.backfill_ai_run_cost_estimates() to service_role;

-- ---------------------------------------------------------------------------
-- public.ai_usage_events: the per-attempt ledger
-- ---------------------------------------------------------------------------

-- No prompts, payloads, provider messages or personal data: ids, model names, counts and money only. ai_run_id and
-- user_id are set null when the run (guest cleanup, erasure) or the account (erasure) is deleted; subject_segment
-- keeps the segment the attempt had when it ran.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  source text not null check (source in ('app', 'script', 'test')),
  environment text not null check (environment ~ '^[a-z][a-z0-9_-]{0,31}$'),
  call_id uuid not null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  flow_type text not null check (char_length(flow_type) between 1 and 64),
  model_requested text not null check (char_length(model_requested) between 1 and 200),
  model_reported text check (char_length(model_reported) between 1 and 200),
  attempt_no integer not null check (attempt_no between 1 and 100),
  is_fallback boolean not null default false,
  outcome text not null check (outcome in ('success', 'refusal', 'truncated', 'empty_output', 'invalid_output',
                                           'usage_not_recorded', 'http_error', 'timeout', 'network_error', 'error')),
  http_status integer check (http_status between 100 and 599),
  provider_request_id text check (char_length(provider_request_id) <= 200),
  input_tokens bigint check (input_tokens >= 0),
  cached_input_tokens bigint check (cached_input_tokens >= 0),
  cache_write_input_tokens bigint check (cache_write_input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  reasoning_tokens bigint check (reasoning_tokens >= 0),
  cost_usd numeric(14, 6) check (cost_usd >= 0),
  latency_ms integer check (latency_ms >= 0),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  subject text check (subject in ('user', 'guest')),
  subject_segment text not null check (subject_segment in ('external', 'internal', 'guest', 'restricted', 'script', 'unattributed'))
);
create index ai_usage_events_occurred_at_idx on public.ai_usage_events(occurred_at);
-- The FK actions on run and account deletion look rows up by these.
create index ai_usage_events_ai_run_idx on public.ai_usage_events(ai_run_id) where ai_run_id is not null;
create index ai_usage_events_user_idx on public.ai_usage_events(user_id) where user_id is not null;
alter table public.ai_usage_events enable row level security;
-- Supabase's default privileges grant every table to service_role too: only reading and appending are kept.
revoke all on public.ai_usage_events from public, anon, authenticated, service_role;
grant select, insert on public.ai_usage_events to service_role;

-- Insert: the database derives the segment. A link to a run or account that no longer exists is dropped instead of
-- failing the write, and an attempt for an account pending deletion or with restricted processing keeps no account
-- link (it is billing metadata, recorded as segment restricted).
create function public.ai_usage_event_defaults() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_internal boolean := false;
  v_restricted boolean := false;
begin
  new.recorded_at := now();
  if new.ai_run_id is not null and not exists (select 1 from public.ai_runs r where r.id = new.ai_run_id) then
    new.ai_run_id := null;
  end if;
  if new.user_id is not null then
    select u.is_internal, (u.deletion_requested_at is not null or u.processing_restricted_at is not null)
    into v_internal, v_restricted from public.users u where u.id = new.user_id;
    if not found then
      new.user_id := null;
    end if;
  end if;
  new.subject_segment := case
    when new.source <> 'app' then 'script'
    when new.user_id is not null and v_restricted then 'restricted'
    when new.user_id is not null and v_internal then 'internal'
    when new.user_id is not null then 'external'
    -- The account went away while the call ran: only erasure deletes accounts.
    when new.subject = 'user' then 'restricted'
    when new.subject = 'guest' then 'guest'
    else 'unattributed'
  end;
  if new.subject_segment = 'restricted' then
    new.user_id := null;
  end if;
  return new;
end $$;
create trigger ai_usage_event_defaults before insert on public.ai_usage_events
  for each row execute function public.ai_usage_event_defaults();

-- Append-only: the only permitted update is the FK action clearing ai_run_id / user_id; rows are never deleted.
create function public.ai_usage_events_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['ai_run_id', 'user_id']) = (to_jsonb(old) - array['ai_run_id', 'user_id'])
     and (new.ai_run_id is null or new.ai_run_id = old.ai_run_id)
     and (new.user_id is null or new.user_id = old.user_id) then
    return new;
  end if;
  raise exception 'ai_usage_events is append-only';
end $$;
create trigger ai_usage_events_append_only before update or delete on public.ai_usage_events
  for each row execute function public.ai_usage_events_append_only();
revoke all on function public.ai_usage_event_defaults() from public, anon, authenticated;
revoke all on function public.ai_usage_events_append_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared definitions
-- ---------------------------------------------------------------------------

-- run_cost (20261031120000) with the backfill flag and the run's segment appended. A backfilled cost is estimated,
-- not exact.
create or replace view analytics_private.run_cost as
select r.id,
       r.user_id,
       r.flow_type,
       r.provider,
       r.model_name,
       r.status,
       r.started_at,
       r.completed_at,
       r.tailoring_session_id,
       r.parent_run_id,
       r.input_tokens,
       r.cached_input_tokens,
       r.output_tokens,
       r.total_tokens,
       coalesce(
         r.cost_usd,
         ((coalesce(r.input_tokens, 0) - least(coalesce(r.cached_input_tokens, 0), coalesce(r.input_tokens, 0))) * p.input_usd
          + least(coalesce(r.cached_input_tokens, 0), coalesce(r.input_tokens, 0)) * coalesce(p.cached_input_usd, p.input_usd)
          + coalesce(r.output_tokens, 0) * p.output_usd) / 1e6
       ) as cost_usd,
       (r.cost_usd is not null and not r.cost_usd_estimated) as cost_is_exact,
       (r.cost_usd is not null or p.model_prefix is not null) as is_priced,
       (coalesce(r.total_tokens, 0) > 0 or coalesce(r.input_tokens, 0) > 0 or coalesce(r.output_tokens, 0) > 0) as has_tokens,
       (r.user_id is null) as is_guest,
       coalesce(u.is_internal, false) as is_internal_user,
       (u.id is not null and u.deletion_requested_at is null and u.processing_restricted_at is null) as is_analysis_user,
       case when r.user_id is null then 'guest'
            when u.deletion_requested_at is not null or u.processing_restricted_at is not null then 'restricted'
            when u.is_internal then 'internal'
            else 'external' end as segment
from public.ai_runs r
left join public.users u on u.id = r.user_id
left join lateral (
  -- starts_with instead of LIKE: '_' and '%' in a model id must not act as wildcards.
  select mp.model_prefix, mp.input_usd, mp.cached_input_usd, mp.output_usd
  from public.ai_model_prices mp
  where r.cost_usd is null and starts_with(r.model_name, mp.model_prefix)
  order by length(mp.model_prefix) desc
  limit 1
) p on true
where r.provider <> 'mock';

-- The segments a metric counts: the ai_segment filter when present, else the previous population (external
-- accounts, plus admin accounts when p_include_internal).
create function analytics_private.ai_segments(p_filters jsonb, p_include_internal boolean) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(analytics_private.filter_values(p_filters, 'ai_segment'),
                  case when p_include_internal then array['external', 'internal'] else array['external'] end)
$$;

-- One row per ledger attempt with its segment and cost. cost_usd is the cost stored at write time, else the tokens
-- re-priced with the longest matching prefix in ai_model_prices (cache reads and writes are parts of input_tokens).
-- The segment follows the account while it exists (an account flagged internal later moves), else the segment
-- stored when the attempt ran.
create view analytics_private.ai_usage_ledger as
select e.id,
       e.occurred_at,
       e.source,
       e.environment,
       e.call_id,
       e.provider,
       e.flow_type,
       coalesce(e.model_reported, e.model_requested) as model_name,
       e.model_requested,
       e.attempt_no,
       e.is_fallback,
       e.outcome,
       e.http_status,
       e.input_tokens,
       e.cached_input_tokens,
       e.cache_write_input_tokens,
       e.output_tokens,
       e.reasoning_tokens,
       coalesce(
         e.cost_usd,
         ((coalesce(e.input_tokens, 0) - least(coalesce(e.cached_input_tokens, 0) + coalesce(e.cache_write_input_tokens, 0), coalesce(e.input_tokens, 0))) * p.input_usd
          + least(coalesce(e.cached_input_tokens, 0), coalesce(e.input_tokens, 0)) * coalesce(p.cached_input_usd, p.input_usd)
          + least(coalesce(e.cache_write_input_tokens, 0), greatest(coalesce(e.input_tokens, 0) - coalesce(e.cached_input_tokens, 0), 0)) * coalesce(p.cache_write_usd, p.input_usd)
          + coalesce(e.output_tokens, 0) * p.output_usd) / 1e6
       ) as cost_usd,
       (e.cost_usd is not null) as cost_is_exact,
       (e.input_tokens is not null or e.output_tokens is not null) as has_usage,
       e.ai_run_id,
       e.user_id,
       case when e.source <> 'app' then 'script'
            when u.id is null then e.subject_segment
            when u.deletion_requested_at is not null or u.processing_restricted_at is not null then 'restricted'
            when u.is_internal then 'internal'
            else 'external' end as segment
from public.ai_usage_events e
left join public.users u on u.id = e.user_id
left join lateral (
  select mp.input_usd, mp.cached_input_usd, mp.cache_write_usd, mp.output_usd
  from public.ai_model_prices mp
  where e.cost_usd is null and (e.input_tokens is not null or e.output_tokens is not null)
    and starts_with(coalesce(e.model_reported, e.model_requested), mp.model_prefix)
  order by length(mp.model_prefix) desc
  limit 1
) p on true;

-- When the ledger took over from ai_runs: the first attempt the production app recorded (infinity before that).
-- Script and development attempts never move it: they have no ai_runs counterpart to replace.
create function analytics_private.ai_ledger_start() returns timestamptz
language sql stable set search_path = ''
as $$
  select coalesce(min(e.occurred_at), 'infinity'::timestamptz)
  from public.ai_usage_events e
  where e.source = 'app' and e.environment = 'production'
$$;

-- The AI metric population (20261102130000), now by segment: analytics_private.ai_segments(p_filters,
-- p_include_internal). Without an ai_segment filter it is unchanged (non-guest runs of analysis accounts, admin
-- accounts only when p_include_internal). The metrics that accept ai_segment validate it; for the others the key
-- cannot reach this function.
create or replace function analytics_private.ai_run_scope(p_from date, p_to date, p_include_internal boolean, p_filters jsonb)
returns table (
  id uuid, user_id uuid, flow_type text, provider text, model_name text, status text,
  started_at timestamptz, completed_at timestamptz, tailoring_session_id uuid,
  input_tokens bigint, cached_input_tokens bigint, output_tokens bigint, total_tokens bigint,
  cost_usd numeric, cost_is_exact boolean, unpriced boolean, market text,
  is_import_sub_run boolean, is_escalation boolean, is_non_model_failure boolean, failure_class text
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_flows text[] := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models text[] := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers text[] := analytics_private.filter_values(p_filters, 'ai_provider');
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_segments text[] := analytics_private.ai_segments(p_filters, p_include_internal);
  v_start timestamptz := analytics_private.utc_start(p_from);
  v_end timestamptz := analytics_private.utc_start(p_to + 1);
begin
  return query
  select rc.id, rc.user_id, rc.flow_type, rc.provider, rc.model_name, rc.status,
         rc.started_at, rc.completed_at, rc.tailoring_session_id,
         rc.input_tokens::bigint, rc.cached_input_tokens::bigint, rc.output_tokens::bigint, rc.total_tokens::bigint,
         rc.cost_usd, rc.cost_is_exact,
         (rc.cost_usd is null and rc.has_tokens),
         coalesce(bm.market, 'unknown'),
         -- import_improve sub-runs: only they carry flow_input.language (KB ai_cost_per_outcome / ai_wasted_spend).
         coalesce(rc.flow_type = 'professional_summary'
                  or (rc.flow_type in ('block_suggest', 'skills_pool') and r.input_payload -> 'flow_input' ? 'language'), false),
         -- skills_pool escalation: the second run of an editor click (KB ai_wasted_spend).
         coalesce(rc.flow_type = 'skills_pool' and r.input_payload -> 'flow_input' ? 'excluded_skills', false),
         -- Failures unrelated to the model (KB ai_daily_cost_anomalies): privacy / claim, watchdog without usage.
         coalesce(rc.status = 'failed'
                  and (r.error_message in ('AI permission withdrawn', 'Processing restricted',
                                           'Guest AI permission changed', 'Guest processing superseded')
                       or (r.error_message like 'AI run timed out%' and r.input_tokens is null)), false),
         -- Failure class (KB ai_wasted_spend B, from tables/ai_runs.md); the message itself is never returned.
         case
           when rc.status <> 'failed' then null
           when r.error_message like 'Structured output validation failed%' then 'output_contract_invalid'
           when r.error_message like 'AI run timed out%' and r.input_tokens is null then 'watchdog_timeout_no_usage'
           when r.error_message like 'AI run timed out%' then 'watchdog_timeout'
           when r.error_message in ('AI permission withdrawn', 'Processing restricted',
                                    'Guest AI permission changed', 'Guest processing superseded') then 'privacy_or_claim'
           when r.error_message like 'Some numbers could not be verified%' then 'translation_numbers_unverified'
           when r.error_message ~ 'reason=[A-Za-z_]+' then substring(r.error_message from 'reason=([A-Za-z_]+)')
           when r.error_message = 'AI processing could not be completed' then 'generic'
           else 'other'
         end
  from analytics_private.run_cost rc
  join public.ai_runs r on r.id = rc.id
  left join public.billing_markets bm on bm.user_id = rc.user_id
  where rc.segment = any (v_segments)
    and rc.started_at >= v_start
    and rc.started_at < v_end
    and (v_flows is null or rc.flow_type = any (v_flows))
    and (v_models is null or rc.model_name = any (v_models))
    and (v_providers is null or rc.provider = any (v_providers))
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));
end $$;

-- ---------------------------------------------------------------------------
-- analytics.ai_cost: ai_segment filter and breakdown
-- ---------------------------------------------------------------------------

create or replace function analytics.ai_cost(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, cost numeric, runs bigint, unpriced_runs bigint, exact_share numeric, fx_provisional boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_flows text[];
  v_models text[];
  v_providers text[];
  v_segments text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider', 'ai_segment'], array['ai_flow', 'ai_model', 'ai_provider', 'ai_segment']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_flows := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers := analytics_private.filter_values(p_filters, 'ai_provider');
  v_segments := analytics_private.ai_segments(p_filters, p_include_internal);

  return query
  with base as (
    select date_trunc(p_grain, rc.started_at at time zone 'UTC')::date as b,
           case p_breakdown when 'ai_flow' then rc.flow_type
                            when 'ai_model' then rc.model_name
                            when 'ai_provider' then rc.provider
                            when 'ai_segment' then rc.segment end as dim,
           rc.cost_usd,
           rc.cost_is_exact,
           (rc.cost_usd is null and rc.has_tokens) as unpriced,
           -- Only priced runs are converted, and only in try mode.
           (p_currency = 'try' and rc.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.run_cost rc
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', rc.started_at at time zone 'UTC')::date
    where rc.segment = any (v_segments)
      and rc.started_at >= v_start
      and rc.started_at < v_end
      and (v_flows is null or rc.flow_type = any (v_flows))
      and (v_models is null or rc.model_name = any (v_models))
      and (v_providers is null or rc.provider = any (v_providers))
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_breakdown is null
  )
  select k.b,
         d.dim,
         case when bool_or(f.needs_fx and f.usd_try is null) then null
              else round(coalesce(sum(case when p_currency = 'try' then f.cost_usd * f.usd_try else f.cost_usd end), 0), 6) end,
         count(f.b),
         count(f.b) filter (where f.unpriced),
         round(sum(f.cost_usd) filter (where f.cost_is_exact) / nullif(sum(f.cost_usd), 0), 4),
         coalesce(bool_or(f.needs_fx and f.provisional), false)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join base f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.ai_cost(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI cost","definition":"AI spend per run start date (UTC), from ai_runs. Each run costs its stored cost_usd (exact, from 2026-10-27) or, when that is null, its tokens re-priced with the longest matching model prefix in ai_model_prices (estimated; a re-priced cost stored later by the backfill also counts as estimated). Runs with tokens but no price count as unpriced and add no cost, so cost is a lower bound while unpriced_runs > 0. Mock runs are excluded. ai_segment selects whose runs count: external, internal (admin accounts), guest (pre-signup uploads), restricted (accounts pending deletion or with restricted processing); without it, external accounts plus internal ones when included (the population before segments existed). Runs deleted with their guest upload or erased account, failed provider attempts, retries and script calls never reach ai_runs: analytics.ai_spend counts them. Cost is USD for native and usd; try converts each run at the monthly USD->TRY average of its month, falling back to the latest earlier month (fx_provisional when that rate is month-to-date, from an earlier month or missing; with no rate at all the bucket cost is null). exact_share is the share of the shown cost that is the cost stored when the run ran, rather than re-priced from tokens; it says nothing about how much of the provider bill is covered.","unit":"currency","shape":"timeseries","breakdowns":["ai_flow","ai_model","ai_provider","ai_segment"],"filters":["ai_flow","ai_model","ai_provider","ai_segment"],"kb":"new_analysis/ai_cost/ai_cost_per_outcome.md","consent_scoped":false,"alertable":false,"drill":true,"measures":{"cost":{"label":"AI cost","unit":"currency","description":"Exact + estimated; USD unless currency = try"},"runs":{"label":"AI runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count","description":"Runs with tokens but no stored cost and no configured model price"},"exact_share":{"label":"Stored-cost share","unit":"ratio","description":"Share of the shown cost stored when the run ran (the rest is re-priced from tokens). Not coverage of the provider bill."}}}';

-- ---------------------------------------------------------------------------
-- AI cost drill: accepts the ai_segment filter the AI cost card sends
-- ---------------------------------------------------------------------------

create or replace function analytics_private.ai_runs_by_user(p_from date, p_to date, p_filters jsonb, p_failed_only boolean)
returns table (user_id uuid, runs bigint, failed_runs bigint, unpriced_runs bigint, cost_usd numeric,
               last_run_at timestamptz, last_failed_at timestamptz, flows jsonb, models jsonb)
language plpgsql stable set search_path = ''
as $$
declare
  v_flows text[] := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models text[] := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers text[] := analytics_private.filter_values(p_filters, 'ai_provider');
  -- Guests have no account, and drill_users drops restricted and (always) admin accounts.
  v_segments text[] := analytics_private.filter_values(p_filters, 'ai_segment');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['ai_flow', 'ai_model', 'ai_provider', 'ai_segment']);
  return query
  select rc.user_id,
         count(*),
         count(*) filter (where rc.status = 'failed'),
         count(*) filter (where rc.cost_usd is null and rc.has_tokens),
         round(coalesce(sum(rc.cost_usd), 0), 6),
         max(rc.started_at),
         max(rc.started_at) filter (where rc.status = 'failed'),
         to_jsonb(array_agg(distinct rc.flow_type order by rc.flow_type)),
         coalesce(to_jsonb(array_agg(distinct rc.model_name order by rc.model_name) filter (where rc.model_name is not null)), '[]'::jsonb)
  from analytics_private.run_cost rc
  where not rc.is_guest
    and rc.started_at >= analytics_private.utc_start(p_from)
    and rc.started_at < analytics_private.utc_start(p_to + 1)
    and (not p_failed_only or rc.status = 'failed')
    and (v_flows is null or rc.flow_type = any (v_flows))
    and (v_models is null or rc.model_name = any (v_models))
    and (v_providers is null or rc.provider = any (v_providers))
    and (v_segments is null or rc.segment = any (v_segments))
  group by rc.user_id;
end $$;

comment on function analytics_private.drill_ai_cost_users(date, date, jsonb, integer, text) is
'{"description":"Accounts with AI runs in the range, highest AI cost (USD, exact + estimated as in analytics.ai_cost) first. Guest runs have no account and admin and restricted accounts are never listed, so only the external segment can return rows.","metric":"ai_cost","filters":["ai_flow","ai_model","ai_provider","ai_segment"],"value":"AI cost in USD","unit":"currency","order":"highest cost first","detail":["cost_usd","runs","unpriced_runs","last_run_at","flows","models"]}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost_anomalies and analytics.ai_tokens_by_model: accept ai_segment (bodies otherwise unchanged)
-- ---------------------------------------------------------------------------

create or replace function analytics.ai_cost_anomalies(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, cost numeric, runs bigint, tokens bigint, unpriced_runs bigint,
  terminal_runs bigint, model_failed_runs bigint, model_failure_rate numeric,
  cost_baseline numeric, cost_upper_band numeric, cost_z numeric,
  tokens_baseline numeric, tokens_upper_band numeric, tokens_z numeric, baseline_buckets bigint,
  cost_spike boolean, token_spike boolean, jump_from_flat_baseline boolean, failure_spike boolean,
  is_anomaly boolean, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  -- KB params: z threshold 3, failure-rate threshold 20% with at least 5 terminal runs.
  c_z constant numeric := 3;
  c_failure_rate constant numeric := 0.20;
  c_min_terminal constant integer := 5;
  v_step interval;
  v_first date;
  v_base_from date;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider'], array['ai_flow', 'ai_model', 'ai_provider', 'market', 'ai_segment']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_step := ('1 ' || p_grain)::interval;
  v_first := date_trunc(p_grain, r.from_day::timestamp)::date;
  -- The baseline of the first bucket needs the 7 buckets before the range.
  v_base_from := (v_first - 7 * v_step)::date;

  return query
  with base as (
    select analytics_private.bucket(s.started_at, p_grain) as b,
           case p_breakdown when 'ai_flow' then s.flow_type
                            when 'ai_model' then s.model_name
                            when 'ai_provider' then s.provider end as dim,
           s.status, s.is_non_model_failure, s.unpriced, coalesce(s.total_tokens, 0) as tok,
           s.cost_usd * case when p_currency = 'try' then x.usd_try else 1 end as amt,
           (p_currency = 'try' and s.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.ai_run_scope(v_base_from, r.to_day, p_include_internal, p_filters) s
    left join analytics_private.fx_months(v_base_from, r.to_day) x
      on x.month = date_trunc('month', s.started_at at time zone 'UTC')::date
  ),
  -- Gap-free spine. The overall series starts at the window start; a breakdown series starts at its first run in
  -- the window, so a flow launched later is not compared against artificial zeros (KB spine per flow).
  dims as (
    select base.dim, min(base.b) as first_b from base where p_breakdown is not null group by base.dim
    union all
    select null, v_base_from where p_breakdown is null
  ),
  series as (
    select k.b, d.dim, (k.b >= d.first_b) as active,
           count(f.b) as n_runs,
           coalesce(sum(f.tok), 0) as n_tokens,
           count(*) filter (where f.unpriced) as n_unpriced,
           count(*) filter (where f.status = 'completed' or (f.status = 'failed' and not f.is_non_model_failure)) as n_terminal,
           count(*) filter (where f.status = 'failed' and not f.is_non_model_failure) as n_model_failed,
           case when bool_or(f.needs_fx and f.usd_try is null) then null else coalesce(sum(f.amt), 0) end as amount,
           coalesce(bool_or(f.needs_fx and f.provisional), false) as provisional
    from analytics_private.buckets(v_base_from, r.to_day, p_grain) k(b)
    cross join dims d
    left join base f on f.b = k.b and f.dim is not distinct from d.dim
    group by k.b, d.dim, d.first_b
  ),
  rolling as (
    -- Baseline = the 7 buckets before the current one (current bucket excluded, as in the KB).
    select s.*,
           count(*) filter (where s.active) over w as n_base,
           avg(s.amount) filter (where s.active) over w as cost_mean,
           stddev_samp(s.amount) filter (where s.active) over w as cost_sd,
           count(s.amount) filter (where s.active) over w as n_cost_base,
           avg(s.n_tokens) filter (where s.active) over w as tokens_mean,
           stddev_samp(s.n_tokens) filter (where s.active) over w as tokens_sd
    from series s
    window w as (partition by s.dim order by s.b rows between 7 preceding and 1 preceding)
  ),
  scored as (
    select ro.*,
           case when ro.active and ro.n_base = 7 and ro.n_cost_base = 7
                then (ro.amount - ro.cost_mean) / nullif(ro.cost_sd, 0) end as z_cost,
           case when ro.active and ro.n_base = 7
                then (ro.n_tokens - ro.tokens_mean) / nullif(ro.tokens_sd, 0) end as z_tokens,
           ro.n_model_failed::numeric / nullif(ro.n_terminal, 0) as fail_rate
    from rolling ro
  ),
  flagged as (
    select sc.*,
           coalesce(sc.z_cost > c_z, false) as f_cost,
           coalesce(sc.z_tokens > c_z, false) as f_tokens,
           coalesce(sc.active and sc.n_base = 7 and coalesce(sc.tokens_sd, 0) = 0
                    and sc.n_tokens > 0 and sc.n_tokens > 2 * sc.tokens_mean, false) as f_jump,
           coalesce(sc.n_terminal >= c_min_terminal and sc.fail_rate > c_failure_rate, false) as f_failure
    from scored sc
  )
  select fl.b,
         fl.dim,
         round(fl.amount, 6),
         fl.n_runs,
         fl.n_tokens::bigint,
         fl.n_unpriced,
         fl.n_terminal,
         fl.n_model_failed,
         round(fl.fail_rate, 4),
         case when fl.active then round(fl.cost_mean, 6) end,
         case when fl.active then round(fl.cost_mean + c_z * coalesce(fl.cost_sd, 0), 6) end,
         round(fl.z_cost, 2),
         case when fl.active then round(fl.tokens_mean, 0) end,
         case when fl.active then round(fl.tokens_mean + c_z * coalesce(fl.tokens_sd, 0), 0) end,
         round(fl.z_tokens, 2),
         case when fl.active then fl.n_base else 0 end,
         fl.f_cost,
         fl.f_tokens,
         fl.f_jump,
         fl.f_failure,
         (fl.f_cost or fl.f_tokens or fl.f_jump or fl.f_failure),
         fl.provisional
  from flagged fl
  where fl.b >= v_first
  order by fl.b, fl.dim;
end $$;

create or replace function analytics.ai_tokens_by_model(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, total_tokens bigint, input_tokens bigint, cached_input_tokens bigint,
  output_tokens bigint, runs bigint, runs_without_tokens bigint, completed_runs bigint, failed_runs bigint,
  cost numeric, unpriced_runs bigint, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_model', 'ai_provider', 'ai_flow'], array['ai_flow', 'ai_model', 'ai_provider', 'market', 'ai_segment']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with base as (
    select analytics_private.bucket(s.started_at, p_grain) as b,
           case p_breakdown when 'ai_flow' then s.flow_type
                            when 'ai_model' then s.model_name
                            when 'ai_provider' then s.provider end as dim,
           s.status, s.unpriced, s.input_tokens, s.cached_input_tokens, s.output_tokens, s.total_tokens,
           s.cost_usd * case when p_currency = 'try' then x.usd_try else 1 end as amt,
           (p_currency = 'try' and s.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, p_filters) s
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', s.started_at at time zone 'UTC')::date
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_breakdown is null
  )
  select k.b,
         d.dim,
         coalesce(sum(f.total_tokens), 0)::bigint,
         coalesce(sum(f.input_tokens), 0)::bigint,
         coalesce(sum(f.cached_input_tokens), 0)::bigint,
         coalesce(sum(f.output_tokens), 0)::bigint,
         count(f.b),
         count(*) filter (where f.b is not null and f.total_tokens is null and f.input_tokens is null and f.output_tokens is null),
         count(*) filter (where f.status = 'completed'),
         count(*) filter (where f.status = 'failed'),
         case when bool_or(f.needs_fx and f.usd_try is null) then null else round(coalesce(sum(f.amt), 0), 6) end,
         count(*) filter (where f.unpriced),
         coalesce(bool_or(f.needs_fx and f.provisional), false)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join base f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

-- Their comments gain the filter and a sentence on segments; everything else is kept as it is.
do $$
declare
  v_fn regprocedure;
  v_meta jsonb;
begin
  for v_fn in
    select 'analytics.ai_cost_anomalies(date, date, text, text, boolean, text, jsonb)'::regprocedure
    union all
    select 'analytics.ai_tokens_by_model(date, date, text, text, boolean, text, jsonb)'::regprocedure
  loop
    v_meta := analytics_private.try_jsonb(pg_catalog.obj_description(v_fn, 'pg_proc'));
    execute format('comment on function %s is %L', v_fn, (v_meta || jsonb_build_object(
      'filters', (v_meta -> 'filters') || '["ai_segment"]'::jsonb,
      'definition', (v_meta ->> 'definition')
        || ' ai_segment selects whose runs count (external, internal, guest, restricted, as in AI cost); without it, external accounts plus internal ones when included.'
    ))::text);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- analytics.ai_spend: everything the providers were asked for, from the ledger
-- ---------------------------------------------------------------------------

create function analytics.ai_spend(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, cost numeric, attempts bigint, failed_attempts bigint, no_usage_attempts bigint,
  unpriced_attempts bigint, pre_ledger_cost numeric, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_t0 timestamptz := analytics_private.ai_ledger_start();
  v_flows text[];
  v_models text[];
  v_providers text[];
  v_segments text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider', 'ai_segment'], array['ai_flow', 'ai_model', 'ai_provider', 'ai_segment']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_flows := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers := analytics_private.filter_values(p_filters, 'ai_provider');
  v_segments := analytics_private.ai_segments(p_filters, p_include_internal);

  return query
  with src as (
    -- Ledger attempts. App attempts before the production ledger start duplicate ai_runs rows counted below.
    select l.occurred_at as at, l.flow_type, l.model_name, l.provider, l.segment, l.cost_usd,
           (l.outcome <> 'success') as failed,
           (not l.has_usage) as no_usage,
           (l.has_usage and l.cost_usd is null) as unpriced,
           false as pre_ledger
    from analytics_private.ai_usage_ledger l
    where l.occurred_at >= v_start
      and l.occurred_at < v_end
      and (l.source <> 'app' or l.occurred_at >= v_t0)
    union all
    -- Before the ledger: one row per surviving ai_runs row (deleted guest runs, retries and scripts are missing).
    select rc.started_at, rc.flow_type, rc.model_name, rc.provider, rc.segment, rc.cost_usd,
           (rc.status = 'failed'),
           (not rc.has_tokens),
           (rc.cost_usd is null and rc.has_tokens),
           true
    from analytics_private.run_cost rc
    where rc.started_at >= v_start
      and rc.started_at < least(v_end, v_t0)
  ),
  base as (
    select analytics_private.bucket(s.at, p_grain) as b,
           case p_breakdown when 'ai_flow' then s.flow_type
                            when 'ai_model' then s.model_name
                            when 'ai_provider' then s.provider
                            when 'ai_segment' then s.segment end as dim,
           s.cost_usd, s.failed, s.no_usage, s.unpriced, s.pre_ledger,
           (p_currency = 'try' and s.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from src s
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', s.at at time zone 'UTC')::date
    where s.segment = any (v_segments)
      and (v_flows is null or s.flow_type = any (v_flows))
      and (v_models is null or s.model_name = any (v_models))
      and (v_providers is null or s.provider = any (v_providers))
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_breakdown is null
  )
  select k.b,
         d.dim,
         case when bool_or(f.needs_fx and f.usd_try is null) then null
              else round(coalesce(sum(case when p_currency = 'try' then f.cost_usd * f.usd_try else f.cost_usd end), 0), 6) end,
         count(f.b),
         count(f.b) filter (where f.failed),
         count(f.b) filter (where f.no_usage),
         count(f.b) filter (where f.unpriced),
         case when bool_or(f.needs_fx and f.pre_ledger and f.usd_try is null) then null
              else round(coalesce(sum(case when p_currency = 'try' then f.cost_usd * f.usd_try else f.cost_usd end)
                                  filter (where f.pre_ledger), 0), 6) end,
         coalesce(bool_or(f.needs_fx and f.provisional), false)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join base f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.ai_spend(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI spend (all provider attempts)","definition":"Everything the AI providers were asked for, per attempt start date (UTC), from the append-only ledger public.ai_usage_events: one row per provider HTTP attempt, including retries, timeouts, errors, refusals, model fallbacks and script calls, and kept when a guest upload or an account is deleted. This is the figure to compare with the provider bill. Each attempt costs its cost_usd stored when it ran, else its tokens re-priced with ai_model_prices; attempts with tokens but no price are unpriced and add no cost. Attempts without usage (failed requests, timeouts) add no cost: providers do not bill most of them, but a timed-out request can still be billed, so no_usage_attempts > 0 can mean a small undercount. Before the ledger started (the first attempt the production app recorded, 2026-11-05 or later) the series falls back to ai_runs: the surviving runs of every segment, so deleted guest runs, retries and script calls are missing there (pre_ledger_cost is that part). ai_segment selects whose attempts count: external, internal (admin accounts), guest, restricted (accounts pending deletion or with restricted processing), script (scripts and tests, source script/test) and unattributed (app attempts without a subject); without it, external accounts plus internal ones when included. ai_model is the model the provider reported (else the one requested). Cost is USD for native and usd; try converts at the monthly USD->TRY rate as in AI cost (fx_provisional).","unit":"currency","shape":"timeseries","breakdowns":["ai_segment","ai_flow","ai_model","ai_provider"],"filters":["ai_flow","ai_model","ai_provider","ai_segment"],"kb":"new_analysis/ai_cost/ai_cost_per_outcome.md","consent_scoped":false,"alertable":false,"measures":{"cost":{"label":"AI spend","unit":"currency","description":"Exact + re-priced cost of every attempt; USD unless currency = try"},"attempts":{"label":"Provider attempts","unit":"count","description":"Ledger attempts (ai_runs rows before the ledger started)"},"failed_attempts":{"label":"Failed attempts","unit":"count","description":"Any outcome other than success (failed runs before the ledger)"},"no_usage_attempts":{"label":"Attempts without usage","unit":"count","description":"No tokens reported (errors, timeouts); cost unknown, usually not billed"},"unpriced_attempts":{"label":"Unpriced attempts","unit":"count","description":"Tokens but no configured model price"},"pre_ledger_cost":{"label":"Cost from ai_runs","unit":"currency","description":"Part of the cost from before the ledger started"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_ledger_health: Data health checks for the ledger (same row shape as data_freshness)
-- ---------------------------------------------------------------------------

create function analytics.ai_ledger_health(
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
  v_t0 timestamptz := analytics_private.ai_ledger_start();
  v_since timestamptz;
  v_last timestamptz;
  v_last_run timestamptz;
  v_n bigint;
  v_ledger numeric;
  v_runs numeric;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array[]::text[]);
  -- The checks compare the last 7 days, or the time since the ledger started when that is shorter.
  v_since := greatest(v_now - interval '7 days', v_t0);

  select max(e.occurred_at) into v_last from public.ai_usage_events e where e.source = 'app' and e.environment = 'production';
  select max(rc.started_at) into v_last_run from analytics_private.run_cost rc where rc.has_tokens;
  item := 'ai_ledger_last_attempt'; label := 'AI usage ledger: latest production attempt';
  status := case when v_last is null then 'info'
                 -- Runs keep reporting usage but the ledger stopped receiving attempts.
                 when v_last_run > v_last + interval '1 hour' then 'warn'
                 else 'ok' end;
  value := round(extract(epoch from v_now - v_last)::numeric / 3600, 2);
  value_text := case when v_last is null then 'no attempts yet; the ledger starts with the first production attempt' else 'hours ago' end;
  at := v_last; detail := null;
  return next;

  if v_last is null then
    return;
  end if;

  -- Runs whose provider call reported tokens but left no ledger attempt (expected 0).
  select count(*) into v_n
  from analytics_private.run_cost rc
  where rc.started_at >= v_since and rc.has_tokens
    and not exists (select 1 from public.ai_usage_events e where e.ai_run_id = rc.id);
  item := 'ai_runs_without_attempts'; label := 'AI runs with usage but no ledger attempt (7 days)';
  status := case when v_n > 0 then 'warn' else 'ok' end;
  value := v_n; value_text := 'runs'; at := null;
  detail := jsonb_build_object('counts', (
    select coalesce(jsonb_object_agg(x.flow, x.n), '{}'::jsonb) from (
      select rc.flow_type as flow, count(*) as n from analytics_private.run_cost rc
      where rc.started_at >= v_since and rc.has_tokens
        and not exists (select 1 from public.ai_usage_events e where e.ai_run_id = rc.id)
      group by 1) x));
  return next;

  -- Ledger cost against ai_runs cost of every segment over the same window: the ledger also holds retries,
  -- failed attempts, scripts and deleted runs, so it should never be lower.
  select coalesce(sum(l.cost_usd), 0) into v_ledger from analytics_private.ai_usage_ledger l where l.occurred_at >= v_since;
  select coalesce(sum(rc.cost_usd), 0) into v_runs from analytics_private.run_cost rc where rc.started_at >= v_since;
  item := 'ai_ledger_vs_runs_cost'; label := 'AI usage ledger cost minus ai_runs cost (7 days)';
  status := case when v_ledger < v_runs * 0.99 then 'warn' else 'ok' end;
  value := round(v_ledger - v_runs, 6); value_text := 'USD'; at := null;
  detail := jsonb_build_object('ledger_cost_usd', round(v_ledger, 6), 'runs_cost_usd', round(v_runs, 6));
  return next;

  -- App attempts not linked to a run: calls without a run context, or runs deleted since.
  select count(*) into v_n from public.ai_usage_events e
  where e.occurred_at >= v_since and e.source = 'app' and e.ai_run_id is null;
  item := 'ai_attempts_without_run'; label := 'App attempts not linked to an AI run (7 days)';
  status := 'info'; value := v_n; value_text := 'attempts'; at := null;
  detail := jsonb_build_object('counts', (
    select coalesce(jsonb_object_agg(x.segment, x.n), '{}'::jsonb) from (
      select l.segment, count(*) as n from analytics_private.ai_usage_ledger l
      join public.ai_usage_events e on e.id = l.id
      where e.occurred_at >= v_since and e.source = 'app' and e.ai_run_id is null
      group by 1) x));
  return next;

  -- Attempts that did not succeed, by outcome (retries, timeouts, refusals, truncation).
  select count(*) into v_n from public.ai_usage_events e where e.occurred_at >= v_since and e.outcome <> 'success';
  item := 'ai_failed_attempts'; label := 'Provider attempts that did not succeed (7 days)';
  status := 'info'; value := v_n; value_text := 'attempts'; at := null;
  detail := jsonb_build_object('counts', (
    select coalesce(jsonb_object_agg(x.outcome, x.n), '{}'::jsonb) from (
      select e.outcome, count(*) as n from public.ai_usage_events e
      where e.occurred_at >= v_since and e.outcome <> 'success'
      group by 1) x));
  return next;

  -- Attempts with tokens but no price: their cost is missing from AI spend.
  select count(*) into v_n from analytics_private.ai_usage_ledger l
  where l.occurred_at >= v_since and l.has_usage and l.cost_usd is null;
  item := 'ai_unpriced_attempts'; label := 'Unpriced provider attempts (7 days)';
  status := case when v_n > 0 then 'warn' else 'ok' end;
  value := v_n; value_text := 'attempts'; at := null;
  detail := jsonb_build_object('models', (
    select coalesce(jsonb_object_agg(x.model, x.n), '{}'::jsonb) from (
      select l.model_name as model, count(*) as n from analytics_private.ai_usage_ledger l
      where l.occurred_at >= v_since and l.has_usage and l.cost_usd is null
      group by 1) x));
  return next;
end $$;

comment on function analytics.ai_ledger_health(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI usage ledger health","definition":"Checks of the AI usage ledger (public.ai_usage_events) against ai_runs over the last 7 days, or since the ledger started (the first production app attempt) when that is shorter; status ok / warn / info as in Data freshness. ai_ledger_last_attempt: hours since the latest production attempt (info before the first; warn when runs with usage are more than an hour newer, i.e. the backend stopped writing attempts). ai_runs_without_attempts: runs with tokens and no ledger attempt (warn when > 0; counts by flow). ai_ledger_vs_runs_cost: ledger cost minus ai_runs cost of every segment (warn when the ledger is more than 1% lower; it also holds retries, failed attempts, scripts and deleted runs, so it is normally higher). ai_attempts_without_run: app attempts with no AI run (calls without a run context, or runs deleted since; counts by segment). ai_failed_attempts: attempts with any outcome other than success (counts by outcome). ai_unpriced_attempts: attempts with tokens but no model price (warn when > 0; counts by model). The range, grain, currency and filters do not apply; every segment is included.","unit":"count","shape":"table","breakdowns":[],"filters":[],"kb":"new_analysis/ai_cost/ai_cost_per_outcome.md","consent_scoped":false,"alertable":false,"measures":{"value":{"label":"Value","unit":"count","description":"Per check: hours, a count, or USD for the cost comparison"}}}';

-- ---------------------------------------------------------------------------
-- Existing runs: store the estimate for runs whose model is already priced
-- ---------------------------------------------------------------------------

select public.backfill_ai_run_cost_estimates();

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
