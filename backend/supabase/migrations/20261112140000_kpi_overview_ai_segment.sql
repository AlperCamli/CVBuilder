-- analytics.kpi_overview follows the AI cost ai_segment filter (integration of 20261112120000_trial_outcomes_charge_pending.sql
-- and 20261112130000_ai_cost_observability.sql). The Overview AI cost tile now counts the same runs as the AI cost
-- page: analytics_private.ai_segments(p_filters, p_include_internal). Without ai_segment the population is unchanged
-- (non-guest runs of analysis accounts, admin accounts only when p_include_internal), so alert rules and existing
-- callers keep their numbers; the dashboard sends every segment while "Include all AI costs" is checked.
-- Body copied from 20261112120000 (the latest definition) with only these changes: ai_segment in the accepted filter
-- list, and the AI cost block's population filter. Comment: ai_segment in filters and in the definition, and
-- "ignores_filters":["ai_segment"] on every non-AI measure. Signature and return type unchanged.

create or replace function analytics.kpi_overview(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  signups bigint, activated_users bigint, activation_eligible bigint, activated_eligible bigint, activation_rate numeric,
  new_paying_customers bigint,
  revenue numeric, revenue_usd_native numeric, revenue_try_native numeric,
  mrr numeric, mrr_usd_native numeric, mrr_try_native numeric, active_subscriptions bigint,
  trial_starts bigint, trial_resolved bigint, trial_conversions bigint, trial_to_paid_rate numeric,
  ai_cost numeric, ai_runs bigint, unpriced_ai_runs bigint,
  revenue_fx_provisional boolean, mrr_fx_provisional boolean, ai_cost_fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  -- MRR snapshot: the last instant of p_to, or now while p_to is still running.
  v_snap timestamptz;
  v_markets text[];
  v_plans text[];
  v_signups bigint;
  v_activated bigint;
  v_eligible bigint;
  v_activated_eligible bigint;
  v_new_paying bigint;
  v_rev_usd numeric;
  v_rev_try numeric;
  v_rev_converted numeric;
  v_rev_missing boolean;
  v_rev_provisional boolean;
  v_mrr_usd numeric;
  v_mrr_try numeric;
  v_active_subs bigint;
  v_mrr_rate numeric;
  v_mrr_rate_final boolean;
  v_mrr_rate_month date;
  v_mrr numeric;
  v_mrr_needs_fx boolean := false;
  v_trials bigint;
  v_conversions bigint;
  v_resolved bigint;
  v_ai_cost numeric;
  v_ai_runs bigint;
  v_unpriced bigint;
  v_ai_missing boolean;
  v_ai_provisional boolean;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'plan', 'ai_segment']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_snap := least(v_end - interval '1 microsecond', now());
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  -- Signups and activation (market = the user's locked market; plan is ignored): activated = first completed
  -- export (master or tailored CV) within 7 days of signup. Eligible = the 7-day window has closed.
  select count(*),
         count(*) filter (where a.activated),
         count(*) filter (where u.created_at + interval '7 days' <= now()),
         count(*) filter (where u.created_at + interval '7 days' <= now() and a.activated)
  into v_signups, v_activated, v_eligible, v_activated_eligible
  from analytics_private.analysis_users u
  left join public.billing_markets bm on bm.user_id = u.id
  cross join lateral (
    select exists (
      select 1 from public.exports e
      where e.user_id = u.id and e.status = 'completed'
        and e.completed_at < u.created_at + interval '7 days'
    ) as activated
  ) a
  where (p_include_internal or not u.is_internal)
    and u.created_at >= v_start
    and u.created_at < v_end
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));

  -- New paying customers: the customer's first collected invoice (amount_paid > 0) falls in the range; market
  -- and plan come from that invoice. Erased accounts are keyed by subscription, as in the KB customer_key.
  with first_inv as (
    select distinct on (coalesce('u:' || ir.user_id::text, 's:' || ir.subscription_id::text, 'i:' || ir.id::text))
           ir.market, ir.plan_code
    from analytics_private.invoice_revenue ir
    where (p_include_internal or not ir.is_internal_user)
      and ir.paid_at >= v_start
      and ir.paid_at < v_end
      and not exists (
        select 1 from analytics_private.invoice_revenue e
        where e.paid_at < v_start
          and (e.user_id = ir.user_id
               or (ir.user_id is null and e.user_id is null and e.subscription_id = ir.subscription_id))
      )
    order by coalesce('u:' || ir.user_id::text, 's:' || ir.subscription_id::text, 'i:' || ir.id::text), ir.paid_at, ir.id
  )
  select count(*) into v_new_paying
  from first_inv fi
  where (v_markets is null or coalesce(fi.market, 'unknown') = any (v_markets))
    and (v_plans is null or coalesce(fi.plan_code, 'unknown') = any (v_plans));

  -- Revenue in the range, three variants (invoice market and plan).
  select coalesce(sum(ir.revenue) filter (where ir.currency = 'USD'), 0),
         coalesce(sum(ir.revenue) filter (where ir.currency = 'TRY'), 0),
         coalesce(sum(case p_currency when 'try' then ir.revenue_try else ir.revenue_usd end), 0),
         coalesce(bool_or(p_currency <> 'native' and ir.currency <> upper(p_currency) and ir.usd_try is null), false),
         coalesce(bool_or(p_currency <> 'native' and ir.currency <> upper(p_currency) and ir.fx_is_provisional), false)
  into v_rev_usd, v_rev_try, v_rev_converted, v_rev_missing, v_rev_provisional
  from analytics_private.invoice_revenue ir
  where (p_include_internal or not ir.is_internal_user)
    and ir.paid_at >= v_start
    and ir.paid_at < v_end
    and (v_markets is null or coalesce(ir.market, 'unknown') = any (v_markets))
    and (v_plans is null or coalesce(ir.plan_code, 'unknown') = any (v_plans));

  -- MRR at the snapshot (KB revenue_monthly_by_currency B / mrr_movement_waterfall): per subscription, the latest
  -- paid recurring invoice whose service period covers the snapshot, normalised to one month. Market and plan
  -- are those of that invoice.
  with recurring as (
    select ir.*,
           coalesce(ir.subscription_id::text, 'i:' || ir.id::text) as sub_key,
           case when d.period_days between 27 and 32 then 1
                when d.period_days between 358 and 368 then 12
                else d.period_days / 30.4375 end as period_months
    from analytics_private.invoice_revenue ir
    cross join lateral (select extract(epoch from ir.period_end - ir.period_start) / 86400.0 as period_days) d
    where (p_include_internal or not ir.is_internal_user)
      and coalesce(ir.billing_reason, '') like 'subscription%'
      and ir.plan_code is distinct from 'lifetime'
      and ir.period_start is not null
      and ir.period_end > ir.period_start
      -- Only invoices that can cover the snapshot (coverage never extends past period_end + renewal grace).
      and ir.period_start <= v_snap
      and ir.period_end + interval '3 days' > v_snap
  ),
  mrr_inv as (
    select ri.sub_key, ri.currency, ri.market, ri.plan_code, ri.period_start, ri.period_end, ri.paid_at,
           case when ri.billing_reason = 'subscription_update' and ri.revenue > 0 and pl.monthly_list_price is not null
                then pl.monthly_list_price  -- a plan-change invoice nets a proration credit
                else ri.revenue / nullif(ri.period_months, 0) end as mrr_amount,
           ev.first_end_at,
           least(ri.period_end, ev.first_end_at) as coverage_end
    from recurring ri
    left join lateral (
      select pc.unit_amount / 100.0 * case pc.billing_interval
               when 'week' then 52.0 / 12 when 'month' then 1 when 'year' then 1.0 / 12 when 'day' then 365.0 / 12
             end / coalesce(nullif(pc.interval_count, 0), 1) as monthly_list_price
      from public.billing_price_catalog pc
      where pc.is_configured and pc.plan_code = ri.plan_code and upper(pc.currency) = ri.currency
      order by (pc.market is not distinct from ri.market) desc
      limit 1
    ) pl on true
    -- Live history (from 2026-10-29): an end event after payment cuts the service short.
    left join lateral (
      select min(se.occurred_at) as first_end_at
      from public.subscription_events se
      where se.subscription_id = ri.subscription_id
        and se.event_type in ('canceled', 'past_due', 'superseded', 'trial_canceled')
        and se.source <> 'backfill'
        and se.occurred_at > ri.paid_at
    ) ev on true
  ),
  snap as (
    select distinct on (m.sub_key) m.sub_key, m.currency, m.market, m.plan_code, m.mrr_amount
    from mrr_inv m
    where v_snap < m.coverage_end
       or (m.first_end_at is null
           and v_snap < m.period_end + interval '3 days'
           and now() < m.period_end + interval '3 days')
    order by m.sub_key, m.period_start desc, m.paid_at desc
  )
  select coalesce(sum(s.mrr_amount) filter (where s.currency = 'USD'), 0),
         coalesce(sum(s.mrr_amount) filter (where s.currency = 'TRY'), 0),
         -- A fully refunded latest invoice leaves the subscription at 0 MRR: not active.
         count(*) filter (where s.mrr_amount > 0)
  into v_mrr_usd, v_mrr_try, v_active_subs
  from snap s
  where (v_markets is null or coalesce(s.market, 'unknown') = any (v_markets))
    and (v_plans is null or coalesce(s.plan_code, 'unknown') = any (v_plans));

  select f.rate, f.is_final, f.rate_month into v_mrr_rate, v_mrr_rate_final, v_mrr_rate_month
  from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY'
    and f.rate_month <= date_trunc('month', v_snap at time zone 'UTC')::date
  order by f.rate_month desc
  limit 1;
  if p_currency = 'usd' then
    v_mrr_needs_fx := v_mrr_try <> 0;
    v_mrr := v_mrr_usd + case when v_mrr_needs_fx then v_mrr_try / v_mrr_rate else 0 end;
  elsif p_currency = 'try' then
    v_mrr_needs_fx := v_mrr_usd <> 0;
    v_mrr := v_mrr_try + case when v_mrr_needs_fx then v_mrr_usd * v_mrr_rate else 0 end;
  end if;

  -- Trial -> paid (KB trial_to_paid_conversion): trials started in the range, classified by
  -- analytics_private.trial_outcomes (the same rules as analytics.trial_to_paid). resolved = converted, failed first
  -- charge or canceled; converted includes plan-change and replacement-subscription conversions. Market =
  -- subscription market, else the user's locked market.
  select count(*),
         count(*) filter (where o.outcome_group in ('converted', 'failed_first_charge', 'trial_canceled')),
         count(*) filter (where o.outcome_group = 'converted')
  into v_trials, v_resolved, v_conversions
  from analytics_private.trial_outcomes o
  where (p_include_internal or not o.is_internal)
    and o.t_start >= v_start
    and o.t_start < v_end
    and (v_markets is null or o.market = any (v_markets))
    and (v_plans is null or o.plan_code = any (v_plans));

  -- AI cost (same population and pricing as analytics.ai_cost, including its ai_segment filter; market = the user's
  -- locked market).
  with fx as (
    select m::date as month, f.usd_try,
           (f.usd_try is null or not f.is_final or f.rate_month <> m::date) as provisional
    from generate_series(date_trunc('month', r.from_day::timestamp), r.to_day::timestamp, interval '1 month') m
    left join lateral (
      select x.rate as usd_try, x.is_final, x.rate_month
      from public.fx_rates x
      where x.base_currency = 'USD' and x.quote_currency = 'TRY' and x.rate_month <= m::date
      order by x.rate_month desc
      limit 1
    ) f on true
  )
  select coalesce(sum(case when p_currency = 'try' then rc.cost_usd * x.usd_try else rc.cost_usd end), 0),
         count(*),
         count(*) filter (where rc.cost_usd is null and rc.has_tokens),
         coalesce(bool_or(p_currency = 'try' and rc.cost_usd is not null and x.usd_try is null), false),
         coalesce(bool_or(p_currency = 'try' and rc.cost_usd is not null and x.provisional), false)
  into v_ai_cost, v_ai_runs, v_unpriced, v_ai_missing, v_ai_provisional
  from analytics_private.run_cost rc
  left join public.billing_markets bm on bm.user_id = rc.user_id
  left join fx x on x.month = date_trunc('month', rc.started_at at time zone 'UTC')::date
  where rc.segment = any (analytics_private.ai_segments(p_filters, p_include_internal))
    and rc.started_at >= v_start
    and rc.started_at < v_end
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));

  return query select
    v_signups,
    v_activated,
    v_eligible,
    v_activated_eligible,
    round(v_activated_eligible::numeric / nullif(v_eligible, 0), 4),
    v_new_paying,
    case when p_currency = 'native' or v_rev_missing then null else round(v_rev_converted, 2) end,
    round(v_rev_usd, 2),
    round(v_rev_try, 2),
    case when p_currency = 'native' then null else round(v_mrr, 2) end,
    round(v_mrr_usd, 2),
    round(v_mrr_try, 2),
    v_active_subs,
    v_trials,
    v_resolved,
    v_conversions,
    round(v_conversions::numeric / nullif(v_resolved, 0), 4),
    case when v_ai_missing then null else round(v_ai_cost, 6) end,
    v_ai_runs,
    v_unpriced,
    v_rev_provisional,
    (v_mrr_needs_fx and (v_mrr_rate is null or not v_mrr_rate_final
                         or v_mrr_rate_month <> date_trunc('month', v_snap at time zone 'UTC')::date)),
    v_ai_provisional;
end $$;

comment on function analytics.kpi_overview(date, date, text, text, boolean, text, jsonb) is
'{"title":"Overview KPIs","definition":"One row for the whole range (UTC); internal accounts excluded unless included. Signups: new accounts, excluding accounts pending deletion or with restricted processing. Activated users: signups of the range whose first completed export (master or tailored CV) came within 7 days of signup; activation_eligible = signups whose 7-day window has closed, activated_eligible = activated among them, activation_rate = activated_eligible / activation_eligible (compare periods by the rate). New paying customers: customers whose first collected invoice (amount_paid > 0, refunds included) falls in the range; erased accounts count per subscription. Revenue: net cash from billing_invoices paid in the range, in the requested currency (null for native) and natively per invoice currency. MRR and active subscriptions: snapshot at the end of p_to (or now): per subscription, the latest paid recurring invoice covering the snapshot, normalised to one month (trials and lifetime excluded); active subscriptions have MRR > 0. Trials (analytics_private.trial_outcomes, the same rules as analytics.trial_to_paid): trials started in the range; trial_resolved = converted, failed first charge or canceled; trial_conversions = converted trials (a paid first subscription_cycle invoice from trial end, a paid plan-change invoice during the trial, or a paid replacement subscription such as the cancel-flow offer); trials still running, superseded, with the first charge pending or needing a check are not resolved; trial_to_paid_rate = trial_conversions / trial_resolved. AI cost: exact + estimated cost of non-mock runs started in the range (USD; TRY when currency = try), with unpriced runs counted; ai_segment selects whose runs count, as in analytics.ai_cost (external, internal, guest, restricted); without it, external accounts plus internal ones when included (non-guest runs of analysis accounts, as before segments existed). Filters: market uses the user''s locked market for signups, activation and AI cost, and the invoice or subscription market for revenue, MRR, subscriptions, new paying customers and trials; plan applies to revenue, MRR, active subscriptions, new paying customers and trials. ai_segment applies to the AI cost measures only. The *_fx_provisional flags are true when that measure needed a USD/TRY conversion whose rate was month-to-date, from an earlier month or missing (the measure is then null); always false for native. Sources: queries/user_acquisition_activation_report.md, queries/new_paying_customers_monthly.md, new_analysis/monetization/revenue_monthly_by_currency.md, mrr_movement_waterfall.md, trial_to_paid_conversion.md, queries/active_subscriptions_by_plan.md, new_analysis/ai_cost/ai_cost_per_outcome.md.","unit":"count","shape":"kpi","breakdowns":[],"filters":["market","plan","ai_segment"],"kb":"new_analysis/README.md","consent_scoped":false,"alertable":true,"measures":{"signups":{"label":"Signups","unit":"count","ignores_filters":["plan","ai_segment"]},"activated_users":{"label":"Activated users","unit":"count","description":"First completed export within 7 days of signup","ignores_filters":["plan","ai_segment"]},"activation_eligible":{"label":"Activation-eligible signups","unit":"count","description":"Signups whose 7-day window has closed","ignores_filters":["plan","ai_segment"]},"activated_eligible":{"label":"Activated (eligible)","unit":"count","description":"Activated users among eligible signups","ignores_filters":["plan","ai_segment"]},"activation_rate":{"label":"Activation rate","unit":"ratio","description":"activated_eligible / activation_eligible","ignores_filters":["plan","ai_segment"]},"new_paying_customers":{"label":"New paying customers","unit":"count","description":"First collected invoice in the range","ignores_filters":["ai_segment"]},"revenue":{"label":"Revenue","unit":"currency","description":"Net cash, requested currency","ignores_filters":["ai_segment"]},"revenue_usd_native":{"label":"Revenue (USD invoices)","unit":"currency","ignores_filters":["ai_segment"]},"revenue_try_native":{"label":"Revenue (TRY invoices)","unit":"currency","ignores_filters":["ai_segment"]},"mrr":{"label":"MRR","unit":"currency","description":"Snapshot at the end of the range","ignores_filters":["ai_segment"]},"mrr_usd_native":{"label":"MRR (USD)","unit":"currency","ignores_filters":["ai_segment"]},"mrr_try_native":{"label":"MRR (TRY)","unit":"currency","ignores_filters":["ai_segment"]},"active_subscriptions":{"label":"Active subscriptions","unit":"count","description":"Subscriptions with MRR > 0 at the end of the range","ignores_filters":["ai_segment"]},"trial_starts":{"label":"Trial starts","unit":"count","ignores_filters":["ai_segment"]},"trial_resolved":{"label":"Resolved trials","unit":"count","description":"Converted, failed first charge or canceled","ignores_filters":["ai_segment"]},"trial_conversions":{"label":"Trial conversions","unit":"count","description":"Includes plan-change and replacement-subscription conversions","ignores_filters":["ai_segment"]},"trial_to_paid_rate":{"label":"Trial to paid","unit":"ratio","description":"trial_conversions / trial_resolved","ignores_filters":["ai_segment"]},"ai_cost":{"label":"AI cost","unit":"currency","description":"USD; TRY when currency = try","ignores_filters":["plan"]},"ai_runs":{"label":"AI runs","unit":"count","ignores_filters":["plan"]},"unpriced_ai_runs":{"label":"Unpriced AI runs","unit":"count","ignores_filters":["plan"]}}}';

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
