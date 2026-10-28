-- Admin analytics Phase 3: AI cost and reliability metrics (docs/admin-analytics/metrics-plan.md "Phase 3", AI rows;
-- api-contract.md). Every metric reads analytics_private.run_cost (exact cost_usd from 2026-10-27, otherwise tokens
-- re-priced with ai_model_prices; mock runs excluded) through one shared population helper, so the AI pages agree
-- with analytics.ai_cost: non-guest runs of accounts not pending deletion or restricted, admin accounts only when
-- p_include_internal. Buckets are UTC. AI cost is USD by nature: native behaves like usd, try converts each run at
-- the monthly USD->TRY rate of its month with the Phase 1 fallback and fx_provisional rules.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- FX: analytics_private.fx_months (20261102120000_analytics_monetization.sql) gives the USD->TRY rate per month with
-- the dashboard's provisional rule (missing, month-to-date or an earlier month's rate), as analytics.ai_cost does.

-- The AI metric population: runs started p_from..p_to (UTC days, inclusive) of the analytics.ai_cost population,
-- narrowed by p_filters (ai_flow, ai_model, ai_provider, market; other keys are ignored here and validated by the
-- caller). Adds the run's market (the account's locked market, 'unknown' without one) and the run-level flags
-- the KB AI queries derive from error_message / input_payload. No content leaves this function.
create function analytics_private.ai_run_scope(p_from date, p_to date, p_include_internal boolean, p_filters jsonb)
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
  where not rc.is_guest
    and rc.is_analysis_user
    and (p_include_internal or not rc.is_internal_user)
    and rc.started_at >= v_start
    and rc.started_at < v_end
    and (v_flows is null or rc.flow_type = any (v_flows))
    and (v_models is null or rc.model_name = any (v_models))
    and (v_providers is null or rc.provider = any (v_providers))
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));
end $$;

-- KB ai_wasted_spend (A) per run: the waste categories and the de-duplicated wasted fraction (1 for a failed run,
-- a run of a failed import_improve orchestration, a run of an abandoned tailoring session or a skills_pool
-- escalation; otherwise the share of its v2 cards that expired or were rejected).
create function analytics_private.ai_run_waste(p_from date, p_to date, p_include_internal boolean, p_filters jsonb)
returns table (
  id uuid, user_id uuid, started_at timestamptz, flow_type text, provider text, model_name text, status text,
  cost_usd numeric, cost_is_exact boolean, unpriced boolean, tokens bigint,
  w_failed boolean, w_import_failed boolean, w_session_unfinished boolean, w_escalation boolean,
  f_expired numeric, f_rejected numeric, wasted_fraction numeric
)
language sql stable set search_path = ''
as $$
  with s as (
    select * from analytics_private.ai_run_scope(p_from, p_to, p_include_internal, p_filters)
  ),
  w as (
    select s.id, s.user_id, s.started_at, s.flow_type, s.provider, s.model_name, s.status,
           s.cost_usd, s.cost_is_exact, s.unpriced, coalesce(s.total_tokens, 0) as tokens,
           (s.status = 'failed') as w_failed,
           ((s.flow_type = 'import_improve' and s.status = 'failed')
            or (s.is_import_sub_run and exists (
                  -- Sub-runs have no parent link: same user, started inside the failed parent's run window. A parent
                  -- is failed by the watchdog within minutes, so looking back one day bounds the index range.
                  select 1 from public.ai_runs p
                  where p.user_id = s.user_id
                    and p.flow_type = 'import_improve' and p.status = 'failed' and p.provider <> 'mock'
                    and p.started_at <= s.started_at
                    and p.started_at > s.started_at - interval '1 day'
                    and s.started_at <= coalesce(p.completed_at, p.started_at + interval '10 minutes')))) as w_import_failed,
           exists (select 1 from public.tailoring_sessions ts
                   where ts.id = s.tailoring_session_id
                     and ts.finished_at is null
                     and ts.created_at < now() - interval '7 days') as w_session_unfinished,
           s.is_escalation as w_escalation,
           coalesce(c.expired::numeric / nullif(c.cards, 0), 0) as f_expired,
           coalesce(c.rejected::numeric / nullif(c.cards, 0), 0) as f_rejected
    from s
    left join lateral (
      select count(*) as cards,
             count(*) filter (where sg.status = 'expired') as expired,
             count(*) filter (where sg.status = 'rejected') as rejected
      from public.ai_suggestions sg
      where sg.ai_run_id = s.id
        and sg.action_type = 'tailor'
        and sg.tailoring_session_id is not null
    ) c on true
  )
  select w.id, w.user_id, w.started_at, w.flow_type, w.provider, w.model_name, w.status,
         w.cost_usd, w.cost_is_exact, w.unpriced, w.tokens,
         w.w_failed, w.w_import_failed, w.w_session_unfinished, w.w_escalation, w.f_expired, w.f_rejected,
         case when w.w_failed or w.w_import_failed or w.w_session_unfinished or w.w_escalation then 1::numeric
              else least(1, w.f_expired + w.f_rejected) end
  from w
$$;

-- ---------------------------------------------------------------------------
-- analytics.ai_reliability
-- ---------------------------------------------------------------------------

create function analytics.ai_reliability(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, failure_rate numeric, runs bigint, completed_runs bigint, failed_runs bigint,
  pending_runs bigint, model_failure_rate numeric, model_failed_runs bigint,
  p50_duration_seconds numeric, p95_duration_seconds numeric, avg_tokens_per_run numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider'], array['ai_flow', 'ai_model', 'ai_provider', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with base as (
    select analytics_private.bucket(s.started_at, p_grain) as b,
           case p_breakdown when 'ai_flow' then s.flow_type
                            when 'ai_model' then s.model_name
                            when 'ai_provider' then s.provider end as dim,
           s.status,
           s.is_non_model_failure,
           case when s.status = 'completed' then extract(epoch from s.completed_at - s.started_at) end as dur,
           case when s.status = 'completed' then s.total_tokens end as tok
    from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, p_filters) s
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_breakdown is null
  )
  select k.b,
         d.dim,
         round(count(*) filter (where f.status = 'failed')::numeric
               / nullif(count(*) filter (where f.status in ('completed', 'failed')), 0), 4),
         count(f.b),
         count(*) filter (where f.status = 'completed'),
         count(*) filter (where f.status = 'failed'),
         count(*) filter (where f.status = 'pending'),
         round(count(*) filter (where f.status = 'failed' and not f.is_non_model_failure)::numeric
               / nullif(count(*) filter (where f.status = 'completed'
                                            or (f.status = 'failed' and not f.is_non_model_failure)), 0), 4),
         count(*) filter (where f.status = 'failed' and not f.is_non_model_failure),
         round((percentile_cont(0.5) within group (order by f.dur))::numeric, 2),
         round((percentile_cont(0.95) within group (order by f.dur))::numeric, 2),
         round(avg(f.tok), 1)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join base f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.ai_reliability(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI reliability","definition":"AI runs per start date (UTC) of the analytics.ai_cost population (non-mock, non-guest runs; accounts pending deletion or with restricted processing excluded; admin accounts unless included). failure_rate = failed / (completed + failed): pending runs are in flight and stay out of the denominator (KB). model_failure_rate also drops failures unrelated to the model (privacy / claim failures and watchdog timeouts with no usage, from KB ai_daily_cost_anomalies). Durations are completed_at - started_at of completed runs (p50 / p95, seconds); avg_tokens_per_run averages total_tokens of completed runs (tokens exist from 2026-04-29). Market is the account''s locked market (unknown without one). Since 2026-10-06 most failures carry a generic message, so the failure class is often unknown. Dashboard definition: any date range instead of the KB''s fixed last 30 days, as a time series rather than one row per flow.","unit":"ratio","shape":"timeseries","breakdowns":["ai_flow","ai_model","ai_provider"],"filters":["ai_flow","ai_model","ai_provider","market"],"kb":"queries/ai_flow_efficiency_and_failure_rate.md","consent_scoped":false,"alertable":false,"drill":true,"plot":["failure_rate"],"measures":{"failure_rate":{"label":"Failure rate","unit":"ratio","description":"failed / (completed + failed)"},"runs":{"label":"AI runs","unit":"count"},"completed_runs":{"label":"Completed runs","unit":"count"},"failed_runs":{"label":"Failed runs","unit":"count"},"pending_runs":{"label":"Pending runs","unit":"count","description":"Still running, or never finished"},"model_failure_rate":{"label":"Model failure rate","unit":"ratio","description":"Excludes privacy / claim failures and watchdog timeouts without usage"},"model_failed_runs":{"label":"Model failures","unit":"count"},"p50_duration_seconds":{"label":"Median duration","unit":"seconds","description":"Completed runs"},"p95_duration_seconds":{"label":"p95 duration","unit":"seconds","description":"Completed runs"},"avg_tokens_per_run":{"label":"Tokens per completed run","unit":"tokens"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_wasted_spend
-- ---------------------------------------------------------------------------

create function analytics.ai_wasted_spend(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, wasted_share numeric, wasted_cost numeric, total_cost numeric,
  failed_runs_cost numeric, expired_cards_cost numeric, rejected_cards_cost numeric, unfinished_sessions_cost numeric,
  failed_import_improve_cost numeric, skills_pool_escalation_cost numeric, wasted_tokens_share numeric,
  runs bigint, failed_runs bigint, unpriced_runs bigint, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider'], array['ai_flow', 'ai_model', 'ai_provider', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with base as (
    select analytics_private.bucket(w.started_at, p_grain) as b,
           case p_breakdown when 'ai_flow' then w.flow_type
                            when 'ai_model' then w.model_name
                            when 'ai_provider' then w.provider end as dim,
           w.*,
           -- Converted cost (USD for native / usd); only priced runs need a rate.
           w.cost_usd * case when p_currency = 'try' then x.usd_try else 1 end as amt,
           (p_currency = 'try' and w.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.ai_run_waste(r.from_day, r.to_day, p_include_internal, p_filters) w
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', w.started_at at time zone 'UTC')::date
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_breakdown is null
  ),
  agg as (
    select k.b, d.dim,
           sum(f.amt) as total,
           sum(f.amt * f.wasted_fraction) as wasted,
           sum(f.amt) filter (where f.w_failed) as failed_cost,
           sum(f.amt * f.f_expired) as expired_cost,
           sum(f.amt * f.f_rejected) as rejected_cost,
           sum(f.amt) filter (where f.w_session_unfinished) as unfinished_cost,
           sum(f.amt) filter (where f.w_import_failed) as import_cost,
           sum(f.amt) filter (where f.w_escalation) as escalation_cost,
           sum(f.cost_usd) as total_usd,
           sum(f.cost_usd * f.wasted_fraction) as wasted_usd,
           sum(f.tokens) as tokens,
           sum(f.tokens * f.wasted_fraction) as wasted_tokens,
           count(f.b) as n_runs,
           count(*) filter (where f.w_failed) as n_failed,
           count(*) filter (where f.unpriced) as n_unpriced,
           coalesce(bool_or(f.needs_fx and f.usd_try is null), false) as missing_rate,
           coalesce(bool_or(f.needs_fx and f.provisional), false) as provisional
    from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
    cross join dims d
    left join base f on f.b = k.b and f.dim is not distinct from d.dim
    group by k.b, d.dim
  )
  select a.b,
         a.dim,
         round(a.wasted_usd / nullif(a.total_usd, 0), 4),
         case when a.missing_rate then null else round(coalesce(a.wasted, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.total, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.failed_cost, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.expired_cost, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.rejected_cost, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.unfinished_cost, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.import_cost, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.escalation_cost, 0), 6) end,
         round(a.wasted_tokens / nullif(a.tokens, 0), 4),
         a.n_runs,
         a.n_failed,
         a.n_unpriced,
         a.provisional
  from agg a
  order by a.b, a.dim;
end $$;

comment on function analytics.ai_wasted_spend(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI wasted spend","definition":"AI spend that produced no lasting value, per run start date (UTC), for the analytics.ai_cost population. A run is fully wasted when it failed, belongs to a failed import_improve orchestration (the parent, or an import sub-run of the same account started inside the parent''s run window: a heuristic, sub-runs have no parent link), belongs to a tailoring v2 session still unfinished 7 days after creation, or is a skills_pool escalation; otherwise the share of its v2 cards that expired or were rejected is wasted (run cost split evenly over its cards). wasted_cost counts each run once; the category columns overlap (a failed run in an abandoned session is in both) and can sum to more than wasted_cost. wasted_share = wasted / total cost (USD); wasted_tokens_share is the same on tokens, the price-independent view while model prices are missing (unpriced_runs > 0 means costs are lower bounds). Cost is exact from 2026-10-27 and token-estimated before (tokens from 2026-04-29); card and session waste exist only from 2026-10-27; card status is final-state only. Costs are USD for native and usd; try converts each run at its month''s USD->TRY rate (fx_provisional when that rate is month-to-date, from an earlier month or missing; with no rate the bucket''s costs are null). Market is the account''s locked market. Dashboard definition: any grain and range instead of the KB''s ISO weeks, with breakdowns by flow, model and provider; the failure-class breakdown (KB section B) is in the drill-down detail.","unit":"ratio","shape":"timeseries","breakdowns":["ai_flow","ai_model","ai_provider"],"filters":["ai_flow","ai_model","ai_provider","market"],"kb":"new_analysis/ai_cost/ai_wasted_spend.md","consent_scoped":false,"alertable":false,"drill":true,"plot":["wasted_share","wasted_tokens_share"],"measures":{"wasted_share":{"label":"Wasted share","unit":"ratio","description":"De-duplicated wasted cost / total cost"},"wasted_cost":{"label":"Wasted cost","unit":"currency","description":"Each run counted once"},"total_cost":{"label":"Total AI cost","unit":"currency"},"failed_runs_cost":{"label":"Failed runs","unit":"currency"},"expired_cards_cost":{"label":"Expired cards","unit":"currency"},"rejected_cards_cost":{"label":"Rejected cards","unit":"currency"},"unfinished_sessions_cost":{"label":"Unfinished sessions","unit":"currency","description":"Sessions unfinished 7 days after creation"},"failed_import_improve_cost":{"label":"Failed import_improve","unit":"currency"},"skills_pool_escalation_cost":{"label":"skills_pool escalations","unit":"currency"},"wasted_tokens_share":{"label":"Wasted token share","unit":"ratio","description":"Price-independent"},"runs":{"label":"AI runs","unit":"count"},"failed_runs":{"label":"Failed runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count","description":"Runs with tokens but no price: costs are lower bounds"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost_anomalies
-- ---------------------------------------------------------------------------

create function analytics.ai_cost_anomalies(
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
    array['ai_flow', 'ai_model', 'ai_provider'], array['ai_flow', 'ai_model', 'ai_provider', 'market']);
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

comment on function analytics.ai_cost_anomalies(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI cost anomalies","definition":"AI cost, tokens, runs and model failure rate per bucket (UTC) on a gap-free spine for the analytics.ai_cost population, each bucket compared with the 7 buckets before it (current bucket excluded; mean and sample standard deviation). cost_spike / token_spike: z-score above 3 (only upward spikes; z is null until 7 baseline buckets exist or when the baseline is flat). jump_from_flat_baseline: a flat token baseline followed by more than twice its mean. failure_spike: model failure rate above 20% with at least 5 terminal runs (privacy / claim failures and watchdog timeouts with no usage excluded). is_anomaly = any flag. The overall series counts quiet buckets from the start of the baseline window; with a breakdown, each series starts at its first run in the window. Cost is exact from 2026-10-27 and token-estimated before; while model prices are missing (unpriced_runs > 0) cost z-scores are meaningless, use token_spike (tokens exist from 2026-04-29). The 2026-10-27 switch to exact cost can itself look like a step. The current bucket is partial, so its values are low by construction. Cost is USD for native and usd; try converts each run at its month''s USD->TRY rate (fx_provisional as in AI cost; a bucket without a rate has null cost and no cost z-score). Dashboard definition: the baseline is 7 buckets of the requested grain (7 days for day, as in the KB); only the range is returned (the KB spans each flow''s whole history), and the per-flow series are a breakdown rather than a fixed ALL + per-flow grid.","unit":"currency","shape":"timeseries","breakdowns":["ai_flow","ai_model","ai_provider"],"filters":["ai_flow","ai_model","ai_provider","market"],"kb":"new_analysis/ai_cost/ai_daily_cost_anomalies.md","consent_scoped":false,"alertable":false,"flag_column":"is_anomaly","measures":{"cost":{"label":"AI cost","unit":"currency","description":"Exact + estimated; USD unless currency = try"},"runs":{"label":"AI runs","unit":"count"},"tokens":{"label":"Tokens","unit":"tokens"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"},"terminal_runs":{"label":"Terminal runs","unit":"count","description":"Completed + model failures"},"model_failed_runs":{"label":"Model failures","unit":"count"},"model_failure_rate":{"label":"Model failure rate","unit":"ratio"},"cost_baseline":{"label":"Cost baseline","unit":"currency","description":"Mean of the previous 7 buckets"},"cost_upper_band":{"label":"Cost upper band","unit":"currency","description":"Baseline + 3 standard deviations"},"cost_z":{"label":"Cost z-score","unit":"count","description":"Standard deviations above the baseline; a spike is above 3"},"tokens_baseline":{"label":"Token baseline","unit":"tokens"},"tokens_upper_band":{"label":"Token upper band","unit":"tokens"},"tokens_z":{"label":"Token z-score","unit":"count","description":"Standard deviations above the baseline; a spike is above 3"},"baseline_buckets":{"label":"Baseline buckets","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_tokens_by_model
-- ---------------------------------------------------------------------------

create function analytics.ai_tokens_by_model(
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
    array['ai_model', 'ai_provider', 'ai_flow'], array['ai_flow', 'ai_model', 'ai_provider', 'market']);
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

comment on function analytics.ai_tokens_by_model(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI tokens by model","definition":"Token usage per run start date (UTC) for the analytics.ai_cost population, by model (or provider / flow). Token columns exist from 2026-04-29; earlier runs count in runs_without_tokens. cached_input_tokens is part of input_tokens (from 2026-10-27); output_tokens includes reasoning tokens; total_tokens is the stored total. cost is the analytics.ai_cost cost of the same runs (exact from 2026-10-27, else re-priced from tokens with ai_model_prices; unpriced runs add no cost), USD for native and usd and converted for try (fx_provisional as in AI cost). Dashboard definition: tokens of every run that reported usage, failed runs included (providers bill them), where the KB counts completed runs only; cost uses run_cost instead of the KB''s total_tokens x output price; any range and grain instead of the trailing 12 months.","unit":"tokens","shape":"timeseries","breakdowns":["ai_model","ai_provider","ai_flow"],"filters":["ai_flow","ai_model","ai_provider","market"],"kb":"queries/ai_token_usage_monthly_by_model.md","consent_scoped":false,"alertable":false,"plot":["input_tokens","output_tokens"],"stacked":true,"measures":{"total_tokens":{"label":"Total tokens","unit":"tokens"},"input_tokens":{"label":"Input tokens","unit":"tokens","description":"Includes cached input"},"cached_input_tokens":{"label":"Cached input tokens","unit":"tokens"},"output_tokens":{"label":"Output tokens","unit":"tokens","description":"Includes reasoning"},"runs":{"label":"AI runs","unit":"count"},"runs_without_tokens":{"label":"Runs without tokens","unit":"count","description":"No usage recorded (all runs before 2026-04-29)"},"completed_runs":{"label":"Completed runs","unit":"count"},"failed_runs":{"label":"Failed runs","unit":"count"},"cost":{"label":"AI cost","unit":"currency","description":"USD unless currency = try"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost_concentration
-- ---------------------------------------------------------------------------

create function analytics.ai_cost_concentration(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, cost_share numeric, cumulative_cost_share numeric, cost numeric, users bigint, runs bigint,
  tokens bigint, token_share numeric, unpriced_runs bigint, gini_cost numeric, gini_tokens numeric,
  fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  c_min_group constant integer := 2;  -- meta.min_group
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['ai_flow', 'ai_model', 'ai_provider', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with per_user as (
    select s.user_id,
           count(*) as n_runs,
           coalesce(sum(s.cost_usd), 0) as usd,
           sum(s.cost_usd * case when p_currency = 'try' then x.usd_try else 1 end) as amt,
           bool_or(p_currency = 'try' and s.cost_usd is not null and x.usd_try is null) as missing_rate,
           bool_or(p_currency = 'try' and s.cost_usd is not null and x.provisional) as provisional,
           coalesce(sum(s.total_tokens), 0) as tok,
           count(*) filter (where s.unpriced) as n_unpriced
    from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, p_filters) s
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', s.started_at at time zone 'UTC')::date
    group by s.user_id
  ),
  ranked as (
    -- Deciles by USD cost (ties: tokens, then user id), highest first; ntile gives the top decile at least one user.
    select pu.*,
           ntile(10) over (order by pu.usd desc, pu.tok desc, pu.user_id) as decile,
           row_number() over (order by pu.usd, pu.tok, pu.user_id desc) as rank_asc_cost,
           row_number() over (order by pu.tok, pu.user_id desc) as rank_asc_tokens
    from per_user pu
  ),
  totals as (
    select count(*) as n,
           sum(rk.usd) as usd,
           sum(rk.tok) as tok,
           round(2.0 * sum(rk.rank_asc_cost * rk.usd) / nullif(count(*) * sum(rk.usd), 0)
                 - (count(*) + 1.0) / nullif(count(*), 0), 4) as gini_cost,
           round(2.0 * sum(rk.rank_asc_tokens * rk.tok) / nullif(count(*) * sum(rk.tok), 0)
                 - (count(*) + 1.0) / nullif(count(*), 0), 4) as gini_tokens,
           coalesce(bool_or(rk.missing_rate), false) as missing_rate,
           coalesce(bool_or(rk.provisional), false) as provisional
    from ranked rk
  ),
  deciles as (
    select g.d,
           count(rk.user_id) as n_users,
           coalesce(sum(rk.usd), 0) as usd,
           coalesce(sum(rk.amt), 0) as amt,
           coalesce(sum(rk.n_runs), 0) as n_runs,
           coalesce(sum(rk.tok), 0) as tok,
           coalesce(sum(rk.n_unpriced), 0) as n_unpriced,
           (count(rk.user_id) between 1 and c_min_group - 1) as small
    from generate_series(1, 10) g(d)
    left join ranked rk on rk.decile = g.d
    group by g.d
  )
  -- A decile of fewer than c_min_group users would expose one account's spend: only its user count is shown.
  select case dc.d when 1 then 'top 10%' else ((dc.d - 1) * 10)::text || '-' || (dc.d * 10)::text || '%' end,
         case when dc.small then null else round(dc.usd / nullif(t.usd, 0), 4) end,
         case when dc.small then null else round(sum(dc.usd) over (order by dc.d) / nullif(t.usd, 0), 4) end,
         case when dc.small or t.missing_rate then null else round(dc.amt, 6) end,
         dc.n_users,
         case when dc.small then null else dc.n_runs::bigint end,
         case when dc.small then null else dc.tok::bigint end,
         case when dc.small then null else round(dc.tok / nullif(t.tok, 0), 4) end,
         case when dc.small then null else dc.n_unpriced::bigint end,
         t.gini_cost,
         t.gini_tokens,
         t.provisional
  from deciles dc
  cross join totals t
  order by dc.d;
end $$;

comment on function analytics.ai_cost_concentration(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI cost concentration","definition":"How concentrated AI spend is among AI users in the range: users of the analytics.ai_cost population with at least one run in the range, ranked by USD cost (ties: tokens, then user id) and split into 10 deciles with ntile (the top decile always holds at least one user; with fewer than 10 users the lower deciles are empty). Rows are deciles from the top: cost_share = the decile''s share of total cost, cumulative_cost_share = share of the top deciles so far, token_share = the same deciles'' share of tokens (the price-independent view while prices are missing). gini_cost / gini_tokens are the Gini coefficients of all AI users (0 = equal, near 1 = one user spends everything; same value on every row). Users with no AI runs are not zeros in the distribution. Aggregate only: no per-user rows, and a decile holding a single user (fewer than min_group = 2) shows only its user count (shares, cost, runs and tokens are null). Cost is exact from 2026-10-27, token-estimated before, and unpriced runs add no cost (unpriced_runs). Cost is USD for native and usd and converted per run month for try (shares and Gini always use USD; fx_provisional as in AI cost). p_grain is ignored. Dashboard definition: deciles of the selected range instead of the KB''s top 1/5/10/20% per month and all-time; the KB heavy-user list (section B) is not ported (privacy), use the AI cost drill-down for named users.","unit":"ratio","shape":"breakdown","breakdowns":[],"filters":["ai_flow","ai_model","ai_provider","market"],"kb":"new_analysis/ai_cost/ai_cost_concentration.md","consent_scoped":false,"alertable":false,"min_group":2,"measures":{"cost_share":{"label":"Share of AI cost","unit":"ratio"},"cumulative_cost_share":{"label":"Cumulative share","unit":"ratio","description":"This decile and every decile above it"},"cost":{"label":"AI cost","unit":"currency","description":"USD unless currency = try"},"users":{"label":"Users","unit":"count"},"runs":{"label":"AI runs","unit":"count"},"tokens":{"label":"Tokens","unit":"tokens"},"token_share":{"label":"Share of tokens","unit":"ratio"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"},"gini_cost":{"label":"Gini (cost)","unit":"ratio","description":"All AI users in the range"},"gini_tokens":{"label":"Gini (tokens)","unit":"ratio","description":"All AI users in the range"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost_per_outcome
-- ---------------------------------------------------------------------------

create function analytics.ai_cost_per_outcome(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, cost_per_outcome numeric, outcomes bigint, users bigint, attributed_cost numeric,
  attributed_cost_exact numeric, attributed_cost_estimated numeric, attributed_runs bigint, unpriced_runs bigint,
  tokens_per_outcome numeric, fully_loaded_cost_per_outcome numeric, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['ai_model', 'ai_provider', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');

  return query
  with runs as (
    select s.*,
           case when s.tailoring_session_id is not null
                  or s.flow_type in ('tailoring_analysis', 'tailoring_block', 'tailoring_skills', 'tailoring_structure') then 'tailoring_v2'
                when s.flow_type in ('job_analysis', 'follow_up_questions', 'tailored_draft') then 'tailoring_v1'
                when s.flow_type = 'cover_letter_generation' then 'cover_letter'
                when s.flow_type = 'import_improve' or s.is_import_sub_run then 'import_improve'
                else 'other' end as cost_bucket,
           s.cost_usd * case when p_currency = 'try' then x.usd_try else 1 end as amt,
           (p_currency = 'try' and s.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, p_filters) s
    left join analytics_private.fx_months(r.from_day, r.to_day) x
      on x.month = date_trunc('month', s.started_at at time zone 'UTC')::date
  ),
  -- Accounts whose outcomes count: same population as the runs (market filter on the locked market).
  people as (
    select u.id
    from analytics_private.analysis_users u
    left join public.billing_markets bm on bm.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
  ),
  outcome_defs (outcome, sort_order, cost_buckets) as (
    values ('tailoring_finished', 1, array['tailoring_v1', 'tailoring_v2']),
           ('tailored_cv_exported', 2, array['tailoring_v1', 'tailoring_v2']),
           ('job_applied', 3, array['tailoring_v1', 'tailoring_v2', 'cover_letter']),
           ('v2_card_accepted', 4, array['tailoring_v2']),
           ('cover_letter_generated', 5, array['cover_letter']),
           ('import_improved', 6, array['import_improve'])
  ),
  -- Outcome events whose own timestamp falls in the range (KB outcome definitions).
  events as (
    select 'tailoring_finished' as outcome, ts.user_id, ts.id as event_id
    from public.tailoring_sessions ts
    join people p on p.id = ts.user_id
    where ts.finished_at >= v_start and ts.finished_at < v_end
    union all
    select case ar.flow_type when 'tailored_draft' then 'tailoring_finished'
                             when 'cover_letter_generation' then 'cover_letter_generated'
                             else 'import_improved' end,
           ar.user_id, ar.id
    from public.ai_runs ar
    join people p on p.id = ar.user_id
    where ar.flow_type in ('tailored_draft', 'cover_letter_generation', 'import_improve')
      and ar.status = 'completed'
      and ar.provider <> 'mock'
      and ar.started_at >= v_start and ar.started_at < v_end
    union all
    -- Tailored CVs whose first completed export is in the range.
    select 'tailored_cv_exported', e.user_id, e.tailored_cv_id
    from public.exports e
    join people p on p.id = e.user_id
    where e.status = 'completed'
      and e.tailored_cv_id is not null  -- master CV exports are not a tailoring outcome
      and e.completed_at >= v_start and e.completed_at < v_end
      and not exists (select 1 from public.exports e2
                      where e2.tailored_cv_id = e.tailored_cv_id and e2.status = 'completed'
                        and (e2.completed_at < e.completed_at or (e2.completed_at = e.completed_at and e2.id < e.id)))
    union all
    -- Jobs whose first move to applied / interview / offer is in the range.
    select 'job_applied', j.user_id, j.id
    from public.jobs j
    join people p on p.id = j.user_id
    left join lateral (
      select min(h.changed_at) as first_applied_at
      from public.job_status_history h
      where h.job_id = j.id and h.to_status in ('applied', 'interview', 'offer')
    ) h on true
    cross join lateral (select coalesce(least(j.applied_at, h.first_applied_at), j.updated_at) as at) a
    where (j.applied_at is not null or j.status in ('applied', 'interview', 'offer') or h.first_applied_at is not null)
      and a.at >= v_start and a.at < v_end
    union all
    -- Accepted tailoring v2 cards (real cards, final state), at their acceptance time.
    select 'v2_card_accepted', sg.user_id, sg.id
    from public.ai_suggestions sg
    join people p on p.id = sg.user_id
    join public.ai_runs ar on ar.id = sg.ai_run_id and ar.provider <> 'mock'
    where sg.action_type = 'tailor'
      and sg.tailoring_session_id is not null
      and sg.status = 'applied'
      and sg.applied_at >= v_start and sg.applied_at < v_end
  ),
  outcome_counts as (
    select ev.outcome, count(distinct ev.event_id) as n, count(distinct ev.user_id) as n_users
    from events ev
    group by ev.outcome
  ),
  totals as (
    select sum(ru.amt) as amt,
           coalesce(bool_or(ru.needs_fx and ru.usd_try is null), false) as missing_rate,
           coalesce(bool_or(ru.needs_fx and ru.provisional), false) as provisional
    from runs ru
  ),
  attributed as (
    select od.outcome, od.sort_order,
           count(ru.id) as n_runs,
           sum(ru.amt) as amt,
           sum(ru.amt) filter (where ru.cost_is_exact) as amt_exact,
           sum(ru.amt) filter (where not ru.cost_is_exact) as amt_estimated,
           count(*) filter (where ru.unpriced) as n_unpriced,
           coalesce(sum(ru.total_tokens), 0) as tok,
           coalesce(bool_or(ru.needs_fx and ru.usd_try is null), false) as missing_rate,
           coalesce(bool_or(ru.needs_fx and ru.provisional), false) as provisional
    from outcome_defs od
    left join runs ru on ru.cost_bucket = any (od.cost_buckets)
    group by od.outcome, od.sort_order
  )
  select a.outcome,
         case when a.missing_rate then null else round(coalesce(a.amt, 0) / nullif(oc.n, 0), 6) end,
         coalesce(oc.n, 0),
         coalesce(oc.n_users, 0),
         case when a.missing_rate then null else round(coalesce(a.amt, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.amt_exact, 0), 6) end,
         case when a.missing_rate then null else round(coalesce(a.amt_estimated, 0), 6) end,
         a.n_runs,
         a.n_unpriced,
         round(a.tok / nullif(oc.n, 0), 0),
         case when t.missing_rate then null else round(coalesce(t.amt, 0) / nullif(oc.n, 0), 6) end,
         t.provisional
  from attributed a
  cross join totals t
  left join outcome_counts oc on oc.outcome = a.outcome
  order by 2 desc nulls last, a.sort_order;
end $$;

comment on function analytics.ai_cost_per_outcome(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI cost per outcome","definition":"AI cost per value event in the range (UTC), for the analytics.ai_cost population. Outcomes (KB): tailoring_finished = v2 sessions finished plus completed legacy tailored_draft runs (v1 is an upper bound); tailored_cv_exported = tailored CVs whose first completed export is in the range; job_applied = jobs whose first move to applied / interview / offer is in the range (applied_at or status history, else updated_at); v2_card_accepted = applied tailoring v2 cards (final state; cards of deleted CVs are gone, so a lower bound); cover_letter_generated = completed cover_letter_generation runs; import_improved = completed import_improve parents. attributed_cost sums every run in the range (failed runs and retries included) of the flows that produce the outcome: tailoring v2 = runs with a session or a tailoring_* flow, tailoring v1 = job_analysis / follow_up_questions / tailored_draft, cover_letter, import_improve = parent + sub-runs (professional_summary, block_suggest / skills_pool carrying flow_input.language). The same tailoring cost is attributed to finished, exported and applied: alternative denominators, not additive. fully_loaded_cost_per_outcome divides all AI spend in the range by the outcome count. Cost is exact from 2026-10-27, token-estimated before (no tokens before 2026-04-29); unpriced runs add no cost, so costs are lower bounds while unpriced_runs > 0 (tokens_per_outcome is price-independent). Cost is USD for native and usd, converted per run month for try (fx_provisional as in AI cost). ai_model / ai_provider filter the cost side only; market (the account''s locked market) applies to both. Dashboard definition: one range instead of the KB''s v1_legacy / v2 eras (pick a range on one side of 2026-10-27 to compare eras); outcomes are dated by their own event time (session finished_at, card applied_at) where the KB uses creation time for the era.","unit":"currency","shape":"breakdown","breakdowns":[],"filters":["ai_model","ai_provider","market"],"kb":"new_analysis/ai_cost/ai_cost_per_outcome.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"cost_per_outcome":{"label":"Cost per outcome","unit":"currency","description":"Attributed cost / outcomes"},"outcomes":{"label":"Outcomes","unit":"count","ignores_filters":["ai_model","ai_provider"]},"users":{"label":"Users with the outcome","unit":"count","ignores_filters":["ai_model","ai_provider"]},"attributed_cost":{"label":"Attributed cost","unit":"currency"},"attributed_cost_exact":{"label":"Attributed cost (exact)","unit":"currency"},"attributed_cost_estimated":{"label":"Attributed cost (estimated)","unit":"currency"},"attributed_runs":{"label":"Attributed runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"},"tokens_per_outcome":{"label":"Tokens per outcome","unit":"tokens"},"fully_loaded_cost_per_outcome":{"label":"Fully-loaded cost per outcome","unit":"currency","description":"All AI spend / outcomes"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost_by_plan
-- ---------------------------------------------------------------------------

create function analytics.ai_cost_by_plan(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, ai_cost numeric, users bigint, paying_users bigint, ai_active_users bigint, runs bigint,
  unpriced_runs bigint, cost_per_user numeric, cost_per_paying_user numeric, revenue numeric,
  revenue_usd_native numeric, revenue_try_native numeric, ai_cost_share_of_revenue numeric, gross_margin numeric,
  exact_share numeric, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['plan', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with months as (
    -- Each month touched by the range, clipped to the range (and to now: future service is deferred revenue).
    select x.month, x.usd_try, x.provisional,
           greatest(analytics_private.utc_start(x.month), v_start) as m_start,
           least(analytics_private.utc_start((x.month + interval '1 month')::date), v_end, v_now) as m_end
    from analytics_private.fx_months(r.from_day, r.to_day) x
  ),
  run_months as (
    select s.user_id,
           date_trunc('month', s.started_at at time zone 'UTC')::date as month,
           count(*) as n_runs,
           sum(s.cost_usd) as cost_usd,
           sum(s.cost_usd) filter (where s.cost_is_exact) as cost_exact_usd,
           count(*) filter (where s.unpriced) as n_unpriced,
           bool_or(s.cost_usd is not null) as has_cost
    from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, '{}'::jsonb) s
    group by 1, 2
  ),
  -- Invoices of analysis accounts (erased accounts have no AI runs left, as in the KB).
  inv as (
    select ir.user_id, ir.currency, ir.plan_code, ir.revenue, ir.paid_at, ir.period_start, ir.period_end,
           (coalesce(ir.billing_reason, '') like 'subscription%'
            and ir.plan_code is distinct from 'lifetime'
            and ir.period_start is not null
            and ir.period_end > ir.period_start) as is_recurring
    from analytics_private.invoice_revenue ir
    join analytics_private.analysis_users au on au.id = ir.user_id
    where (p_include_internal or not au.is_internal)
      -- Paid in the range, or a service period overlapping it (a renewal paid before the range still covers it).
      and ((ir.paid_at >= v_start and ir.paid_at < v_end)
           or (ir.period_end > v_start and ir.period_start < v_end))
  ),
  -- Recognised revenue: recurring invoices spread over their service period by time share; one-time in the paid month.
  rev_alloc as (
    select i.user_id, m.month, i.currency, i.plan_code, true as covers,
           i.revenue * extract(epoch from least(i.period_end, m.m_end) - greatest(i.period_start, m.m_start))
                     / extract(epoch from i.period_end - i.period_start) as recognised
    from inv i
    join months m on i.period_start < m.m_end and i.period_end > m.m_start
    where i.is_recurring
    union all
    select i.user_id, m.month, i.currency, i.plan_code, false, i.revenue
    from inv i
    join months m on i.paid_at >= m.m_start and i.paid_at < m.m_end
    where not i.is_recurring
  ),
  rev_months as (
    select ra.user_id, ra.month,
           bool_or(ra.covers) as paid_coverage,
           max(ra.plan_code) filter (where ra.covers) as invoice_plan,
           coalesce(sum(ra.recognised) filter (where ra.currency = 'USD'), 0) as rec_usd,
           coalesce(sum(ra.recognised) filter (where ra.currency = 'TRY'), 0) as rec_try
    from rev_alloc ra
    group by ra.user_id, ra.month
  ),
  -- Plan stamped on usage (from 2026-10-29).
  uc_plan as (
    select uc.user_id, uc.period_month as month, uc.plan_code
    from public.usage_counters uc
    join months m on m.month = uc.period_month
    where uc.plan_code is not null
  ),
  -- The most recently created real subscription overlapping the month.
  sub_months as (
    select distinct on (s.user_id, m.month) s.user_id, m.month, s.plan_code
    from public.subscriptions s
    -- A subscription ends at ended_at, else its current period end, else its last update; only a live lifetime plan
    -- (no period) stays open until now.
    join months m on s.created_at < m.m_end
                 and least(case when s.plan_code = 'lifetime' and s.ended_at is null then v_now
                                else coalesce(s.ended_at, s.current_period_end, s.updated_at) end,
                           v_now) >= analytics_private.utc_start(m.month)
    where s.provider_subscription_id is not null
      and s.plan_code <> 'free'
    order by s.user_id, m.month, s.created_at desc
  ),
  trial_months as (
    select distinct s.user_id, m.month
    from public.subscriptions s
    join months m on s.trial_start < analytics_private.utc_start((m.month + interval '1 month')::date)
                 and coalesce(s.trial_end, s.trial_start) >= analytics_private.utc_start(m.month)
    where s.trial_start is not null
  ),
  user_months as (
    select user_id, month from run_months
    union
    select user_id, month from rev_months
    union
    select user_id, month from sub_months
  ),
  detail as (
    select um.user_id, um.month, m.usd_try, m.provisional,
           coalesce(up.plan_code, sm.plan_code, 'free') as plan_effective,
           (coalesce(rv.paid_coverage, false) or coalesce(up.plan_code, sm.plan_code) = 'lifetime') as is_paying,
           rv.invoice_plan,
           (tm.user_id is not null) as trial_in_month,
           coalesce(bm.market, 'unknown') as market,
           coalesce(rm.n_runs, 0) as n_runs,
           rm.cost_usd,
           rm.cost_exact_usd,
           coalesce(rm.n_unpriced, 0) as n_unpriced,
           coalesce(rm.has_cost, false) as has_cost,
           coalesce(rv.rec_usd, 0) as rec_usd,
           coalesce(rv.rec_try, 0) as rec_try
    from user_months um
    join analytics_private.analysis_users au on au.id = um.user_id
    join months m on m.month = um.month
    left join uc_plan up on up.user_id = um.user_id and up.month = um.month
    left join sub_months sm on sm.user_id = um.user_id and sm.month = um.month
    left join rev_months rv on rv.user_id = um.user_id and rv.month = um.month
    left join run_months rm on rm.user_id = um.user_id and rm.month = um.month
    left join trial_months tm on tm.user_id = um.user_id and tm.month = um.month
    left join public.billing_markets bm on bm.user_id = um.user_id
    where (p_include_internal or not au.is_internal)
  ),
  seg as (
    select d.*,
           case when d.is_paying then coalesce(nullif(d.plan_effective, 'free'), d.invoice_plan, 'unknown')
                when d.plan_effective <> 'free' and d.trial_in_month then 'trial'
                when d.plan_effective <> 'free' then 'unpaid_subscription'
                else 'free' end as segment
    from detail d
  ),
  agg as (
    select sg.segment,
           -- AI cost: USD, or TRY at the user-month's rate (only priced runs need one).
           sum(case when p_currency = 'try' then sg.cost_usd * sg.usd_try else sg.cost_usd end) as cost_amt,
           bool_or(p_currency = 'try' and sg.has_cost and sg.usd_try is null) as cost_missing,
           sum(sg.cost_usd) as cost_usd,
           sum(sg.cost_exact_usd) as cost_exact_usd,
           -- Revenue in the requested currency (usd / try); the other invoice currency is converted.
           sum(case p_currency
                 when 'usd' then sg.rec_usd + case when sg.rec_try = 0 then 0 else sg.rec_try / sg.usd_try end
                 when 'try' then sg.rec_try + case when sg.rec_usd = 0 then 0 else sg.rec_usd * sg.usd_try end
               end) as rev_amt,
           bool_or((p_currency = 'usd' and sg.rec_try <> 0 or p_currency = 'try' and sg.rec_usd <> 0) and sg.usd_try is null) as rev_missing,
           sum(sg.rec_usd + case when sg.rec_try = 0 then 0 else sg.rec_try / sg.usd_try end) as rev_usd,
           bool_or(sg.rec_try <> 0 and sg.usd_try is null) as rev_usd_missing,
           sum(sg.rec_usd) as rec_usd,
           sum(sg.rec_try) as rec_try,
           bool_or(((p_currency = 'try' and (sg.has_cost or sg.rec_usd <> 0)) or (p_currency = 'usd' and sg.rec_try <> 0))
                   and sg.provisional) as provisional,
           count(distinct sg.user_id) as n_users,
           count(distinct sg.user_id) filter (where sg.is_paying) as n_paying,
           count(distinct sg.user_id) filter (where sg.n_runs > 0) as n_active,
           sum(sg.n_runs) as n_runs,
           sum(sg.n_unpriced) as n_unpriced
    from seg sg
    where (v_markets is null or sg.market = any (v_markets))
      and (v_plans is null or sg.segment = any (v_plans))
    group by sg.segment
  ),
  fin as (
    select a.*,
           case when a.cost_missing then null else coalesce(a.cost_amt, 0) end as cost_out,
           case when p_currency = 'native' or a.rev_missing then null else a.rev_amt end as rev_out
    from agg a
  )
  select f.segment,
         round(f.cost_out, 6),
         f.n_users,
         f.n_paying,
         f.n_active,
         f.n_runs::bigint,
         f.n_unpriced::bigint,
         round(f.cost_out / nullif(f.n_users, 0), 6),
         round(f.cost_out / nullif(f.n_paying, 0), 6),
         round(f.rev_out, 2),
         round(f.rec_usd, 2),
         round(f.rec_try, 2),
         case when f.rev_usd_missing then null else round(coalesce(f.cost_usd, 0) / nullif(f.rev_usd, 0), 4) end,
         round(f.rev_out - f.cost_out, 2),
         round(f.cost_exact_usd / nullif(f.cost_usd, 0), 4),
         coalesce(f.provisional, false)
  from fin f
  order by f.cost_out desc nulls last, f.segment;
end $$;

comment on function analytics.ai_cost_by_plan(date, date, text, text, boolean, text, jsonb) is
'{"title":"AI cost by plan","definition":"AI cost against recognised revenue per plan segment for the range (UTC), built per user-month (KB). Universe: user-months of analysis accounts (internal ones only when included) with an AI run in the range, revenue recognised in the range, or an overlapping real subscription. Plan: usage_counters.plan_code (stamped from 2026-10-29), else the most recently created real subscription overlapping the month, else the plan of the paid invoice covering it. A user-month is paying when a paid recurring invoice''s service period overlaps it (or the plan is lifetime); its segment is the plan. Non-paying user-months on a non-free plan are trial (a trial touches the month) or unpaid_subscription; everything else is free. An account can appear in several segments within one range. Revenue is recognised revenue: recurring invoices spread over their service period by time share, clipped to the range and to now; one-time invoices in the paid month; erased accounts are out of scope (their AI runs are gone), so revenue is lower than analytics.revenue. revenue / gross_margin (revenue - AI cost only; no Stripe fees or infrastructure) are in the requested currency (null for native, see the *_native columns), converted per user-month at that month''s USD->TRY rate (fx_provisional when it is month-to-date, from an earlier month or missing; a needed missing rate makes the value null). ai_cost_share_of_revenue uses USD. AI cost is a lower bound while unpriced_runs > 0 (margins an upper bound): exact from 2026-10-27, token-estimated before. Before the 2026-10-24 paywall free users could use AI, so free-segment cost is not comparable across it. Market is the account''s locked market (unknown without one); the plan filter matches the segment. p_grain is ignored. Dashboard definition: one row per segment for the selected range instead of the KB''s month x segment x market grid; market ''unknown'' instead of the KB''s GLOBAL / no_market fallbacks.","unit":"currency","shape":"breakdown","breakdowns":[],"filters":["plan","market"],"kb":"new_analysis/ai_cost/ai_cost_unit_economics_by_plan.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"ai_cost":{"label":"AI cost","unit":"currency","description":"USD unless currency = try"},"users":{"label":"Users","unit":"count"},"paying_users":{"label":"Paying users","unit":"count"},"ai_active_users":{"label":"AI-active users","unit":"count"},"runs":{"label":"AI runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"},"cost_per_user":{"label":"AI cost per user","unit":"currency"},"cost_per_paying_user":{"label":"AI cost per paying user","unit":"currency"},"revenue":{"label":"Recognised revenue","unit":"currency","description":"Requested currency; null for native"},"revenue_usd_native":{"label":"Revenue (USD invoices)","unit":"currency"},"revenue_try_native":{"label":"Revenue (TRY invoices)","unit":"currency"},"ai_cost_share_of_revenue":{"label":"AI cost / revenue","unit":"ratio","description":"In USD"},"gross_margin":{"label":"Gross margin after AI","unit":"currency","description":"Revenue - AI cost"},"exact_share":{"label":"Exact share","unit":"ratio","description":"Exact cost / total cost"}}}';

-- ---------------------------------------------------------------------------
-- Drill-down keys (analytics_people.drill_users convention, see 20261101120000_analytics_people.sql)
-- ---------------------------------------------------------------------------

-- Accounts with failed runs behind an ai_reliability point (a flow / model / provider and a day or bucket).
create function analytics_private.drill_ai_failures_by_flow(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
begin
  perform analytics_private.assert_filter_keys(p_filters, array['ai_flow', 'ai_model', 'ai_provider', 'market']);
  return query
  with s as (
    -- Internal accounts are kept: drill_users applies include_internal and the privacy rules.
    select * from analytics_private.ai_run_scope(p_from, p_to, true, p_filters)
  ),
  classes as (
    select c.user_id, jsonb_object_agg(c.failure_class, c.n order by c.failure_class) as by_class
    from (select s.user_id, s.failure_class, count(*) as n from s where s.status = 'failed' group by 1, 2) c
    group by c.user_id
  ),
  per_user as (
    select s.user_id,
           count(*) as n_runs,
           count(*) filter (where s.status = 'failed') as n_failed,
           count(*) filter (where s.status in ('completed', 'failed')) as n_terminal,
           max(s.started_at) filter (where s.status = 'failed') as last_failed_at,
           array_agg(distinct s.flow_type order by s.flow_type) filter (where s.status = 'failed') as flows,
           array_agg(distinct s.model_name order by s.model_name) filter (where s.status = 'failed') as models
    from s
    group by s.user_id
    having count(*) filter (where s.status = 'failed') > 0
  )
  select p.user_id,
         p.n_failed::numeric,
         jsonb_build_object('failed_runs', p.n_failed, 'runs', p.n_runs,
                            'failure_rate', round(p.n_failed::numeric / nullif(p.n_terminal, 0), 4),
                            'last_failed_at', p.last_failed_at, 'flows', to_jsonb(p.flows), 'models', to_jsonb(p.models),
                            'failure_classes', coalesce(c.by_class, '{}'::jsonb)),
         p.n_failed::text
  from per_user p
  left join classes c on c.user_id = p.user_id;
end $$;

comment on function analytics_private.drill_ai_failures_by_flow(date, date, jsonb, integer, text) is
'{"description":"Accounts with failed AI runs in the range (analytics.ai_reliability population), most failures first; detail has the account''s failure rate and failure classes (never the error text).","metric":"ai_reliability","filters":["ai_flow","ai_model","ai_provider","market"],"value":"failed runs in range","unit":"count","order":"most failures first","detail":["failed_runs","runs","failure_rate","last_failed_at","flows","models","failure_classes"]}';

-- Accounts behind an ai_wasted_spend point, most wasted cost first.
create function analytics_private.drill_ai_wasted_spend(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
begin
  perform analytics_private.assert_filter_keys(p_filters, array['ai_flow', 'ai_model', 'ai_provider', 'market']);
  return query
  with per_user as (
    select w.user_id,
           round(coalesce(sum(w.cost_usd * w.wasted_fraction), 0), 6) as wasted_usd,
           round(coalesce(sum(w.cost_usd), 0), 6) as total_usd,
           count(*) filter (where w.wasted_fraction > 0) as wasted_runs,
           count(*) filter (where w.w_failed) as failed_runs,
           count(*) as n_runs,
           count(*) filter (where w.unpriced) as unpriced_runs,
           sum(w.tokens * w.wasted_fraction) as wasted_tokens,
           sum(w.tokens) as tokens,
           array_agg(distinct w.flow_type order by w.flow_type) filter (where w.wasted_fraction > 0) as flows
    from analytics_private.ai_run_waste(p_from, p_to, true, p_filters) w
    group by w.user_id
    having bool_or(w.wasted_fraction > 0)
  )
  select p.user_id,
         p.wasted_usd,
         jsonb_build_object('wasted_cost_usd', p.wasted_usd, 'total_cost_usd', p.total_usd,
                            'wasted_share', round(p.wasted_usd / nullif(p.total_usd, 0), 4),
                            'wasted_tokens_share', round(p.wasted_tokens / nullif(p.tokens, 0), 4),
                            'wasted_runs', p.wasted_runs, 'failed_runs', p.failed_runs, 'runs', p.n_runs,
                            'unpriced_runs', p.unpriced_runs, 'flows', to_jsonb(p.flows)),
         p.wasted_usd::text
  from per_user p;
end $$;

comment on function analytics_private.drill_ai_wasted_spend(date, date, jsonb, integer, text) is
'{"description":"Accounts with wasted AI spend in the range (analytics.ai_wasted_spend definition, de-duplicated), highest wasted cost (USD) first; accounts whose waste is all unpriced are listed with 0.","metric":"ai_wasted_spend","filters":["ai_flow","ai_model","ai_provider","market"],"value":"wasted AI cost in USD","unit":"currency","order":"highest wasted cost first","detail":["wasted_cost_usd","total_cost_usd","wasted_share","wasted_tokens_share","wasted_runs","failed_runs","runs","unpriced_runs","flows"]}';

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
