-- Admin analytics Phase 1: shared definitions and the Overview metrics
-- (docs/admin-analytics/metrics-plan.md "Shared definitions" and "Phase 1", api-contract.md).
-- Definitions follow the KB conventions in new_analysis/README.md: UTC buckets, internal accounts excluded
-- unless requested, revenue from billing_invoices in three currency variants, AI cost exact + estimated.
--
-- FX rule (every conversion): use the USD->TRY monthly average of the conversion month, falling back to the
-- latest earlier month. The conversion is provisional when the rate is missing, its month is not final
-- (month-to-date), or it comes from an earlier month. A needed but missing rate makes the converted sum null
-- (never silently smaller).

-- ---------------------------------------------------------------------------
-- Model prices (USD per 1M tokens), synced daily from AI_MODEL_PRICING_JSON by the 03:30 refresh
-- ---------------------------------------------------------------------------

create table public.ai_model_prices (
  model_prefix text primary key check (model_prefix <> ''),
  input_usd numeric not null check (input_usd >= 0),
  cached_input_usd numeric check (cached_input_usd >= 0),
  output_usd numeric not null check (output_usd >= 0),
  refreshed_at timestamptz not null default now()
);
alter table public.ai_model_prices enable row level security;
revoke all on public.ai_model_prices from public, anon, authenticated;
grant select, insert, update, delete on public.ai_model_prices to service_role;

-- Overview AI cost reads runs by start time; no existing index leads with started_at.
create index ai_runs_started_at_idx on public.ai_runs(started_at);

-- ---------------------------------------------------------------------------
-- Shared definitions (plain views so the planner can inline them and push range predicates down)
-- ---------------------------------------------------------------------------

-- Admin and test accounts. The daily refresh flags ADMIN_EMAILS case-insensitively (public.mark_internal_users).
create view analytics_private.internal_users as
select u.id
from public.users u
where u.is_internal;

-- One row per collected invoice (KB invoice_revenue), with the paid month's USD->TRY rate. revenue is the cash
-- kept after refunds in the invoice currency (major units). Erased accounts keep their invoices with a null
-- user_id; they count as revenue and are never internal. Restricted / pending-deletion accounts are kept too:
-- revenue is a financial fact, not behavioural data.
create view analytics_private.invoice_revenue as
select i.id,
       i.user_id,
       i.subscription_id,
       i.plan_code,
       i.market,
       i.billing_reason,
       upper(i.currency) as currency,
       i.paid_at,
       i.period_start,
       i.period_end,
       i.amount_paid / 100.0 as gross_paid,
       i.amount_refunded / 100.0 as refunded,
       i.amount_discount / 100.0 as discount,
       i.amount_tax / 100.0 as tax,
       (i.amount_paid - i.amount_refunded) / 100.0 as revenue,
       case upper(i.currency) when 'USD' then (i.amount_paid - i.amount_refunded) / 100.0
                              when 'TRY' then (i.amount_paid - i.amount_refunded) / 100.0 / fx.usd_try end as revenue_usd,
       case upper(i.currency) when 'TRY' then (i.amount_paid - i.amount_refunded) / 100.0
                              when 'USD' then (i.amount_paid - i.amount_refunded) / 100.0 * fx.usd_try end as revenue_try,
       fx.usd_try,
       fx.fx_is_final,
       fx.fx_rate_month,
       (fx.usd_try is null or not fx.fx_is_final
        or fx.fx_rate_month <> date_trunc('month', i.paid_at at time zone 'UTC')::date) as fx_is_provisional,
       coalesce(u.is_internal, false) as is_internal_user
from public.billing_invoices i
left join public.users u on u.id = i.user_id
-- TRY per USD of the paid month, falling back to the latest earlier month that is loaded.
left join lateral (
  select f.rate as usd_try, f.is_final as fx_is_final, f.rate_month as fx_rate_month
  from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY'
    and f.rate_month <= date_trunc('month', i.paid_at at time zone 'UTC')::date
  order by f.rate_month desc
  limit 1
) fx on true
where i.paid_at is not null
  and i.status in ('paid', 'refunded', 'partially_refunded')
  and i.amount_paid > 0;  -- $0 trial-start invoices are not revenue

-- KB run_cost: stored cost_usd when present (exact, from 2026-10-27), otherwise re-priced from tokens with the
-- longest matching prefix in public.ai_model_prices. Mock runs are excluded. Guest runs (user_id null) are kept
-- and flagged; metrics decide whether to count them.
create view analytics_private.run_cost as
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
       (r.cost_usd is not null) as cost_is_exact,
       (r.cost_usd is not null or p.model_prefix is not null) as is_priced,
       (coalesce(r.total_tokens, 0) > 0 or coalesce(r.input_tokens, 0) > 0 or coalesce(r.output_tokens, 0) > 0) as has_tokens,
       (r.user_id is null) as is_guest,
       coalesce(u.is_internal, false) as is_internal_user,
       (u.id is not null and u.deletion_requested_at is null and u.processing_restricted_at is null) as is_analysis_user
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

-- Values of one p_filters key as an array; null when the filter is absent (match everything). An empty array
-- yields an empty array for every key, so `= any(...)` matches nothing, the same as filter_match().
-- Called once per metric call, so the per-row predicate stays a plain `= any(...)`.
create function analytics_private.filter_values(p_filters jsonb, p_key text) returns text[]
language sql immutable set search_path = ''
as $$
  select case
    when p_filters is null or jsonb_typeof(p_filters) <> 'object' or not (p_filters ? p_key) then null
    when jsonb_typeof(p_filters -> p_key) = 'array'
      then array(select jsonb_array_elements_text(p_filters -> p_key))::text[]
    else array[p_filters ->> p_key]
  end
$$;

-- ---------------------------------------------------------------------------
-- analytics.signups: measures metadata (the function is unchanged)
-- ---------------------------------------------------------------------------

comment on function analytics.signups(date, date, text, text, boolean, text, jsonb) is
'{"title":"Signups","definition":"New accounts created per period (UTC). Excludes admin accounts unless included, and accounts pending deletion or with restricted processing.","unit":"count","shape":"timeseries","breakdowns":["locale","market"],"filters":["locale","market"],"kb":"queries/monthly_new_signups.md","alertable":false,"measures":{"signups":{"label":"Signups","unit":"count","description":"New accounts created in the period"}}}';

-- ---------------------------------------------------------------------------
-- analytics.revenue
-- ---------------------------------------------------------------------------

create function analytics.revenue(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, revenue numeric, refunded numeric, invoices bigint, fx_provisional boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
  v_currencies text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan', 'currency']);
  if p_currency = 'native' and p_breakdown is not null then
    raise exception 'native currency already splits by invoice currency; use usd or try for a breakdown'
      using errcode = '22023';
  end if;
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');
  v_currencies := analytics_private.filter_values(p_filters, 'currency');
  if v_currencies is not null then
    v_currencies := array(select upper(c) from unnest(v_currencies) c)::text[];
  end if;

  return query
  with base as (
    select date_trunc(p_grain, ir.paid_at at time zone 'UTC')::date as b,
           case when p_currency = 'native' then ir.currency
                when p_breakdown = 'market' then coalesce(ir.market, 'unknown')
                when p_breakdown = 'plan' then coalesce(ir.plan_code, 'unknown') end as dim,
           case p_currency when 'native' then ir.revenue
                           when 'usd' then ir.revenue_usd
                           else ir.revenue_try end as amount,
           case p_currency when 'native' then ir.refunded
                           when 'usd' then case ir.currency when 'USD' then ir.refunded when 'TRY' then ir.refunded / ir.usd_try end
                           else case ir.currency when 'TRY' then ir.refunded when 'USD' then ir.refunded * ir.usd_try end
           end as refund_amount,
           (p_currency <> 'native' and ir.currency <> upper(p_currency)) as needs_fx,
           ir.usd_try,
           ir.fx_is_provisional
    from analytics_private.invoice_revenue ir
    where (p_include_internal or not ir.is_internal_user)
      and ir.paid_at >= v_start
      and ir.paid_at < v_end
      and (v_markets is null or coalesce(ir.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(ir.plan_code, 'unknown') = any (v_plans))
      and (v_currencies is null or ir.currency = any (v_currencies))
  ),
  dims as (
    select distinct base.dim from base
    union
    select null where p_currency <> 'native' and p_breakdown is null
    union
    select c from unnest(array['USD', 'TRY']) c
    where p_currency = 'native' and (v_currencies is null or c = any (v_currencies))
  )
  select k.b,
         d.dim,
         -- A needed but missing rate makes the bucket unknown rather than silently smaller.
         case when bool_or(f.needs_fx and f.usd_try is null) then null
              else round(coalesce(sum(f.amount), 0), 2) end,
         case when bool_or(f.needs_fx and f.usd_try is null) then null
              else round(coalesce(sum(f.refund_amount), 0), 2) end,
         count(f.b),
         coalesce(bool_or(f.needs_fx and f.fx_is_provisional), false)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join base f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.revenue(date, date, text, text, boolean, text, jsonb) is
'{"title":"Revenue","definition":"Cash collected from billing_invoices per paid date (UTC): paid, refunded and partially refunded invoices with amount_paid > 0 (the $0 trial-start invoice is excluded), net of refunds. A refund is booked in the month the invoice was paid (no refund timestamp exists). Erased accounts are included; internal accounts are excluded unless included. usd / try convert each invoice at the monthly USD->TRY average of its paid month, falling back to the latest earlier month; fx_provisional is true when a conversion used a month-to-date rate or an earlier month''s rate, or no rate exists (the bucket is then null). native returns one series per invoice currency (dimension = USD / TRY) and allows no breakdown. Plan and market are the values stamped on the invoice (unknown when absent).","unit":"currency","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan","currency"],"kb":"new_analysis/monetization/revenue_monthly_by_currency.md","consent_scoped":false,"alertable":false,"measures":{"revenue":{"label":"Net revenue","unit":"currency","description":"amount_paid - amount_refunded, major units"},"refunded":{"label":"Refunded","unit":"currency","description":"Refunds on invoices paid in the period"},"invoices":{"label":"Paid invoices","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.ai_cost
-- ---------------------------------------------------------------------------

create function analytics.ai_cost(
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
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_flow', 'ai_model', 'ai_provider'], array['ai_flow', 'ai_model', 'ai_provider']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_flows := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers := analytics_private.filter_values(p_filters, 'ai_provider');

  return query
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
  ),
  base as (
    select date_trunc(p_grain, rc.started_at at time zone 'UTC')::date as b,
           case p_breakdown when 'ai_flow' then rc.flow_type
                            when 'ai_model' then rc.model_name
                            when 'ai_provider' then rc.provider end as dim,
           rc.cost_usd,
           rc.cost_is_exact,
           (rc.cost_usd is null and rc.has_tokens) as unpriced,
           -- Only priced runs are converted, and only in try mode.
           (p_currency = 'try' and rc.cost_usd is not null) as needs_fx,
           x.usd_try,
           x.provisional
    from analytics_private.run_cost rc
    left join fx x on x.month = date_trunc('month', rc.started_at at time zone 'UTC')::date
    where not rc.is_guest
      and rc.is_analysis_user
      and (p_include_internal or not rc.is_internal_user)
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
'{"title":"AI cost","definition":"AI spend per run start date (UTC). Each run costs its stored cost_usd (exact, from 2026-10-27) or, when that is null, its tokens re-priced with the longest matching model prefix in ai_model_prices (estimated). Runs with tokens but no price count as unpriced and add no cost, so cost is a lower bound while unpriced_runs > 0. Excludes mock runs, guest runs, accounts pending deletion or with restricted processing, and internal accounts unless included. Cost is USD for native and usd; try converts each run at the monthly USD->TRY average of its month, falling back to the latest earlier month (fx_provisional when that rate is month-to-date, from an earlier month or missing; with no rate at all the bucket cost is null). exact_share is the share of the cost that is exact rather than estimated.","unit":"currency","shape":"timeseries","breakdowns":["ai_flow","ai_model","ai_provider"],"filters":["ai_flow","ai_model","ai_provider"],"kb":"new_analysis/ai_cost/ai_cost_per_outcome.md","consent_scoped":false,"alertable":false,"measures":{"cost":{"label":"AI cost","unit":"currency","description":"Exact + estimated; USD unless currency = try"},"runs":{"label":"AI runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count","description":"Runs with tokens but no stored cost and no configured model price"},"exact_share":{"label":"Exact share","unit":"ratio","description":"Exact cost / total cost"}}}';

-- ---------------------------------------------------------------------------
-- analytics.kpi_overview
-- ---------------------------------------------------------------------------

create function analytics.kpi_overview(
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
    array[]::text[], array['market', 'plan']);
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

  -- Trial -> paid (KB trial_to_paid_conversion): trials started in the range; converted = first paid
  -- subscription_cycle invoice from trial end (or a paid plan-change invoice during the trial); resolved =
  -- converted, failed first charge or canceled. Market = subscription market, else the user's locked market.
  with subs as (
    select s.id, s.provider_subscription_id, s.status, s.created_at, s.trial_start, s.trial_end, s.plan_code,
           coalesce(s.market, bm.market, 'unknown') as market,
           (g.provider_subscription_id is not null) as is_transition_trial,
           (s.billing_interval is not null or s.currency is not null) as has_stripe_detail,
           extract(epoch from s.current_period_end - s.current_period_start) / 86400 as period_days,
           mod((extract(epoch from s.current_period_start - s.created_at) / 86400)::numeric, 7) as offset_mod7
    from public.subscriptions s
    join analytics_private.analysis_users au on au.id = s.user_id
    left join public.billing_markets bm on bm.user_id = s.user_id
    left join public.trial_transition_grants g on g.provider_subscription_id = s.provider_subscription_id
    where s.provider_subscription_id is not null
      and s.plan_code <> 'free'
      and (p_include_internal or not au.is_internal)
  ),
  trials as (
    select sb.*,
           coalesce(sb.trial_start, sb.created_at) as t_start,
           coalesce(sb.trial_end, coalesce(sb.trial_start, sb.created_at) + interval '3 days') as t_end
    from subs sb
    where (sb.trial_start is not null
           or sb.is_transition_trial
           or (not sb.has_stripe_detail
               and sb.status not in ('incomplete', 'incomplete_expired')
               and sb.plan_code in ('weekly', 'pro')
               and (sb.status = 'trialing'
                    or sb.period_days < 4
                    or (sb.plan_code = 'weekly' and sb.offset_mod7 between 2.5 and 3.5))))
      and (v_markets is null or sb.market = any (v_markets))
      and (v_plans is null or sb.plan_code = any (v_plans))
  ),
  outcomes as (
    select case
             when i.cycle_paid or i.update_paid then 'converted'
             when t.status = 'trialing' and t.t_end > now() then 'in_trial'
             when t.status in ('past_due', 'unpaid') or i.failed_charge
                  or exists (select 1 from public.subscription_events e
                             where e.subscription_id = t.id and e.source <> 'backfill'
                               and e.event_type = 'past_due' and e.from_status = 'trialing') then 'failed_first_charge'
             when t.status in ('canceled', 'incomplete_expired', 'paused') then 'trial_canceled'
             else 'unresolved'  -- superseded, awaiting first charge, active without a paid invoice
           end as outcome
    from trials t
    cross join lateral (
      select coalesce(bool_or(bi.billing_reason = 'subscription_cycle' and bi.paid_at is not null and bi.amount_paid > 0
                              and bi.status in ('paid', 'refunded', 'partially_refunded')
                              and coalesce(bi.period_start, bi.created_at) >= t.t_end - interval '1 hour'), false) as cycle_paid,
             coalesce(bool_or(bi.billing_reason = 'subscription_update' and bi.paid_at is not null and bi.amount_paid > 0
                              and bi.status in ('paid', 'refunded', 'partially_refunded')
                              and bi.created_at >= t.t_start and bi.created_at < t.t_end + interval '1 day'), false) as update_paid,
             coalesce(bool_or(bi.billing_reason = 'subscription_cycle' and bi.status in ('open', 'uncollectible', 'void')
                              and coalesce(bi.period_start, bi.created_at) >= t.t_end - interval '1 hour'
                              and coalesce(bi.period_start, bi.created_at) < t.t_end + interval '2 days'), false) as failed_charge
      from public.billing_invoices bi
      where bi.subscription_id = t.id
         or (bi.subscription_id is null and bi.provider_subscription_id = t.provider_subscription_id)
    ) i
    where t.t_start >= v_start and t.t_start < v_end
  )
  select count(*),
         count(*) filter (where o.outcome in ('converted', 'failed_first_charge', 'trial_canceled')),
         count(*) filter (where o.outcome = 'converted')
  into v_trials, v_resolved, v_conversions
  from outcomes o;

  -- AI cost (same population and pricing as analytics.ai_cost; market = the user's locked market).
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
  where not rc.is_guest
    and rc.is_analysis_user
    and (p_include_internal or not rc.is_internal_user)
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
'{"title":"Overview KPIs","definition":"One row for the whole range (UTC); internal accounts excluded unless included. Signups: new accounts, excluding accounts pending deletion or with restricted processing. Activated users: signups of the range whose first completed export (master or tailored CV) came within 7 days of signup; activation_eligible = signups whose 7-day window has closed, activated_eligible = activated among them, activation_rate = activated_eligible / activation_eligible (compare periods by the rate). New paying customers: customers whose first collected invoice (amount_paid > 0, refunds included) falls in the range; erased accounts count per subscription. Revenue: net cash from billing_invoices paid in the range, in the requested currency (null for native) and natively per invoice currency. MRR and active subscriptions: snapshot at the end of p_to (or now): per subscription, the latest paid recurring invoice covering the snapshot, normalised to one month (trials and lifetime excluded); active subscriptions have MRR > 0. Trials: trials started in the range; trial_resolved = converted, failed first charge or canceled; trial_conversions have a first paid subscription_cycle invoice from trial end; trial_to_paid_rate = trial_conversions / trial_resolved. AI cost: exact + estimated cost of non-mock, non-guest runs started in the range (USD; TRY when currency = try), with unpriced runs counted. Filters: market uses the user''s locked market for signups, activation and AI cost, and the invoice or subscription market for revenue, MRR, subscriptions, new paying customers and trials; plan applies to revenue, MRR, active subscriptions, new paying customers and trials. The *_fx_provisional flags are true when that measure needed a USD/TRY conversion whose rate was month-to-date, from an earlier month or missing (the measure is then null); always false for native. Sources: queries/user_acquisition_activation_report.md, queries/new_paying_customers_monthly.md, new_analysis/monetization/revenue_monthly_by_currency.md, mrr_movement_waterfall.md, trial_to_paid_conversion.md, queries/active_subscriptions_by_plan.md, new_analysis/ai_cost/ai_cost_per_outcome.md.","unit":"count","shape":"kpi","breakdowns":[],"filters":["market","plan"],"kb":"new_analysis/README.md","consent_scoped":false,"alertable":true,"measures":{"signups":{"label":"Signups","unit":"count","ignores_filters":["plan"]},"activated_users":{"label":"Activated users","unit":"count","description":"First completed export within 7 days of signup","ignores_filters":["plan"]},"activation_eligible":{"label":"Activation-eligible signups","unit":"count","description":"Signups whose 7-day window has closed","ignores_filters":["plan"]},"activated_eligible":{"label":"Activated (eligible)","unit":"count","description":"Activated users among eligible signups","ignores_filters":["plan"]},"activation_rate":{"label":"Activation rate","unit":"ratio","description":"activated_eligible / activation_eligible","ignores_filters":["plan"]},"new_paying_customers":{"label":"New paying customers","unit":"count","description":"First collected invoice in the range"},"revenue":{"label":"Revenue","unit":"currency","description":"Net cash, requested currency"},"revenue_usd_native":{"label":"Revenue (USD invoices)","unit":"currency"},"revenue_try_native":{"label":"Revenue (TRY invoices)","unit":"currency"},"mrr":{"label":"MRR","unit":"currency","description":"Snapshot at the end of the range"},"mrr_usd_native":{"label":"MRR (USD)","unit":"currency"},"mrr_try_native":{"label":"MRR (TRY)","unit":"currency"},"active_subscriptions":{"label":"Active subscriptions","unit":"count","description":"Subscriptions with MRR > 0 at the end of the range"},"trial_starts":{"label":"Trial starts","unit":"count"},"trial_resolved":{"label":"Resolved trials","unit":"count","description":"Converted, failed first charge or canceled"},"trial_conversions":{"label":"Trial conversions","unit":"count"},"trial_to_paid_rate":{"label":"Trial to paid","unit":"ratio","description":"trial_conversions / trial_resolved"},"ai_cost":{"label":"AI cost","unit":"currency","description":"USD; TRY when currency = try","ignores_filters":["plan"]},"ai_runs":{"label":"AI runs","unit":"count","ignores_filters":["plan"]},"unpriced_ai_runs":{"label":"Unpriced AI runs","unit":"count","ignores_filters":["plan"]}}}';

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
