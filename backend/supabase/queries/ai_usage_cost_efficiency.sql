-- =============================================================================
-- AI Usage & Cost Efficiency Report
-- =============================================================================
-- How often users trigger AI actions, average cost per AI operation, which AI
-- features (flow_type) are used most, and which user segments drive the most
-- AI cost.
--
-- Tables: public.ai_runs (input_tokens/output_tokens/model_name/provider/
--         flow_type/status/started_at/user_id), public.users, public.subscriptions
--
-- ⚠️ COST CAVEAT
-- ai_runs has no cost column; cost is derived from token counts × per-model USD
-- rates. EDIT the `pricing` CTE with your real $/1M-token rates. Runs whose
-- model has no pricing row contribute 0 cost (so keep the list current).
--
-- This file has TWO independent queries:
--   QUERY A — usage & cost per AI feature (flow_type)
--   QUERY B — highest-cost user segments (by current plan)
-- =============================================================================


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY A — AI usage & cost per feature (flow_type)                          │
-- └───────────────────────────────────────────────────────────────────────────┘
with pricing(model_name, input_usd_per_mtok, output_usd_per_mtok) as (
  values
    -- model_name               input $/1M   output $/1M   <-- EDIT THESE
    ('gemini-3-flash',           0.30,        2.50),
    ('gemini-2.5-flash-preview', 0.30,        2.50)
),

runs as (
  select
    r.flow_type,
    r.user_id,
    r.status,
    coalesce(r.input_tokens, 0)  as input_tokens,
    coalesce(r.output_tokens, 0) as output_tokens,
    coalesce(r.input_tokens, 0)  / 1e6 * coalesce(p.input_usd_per_mtok, 0)
      + coalesce(r.output_tokens, 0) / 1e6 * coalesce(p.output_usd_per_mtok, 0) as run_cost_usd
  from public.ai_runs r
  left join pricing p on p.model_name = r.model_name
  -- optional window; comment out to score all-time
  where r.started_at >= now() - interval '90 days'
)

select
  flow_type                                                       as ai_feature,
  count(*)                                                        as total_runs,
  round(100.0 * count(*) / sum(count(*)) over (), 1)              as pct_of_all_runs,
  count(distinct user_id)                                         as distinct_users,
  count(*) filter (where status = 'completed')                   as completed_runs,
  count(*) filter (where status = 'failed')                      as failed_runs,
  round(
    count(*) filter (where status = 'failed')::numeric
    / nullif(count(*), 0), 3
  )                                                               as failure_rate,
  sum(input_tokens + output_tokens)                              as total_tokens,
  round(sum(run_cost_usd)::numeric, 2)                           as total_cost_usd,
  -- average cost per AI operation (the headline efficiency metric)
  round(avg(run_cost_usd)::numeric, 5)                           as avg_cost_per_run_usd,
  round(100.0 * sum(run_cost_usd) / nullif(sum(sum(run_cost_usd)) over (), 0), 1)
                                                                  as pct_of_total_cost
from runs
group by flow_type
order by total_cost_usd desc;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY B — highest-cost user segments (by current plan)                     │
-- └───────────────────────────────────────────────────────────────────────────┘
-- Segments users by their current paid plan (active/trialing subscription, else
-- 'free') and ranks segments by total + per-user AI cost.
with pricing(model_name, input_usd_per_mtok, output_usd_per_mtok) as (
  values
    ('gemini-3-flash',           0.30, 2.50),
    ('gemini-2.5-flash-preview', 0.30, 2.50)
),

current_plan as (
  -- one active/trialing subscription per user is enforced by a unique index
  select distinct on (s.user_id)
    s.user_id,
    s.plan_code
  from public.subscriptions s
  where s.status in ('active', 'trialing')
  order by s.user_id, s.current_period_start desc nulls last
),

run_costs as (
  select
    r.user_id,
    coalesce(r.input_tokens, 0)  / 1e6 * coalesce(p.input_usd_per_mtok, 0)
      + coalesce(r.output_tokens, 0) / 1e6 * coalesce(p.output_usd_per_mtok, 0) as run_cost_usd
  from public.ai_runs r
  left join pricing p on p.model_name = r.model_name
  where r.started_at >= now() - interval '90 days'
),

per_user as (
  select
    rc.user_id,
    coalesce(cp.plan_code, 'free') as segment,
    count(*)                       as runs,
    sum(rc.run_cost_usd)           as cost_usd
  from run_costs rc
  left join current_plan cp on cp.user_id = rc.user_id
  group by rc.user_id, coalesce(cp.plan_code, 'free')
)

select
  segment,
  count(*)                                          as users_in_segment,
  sum(runs)                                         as total_runs,
  round(sum(cost_usd)::numeric, 2)                  as total_cost_usd,
  round(100.0 * sum(cost_usd) / nullif(sum(sum(cost_usd)) over (), 0), 1)
                                                    as pct_of_total_cost,
  round((sum(cost_usd) / nullif(count(*), 0))::numeric, 4)
                                                    as avg_cost_per_user_usd,
  round((sum(runs)::numeric / nullif(count(*), 0)), 1)
                                                    as avg_runs_per_user
from per_user
group by segment
order by total_cost_usd desc;
