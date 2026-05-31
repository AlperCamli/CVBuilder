-- AI cost per top user spenders (+ behavioural signals)
--
-- ai_runs has no cost column, so cost is derived from token counts × per-model
-- rates. Edit the `pricing` CTE below with your real USD/1M-token rates.
-- Source columns: public.ai_runs (input_tokens, output_tokens, model_name,
-- provider, flow_type, status, started_at, user_id) joined to public.users.

with pricing(model_name, input_usd_per_mtok, output_usd_per_mtok) as (
  values
    -- model_name              input $/1M   output $/1M   <-- EDIT THESE
    ('gemini-3-flash',          0.30,        2.50),
    ('gemini-2.5-flash-preview',0.30,        2.50)
),

runs as (
  select
    r.user_id,
    r.flow_type,
    r.model_name,
    r.status,
    r.started_at,
    coalesce(r.input_tokens, 0)  as input_tokens,
    coalesce(r.output_tokens, 0) as output_tokens,
    -- per-run cost; falls back to 0 if the model has no pricing row
    coalesce(r.input_tokens, 0)  / 1e6 * coalesce(p.input_usd_per_mtok, 0)
      + coalesce(r.output_tokens, 0) / 1e6 * coalesce(p.output_usd_per_mtok, 0) as run_cost_usd
  from public.ai_runs r
  left join pricing p on p.model_name = r.model_name
  -- optional window; comment out to score all-time
  where r.started_at >= now() - interval '90 days'
),

per_user as (
  select
    user_id,
    count(*)                                              as total_runs,
    count(*) filter (where status = 'completed')          as completed_runs,
    count(*) filter (where status = 'failed')             as failed_runs,
    sum(input_tokens)                                     as total_input_tokens,
    sum(output_tokens)                                    as total_output_tokens,
    sum(input_tokens + output_tokens)                     as total_tokens,
    round(sum(run_cost_usd)::numeric, 4)                  as total_cost_usd,
    round(avg(run_cost_usd)::numeric, 5)                  as avg_cost_per_run_usd,
    -- behaviour: which flow drives their spend, model mix, span of activity
    mode() within group (order by flow_type)              as top_flow_type,
    count(distinct flow_type)                             as distinct_flow_types,
    count(distinct model_name)                            as distinct_models,
    count(distinct date_trunc('day', started_at))         as active_days,
    min(started_at)                                       as first_run_at,
    max(started_at)                                       as last_run_at
  from runs
  group by user_id
)

select
  u.id            as user_id,
  u.email,
  u.created_at    as signed_up_at,
  pu.total_cost_usd,
  pu.avg_cost_per_run_usd,
  pu.total_runs,
  pu.completed_runs,
  pu.failed_runs,
  round(pu.failed_runs::numeric / nullif(pu.total_runs, 0), 3) as failure_rate,
  pu.total_input_tokens,
  pu.total_output_tokens,
  pu.total_tokens,
  pu.top_flow_type,
  pu.distinct_flow_types,
  pu.distinct_models,
  pu.active_days,
  round(pu.total_runs::numeric / nullif(pu.active_days, 0), 2) as runs_per_active_day,
  pu.first_run_at,
  pu.last_run_at
from per_user pu
join public.users u on u.id = pu.user_id
order by pu.total_cost_usd desc
limit 50;
