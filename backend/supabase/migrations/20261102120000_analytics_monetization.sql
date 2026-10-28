-- Admin analytics Phase 3: Monetization metrics (docs/admin-analytics/metrics-plan.md "Phase 3", api-contract.md).
-- Ports of the KB monetization queries (new_analysis/monetization/*.md, queries/subscription_churn_monthly.md,
-- queries/active_subscriptions_by_plan.md) as one function per metric, plus drill-down keys for
-- analytics_people.drill_users. Conventions follow 20261031120000_analytics_overview.sql:
-- - UTC buckets, gap-filled timeseries, internal accounts excluded unless p_include_internal.
-- - Billing facts (invoices, checkout attempts, subscription events) keep erased accounts (user_id null) and
--   accounts pending deletion or restricted; behavioural / subscription-row metrics use analysis_users.
-- - Money in three variants: the requested currency (usd / try) plus *_usd_native / *_try_native. Converted
--   amounts use the USD->TRY monthly average of the fact's month, falling back to the latest earlier month; the
--   conversion is provisional when that rate is missing, month-to-date, or from an earlier month, and a needed but
--   missing rate makes the converted value null (never silently smaller).
-- - Market labels fall back to 'unknown' (the KB writes 'GLOBAL' / '(unknown)'), as in analytics.kpi_overview.
-- Every metric here is computed live. mrr_movement evaluates each subscription's coverage once per invoice boundary
-- and classifies only the customers whose MRR changed in a bucket; subscriber_ltv reads every invoice of the cohort's
-- customers. Phase 4 may move them to materialized views.

-- ---------------------------------------------------------------------------
-- Shared definitions
-- ---------------------------------------------------------------------------

-- Dunning recovery (payment_issues) reads a subscription's first paid invoice after a past_due event.
create index if not exists billing_invoices_subscription_paid_at_idx on public.billing_invoices(subscription_id, paid_at);

-- THE shared monthly FX helper for analytics metrics: the USD->TRY rate for every month in [month of p_from, p_to]
-- (latest earlier month as fallback), with the dashboard's provisional rule. Called once per metric call and joined
-- by month.
create function analytics_private.fx_months(p_from date, p_to date)
returns table (month date, usd_try numeric, is_final boolean, rate_month date, provisional boolean)
language sql stable set search_path = ''
as $$
  select m::date, f.usd_try, f.is_final, f.rate_month,
         (f.usd_try is null or not f.is_final or f.rate_month <> m::date)
  from generate_series(date_trunc('month', p_from::timestamp), p_to::timestamp, interval '1 month') m
  left join lateral (
    select x.rate as usd_try, x.is_final, x.rate_month
    from public.fx_rates x
    where x.base_currency = 'USD' and x.quote_currency = 'TRY' and x.rate_month <= m::date
    order by x.rate_month desc
    limit 1
  ) f on true
$$;

-- KB mrr_movement_waterfall recurring_inv + mrr_inv: one row per paid recurring invoice with its monthly MRR and the
-- end of its paid coverage. A subscription's MRR at instant t is its latest such invoice (period_start desc,
-- paid_at desc) with period_start <= t < cover_end: cover_end = the first live end event after payment, else
-- period_end, extended by the 3-day renewal grace while that grace has not passed yet (the renewal may still arrive).
-- Built on billing_invoices directly (same population as invoice_revenue) so no FX lookup runs per invoice; the
-- catalogue price is only read for plan-change invoices.
create view analytics_private.mrr_invoices as
select i.id,
       i.user_id,
       i.subscription_id,
       upper(i.currency) as currency,
       i.market,
       i.plan_code,
       i.billing_reason,
       i.period_start,
       i.period_end,
       i.paid_at,
       x.revenue,
       coalesce(u.is_internal, false) as is_internal_user,
       coalesce('u:' || i.user_id::text, 's:' || i.subscription_id::text, 'i:' || i.id::text) as customer_key,
       coalesce(i.subscription_id::text, 'i:' || i.id::text) as sub_key,
       case when i.billing_reason = 'subscription_update' and x.revenue > 0
            -- A plan-change invoice nets a proration credit: valued at the catalogue monthly list price.
            then coalesce((select pc.unit_amount / 100.0 * case pc.billing_interval
                                    when 'week' then 52.0 / 12 when 'month' then 1 when 'year' then 1.0 / 12 when 'day' then 365.0 / 12
                                  end / coalesce(nullif(pc.interval_count, 0), 1)
                           from public.billing_price_catalog pc
                           where pc.is_configured and pc.plan_code = i.plan_code and upper(pc.currency) = upper(i.currency)
                           order by (pc.market is not distinct from i.market) desc
                           limit 1), x.revenue / x.period_months)
            else x.revenue / x.period_months end as mrr_amount,
       ev.first_end_at,
       least(i.period_end, ev.first_end_at) as coverage_end,
       case when ev.first_end_at is null and now() < i.period_end + interval '3 days' then i.period_end + interval '3 days'
            else least(i.period_end, ev.first_end_at) end as cover_end
from public.billing_invoices i
left join public.users u on u.id = i.user_id
cross join lateral (
  select (i.amount_paid - i.amount_refunded) / 100.0 as revenue,
         nullif(case when extract(epoch from i.period_end - i.period_start) / 86400.0 between 27 and 32 then 1
                     when extract(epoch from i.period_end - i.period_start) / 86400.0 between 358 and 368 then 12
                     else extract(epoch from i.period_end - i.period_start) / 86400.0 / 30.4375 end, 0) as period_months
) x
-- Live history (from 2026-10-29): an end event after payment cuts the service short.
left join lateral (
  select min(se.occurred_at) as first_end_at
  from public.subscription_events se
  where se.subscription_id = i.subscription_id
    and se.event_type in ('canceled', 'past_due', 'superseded', 'trial_canceled')
    and se.source <> 'backfill'
    and se.occurred_at > i.paid_at
) ev on true
where i.paid_at is not null
  and i.status in ('paid', 'refunded', 'partially_refunded')
  and i.amount_paid > 0
  and coalesce(i.billing_reason, '') like 'subscription%'
  and i.plan_code is distinct from 'lifetime'
  and i.period_start is not null
  and i.period_end > i.period_start;

-- KB trial_to_paid_conversion trials + outcomes (same rules as analytics.kpi_overview): one row per trial of a real
-- subscription of an analysis user. outcome_group folds converted_plan_change into converted and
-- awaiting_first_charge / active_no_paid_invoice into unresolved.
create view analytics_private.trial_outcomes as
with subs as (
  select s.id, s.user_id, s.provider_subscription_id, s.plan_code, s.status, s.created_at, s.trial_start, s.trial_end,
         s.canceled_at,
         coalesce(s.market, bm.market, 'unknown') as market,
         au.is_internal,
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
),
trials as (
  select sb.*,
         case when sb.trial_start is not null then 'stripe' when sb.is_transition_trial then 'grant_link' else 'heuristic' end as trial_source,
         case when sb.is_transition_trial then 'transition_grant' else 'regular' end as trial_type,
         coalesce(sb.trial_start, sb.created_at) as t_start,
         coalesce(sb.trial_end, coalesce(sb.trial_start, sb.created_at) + interval '3 days') as t_end
  from subs sb
  where sb.trial_start is not null
     or sb.is_transition_trial
     or (not sb.has_stripe_detail
         and sb.status not in ('incomplete', 'incomplete_expired')
         and sb.plan_code in ('weekly', 'pro')
         and (sb.status = 'trialing'
              or sb.period_days < 4
              or (sb.plan_code = 'weekly' and sb.offset_mod7 between 2.5 and 3.5)))
),
classified as (
  select t.id as subscription_id, t.user_id, t.is_internal, t.plan_code, t.market, t.status, t.trial_source, t.trial_type,
         t.t_start, t.t_end, t.canceled_at,
         coalesce(i.first_cycle_paid_at, i.first_update_paid_at) as first_paid_at,
         case
           when i.first_cycle_paid_at is not null then 'converted'
           when i.first_update_paid_at is not null then 'converted_plan_change'
           when t.status = 'trialing' and t.t_end > now() then 'in_trial'
           when t.status in ('past_due', 'unpaid') or i.failed_first_charge_at is not null
                or exists (select 1 from public.subscription_events e
                           where e.subscription_id = t.id and e.source <> 'backfill'
                             and e.event_type = 'past_due' and e.from_status = 'trialing') then 'failed_first_charge'
           when t.status in ('canceled', 'incomplete_expired', 'paused') then 'trial_canceled'
           when t.status = 'inactive' then 'superseded'
           when t.status = 'active' and t.t_end < now() - interval '1 day' then 'active_no_paid_invoice'
           else 'awaiting_first_charge'
         end as outcome
  from trials t
  cross join lateral (
    select min(bi.paid_at) filter (
             where bi.billing_reason = 'subscription_cycle' and bi.paid_at is not null and bi.amount_paid > 0
               and bi.status in ('paid', 'refunded', 'partially_refunded')
               and coalesce(bi.period_start, bi.created_at) >= t.t_end - interval '1 hour') as first_cycle_paid_at,
           min(bi.paid_at) filter (
             where bi.billing_reason = 'subscription_update' and bi.paid_at is not null and bi.amount_paid > 0
               and bi.status in ('paid', 'refunded', 'partially_refunded')
               and bi.created_at >= t.t_start and bi.created_at < t.t_end + interval '1 day') as first_update_paid_at,
           min(bi.created_at) filter (
             where bi.billing_reason = 'subscription_cycle' and bi.status in ('open', 'uncollectible', 'void')
               and coalesce(bi.period_start, bi.created_at) >= t.t_end - interval '1 hour'
               and coalesce(bi.period_start, bi.created_at) < t.t_end + interval '2 days') as failed_first_charge_at
    from public.billing_invoices bi
    where bi.subscription_id = t.id
       or (bi.subscription_id is null and bi.provider_subscription_id = t.provider_subscription_id)
  ) i
)
select c.*,
       case when c.outcome in ('converted', 'converted_plan_change') then 'converted'
            when c.outcome in ('awaiting_first_charge', 'active_no_paid_invoice') then 'unresolved'
            else c.outcome end as outcome_group
from classified c;

-- KB cancellation_reasons B: ended real subscriptions (not free / lifetime) of analysis users, bucketed by access
-- end (ended_at, updated_at fallback). replaced = superseded, or the same user started another real subscription
-- between the cancel request - 1 day and the access end + 1 day (a switch, not churn). mrr_native = the
-- subscription's own Stripe price per month, else the catalogue monthly list price (amount_source = list_price).
create view analytics_private.subscription_endings as
select s.id as subscription_id,
       s.user_id,
       au.is_internal,
       s.plan_code,
       s.status,
       coalesce(s.market, bm.market, 'unknown') as market,
       s.canceled_at,
       s.ended_at,
       coalesce(s.ended_at, s.updated_at) as end_ts,
       s.cancellation_reason,
       s.cancellation_feedback,
       case when s.cancellation_reason = 'cancellation_requested' then 'voluntary'
            when s.cancellation_reason in ('payment_failed', 'payment_disputed') then 'involuntary'
            when s.cancellation_reason is not null then 'other'
            when s.status = 'unpaid' then 'involuntary'
            else 'unknown' end as reason_group,
       exists (select 1 from public.billing_invoices i
               where i.subscription_id = s.id and i.paid_at is not null and i.amount_paid > 0
                 and i.status in ('paid', 'refunded', 'partially_refunded')) as ever_paid,
       case when s.unit_amount is not null and s.billing_interval in ('day', 'week', 'month', 'year')
            then s.unit_amount / 100.0 * case s.billing_interval
                   when 'week' then 52.0 / 12 when 'month' then 1 when 'year' then 1.0 / 12 when 'day' then 365.0 / 12 end
            else pp.monthly_list_price end as mrr_native,
       coalesce(upper(s.currency), pp.currency) as currency,
       case when s.unit_amount is not null then 'subscription' else 'list_price' end as amount_source,
       (exists (select 1 from public.subscription_events e
                where e.subscription_id = s.id and e.event_type = 'superseded')
        or exists (select 1 from public.subscriptions s2
                   where s2.user_id = s.user_id and s2.id <> s.id
                     and s2.provider_subscription_id is not null and s2.plan_code <> 'free'
                     and s2.created_at > s.created_at
                     and s2.created_at >= coalesce(s.canceled_at, s.ended_at, s.updated_at) - interval '1 day'
                     and s2.created_at <= coalesce(s.ended_at, s.current_period_end, s.updated_at) + interval '1 day')) as replaced
from public.subscriptions s
join analytics_private.analysis_users au on au.id = s.user_id
left join public.billing_markets bm on bm.user_id = s.user_id
-- KB plan_price: per plan and market (GLOBAL when unknown), the lowest configured monthly list price.
left join lateral (
  select min(upper(pc.currency)) as currency,
         min(pc.unit_amount / 100.0 * case pc.billing_interval
               when 'week' then 52.0 / 12 when 'month' then 1 when 'year' then 1.0 / 12 when 'day' then 365.0 / 12
             end / coalesce(nullif(pc.interval_count, 0), 1)) as monthly_list_price
  from public.billing_price_catalog pc
  where pc.is_configured and pc.plan_code = s.plan_code and pc.market = coalesce(s.market, bm.market, 'GLOBAL')
) pp on true
where s.provider_subscription_id is not null
  and s.plan_code not in ('free', 'lifetime')
  and s.status in ('canceled', 'incomplete_expired', 'unpaid', 'paused');

-- ---------------------------------------------------------------------------
-- analytics.mrr_movement
-- ---------------------------------------------------------------------------

create function analytics.mrr_movement(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text,
  new numeric, expansion numeric, contraction numeric, churn numeric, reactivation numeric, fx_effect numeric,
  starting_mrr numeric, ending_mrr numeric,
  starting_customers bigint, new_customers bigint, reactivated_customers bigint, churned_customers bigint, ending_customers bigint,
  fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_target text;
  v_markets text[];
  v_plans text[];
  v_currencies text[];
  v_today date := (now() at time zone 'UTC')::date;
  v_first_at timestamptz;
  v_last_at timestamptz;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan', 'currency']);
  if p_currency = 'native' and p_breakdown is not null then
    raise exception 'native currency already splits by invoice currency; use usd or try for a breakdown'
      using errcode = '22023';
  end if;
  select * into r from analytics_private.resolve_range(p_from, p_to);
  if p_grain = 'day' and r.to_day - r.from_day >= 366 then
    raise exception 'use week or month grain for ranges over a year' using errcode = '22023';
  end if;
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_target := upper(p_currency);
  v_first_at := least(v_start - interval '1 microsecond', now());
  v_last_at := least(v_end - interval '1 microsecond', now());
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');
  v_currencies := analytics_private.filter_values(p_filters, 'currency');
  if v_currencies is not null then
    v_currencies := array(select upper(c) from unnest(v_currencies) c)::text[];
  end if;

  return query
  with snaps as (
    -- Each bucket clipped to the range; a movement is measured between its two boundary snapshots (capped at now).
    select k.b,
           greatest(analytics_private.utc_start(k.b), v_start) as p_start,
           least(greatest(analytics_private.utc_start(k.b), v_start) - interval '1 microsecond', now()) as prev_at,
           least(least(analytics_private.utc_start((k.b + ('1 ' || p_grain)::interval)::date), v_end)
                 - interval '1 microsecond', now()) as end_at
    from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  ),
  -- Invoices that can cover some snapshot of the range, read once.
  inv as materialized (
    select m.sub_key, m.customer_key, m.currency,
           coalesce(m.market, 'unknown') as market,
           coalesce(m.plan_code, 'unknown') as plan,
           m.mrr_amount, m.period_start, m.paid_at, m.cover_end
    from analytics_private.mrr_invoices m
    where (p_include_internal or not m.is_internal_user)
      and m.period_start <= v_last_at
      and m.period_end + interval '3 days' > v_first_at
  ),
  -- Per subscription, the timeline is cut at every invoice start / coverage end; inside one piece the covering
  -- invoices do not change, so the latest one (period_start desc, paid_at desc) holds for the whole piece. This is
  -- the snapshot rule evaluated once per piece instead of once per snapshot.
  bounds as (
    select distinct i.sub_key, x.t
    from inv i
    cross join lateral (values (i.period_start), (i.cover_end)) x(t)
  ),
  pieces as (
    select bd.sub_key, bd.t as a, lead(bd.t) over (partition by bd.sub_key order by bd.t) as z
    from bounds bd
  ),
  picks as (
    select distinct on (g.sub_key, g.a)
           g.a, g.z, i.customer_key, i.currency, i.market, i.plan, i.mrr_amount
    from pieces g
    join inv i on i.sub_key = g.sub_key and i.period_start <= g.a and g.a < i.cover_end
    where g.z is not null
    order by g.sub_key, g.a, i.period_start desc, i.paid_at desc
  ),
  -- Customer x currency (x breakdown value) MRR as a step function: one row per change, up to the last snapshot.
  -- Filters apply to the covering invoice.
  cp as (
    select k.customer_key, k.currency, k.dim, x.t, sum(x.d) as d
    from (
      select pk.*,
             case when p_currency = 'native' then pk.currency
                  when p_breakdown = 'market' then pk.market
                  when p_breakdown = 'plan' then pk.plan end as dim
      from picks pk
      where (v_markets is null or pk.market = any (v_markets))
        and (v_plans is null or pk.plan = any (v_plans))
        and (v_currencies is null or pk.currency = any (v_currencies))
    ) k
    cross join lateral (values (k.a, k.mrr_amount), (k.z, -k.mrr_amount)) x(t, d)
    where x.t <= v_last_at
    group by 1, 2, 3, 4
    having sum(x.d) <> 0
  ),
  ch as (
    select c.customer_key, c.currency, c.dim, c.t, c.d, c.v, c.v - c.d as pv,
           (c.v > 0)::int - (c.v - c.d > 0)::int as dc,
           -- A change at t is seen by every snapshot >= t: changes up to the first snapshot form the opening state,
           -- later ones belong to the bucket whose end snapshot first sees them.
           case when c.t <= v_first_at then null else date_trunc(p_grain, c.t at time zone 'UTC')::date end as b
    from (
      select cp.*, sum(cp.d) over (partition by cp.customer_key, cp.currency, cp.dim order by cp.t) as v
      from cp
    ) c
  ),
  opening as (
    select ch.currency, ch.dim, sum(ch.d) as amt, sum(ch.dc) as cnt
    from ch where ch.b is null
    group by 1, 2
  ),
  bdelta as (
    select ch.b, ch.currency, ch.dim, sum(ch.d) as amt, sum(ch.dc) as cnt
    from ch where ch.b is not null
    group by 1, 2, 3
  ),
  combos as (
    select o.currency, o.dim from opening o where o.amt <> 0 or o.cnt <> 0
    union
    select bd.currency, bd.dim from bdelta bd
  ),
  totals as (
    select s.b, co.currency, co.dim,
           coalesce(o.amt, 0) + sum(coalesce(bd.amt, 0)) over w - coalesce(bd.amt, 0) as start_amt,
           coalesce(o.amt, 0) + sum(coalesce(bd.amt, 0)) over w as end_amt,
           coalesce(o.cnt, 0) + sum(coalesce(bd.cnt, 0)) over w - coalesce(bd.cnt, 0) as start_c,
           coalesce(o.cnt, 0) + sum(coalesce(bd.cnt, 0)) over w as end_c
    from snaps s
    cross join combos co
    left join opening o on o.currency = co.currency and o.dim is not distinct from co.dim
    left join bdelta bd on bd.b = s.b and bd.currency = co.currency and bd.dim is not distinct from co.dim
    window w as (partition by co.currency, co.dim order by s.b)
  ),
  -- Customers whose MRR changed inside a bucket: value at the start snapshot (before the bucket's first change) and
  -- at the end snapshot (after its last change). Everyone else is flat.
  changed as (
    select ch.b, ch.customer_key, ch.currency, ch.dim,
           (array_agg(ch.pv order by ch.t))[1] as mrr_start,
           (array_agg(ch.v order by ch.t desc))[1] as mrr_end
    from ch where ch.b is not null
    group by 1, 2, 3, 4
  ),
  first_paid as (
    select coalesce('u:' || i.user_id::text, 's:' || i.subscription_id::text, 'i:' || i.id::text) as customer_key,
           upper(i.currency) as currency, min(i.period_start) as first_paid_start
    from public.billing_invoices i
    where i.paid_at is not null
      and i.status in ('paid', 'refunded', 'partially_refunded')
      and i.amount_paid > 0
      and coalesce(i.billing_reason, '') like 'subscription%'
      and i.plan_code is distinct from 'lifetime'
      and i.period_start is not null
      and i.period_end > i.period_start
    group by 1, 2
  ),
  moves as (
    select c.b, c.currency, c.dim,
           c.mrr_end - c.mrr_start as delta,
           case when c.mrr_start = 0 and c.mrr_end > 0 and fp.first_paid_start >= s.p_start then 'new'
                when c.mrr_start = 0 and c.mrr_end > 0 then 'reactivation'
                when c.mrr_start > 0 and c.mrr_end = 0 then 'churned'
                when abs(c.mrr_end - c.mrr_start) < 0.01 then 'flat'
                when c.mrr_end > c.mrr_start then 'expansion'
                else 'contraction' end as movement
    from changed c
    join snaps s on s.b = c.b
    left join first_paid fp on fp.customer_key = c.customer_key and fp.currency = c.currency
  ),
  mv as (
    select m.b, m.dim, m.currency,
           coalesce(sum(m.delta) filter (where m.movement = 'new'), 0) as new_amt,
           coalesce(sum(m.delta) filter (where m.movement = 'expansion'), 0) as exp_amt,
           coalesce(sum(m.delta) filter (where m.movement = 'contraction'), 0) as con_amt,
           coalesce(sum(m.delta) filter (where m.movement = 'churned'), 0) as churn_amt,
           coalesce(sum(m.delta) filter (where m.movement = 'reactivation'), 0) as react_amt,
           count(*) filter (where m.movement = 'new') as new_c,
           count(*) filter (where m.movement = 'reactivation') as react_c,
           count(*) filter (where m.movement = 'churned') as churn_c
    from moves m
    group by 1, 2, 3
  ),
  per_cur as (
    select t.b, t.dim, t.currency,
           coalesce(m.new_amt, 0) as new_amt, coalesce(m.exp_amt, 0) as exp_amt, coalesce(m.con_amt, 0) as con_amt,
           coalesce(m.churn_amt, 0) as churn_amt, coalesce(m.react_amt, 0) as react_amt,
           t.start_amt, t.end_amt, t.start_c,
           coalesce(m.new_c, 0) as new_c, coalesce(m.react_c, 0) as react_c, coalesce(m.churn_c, 0) as churn_c, t.end_c
    from totals t
    left join mv m on m.b = t.b and m.currency = t.currency and m.dim is not distinct from t.dim
  ),
  fx as (
    select * from analytics_private.fx_months(least(r.from_day - 1, v_today), greatest(r.to_day, v_today))
  ),
  rates as (
    select s.b, fe.usd_try as rate_end, fe.provisional as prov_end, fp.usd_try as rate_prev, fp.provisional as prov_prev
    from snaps s
    left join fx fe on fe.month = date_trunc('month', s.end_at at time zone 'UTC')::date
    left join fx fp on fp.month = date_trunc('month', s.prev_at at time zone 'UTC')::date
  ),
  -- Converted variants (KB section A): starting MRR at the previous snapshot's month rate, movements and ending at
  -- this snapshot's; fx_effect is the difference, so starting + movements + fx_effect = ending. native: no conversion.
  conv as (
    select pc.b, pc.dim,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.new_amt
                    when v_target = 'USD' then pc.new_amt / rt.rate_end else pc.new_amt * rt.rate_end end) as new_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.exp_amt
                    when v_target = 'USD' then pc.exp_amt / rt.rate_end else pc.exp_amt * rt.rate_end end) as exp_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.con_amt
                    when v_target = 'USD' then pc.con_amt / rt.rate_end else pc.con_amt * rt.rate_end end) as con_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.churn_amt
                    when v_target = 'USD' then pc.churn_amt / rt.rate_end else pc.churn_amt * rt.rate_end end) as churn_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.react_amt
                    when v_target = 'USD' then pc.react_amt / rt.rate_end else pc.react_amt * rt.rate_end end) as react_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.start_amt
                    when v_target = 'USD' then pc.start_amt / rt.rate_prev else pc.start_amt * rt.rate_prev end) as start_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target then pc.end_amt
                    when v_target = 'USD' then pc.end_amt / rt.rate_end else pc.end_amt * rt.rate_end end) as end_amt,
           sum(case when p_currency = 'native' or pc.currency = v_target or pc.start_amt = 0 then 0
                    when v_target = 'USD' then pc.start_amt / rt.rate_end - pc.start_amt / rt.rate_prev
                    else pc.start_amt * rt.rate_end - pc.start_amt * rt.rate_prev end) as fx_amt,
           sum(pc.start_c) as start_c, sum(pc.new_c) as new_c, sum(pc.react_c) as react_c,
           sum(pc.churn_c) as churn_c, sum(pc.end_c) as end_c,
           bool_or(p_currency <> 'native' and pc.currency <> v_target
                   and (((pc.start_amt <> 0 or pc.end_amt <> 0) and rt.rate_end is null)
                        or (pc.start_amt <> 0 and rt.rate_prev is null))) as missing,
           bool_or(p_currency <> 'native' and pc.currency <> v_target
                   and (((pc.start_amt <> 0 or pc.end_amt <> 0) and rt.prov_end)
                        or (pc.start_amt <> 0 and rt.prov_prev))) as provisional
    from per_cur pc
    join rates rt on rt.b = pc.b
    group by 1, 2
  ),
  dims as (
    select distinct c.dim from conv c where p_currency <> 'native'
    union
    select null where p_currency <> 'native' and p_breakdown is null
    union
    select c from unnest(array['USD', 'TRY']) c
    where p_currency = 'native' and (v_currencies is null or c = any (v_currencies))
  )
  select k.b, d.dim,
         case when c.missing then null else round(coalesce(c.new_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.exp_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.con_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.churn_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.react_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.fx_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.start_amt, 0), 2) end,
         case when c.missing then null else round(coalesce(c.end_amt, 0), 2) end,
         coalesce(c.start_c, 0)::bigint,
         coalesce(c.new_c, 0)::bigint,
         coalesce(c.react_c, 0)::bigint,
         coalesce(c.churn_c, 0)::bigint,
         coalesce(c.end_c, 0)::bigint,
         coalesce(c.provisional, false)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join conv c on c.b = k.b and c.dim is not distinct from d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.mrr_movement(date, date, text, text, boolean, text, jsonb) is
'{"title":"MRR movement","definition":"MRR bridge per period (KB mrr_movement_waterfall section A, generalised from month ends to bucket boundaries): MRR is snapshotted at the start and the end of each bucket (clipped to the range, and to now). A subscription''s MRR at a snapshot is its latest paid recurring invoice (billing_reason subscription*, not lifetime) whose service period covers the snapshot, net of refunds and normalised to one month (27-32 days = 1, 358-368 days = 12, otherwise days / 30.4375; plan-change invoices at the catalogue monthly list price). A live canceled / past_due / superseded / trial_canceled event after payment ends coverage at the event; otherwise a subscription leaves MRR at period_end, kept for a 3-day renewal grace while the renewal may still arrive. Movements are classified per customer x invoice currency between the two snapshots: new (first paid service starts in the bucket), reactivation (paid before, absent at the start), expansion / contraction (up / down by at least 0.01), churn (to 0). With a plan or market breakdown or a plan / market / currency filter, movements are classified per customer x currency x that value, so a plan switch shows as churn on the old plan and reactivation on the new one. Snapshots miss customers who start and end inside one bucket. usd / try: starting MRR is converted at the USD->TRY rate of the start snapshot''s month and everything else at the end snapshot''s month; fx_effect is the difference, so starting_mrr + new + expansion + contraction + churn + reactivation + fx_effect = ending_mrr (up to sub-cent flat moves). fx_provisional when a used rate is month-to-date, from an earlier month or missing (the bucket is then null). native returns one series per invoice currency (dimension = USD / TRY, fx_effect 0) and allows no breakdown. Customer counts add the per-currency counts. Internal accounts are excluded unless included; erased and restricted accounts are kept (financial facts). Plan and market are the values on the covering invoice. Day grain is limited to 366 days (22023: use week or month grain).","unit":"currency","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan","currency"],"kb":"new_analysis/monetization/mrr_movement_waterfall.md","consent_scoped":false,"alertable":false,"plot":["new","expansion","contraction","churn","reactivation"],"stacked":true,"measures":{"new":{"label":"New MRR","unit":"currency","description":"MRR of customers whose first paid service started in the period"},"expansion":{"label":"Expansion","unit":"currency"},"contraction":{"label":"Contraction","unit":"currency","description":"Negative"},"churn":{"label":"Churned MRR","unit":"currency","description":"Negative: MRR of customers that went to 0"},"reactivation":{"label":"Reactivation","unit":"currency","description":"Returning customers who paid before"},"fx_effect":{"label":"FX effect","unit":"currency","description":"Change of the starting MRR''s value from the start to the end month rate; 0 for native"},"starting_mrr":{"label":"Starting MRR","unit":"currency"},"ending_mrr":{"label":"Ending MRR","unit":"currency"},"starting_customers":{"label":"Customers at start","unit":"count"},"new_customers":{"label":"New customers","unit":"count"},"reactivated_customers":{"label":"Reactivated customers","unit":"count"},"churned_customers":{"label":"Churned customers","unit":"count"},"ending_customers":{"label":"Customers at end","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.trial_to_paid
-- ---------------------------------------------------------------------------

create function analytics.trial_to_paid(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, trial_to_paid numeric, trial_starts bigint, converted bigint,
  failed_first_charge bigint, trial_canceled bigint, superseded bigint, in_trial bigint, unresolved bigint,
  resolved bigint, failed_charge_rate numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with t as (
    select analytics_private.bucket(o.t_start, p_grain) as b,
           case p_breakdown when 'market' then o.market when 'plan' then o.plan_code end as dim,
           o.outcome_group as og
    from analytics_private.trial_outcomes o
    where (p_include_internal or not o.is_internal)
      and o.t_start >= v_start
      and o.t_start < v_end
      and (v_markets is null or o.market = any (v_markets))
      and (v_plans is null or o.plan_code = any (v_plans))
  ),
  dims as (
    select distinct t.dim from t
    union
    select null where p_breakdown is null
  )
  select k.b, d.dim,
         round(count(*) filter (where t.og = 'converted')::numeric
               / nullif(count(*) filter (where t.og in ('converted', 'failed_first_charge', 'trial_canceled')), 0), 4),
         count(t.b),
         count(*) filter (where t.og = 'converted'),
         count(*) filter (where t.og = 'failed_first_charge'),
         count(*) filter (where t.og = 'trial_canceled'),
         count(*) filter (where t.og = 'superseded'),
         count(*) filter (where t.og = 'in_trial'),
         count(*) filter (where t.og = 'unresolved'),
         count(*) filter (where t.og in ('converted', 'failed_first_charge', 'trial_canceled')),
         round(count(*) filter (where t.og = 'failed_first_charge')::numeric
               / nullif(count(*) filter (where t.og in ('converted', 'failed_first_charge', 'trial_canceled')), 0), 4)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join t on t.b = k.b and t.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.trial_to_paid(date, date, text, text, boolean, text, jsonb) is
'{"title":"Trial to paid","definition":"Trials by trial-start period (UTC cohort) and their outcome today (KB trial_to_paid_conversion section A; same rules as the Overview trial KPIs). A trial is a real subscription (not free) with trial_start, the redeemed transition-grant trial, or (only for rows with no Stripe detail) the weekly/pro heuristic; start = trial_start, else created_at; end = trial_end, else start + 3 days. Outcome, first match wins: converted = a paid subscription_cycle invoice (amount_paid > 0, refunds included) whose service starts at trial end (-1h), or a paid subscription_update invoice during the trial (portal plan switch); in_trial = trialing and trial end in the future; failed_first_charge = past_due / unpaid, an open / uncollectible / void first cycle invoice, or a trialing -> past_due event; trial_canceled = canceled / incomplete_expired / paused; superseded = replaced by another subscription (inactive); unresolved = awaiting the first charge or active without a paid invoice. resolved = converted + failed_first_charge + trial_canceled; trial_to_paid = converted / resolved; failed_charge_rate = failed_first_charge / resolved. Recent cohorts are still maturing. Market = subscription market, else the locked market. Excludes internal accounts unless included, and accounts pending deletion or with restricted processing; trials of erased accounts are gone (survivorship). Grant trials (release cohort) are included, as in the KB overall rows. Currency does not apply.","unit":"ratio","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan"],"kb":"new_analysis/monetization/trial_to_paid_conversion.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"plot":["converted","failed_first_charge","trial_canceled","superseded","in_trial","unresolved"],"stacked":true,"measures":{"trial_to_paid":{"label":"Trial to paid","unit":"ratio","description":"converted / resolved"},"trial_starts":{"label":"Trial starts","unit":"count"},"converted":{"label":"Converted","unit":"count","description":"Includes conversions through a plan-change invoice"},"failed_first_charge":{"label":"Failed first charge","unit":"count"},"trial_canceled":{"label":"Canceled in trial","unit":"count"},"superseded":{"label":"Superseded","unit":"count","description":"Replaced by another subscription; not resolved"},"in_trial":{"label":"In trial","unit":"count"},"unresolved":{"label":"Unresolved","unit":"count","description":"Awaiting the first charge, or active without a paid invoice"},"resolved":{"label":"Resolved trials","unit":"count"},"failed_charge_rate":{"label":"Failed charge rate","unit":"ratio","description":"failed_first_charge / resolved"}}}';

-- ---------------------------------------------------------------------------
-- analytics.checkout_funnel
-- ---------------------------------------------------------------------------

create function analytics.checkout_funnel(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  step_order integer, step text, dimension text, users bigint, conversion_from_prev numeric, conversion_from_start numeric,
  dropped bigint, pending bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with att as (
    select ca.user_id, ca.outcome, ca.created_at,
           case p_breakdown when 'market' then coalesce(ca.market, bm.market, 'unknown')
                            when 'plan' then lower(ca.plan_code) end as dim,
           case when ca.outcome in ('rejected_pending', 'rejected_active', 'rejected_pricing_changed', 'failed') then 'rejected'
                when ca.outcome = 'completed' then 'completed'
                when ca.outcome in ('expired', 'canceled') then 'abandoned'
                when ca.created_at < now() - interval '24 hours' then 'abandoned'  -- open > 24h
                else 'pending' end as stage
    from public.checkout_attempts ca
    left join public.users u on u.id = ca.user_id
    left join public.billing_markets bm on bm.user_id = ca.user_id
    where ca.created_at >= v_start
      and ca.created_at < v_end
      and (p_include_internal or ca.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(ca.market, bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or lower(ca.plan_code) = any (v_plans))
  ),
  linked as (
    select a.*,
           (a.stage = 'completed' and a.user_id is not null and a.created_at <= now() - interval '7 days') as eligible
    from att a
  ),
  agg as (
    select l.dim,
           count(*) as attempts,
           count(*) filter (where l.stage = 'rejected') as rejected,
           count(*) filter (where l.stage <> 'rejected') as sessions,
           count(*) filter (where l.stage = 'completed') as completed,
           count(*) filter (where l.stage = 'abandoned') as abandoned,
           count(*) filter (where l.stage = 'pending') as open_pending,
           count(*) filter (where l.eligible) as eligible,
           count(*) filter (where l.eligible and exists (
             select 1 from analytics_private.invoice_revenue ir
             where ir.user_id = l.user_id and ir.paid_at >= l.created_at and ir.paid_at < l.created_at + interval '7 days')) as paid
    from linked l
    group by l.dim
  ),
  dims as (
    select a.dim from agg a
    union
    select null where p_breakdown is null
  ),
  full_agg as (
    select d.dim,
           coalesce(a.attempts, 0) as attempts, coalesce(a.rejected, 0) as rejected, coalesce(a.sessions, 0) as sessions,
           coalesce(a.completed, 0) as completed, coalesce(a.abandoned, 0) as abandoned,
           coalesce(a.open_pending, 0) as open_pending, coalesce(a.eligible, 0) as eligible, coalesce(a.paid, 0) as paid
    from dims d
    left join agg a on a.dim is not distinct from d.dim
  )
  select s.step_order, s.step, f.dim, s.n,
         round(s.from_prev::numeric / nullif(s.prev_base, 0), 4),
         round(s.n::numeric / nullif(f.attempts, 0), 4),
         s.dropped, s.pend
  from full_agg f
  cross join lateral (values
    (1, 'attempts', f.attempts, null::bigint, null::bigint, null::bigint, null::bigint),
    (2, 'session_created', f.sessions, f.sessions, f.attempts, f.rejected, null::bigint),
    (3, 'completed', f.completed, f.completed, f.sessions, f.abandoned, f.open_pending),
    (4, 'paid_within_7d', f.paid, f.paid, f.eligible, f.eligible - f.paid, f.completed - f.eligible)
  ) s(step_order, step, n, from_prev, prev_base, dropped, pend)
  order by f.dim nulls first, s.step_order;
end $$;

comment on function analytics.checkout_funnel(date, date, text, text, boolean, text, jsonb) is
'{"title":"Checkout funnel","definition":"Attempt-level checkout funnel (KB checkout_funnel_abandonment section A) for checkout attempts created in the range (UTC; checkout_attempts exists from 2026-10-29, no backfill). One attempt = one POST /billing/checkout, so the users column counts attempts. Steps: attempts; session_created = reached Stripe (dropped = rejected: rejected_pending / rejected_active / rejected_pricing_changed / failed); completed (conversion over sessions = payment-page conversion; dropped = abandoned: expired, canceled in the app, or open for more than 24h; pending = open for less than 24h, still in the denominator); paid_within_7d = completed attempts of an identified user at least 7 days old whose user has a collected invoice (amount_paid > 0) paid within 7 days of the attempt; its conversion_from_prev is over those eligible completed attempts (dropped = eligible but unpaid, pending = completed attempts not yet eligible or anonymised). For trial checkouts this is the day-3 trial charge. conversion_from_start = step / attempts. Erased accounts'' attempts (user_id null) are counted but cannot be linked to invoices; internal accounts are excluded unless included. Market = the attempt market, else the locked market, else unknown; plan = the requested plan (lowercased). Grain and currency do not apply.","unit":"count","shape":"funnel","breakdowns":["market","plan"],"filters":["market","plan"],"kb":"new_analysis/monetization/checkout_funnel_abandonment.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"measures":{"users":{"label":"Checkout attempts","unit":"count","description":"Attempts reaching the step"},"conversion_from_prev":{"label":"Step conversion","unit":"ratio"},"conversion_from_start":{"label":"Conversion from attempts","unit":"ratio"},"dropped":{"label":"Dropped","unit":"count","description":"Rejected (step 2), abandoned (step 3), eligible but unpaid (step 4)"},"pending":{"label":"Pending","unit":"count","description":"Open < 24h (step 3); completed attempts not yet 7 days old or anonymised (step 4)"}}}';

-- ---------------------------------------------------------------------------
-- analytics.subscriber_ltv
-- ---------------------------------------------------------------------------

create function analytics.subscriber_ltv(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, ltv numeric, customers bigint, ltv_usd_native numeric, ltv_try_native numeric, median_ltv numeric,
  revenue numeric, revenue_usd_native numeric, revenue_try_native numeric, still_paying bigint, censored_share numeric,
  avg_paid_invoices numeric, avg_observed_months numeric, erased_customers bigint, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_dim text := coalesce(p_breakdown, 'plan');
  v_markets text[];
  v_plans text[];
  v_currencies text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['plan', 'market', 'currency'], array['plan', 'market', 'currency']);
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
  with inv as (
    select ir.*,
           coalesce('u:' || ir.user_id::text, 's:' || ir.subscription_id::text, 'i:' || ir.id::text) as customer_key,
           (coalesce(ir.billing_reason, '') like 'subscription%' and ir.plan_code is distinct from 'lifetime') as is_recurring
    from analytics_private.invoice_revenue ir
    where (p_include_internal or not ir.is_internal_user)
  ),
  first_inv as (
    select distinct on (i.customer_key)
           i.customer_key, i.paid_at as first_paid_at,
           coalesce(i.plan_code, 'unknown') as first_plan,
           coalesce(i.market, 'unknown') as first_market,
           i.currency as first_currency
    from inv i
    order by i.customer_key, i.paid_at, i.id
  ),
  cohort as (
    select f.*,
           case v_dim when 'plan' then f.first_plan when 'market' then f.first_market else f.first_currency end as dim
    from first_inv f
    where f.first_paid_at >= v_start
      and f.first_paid_at < v_end
      and (v_markets is null or f.first_market = any (v_markets))
      and (v_plans is null or f.first_plan = any (v_plans))
      and (v_currencies is null or f.first_currency = any (v_currencies))
  ),
  cust as (
    -- Realised LTV to date: every collected invoice of the customer, net of refunds.
    select c.customer_key, c.dim, c.first_paid_at,
           count(*) as paid_invoices,
           coalesce(sum(i.revenue) filter (where i.currency = 'USD'), 0) as ltv_usd,
           coalesce(sum(i.revenue) filter (where i.currency = 'TRY'), 0) as ltv_try,
           sum(case p_currency when 'try' then i.revenue_try else i.revenue_usd end) as ltv_conv,
           bool_or(i.currency = 'USD') as paid_usd,
           bool_or(i.currency = 'TRY') as paid_try,
           bool_or(p_currency <> 'native' and i.currency <> upper(p_currency) and i.usd_try is null) as fx_missing,
           bool_or(p_currency <> 'native' and i.currency <> upper(p_currency) and i.fx_is_provisional) as fx_prov,
           max(i.period_end) filter (where i.is_recurring) as last_period_end,
           max(i.paid_at) as last_paid_at
    from cohort c
    join inv i on i.customer_key = c.customer_key
    group by c.customer_key, c.dim, c.first_paid_at
  ),
  cust_full as (
    select cu.*,
           (cu.customer_key not like 'u:%') as erased,
           coalesce(cu.last_period_end + interval '3 days' > now(), false) as is_still_paying,
           extract(epoch from greatest(least(coalesce(cu.last_period_end, cu.last_paid_at), now()) - cu.first_paid_at,
                                       interval '0 seconds')) / 86400 / 30.4375 as observed_months
    from cust cu
  )
  select cf.dim,
         case when p_currency = 'native' or bool_or(cf.fx_missing) then null else round(avg(cf.ltv_conv), 2) end,
         count(*),
         round(sum(cf.ltv_usd) / nullif(count(*) filter (where cf.paid_usd), 0), 2),
         round(sum(cf.ltv_try) / nullif(count(*) filter (where cf.paid_try), 0), 2),
         case when p_currency = 'native' or bool_or(cf.fx_missing) then null
              else round((percentile_cont(0.5) within group (order by cf.ltv_conv))::numeric, 2) end,
         case when p_currency = 'native' or bool_or(cf.fx_missing) then null else round(sum(cf.ltv_conv), 2) end,
         round(sum(cf.ltv_usd), 2),
         round(sum(cf.ltv_try), 2),
         count(*) filter (where cf.is_still_paying),
         round(count(*) filter (where cf.is_still_paying)::numeric / nullif(count(*), 0), 4),
         round(avg(cf.paid_invoices), 2),
         round(avg(cf.observed_months)::numeric, 2),
         count(*) filter (where cf.erased),
         coalesce(bool_or(cf.fx_prov or cf.fx_missing), false)
  from cust_full cf
  group by cf.dim
  order by 2 desc nulls last, 3 desc, 1;
end $$;

comment on function analytics.subscriber_ltv(date, date, text, text, boolean, text, jsonb) is
'{"title":"Subscriber LTV","definition":"Realised lifetime value per paying customer (KB subscriber_ltv section A) for customers whose first collected invoice (amount_paid > 0) was paid in the range (UTC): net cash kept (paid - refunded) over every collected invoice to date, recurring and one-time. A customer is the user; accounts erased after the 2026-10-29 backfill are counted once per subscription (erased_customers). The dimension is the first paid invoice''s plan (default, or p_breakdown = plan), market or currency; later switches stay in that row. ltv / median_ltv / revenue are in the requested currency, each invoice converted at its paid month''s USD->TRY rate (null for native, and null when a needed rate is missing); ltv_usd_native / ltv_try_native divide each currency''s revenue by the customers who paid in it. A floor while customers still pay: still_paying = latest recurring period_end + 3 days after now, censored_share = still_paying / customers; avg_observed_months = months from the first payment to the latest paid service end (or now). Legacy lifetime buyers count with their one-time payment. Predicted LTV (KB section C) is not ported. Internal accounts are excluded unless included; accounts erased before the backfill are missing (survivorship). Grain does not apply. Computed live over every invoice of the cohort.","unit":"currency","shape":"breakdown","breakdowns":["plan","market","currency"],"filters":["plan","market","currency"],"kb":"new_analysis/monetization/subscriber_ltv.md","consent_scoped":false,"alertable":false,"min_group":5,"breakdown_dimension":"plan","measures":{"ltv":{"label":"LTV per customer","unit":"currency","description":"Average realised net revenue per customer, requested currency"},"customers":{"label":"Paying customers","unit":"count"},"ltv_usd_native":{"label":"LTV (USD payers)","unit":"currency"},"ltv_try_native":{"label":"LTV (TRY payers)","unit":"currency"},"median_ltv":{"label":"Median LTV","unit":"currency"},"revenue":{"label":"Cohort revenue","unit":"currency"},"revenue_usd_native":{"label":"Cohort revenue (USD invoices)","unit":"currency"},"revenue_try_native":{"label":"Cohort revenue (TRY invoices)","unit":"currency"},"still_paying":{"label":"Still paying","unit":"count"},"censored_share":{"label":"Still paying share","unit":"ratio","description":"LTV is still growing for this share"},"avg_paid_invoices":{"label":"Avg. paid invoices","unit":"count"},"avg_observed_months":{"label":"Avg. observed months","unit":"count","description":"Months from first payment to the latest paid service end"},"erased_customers":{"label":"Erased customers","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.plan_mix
-- ---------------------------------------------------------------------------

create function analytics.plan_mix(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, subscriptions bigint, share numeric, mrr numeric, mrr_usd_native numeric, mrr_try_native numeric,
  switched_in bigint, switched_out bigint, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_snap timestamptz;
  v_markets text[];
  v_plans text[];
  v_currencies text[];
  v_rate numeric;
  v_rate_final boolean;
  v_rate_month date;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['plan'], array['market', 'plan', 'currency']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_snap := least(v_end - interval '1 microsecond', now());
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');
  v_currencies := analytics_private.filter_values(p_filters, 'currency');
  if v_currencies is not null then
    v_currencies := array(select upper(c) from unnest(v_currencies) c)::text[];
  end if;
  select f.rate, f.is_final, f.rate_month into v_rate, v_rate_final, v_rate_month
  from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY'
    and f.rate_month <= date_trunc('month', v_snap at time zone 'UTC')::date
  order by f.rate_month desc
  limit 1;

  return query
  with snap as (
    -- MRR snapshot at the end of p_to, exactly as analytics.kpi_overview (active_subscriptions / mrr).
    select distinct on (m.sub_key)
           m.currency, coalesce(m.market, 'unknown') as market, coalesce(m.plan_code, 'unknown') as plan, m.mrr_amount
    from analytics_private.mrr_invoices m
    where (p_include_internal or not m.is_internal_user)
      and m.period_start <= v_snap
      and m.period_end + interval '3 days' > v_snap
      and (v_snap < m.coverage_end
           or (m.first_end_at is null
               and v_snap < m.period_end + interval '3 days'
               and now() < m.period_end + interval '3 days'))
    order by m.sub_key, m.period_start desc, m.paid_at desc
  ),
  mix as (
    select s.plan,
           count(*) filter (where s.mrr_amount > 0) as subs,
           coalesce(sum(s.mrr_amount) filter (where s.currency = 'USD'), 0) as usd,
           coalesce(sum(s.mrr_amount) filter (where s.currency = 'TRY'), 0) as try_amt
    from snap s
    where (v_markets is null or s.market = any (v_markets))
      and (v_plans is null or s.plan = any (v_plans))
      and (v_currencies is null or s.currency = any (v_currencies))
    group by s.plan
  ),
  -- KB plan_mix_and_switching A: in-place switches (plan_changed events, exact from 2026-10-29; consecutive
  -- invoices of one subscription with a different plan before that) and replacements through a new checkout.
  inv_market as (
    select i.subscription_id, max(i.market) as market
    from public.billing_invoices i
    where i.subscription_id is not null
    group by i.subscription_id
  ),
  switches as (
    select e.from_plan_code as from_plan, e.to_plan_code as to_plan, e.occurred_at as switched_at,
           coalesce(s.market, im.market, bm.market, 'unknown') as market,
           coalesce(u.is_internal, false) as is_internal
    from public.subscription_events e
    left join public.users u on u.id = e.user_id
    left join public.subscriptions s on s.id = e.subscription_id
    left join inv_market im on im.subscription_id = e.subscription_id
    left join public.billing_markets bm on bm.user_id = e.user_id
    where e.event_type = 'plan_changed'
      and e.occurred_at >= v_start and e.occurred_at < v_end
    union all
    select x.prev_plan, x.plan_code, x.service_start, coalesce(x.market, 'unknown'), coalesce(u.is_internal, false)
    from (
      select i.user_id, i.plan_code, i.market,
             coalesce(i.period_start, i.created_at) as service_start,
             lag(i.plan_code) over (partition by i.subscription_id
                                    order by coalesce(i.period_start, i.created_at), i.created_at) as prev_plan
      from public.billing_invoices i
      where i.subscription_id is not null
        and i.plan_code is not null
        and i.status not in ('draft', 'void')
        and i.billing_reason in ('subscription_create', 'subscription_cycle', 'subscription_update')
    ) x
    left join public.users u on u.id = x.user_id
    where x.prev_plan is not null
      and x.prev_plan <> x.plan_code
      and x.service_start < timestamptz '2026-10-29 00:00+00'  -- from then on plan_changed events are exact
      and x.service_start >= v_start and x.service_start < v_end
    union all
    select sq.prev_plan, sq.plan_code, sq.created_at, sq.market, sq.is_internal
    from (
      select s.plan_code, s.created_at, u.is_internal,
             coalesce(s.market, bm.market, 'unknown') as market,
             lag(s.plan_code) over w as prev_plan,
             lag(s.status) over w as prev_status,
             lag(coalesce(s.ended_at, least(s.current_period_end, s.updated_at))) over w as prev_end_est
      from public.subscriptions s
      join public.users u on u.id = s.user_id
      left join public.billing_markets bm on bm.user_id = s.user_id
      where s.provider_subscription_id is not null
        and s.plan_code <> 'free'
        and s.status not in ('incomplete', 'incomplete_expired')
      window w as (partition by s.user_id order by s.created_at)
    ) sq
    where sq.prev_plan is not null
      and (sq.prev_status = 'inactive' or sq.created_at < sq.prev_end_est)  -- replaced while live
      and sq.created_at >= v_start and sq.created_at < v_end
  ),
  sw as (
    select x.plan, sum(x.n_in) as n_in, sum(x.n_out) as n_out
    from (
      select s.to_plan as plan, 1 as n_in, 0 as n_out from switches s
      where (p_include_internal or not s.is_internal) and s.from_plan is distinct from s.to_plan
        and (v_markets is null or s.market = any (v_markets))
      union all
      select s.from_plan, 0, 1 from switches s
      where (p_include_internal or not s.is_internal) and s.from_plan is distinct from s.to_plan
        and (v_markets is null or s.market = any (v_markets))
    ) x
    where v_plans is null or x.plan = any (v_plans)
    group by x.plan
  ),
  plans as (
    select m.plan from mix m where m.subs > 0 or m.usd <> 0 or m.try_amt <> 0
    union
    select s.plan from sw s
  )
  select p.plan,
         coalesce(m.subs, 0)::bigint,
         round(coalesce(m.subs, 0)::numeric / nullif(sum(coalesce(m.subs, 0)) over (), 0), 4),
         case when p_currency = 'native' then null
              when p_currency = 'usd' then
                case when coalesce(m.try_amt, 0) <> 0 and v_rate is null then null
                     else round(coalesce(m.usd, 0) + case when coalesce(m.try_amt, 0) <> 0 then m.try_amt / v_rate else 0 end, 2) end
              else
                case when coalesce(m.usd, 0) <> 0 and v_rate is null then null
                     else round(coalesce(m.try_amt, 0) + case when coalesce(m.usd, 0) <> 0 then m.usd * v_rate else 0 end, 2) end
         end,
         round(coalesce(m.usd, 0), 2),
         round(coalesce(m.try_amt, 0), 2),
         coalesce(s.n_in, 0)::bigint,
         coalesce(s.n_out, 0)::bigint,
         (p_currency <> 'native'
          and ((p_currency = 'usd' and coalesce(m.try_amt, 0) <> 0) or (p_currency = 'try' and coalesce(m.usd, 0) <> 0))
          and (v_rate is null or not v_rate_final or v_rate_month <> date_trunc('month', v_snap at time zone 'UTC')::date))
  from plans p
  left join mix m on m.plan = p.plan
  left join sw s on s.plan = p.plan
  order by 2 desc, 1;
end $$;

comment on function analytics.plan_mix(date, date, text, text, boolean, text, jsonb) is
'{"title":"Plan mix","definition":"Paid subscriptions per plan at the end of the range (end of p_to, or now), with the same MRR snapshot as the Overview active subscriptions and MRR: per subscription, the latest paid recurring invoice covering the snapshot (canceled / past_due / superseded / trial_canceled events end coverage; a 3-day renewal grace otherwise), normalised to one month; subscriptions count when their MRR > 0, so trials, lifetime purchases and fully refunded subscriptions are excluded and erased accounts are kept. Plan, market and currency are the covering invoice''s. share = subscriptions / all listed subscriptions. mrr is in the requested currency at the snapshot month''s USD->TRY rate (null for native; fx_provisional when that rate is month-to-date, from an earlier month or missing), with the native USD / TRY sums alongside. switched_in / switched_out count plan switches in the range (KB plan_mix_and_switching section A): plan_changed events (exact from 2026-10-29), consecutive invoices of one subscription with a different plan before 2026-10-29, and a new subscription replacing a live one (new checkout); market = subscription, invoice or locked market. Internal accounts are excluded unless included. Grain does not apply.","unit":"count","shape":"breakdown","breakdowns":["plan"],"filters":["market","plan","currency"],"kb":"new_analysis/monetization/plan_mix_and_switching.md","consent_scoped":false,"alertable":false,"min_group":5,"breakdown_dimension":"plan","measures":{"subscriptions":{"label":"Paid subscriptions","unit":"count","description":"MRR > 0 at the end of the range"},"share":{"label":"Share of subscriptions","unit":"ratio"},"mrr":{"label":"MRR","unit":"currency","description":"Snapshot at the end of the range"},"mrr_usd_native":{"label":"MRR (USD)","unit":"currency"},"mrr_try_native":{"label":"MRR (TRY)","unit":"currency"},"switched_in":{"label":"Switched in","unit":"count","description":"Plan switches to this plan in the range","ignores_filters":["currency"]},"switched_out":{"label":"Switched out","unit":"count","description":"Plan switches away from this plan in the range","ignores_filters":["currency"]}}}';

-- ---------------------------------------------------------------------------
-- analytics.subscription_churn
-- ---------------------------------------------------------------------------

create function analytics.subscription_churn(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, paid_churn bigint, paid_voluntary bigint, paid_involuntary bigint,
  paid_other_or_unknown bigint, ended_never_paid bigint, replaced_excluded bigint, cancel_scheduled_open bigint,
  lost_to_erasure bigint, lost_mrr numeric, lost_mrr_usd_native numeric, lost_mrr_try_native numeric,
  involuntary_share numeric, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with fx as (
    select * from analytics_private.fx_months(r.from_day, r.to_day)
  ),
  ended as (
    select analytics_private.bucket(e.end_ts, p_grain) as b,
           case p_breakdown when 'market' then e.market when 'plan' then e.plan_code end as dim,
           e.replaced, e.ever_paid, e.reason_group, e.currency, e.mrr_native,
           x.usd_try, x.provisional
    from analytics_private.subscription_endings e
    left join fx x on x.month = date_trunc('month', e.end_ts at time zone 'UTC')::date
    where (p_include_internal or not e.is_internal)
      and e.end_ts >= v_start
      and e.end_ts < v_end
      and (v_markets is null or e.market = any (v_markets))
      and (v_plans is null or e.plan_code = any (v_plans))
  ),
  churn_agg as (
    select en.b, en.dim,
           count(*) filter (where not en.replaced and en.ever_paid) as paid_churn,
           count(*) filter (where not en.replaced and en.ever_paid and en.reason_group = 'voluntary') as paid_vol,
           count(*) filter (where not en.replaced and en.ever_paid and en.reason_group = 'involuntary') as paid_invol,
           count(*) filter (where not en.replaced and en.ever_paid and en.reason_group in ('other', 'unknown')) as paid_other,
           count(*) filter (where not en.replaced and not en.ever_paid) as never_paid,
           count(*) filter (where en.replaced) as replaced,
           sum(en.mrr_native) filter (where not en.replaced and en.ever_paid and en.currency = 'USD') as lost_usd,
           sum(en.mrr_native) filter (where not en.replaced and en.ever_paid and en.currency = 'TRY') as lost_try,
           sum(case when en.currency = upper(p_currency) then en.mrr_native
                    when p_currency = 'usd' and en.currency = 'TRY' then en.mrr_native / en.usd_try
                    when p_currency = 'try' and en.currency = 'USD' then en.mrr_native * en.usd_try end)
             filter (where not en.replaced and en.ever_paid) as lost_conv,
           bool_or(en.currency <> upper(p_currency) and en.mrr_native is not null and en.usd_try is null)
             filter (where not en.replaced and en.ever_paid) as fx_missing,
           bool_or(en.currency <> upper(p_currency) and en.mrr_native is not null and en.provisional)
             filter (where not en.replaced and en.ever_paid) as fx_prov
    from ended en
    group by 1, 2
  ),
  -- Cancel requested, access not ended yet: by request time.
  scheduled as (
    select analytics_private.bucket(s.canceled_at, p_grain) as b,
           case p_breakdown when 'market' then coalesce(s.market, bm.market, 'unknown') when 'plan' then s.plan_code end as dim,
           count(*) as n
    from public.subscriptions s
    join analytics_private.analysis_users au on au.id = s.user_id
    left join public.billing_markets bm on bm.user_id = s.user_id
    where s.provider_subscription_id is not null
      and s.plan_code not in ('free', 'lifetime')
      and s.status in ('active', 'trialing')
      and s.cancel_at_period_end
      and s.canceled_at >= v_start
      and s.canceled_at < v_end
      and (p_include_internal or not au.is_internal)
      and (v_markets is null or coalesce(s.market, bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or s.plan_code = any (v_plans))
    group by 1, 2
  ),
  -- Live subscriptions canceled by account erasure (subscription_events, from 2026-10-29). The account is gone, so
  -- market is unknown and internal accounts cannot be told apart.
  erased as (
    select analytics_private.bucket(e.occurred_at, p_grain) as b,
           case p_breakdown when 'market' then 'unknown' when 'plan' then e.from_plan_code end as dim,
           count(*) as n
    from public.subscription_events e
    where e.source = 'account_deletion'
      and e.event_type = 'canceled'
      and e.occurred_at >= v_start
      and e.occurred_at < v_end
      and (v_plans is null or e.from_plan_code = any (v_plans))
    group by 1, 2
  ),
  dims as (
    select c.dim from churn_agg c
    union select s.dim from scheduled s
    union select e.dim from erased e
    union select null where p_breakdown is null
  )
  select k.b, d.dim,
         coalesce(c.paid_churn, 0),
         coalesce(c.paid_vol, 0),
         coalesce(c.paid_invol, 0),
         coalesce(c.paid_other, 0),
         coalesce(c.never_paid, 0),
         coalesce(c.replaced, 0),
         coalesce(s.n, 0),
         coalesce(e.n, 0),
         case when p_currency = 'native' or coalesce(c.fx_missing, false) then null else round(coalesce(c.lost_conv, 0), 2) end,
         round(coalesce(c.lost_usd, 0), 2),
         round(coalesce(c.lost_try, 0), 2),
         round(c.paid_invol::numeric / nullif(c.paid_churn, 0), 4),
         (p_currency <> 'native' and coalesce(c.fx_prov or c.fx_missing, false))
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join churn_agg c on c.b = k.b and c.dim is not distinct from d.dim
  left join scheduled s on s.b = k.b and s.dim is not distinct from d.dim
  left join erased e on e.b = k.b and e.dim is not distinct from d.dim
  where p_breakdown is null or d.dim is not null
  order by k.b, d.dim;
end $$;

comment on function analytics.subscription_churn(date, date, text, text, boolean, text, jsonb) is
'{"title":"Subscription churn","definition":"Ended subscriptions per access-end period (UTC) (KB cancellation_reasons section B; replaces queries/subscription_churn_monthly, which bucketed status = canceled by updated_at): real subscriptions (not free / lifetime) of analysis users with status canceled, incomplete_expired, unpaid or paused, bucketed by ended_at (updated_at when missing). A subscription replaced by another one of the same user (superseded, or a new subscription started between the cancel request - 1 day and the access end + 1 day) is a switch, not churn (replaced_excluded). paid_churn = ended subscriptions with a collected invoice, split by Stripe cancellation_reason: voluntary (cancellation_requested), involuntary (payment_failed / payment_disputed, or unpaid without a reason), other or unknown; ended_never_paid = trial-stage endings (see trial_to_paid). lost_mrr = the paid churn''s monthly price (the subscription''s own Stripe unit_amount x interval factor, else the catalogue monthly list price), in the requested currency at the end month''s USD->TRY rate (null for native or when a needed rate is missing; fx_provisional when that rate is month-to-date or from an earlier month), with the native USD / TRY sums alongside. cancel_scheduled_open = active / trialing subscriptions with a cancel requested in the period and not yet ended. lost_to_erasure = live subscriptions canceled by account erasure (subscription_events source account_deletion, from 2026-10-29; never part of paid_churn; no market and not filterable for internal accounts). involuntary_share = paid_involuntary / paid_churn. Internal accounts are excluded unless included, as are accounts pending deletion or with restricted processing. Market = subscription market, else the locked market.","unit":"count","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan"],"kb":"queries/subscription_churn_monthly.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"plot":["paid_voluntary","paid_involuntary","paid_other_or_unknown"],"stacked":true,"measures":{"paid_churn":{"label":"Paid churn","unit":"count","description":"Ended paid subscriptions (switches excluded)"},"paid_voluntary":{"label":"Voluntary","unit":"count"},"paid_involuntary":{"label":"Involuntary","unit":"count","description":"Payment failed or disputed"},"paid_other_or_unknown":{"label":"Other / unknown reason","unit":"count"},"ended_never_paid":{"label":"Ended before paying","unit":"count"},"replaced_excluded":{"label":"Switches (excluded)","unit":"count"},"cancel_scheduled_open":{"label":"Cancels scheduled","unit":"count","description":"Requested in the period, access not ended yet"},"lost_to_erasure":{"label":"Lost to erasure","unit":"count","ignores_filters":["market"]},"lost_mrr":{"label":"Lost MRR","unit":"currency","description":"Monthly price of the paid churn, requested currency"},"lost_mrr_usd_native":{"label":"Lost MRR (USD)","unit":"currency"},"lost_mrr_try_native":{"label":"Lost MRR (TRY)","unit":"currency"},"involuntary_share":{"label":"Involuntary share","unit":"ratio","description":"paid_involuntary / paid_churn"}}}';

-- ---------------------------------------------------------------------------
-- analytics.payment_issues
-- ---------------------------------------------------------------------------

create function analytics.payment_issues(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text,
  failed_invoices bigint, invoices_due bigint, failure_rate numeric, paid_late_invoices bigint,
  failed_amount numeric, failed_amount_usd_native numeric, failed_amount_try_native numeric,
  past_due_episodes bigint, recovered_episodes bigint, lost_episodes bigint,
  refunded_invoices bigint, refunded numeric, refunded_usd_native numeric, refunded_try_native numeric, refund_rate numeric,
  discounted_invoices bigint, discount numeric, discount_usd_native numeric, discount_try_native numeric,
  effective_discount_rate numeric, fx_provisional boolean
)
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
  v_target text := upper(p_currency);
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan', 'currency']);
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
  with fx as (
    select * from analytics_private.fx_months(r.from_day, r.to_day)
  ),
  -- A) Invoices that asked for money (not draft, amount_total > 0), by creation time.
  due as (
    select analytics_private.bucket(i.created_at, p_grain) as b,
           case p_breakdown when 'market' then coalesce(i.market, 'unknown') when 'plan' then coalesce(i.plan_code, 'unknown') end as dim,
           upper(i.currency) as cur,
           i.amount_total / 100.0 as amount_total,
           case when i.amount_paid > 0 and i.paid_at > i.created_at + interval '1 day' then 'paid_late'
                when i.amount_paid > 0 then 'paid_on_time'
                when i.status in ('paid', 'refunded', 'partially_refunded') then 'paid_by_credit'
                when i.status = 'open' and i.created_at > now() - interval '1 day' then 'pending'
                when i.status = 'open' then 'failed_open'
                when i.status = 'uncollectible' then 'failed_uncollectible'
                when i.status = 'void' then 'failed_void'
                else 'other' end as outcome,
           x.usd_try, x.provisional
    from public.billing_invoices i
    left join public.users u on u.id = i.user_id
    left join fx x on x.month = date_trunc('month', i.created_at at time zone 'UTC')::date
    where i.status <> 'draft'
      and i.amount_total > 0
      and i.created_at >= v_start
      and i.created_at < v_end
      and (p_include_internal or i.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(i.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(i.plan_code, 'unknown') = any (v_plans))
      and (v_currencies is null or upper(i.currency) = any (v_currencies))
  ),
  due_agg as (
    select d.b, d.dim,
           count(*) filter (where d.outcome like 'failed%') as failed,
           count(*) filter (where d.outcome <> 'pending') as due_n,
           count(*) filter (where d.outcome = 'paid_late') as late,
           sum(d.amount_total) filter (where d.outcome like 'failed%' and d.cur = 'USD') as f_usd,
           sum(d.amount_total) filter (where d.outcome like 'failed%' and d.cur = 'TRY') as f_try,
           sum(case when d.cur = v_target then d.amount_total
                    when v_target = 'USD' and d.cur = 'TRY' then d.amount_total / d.usd_try
                    when v_target = 'TRY' and d.cur = 'USD' then d.amount_total * d.usd_try end)
             filter (where d.outcome like 'failed%') as f_conv,
           bool_or(d.cur <> v_target and d.usd_try is null) filter (where d.outcome like 'failed%') as f_missing,
           bool_or(d.cur <> v_target and d.provisional) filter (where d.outcome like 'failed%') as f_prov
    from due d
    group by 1, 2
  ),
  -- B) past_due episodes entered from a healthy status (live events from 2026-10-29).
  episodes as (
    select se.subscription_id, se.user_id, se.occurred_at as past_due_at,
           coalesce(se.to_plan_code, se.from_plan_code) as plan_at_event,
           lead(se.occurred_at) over (partition by se.subscription_id order by se.occurred_at) as next_episode_at
    from public.subscription_events se
    where se.event_type = 'past_due'
      and se.source <> 'backfill'
      and coalesce(se.from_status, '') not in ('past_due', 'unpaid')
  ),
  ep as (
    select analytics_private.bucket(e.past_due_at, p_grain) as b,
           case p_breakdown when 'market' then coalesce(fi.market, 'unknown') when 'plan' then coalesce(e.plan_at_event, 'unknown') end as dim,
           case when rec.recovered_at is not null and (ch.lost_at is null or rec.recovered_at < ch.lost_at) then 'recovered'
                when ch.lost_at is not null then 'lost'
                else 'still_open' end as outcome
    from episodes e
    left join public.users u on u.id = e.user_id
    left join lateral (
      -- Each side is the first match on a (subscription_id, time) index, not a scan of the subscription's history.
      select least(
               (select se2.occurred_at
                from public.subscription_events se2
                where se2.subscription_id = e.subscription_id and se2.event_type = 'reactivated'
                  and se2.occurred_at > e.past_due_at and se2.occurred_at < coalesce(e.next_episode_at, 'infinity'::timestamptz)
                order by se2.occurred_at
                limit 1),
               (select i.paid_at
                from public.billing_invoices i
                where i.subscription_id = e.subscription_id and i.amount_paid > 0
                  and i.paid_at > e.past_due_at and i.paid_at < coalesce(e.next_episode_at, 'infinity'::timestamptz)
                order by i.paid_at
                limit 1)) as recovered_at
    ) rec on true
    left join lateral (
      select min(se3.occurred_at) as lost_at
      from public.subscription_events se3
      where se3.subscription_id = e.subscription_id
        and se3.event_type in ('canceled', 'superseded', 'trial_canceled')
        and se3.occurred_at > e.past_due_at and se3.occurred_at < coalesce(e.next_episode_at, 'infinity'::timestamptz)
    ) ch on true
    -- The failing invoice: the latest non-zero invoice created up to a day after the event.
    left join lateral (
      select upper(i.currency) as currency, i.market
      from public.billing_invoices i
      where i.subscription_id = e.subscription_id and i.amount_total > 0
        and i.created_at <= e.past_due_at + interval '1 day'
      order by i.created_at desc
      limit 1
    ) fi on true
    where e.past_due_at >= v_start
      and e.past_due_at < v_end
      and (p_include_internal or e.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(fi.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(e.plan_at_event, 'unknown') = any (v_plans))
      and (v_currencies is null or fi.currency = any (v_currencies))
  ),
  ep_agg as (
    select e.b, e.dim, count(*) as episodes,
           count(*) filter (where e.outcome = 'recovered') as recovered,
           count(*) filter (where e.outcome = 'lost') as lost
    from ep e
    group by 1, 2
  ),
  -- C) Refunds by paid month (no refund timestamp exists); legacy one-time purchases never record refunds.
  refunds as (
    select analytics_private.bucket(ir.paid_at, p_grain) as b,
           case p_breakdown when 'market' then coalesce(ir.market, 'unknown') when 'plan' then coalesce(ir.plan_code, 'unknown') end as dim,
           count(*) filter (where ir.refunded > 0) as refunded_n,
           sum(ir.refunded) filter (where ir.currency = 'USD') as r_usd,
           sum(ir.refunded) filter (where ir.currency = 'TRY') as r_try,
           sum(case when ir.currency = v_target then ir.refunded
                    when v_target = 'USD' and ir.currency = 'TRY' then ir.refunded / ir.usd_try
                    when v_target = 'TRY' and ir.currency = 'USD' then ir.refunded * ir.usd_try end) as r_conv,
           -- Refund rate by amount at the paid month's rate (identical in USD and TRY terms).
           sum(case when ir.currency = 'USD' then ir.refunded else ir.refunded / ir.usd_try end)
             / nullif(sum(case when ir.currency = 'USD' then ir.gross_paid else ir.gross_paid / ir.usd_try end), 0) as r_rate,
           bool_or(ir.currency <> 'USD' and ir.usd_try is null) as rate_missing,
           bool_or(ir.refunded > 0 and ir.currency <> v_target and ir.usd_try is null) as r_missing,
           bool_or(ir.refunded > 0 and ir.currency <> v_target and ir.fx_is_provisional) as r_prov
    from analytics_private.invoice_revenue ir
    where ir.billing_reason is distinct from 'one_time_purchase'
      and ir.paid_at >= v_start
      and ir.paid_at < v_end
      and (p_include_internal or not ir.is_internal_user)
      and (v_markets is null or coalesce(ir.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(ir.plan_code, 'unknown') = any (v_plans))
      and (v_currencies is null or ir.currency = any (v_currencies))
    group by 1, 2
  ),
  -- D) Discounts on settled invoices with a list value (100%-discounted ones included), by paid (else created) time.
  settled as (
    select analytics_private.bucket(coalesce(i.paid_at, i.created_at), p_grain) as b,
           case p_breakdown when 'market' then coalesce(i.market, 'unknown') when 'plan' then coalesce(i.plan_code, 'unknown') end as dim,
           upper(i.currency) as cur,
           i.amount_subtotal / 100.0 as subtotal,
           i.amount_discount / 100.0 as disc,
           x.usd_try, x.provisional
    from public.billing_invoices i
    left join public.users u on u.id = i.user_id
    left join fx x on x.month = date_trunc('month', coalesce(i.paid_at, i.created_at) at time zone 'UTC')::date
    where i.status in ('paid', 'refunded', 'partially_refunded')
      and i.amount_subtotal > 0
      and coalesce(i.paid_at, i.created_at) >= v_start
      and coalesce(i.paid_at, i.created_at) < v_end
      and (p_include_internal or i.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(i.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(i.plan_code, 'unknown') = any (v_plans))
      and (v_currencies is null or upper(i.currency) = any (v_currencies))
  ),
  disc_agg as (
    select s.b, s.dim,
           count(*) filter (where s.disc > 0) as disc_n,
           sum(s.disc) filter (where s.cur = 'USD') as d_usd,
           sum(s.disc) filter (where s.cur = 'TRY') as d_try,
           sum(case when s.cur = v_target then s.disc
                    when v_target = 'USD' and s.cur = 'TRY' then s.disc / s.usd_try
                    when v_target = 'TRY' and s.cur = 'USD' then s.disc * s.usd_try end) as d_conv,
           sum(case when s.cur = 'USD' then s.disc else s.disc / s.usd_try end)
             / nullif(sum(case when s.cur = 'USD' then s.subtotal else s.subtotal / s.usd_try end), 0) as d_rate,
           bool_or(s.cur <> 'USD' and s.usd_try is null) as rate_missing,
           bool_or(s.disc > 0 and s.cur <> v_target and s.usd_try is null) as d_missing,
           bool_or(s.disc > 0 and s.cur <> v_target and s.provisional) as d_prov
    from settled s
    group by 1, 2
  ),
  dims as (
    select a.dim from due_agg a
    union select e.dim from ep_agg e
    union select f.dim from refunds f
    union select g.dim from disc_agg g
    union select null where p_breakdown is null
  )
  select k.b, d.dim,
         coalesce(a.failed, 0),
         coalesce(a.due_n, 0),
         round(a.failed::numeric / nullif(a.due_n, 0), 4),
         coalesce(a.late, 0),
         case when p_currency = 'native' or coalesce(a.f_missing, false) then null else round(coalesce(a.f_conv, 0), 2) end,
         round(coalesce(a.f_usd, 0), 2),
         round(coalesce(a.f_try, 0), 2),
         coalesce(e.episodes, 0),
         coalesce(e.recovered, 0),
         coalesce(e.lost, 0),
         coalesce(f.refunded_n, 0),
         case when p_currency = 'native' or coalesce(f.r_missing, false) then null else round(coalesce(f.r_conv, 0), 2) end,
         round(coalesce(f.r_usd, 0), 2),
         round(coalesce(f.r_try, 0), 2),
         case when coalesce(f.rate_missing, false) then null else round(f.r_rate, 4) end,
         coalesce(g.disc_n, 0),
         case when p_currency = 'native' or coalesce(g.d_missing, false) then null else round(coalesce(g.d_conv, 0), 2) end,
         round(coalesce(g.d_usd, 0), 2),
         round(coalesce(g.d_try, 0), 2),
         case when coalesce(g.rate_missing, false) then null else round(g.d_rate, 4) end,
         (p_currency <> 'native'
          and (coalesce(a.f_prov or a.f_missing, false) or coalesce(f.r_prov or f.r_missing, false)
               or coalesce(g.d_prov or g.d_missing, false)))
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join due_agg a on a.b = k.b and a.dim is not distinct from d.dim
  left join ep_agg e on e.b = k.b and e.dim is not distinct from d.dim
  left join refunds f on f.b = k.b and f.dim is not distinct from d.dim
  left join disc_agg g on g.b = k.b and g.dim is not distinct from d.dim
  where p_breakdown is null or d.dim is not null
  order by k.b, d.dim;
end $$;

comment on function analytics.payment_issues(date, date, text, text, boolean, text, jsonb) is
'{"title":"Payment issues","definition":"Revenue leakage per period (UTC), KB payment_failures_refunds_discounts sections A-D. Failures (by invoice creation): an invoice due (not draft, amount_total > 0) with nothing paid that is uncollectible, void, or still open after 1 day; invoices_due excludes the still-pending ones (open < 1 day); failure_rate = failed / due; paid_late = paid more than 1 day after creation (the proxy for a retry that recovered); failed_amount = amount_total of failed invoices. Dunning (by episode start, live from 2026-10-29): a past_due event entered from a healthy status; recovered = a reactivated event or a paid invoice of the subscription before the next episode and before it was lost; lost = canceled / superseded / trial_canceled first; market and currency of the failing invoice. Refunds (by the invoice''s paid time: no refund timestamp exists, so a refund restates the paid period): collected invoices with amount_refunded > 0, legacy one-time purchases excluded; refund_rate = refunded / gross paid. Discounts (by paid time, creation time for $0 invoices): settled invoices with a subtotal > 0, 100%-discounted ones included; effective_discount_rate = discount / subtotal. Amounts in the requested currency at the month''s USD->TRY rate (null for native, or when a needed rate is missing; fx_provisional when a used rate is month-to-date, from an earlier month or missing), plus native USD / TRY sums; the two rates convert to USD at the month''s rate and are currency-independent. Erased accounts are included; internal accounts are excluded unless included. Market and plan are the invoice''s (unknown when absent).","unit":"count","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan","currency"],"kb":"new_analysis/monetization/payment_failures_refunds_discounts.md","consent_scoped":false,"alertable":false,"min_group":5,"plot":["failed_invoices","refunded_invoices","discounted_invoices"],"measures":{"failed_invoices":{"label":"Failed invoices","unit":"count"},"invoices_due":{"label":"Invoices due","unit":"count","description":"Resolved invoices that asked for money"},"failure_rate":{"label":"Failure rate","unit":"ratio","description":"failed_invoices / invoices_due"},"paid_late_invoices":{"label":"Paid after retry","unit":"count","description":"Paid more than 1 day after creation"},"failed_amount":{"label":"Failed amount","unit":"currency"},"failed_amount_usd_native":{"label":"Failed amount (USD)","unit":"currency"},"failed_amount_try_native":{"label":"Failed amount (TRY)","unit":"currency"},"past_due_episodes":{"label":"Past-due episodes","unit":"count"},"recovered_episodes":{"label":"Recovered episodes","unit":"count"},"lost_episodes":{"label":"Lost episodes","unit":"count","description":"Involuntary churn"},"refunded_invoices":{"label":"Refunded invoices","unit":"count"},"refunded":{"label":"Refunded","unit":"currency"},"refunded_usd_native":{"label":"Refunded (USD)","unit":"currency"},"refunded_try_native":{"label":"Refunded (TRY)","unit":"currency"},"refund_rate":{"label":"Refund rate","unit":"ratio","description":"Refunded / gross paid, by amount"},"discounted_invoices":{"label":"Discounted invoices","unit":"count"},"discount":{"label":"Discounts","unit":"currency"},"discount_usd_native":{"label":"Discounts (USD)","unit":"currency"},"discount_try_native":{"label":"Discounts (TRY)","unit":"currency"},"effective_discount_rate":{"label":"Effective discount rate","unit":"ratio","description":"Discount / subtotal"}}}';

-- ---------------------------------------------------------------------------
-- analytics.cancellation_reasons
-- ---------------------------------------------------------------------------

create function analytics.cancellation_reasons(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, cancellations bigint, share numeric, reason_group_share numeric,
  paid_cancellations bigint, trial_or_unpaid_cancellations bigint,
  reason_group text, cancellation_reason text, cancellation_feedback text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with cancels as (
    select s.id,
           coalesce(s.canceled_at, s.ended_at, s.updated_at) as cancel_ts,
           case when s.cancellation_reason = 'cancellation_requested' then 'voluntary'
                when s.cancellation_reason in ('payment_failed', 'payment_disputed') then 'involuntary'
                when s.cancellation_reason is not null then 'other'
                when s.status = 'unpaid' then 'involuntary'
                else 'unknown' end as rg,
           coalesce(s.cancellation_reason, '(null)') as reason,
           coalesce(s.cancellation_feedback, '(none)') as feedback
    from public.subscriptions s
    join analytics_private.analysis_users au on au.id = s.user_id
    left join public.billing_markets bm on bm.user_id = s.user_id
    where s.provider_subscription_id is not null
      and s.plan_code not in ('free', 'lifetime')
      and s.status <> 'inactive'
      and (s.canceled_at is not null or s.ended_at is not null or s.status in ('canceled', 'incomplete_expired'))
      and coalesce(s.canceled_at, s.ended_at, s.updated_at) >= v_start
      and coalesce(s.canceled_at, s.ended_at, s.updated_at) < v_end
      and (p_include_internal or not au.is_internal)
      and (v_markets is null or coalesce(s.market, bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or s.plan_code = any (v_plans))
      -- A switch is not a cancellation.
      and not exists (select 1 from public.subscription_events e
                      where e.subscription_id = s.id and e.event_type = 'superseded')
      and not exists (select 1 from public.subscriptions s2
                      where s2.user_id = s.user_id and s2.id <> s.id
                        and s2.provider_subscription_id is not null and s2.plan_code <> 'free'
                        and s2.created_at > s.created_at
                        and s2.created_at >= coalesce(s.canceled_at, s.ended_at, s.updated_at) - interval '1 day'
                        and s2.created_at <= coalesce(s.ended_at, s.current_period_end, s.updated_at) + interval '1 day')
  ),
  facts as (
    select c.*,
           exists (select 1 from public.billing_invoices i
                   where i.subscription_id = c.id and i.paid_at is not null and i.amount_paid > 0
                     and i.status in ('paid', 'refunded', 'partially_refunded')
                     and i.paid_at <= c.cancel_ts) as paid_before
    from cancels c
  )
  select f.rg || ' / ' || f.reason || ' / ' || f.feedback,
         count(*),
         round(count(*)::numeric / sum(count(*)) over (), 4),
         round(sum(count(*)) over (partition by f.rg) / sum(count(*)) over (), 4),
         count(*) filter (where f.paid_before),
         count(*) filter (where not f.paid_before),
         f.rg, f.reason, f.feedback
  from facts f
  group by f.rg, f.reason, f.feedback
  order by 2 desc, 1;
end $$;

comment on function analytics.cancellation_reasons(date, date, text, text, boolean, text, jsonb) is
'{"title":"Cancellation reasons","definition":"Why subscriptions end (KB cancellation_reasons section A, overall segment) for cancellations in the range (UTC): real subscriptions (not free / lifetime, not superseded) of analysis users with a cancel request (canceled_at), an access end (ended_at) or a terminal status (canceled, incomplete_expired), timed by the request (else the end, else updated_at). A subscription replaced by another one of the same user (superseded event, or a new subscription started between the cancel request - 1 day and the access end + 1 day) is a switch and is left out. One row per reason_group / Stripe cancellation_reason / portal cancellation_feedback: reason_group = voluntary (cancellation_requested), involuntary (payment_failed / payment_disputed, or unpaid without a reason), other, unknown (no reason recorded, e.g. not backfilled); feedback is optional, so most rows are (none). share = cancellations / all; reason_group_share = the row''s reason group / all. paid_cancellations had a collected invoice by the cancel time; trial_or_unpaid_cancellations did not (trial cancels or failed first charges). Internal accounts are excluded unless included, as are accounts pending deletion or with restricted processing. Market = subscription market, else the locked market. Grain and currency do not apply.","unit":"count","shape":"breakdown","breakdowns":[],"filters":["market","plan"],"kb":"new_analysis/monetization/cancellation_reasons.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"cancellations":{"label":"Cancellations","unit":"count"},"share":{"label":"Share","unit":"ratio"},"reason_group_share":{"label":"Reason group share","unit":"ratio"},"paid_cancellations":{"label":"Paid before cancel","unit":"count"},"trial_or_unpaid_cancellations":{"label":"Trial or unpaid","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.paywall_denials
-- ---------------------------------------------------------------------------

create function analytics.paywall_denials(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, user_days bigint, users bigint, hits bigint, hits_consenting bigint,
  hits_anonymous bigint, anonymous_share numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[];
  v_plans text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'plan'], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');

  return query
  with den as (
    select date_trunc(p_grain, d.day::timestamp)::date as b,
           case p_breakdown when 'market' then coalesce(bm.market, 'unknown') when 'plan' then d.plan_code end as dim,
           d.day, d.user_id, d.count
    from public.entitlement_denials d
    left join public.users u on u.id = d.user_id
    left join public.billing_markets bm on bm.user_id = d.user_id
    where d.day >= r.from_day
      and d.day <= r.to_day
      -- Anonymous rows (no consent) always count; per-user rows only for analysis users.
      and (d.user_id is null
           or (u.deletion_requested_at is null and u.processing_restricted_at is null
               and (p_include_internal or not u.is_internal)))
      and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or d.plan_code = any (v_plans))
  ),
  dims as (
    select distinct den.dim from den
    union
    select null where p_breakdown is null
  )
  select k.b, d.dim,
         count(distinct (x.user_id, x.day)) filter (where x.user_id is not null),
         count(distinct x.user_id),
         coalesce(sum(x.count), 0)::bigint,
         coalesce(sum(x.count) filter (where x.user_id is not null), 0)::bigint,
         coalesce(sum(x.count) filter (where x.user_id is null), 0)::bigint,
         round(coalesce(sum(x.count) filter (where x.user_id is null), 0)::numeric / nullif(sum(x.count), 0), 4)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join den x on x.b = k.b and x.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.paywall_denials(date, date, text, text, boolean, text, jsonb) is
'{"title":"Paywall denials","definition":"Paywall pressure per period (UTC day of the hit) from entitlement_denials (KB paywall_transition_impact section A; recorded from 2026-10-29). user_days = distinct consenting user x day pairs with at least one denial (users who hit the paywall that day; counts are request hits, not paywall views, so one blocked page load can hit several routes); users = distinct consenting users; hits = all denial hits including the anonymous rows of users without analytics consent; anonymous_share = anonymous hits / hits, the part the per-user figures cannot see. Per-user figures are of consenting users only. Internal, deleting and restricted users are never recorded; rows of accounts later flagged internal are excluded unless included, and rows of accounts now pending deletion or restricted are excluded (the KB keeps them). Plan = the plan at the denial; market = the user''s locked market, unknown for anonymous rows (a market filter therefore drops anonymous hits unless it includes unknown). Currency does not apply.","unit":"count","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan"],"kb":"new_analysis/monetization/paywall_transition_impact.md","consent_scoped":true,"alertable":false,"drill":true,"min_group":5,"measures":{"user_days":{"label":"User-days at the paywall","unit":"count","description":"Consenting users who hit the paywall, per day"},"users":{"label":"Users at the paywall","unit":"count","description":"Distinct consenting users"},"hits":{"label":"Denial hits","unit":"count","description":"All hits, including anonymous rows"},"hits_consenting":{"label":"Hits (consenting)","unit":"count"},"hits_anonymous":{"label":"Hits (anonymous)","unit":"count"},"anonymous_share":{"label":"Anonymous share","unit":"ratio"}}}';

-- ---------------------------------------------------------------------------
-- Drill-down keys (analytics_people.drill_users -> analytics_private.drill_<key>)
-- Each returns every user behind the point, one row per user; drill_users applies the privacy rules and
-- include_internal, then pages by sort_key desc, user_id.
-- ---------------------------------------------------------------------------

-- Trials started in the range (analytics.trial_to_paid), newest trial first.
create function analytics_private.drill_trial_conversions(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_plans text[] := analytics_private.filter_values(p_filters, 'plan');
  v_outcomes text[] := analytics_private.filter_values(p_filters, 'outcome');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'plan', 'outcome']);
  return query
  select o.user_id,
         count(*)::numeric,
         jsonb_build_object(
           'trials', count(*),
           'outcome', (array_agg(o.outcome_group order by o.t_start desc, o.subscription_id))[1],
           'plan', (array_agg(o.plan_code order by o.t_start desc, o.subscription_id))[1],
           'market', (array_agg(o.market order by o.t_start desc, o.subscription_id))[1],
           'trial_type', (array_agg(o.trial_type order by o.t_start desc, o.subscription_id))[1],
           'trial_start', max(o.t_start),
           'trial_end', (array_agg(o.t_end order by o.t_start desc, o.subscription_id))[1],
           'first_paid_at', (array_agg(o.first_paid_at order by o.t_start desc, o.subscription_id))[1]),
         floor(extract(epoch from max(o.t_start)) * 1000000)::text
  from analytics_private.trial_outcomes o
  where o.t_start >= analytics_private.utc_start(p_from)
    and o.t_start < analytics_private.utc_start(p_to + 1)
    and (v_markets is null or o.market = any (v_markets))
    and (v_plans is null or o.plan_code = any (v_plans))
    and (v_outcomes is null or o.outcome_group = any (v_outcomes))
  group by o.user_id;
end $$;

comment on function analytics_private.drill_trial_conversions(date, date, jsonb, integer, text) is
'{"description":"Accounts with a trial started in the range (analytics.trial_to_paid population), newest trial first. outcome filters by outcome group: converted, failed_first_charge, trial_canceled, superseded, in_trial, unresolved.","metric":"trial_to_paid","filters":["market","plan","outcome"],"value":"trials started in range","unit":"count","order":"newest trial start first","detail":["trials","outcome","plan","market","trial_type","trial_start","trial_end","first_paid_at"]}';

-- Checkout attempts in the range behind one funnel step (analytics.checkout_funnel), latest attempt first. The UI sends
-- the clicked step (and the breakdown value as market / plan); abandoned and rejected list the drop-outs.
create function analytics_private.drill_checkout_funnel(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_plans text[] := analytics_private.filter_values(p_filters, 'plan');
  v_steps text[] := coalesce(analytics_private.filter_values(p_filters, 'step'), array['attempts']);
  v_bad text;
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'plan', 'step']);
  select x into v_bad from unnest(v_steps) x
  where x is null or x not in ('attempts', 'session_created', 'completed', 'paid_within_7d', 'abandoned', 'rejected')
  limit 1;
  if found then
    raise exception 'unsupported checkout step: %', left(coalesce(v_bad, 'null'), 60) using errcode = '22023';
  end if;
  return query
  with att as (
    select ca.id, ca.user_id, ca.outcome, ca.plan_code, ca.trial_requested, ca.created_at,
           coalesce(ca.market, bm.market, 'unknown') as market,
           case when ca.outcome in ('rejected_pending', 'rejected_active', 'rejected_pricing_changed', 'failed') then 'rejected'
                when ca.outcome = 'completed' then 'completed'
                when ca.outcome in ('expired', 'canceled') then 'abandoned'
                when ca.created_at < now() - interval '24 hours' then 'abandoned'
                else 'pending' end as stage
    from public.checkout_attempts ca
    left join public.billing_markets bm on bm.user_id = ca.user_id
    where ca.user_id is not null
      and ca.created_at >= analytics_private.utc_start(p_from)
      and ca.created_at < analytics_private.utc_start(p_to + 1)
      and (v_markets is null or coalesce(ca.market, bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or lower(ca.plan_code) = any (v_plans))
  ),
  matched as (
    select a.*
    from att a
    where 'attempts' = any (v_steps)
       or ('session_created' = any (v_steps) and a.stage <> 'rejected')
       or ('completed' = any (v_steps) and a.stage = 'completed')
       or ('abandoned' = any (v_steps) and a.stage = 'abandoned')
       or ('rejected' = any (v_steps) and a.stage = 'rejected')
       or ('paid_within_7d' = any (v_steps) and a.stage = 'completed' and a.created_at <= now() - interval '7 days'
           and exists (select 1 from analytics_private.invoice_revenue ir
                       where ir.user_id = a.user_id and ir.paid_at >= a.created_at
                         and ir.paid_at < a.created_at + interval '7 days'))
  )
  select m.user_id,
         count(*)::numeric,
         jsonb_build_object(
           'attempts', count(*),
           'last_outcome', (array_agg(m.outcome order by m.created_at desc, m.id))[1],
           'last_plan', (array_agg(lower(m.plan_code) order by m.created_at desc, m.id))[1],
           'last_trial_requested', (array_agg(m.trial_requested order by m.created_at desc, m.id))[1],
           'last_attempt_at', max(m.created_at),
           'market', (array_agg(m.market order by m.created_at desc, m.id))[1],
           'subscribed_now', exists (select 1 from public.subscriptions s
                                     where s.user_id = m.user_id and s.provider_subscription_id is not null
                                       and s.plan_code <> 'free'
                                       and (s.status = 'active' or (s.status = 'trialing' and s.current_period_end > now())))),
         floor(extract(epoch from max(m.created_at)) * 1000000)::text
  from matched m
  group by m.user_id;
end $$;

comment on function analytics_private.drill_checkout_funnel(date, date, jsonb, integer, text) is
'{"description":"Accounts with checkout attempts created in the range at one analytics.checkout_funnel step, latest attempt first. step = attempts (default), session_created, completed, paid_within_7d (completed, at least 7 days old, paid within 7 days), or the drop-outs abandoned (expired, canceled, open > 24h) and rejected. Anonymised (erased) attempts cannot be listed. subscribed_now = has an active (or unexpired trialing) subscription today.","metric":"checkout_funnel","filters":["market","plan","step"],"value":"matching attempts in range","unit":"count","order":"latest attempt first","detail":["attempts","last_outcome","last_plan","last_trial_requested","last_attempt_at","market","subscribed_now"]}';

-- Abandoned checkouts in the range (checkout_funnel step 3 dropped): drill_checkout_funnel with step = abandoned.
create function analytics_private.drill_checkout_abandoned(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language sql stable set search_path = ''
as $$
  select d.user_id, d.value, d.detail, d.sort_key
  from analytics_private.drill_checkout_funnel(p_from, p_to,
         (coalesce(p_filters, '{}'::jsonb) - 'step') || '{"step":"abandoned"}'::jsonb, p_limit, p_cursor) d
$$;

comment on function analytics_private.drill_checkout_abandoned(date, date, jsonb, integer, text) is
'{"description":"Accounts with an abandoned checkout created in the range (expired, canceled in the app, or open for more than 24h; analytics.checkout_funnel step 3 dropped), latest first. Same as checkout_funnel with step = abandoned (a step filter is ignored). subscribed_now = has an active (or unexpired trialing) subscription today.","metric":null,"filters":["market","plan"],"value":"abandoned attempts in range","unit":"count","order":"latest abandoned attempt first","detail":["attempts","last_outcome","last_plan","last_trial_requested","last_attempt_at","market","subscribed_now"]}';

-- Paid churn in the range (analytics.subscription_churn), latest access end first.
create function analytics_private.drill_churned_subscribers(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_plans text[] := analytics_private.filter_values(p_filters, 'plan');
  v_groups text[] := analytics_private.filter_values(p_filters, 'reason_group');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'plan', 'reason_group']);
  return query
  select e.user_id,
         count(*)::numeric,
         jsonb_build_object(
           'churned_subscriptions', count(*),
           'plan', (array_agg(e.plan_code order by e.end_ts desc, e.subscription_id))[1],
           'market', (array_agg(e.market order by e.end_ts desc, e.subscription_id))[1],
           'ended_at', max(e.end_ts),
           'reason_group', (array_agg(e.reason_group order by e.end_ts desc, e.subscription_id))[1],
           'cancellation_reason', (array_agg(e.cancellation_reason order by e.end_ts desc, e.subscription_id))[1],
           'cancellation_feedback', (array_agg(e.cancellation_feedback order by e.end_ts desc, e.subscription_id))[1],
           'lost_mrr_native', (array_agg(round(e.mrr_native, 2) order by e.end_ts desc, e.subscription_id))[1],
           'currency', (array_agg(e.currency order by e.end_ts desc, e.subscription_id))[1]),
         floor(extract(epoch from max(e.end_ts)) * 1000000)::text
  from analytics_private.subscription_endings e
  where not e.replaced
    and e.ever_paid
    and e.end_ts >= analytics_private.utc_start(p_from)
    and e.end_ts < analytics_private.utc_start(p_to + 1)
    and (v_markets is null or e.market = any (v_markets))
    and (v_plans is null or e.plan_code = any (v_plans))
    and (v_groups is null or e.reason_group = any (v_groups))
  group by e.user_id;
end $$;

comment on function analytics_private.drill_churned_subscribers(date, date, jsonb, integer, text) is
'{"description":"Accounts whose paid subscription ended in the range (analytics.subscription_churn paid_churn: switches and never-paid trials excluded), latest end first. reason_group filters by voluntary, involuntary, other or unknown.","metric":"subscription_churn","filters":["market","plan","reason_group"],"value":"churned paid subscriptions in range","unit":"count","order":"latest access end first","detail":["churned_subscriptions","plan","market","ended_at","reason_group","cancellation_reason","cancellation_feedback","lost_mrr_native","currency"]}';

-- Consenting users who hit the paywall in the range (analytics.paywall_denials), most hits first.
create function analytics_private.drill_paywall_denials(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_plans text[] := analytics_private.filter_values(p_filters, 'plan');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'plan']);
  return query
  select d.user_id,
         sum(d.count)::numeric,
         jsonb_build_object(
           'hits', sum(d.count),
           'denial_days', count(distinct d.day),
           'last_day', max(d.day),
           'actions', to_jsonb(array_agg(distinct d.action order by d.action)),
           'reasons', to_jsonb(array_agg(distinct d.reason order by d.reason)),
           'market', coalesce(max(bm.market), 'unknown')),
         sum(d.count)::text
  from public.entitlement_denials d
  left join public.billing_markets bm on bm.user_id = d.user_id
  where d.user_id is not null
    and d.day >= p_from
    and d.day <= p_to
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
    and (v_plans is null or d.plan_code = any (v_plans))
  group by d.user_id;
end $$;

comment on function analytics_private.drill_paywall_denials(date, date, jsonb, integer, text) is
'{"description":"Consenting accounts that hit the paywall in the range (analytics.paywall_denials; users without analytics consent are anonymous and cannot be listed), most denial hits first.","metric":"paywall_denials","filters":["market","plan"],"value":"denial hits in range","unit":"count","order":"most hits first","detail":["hits","denial_days","last_day","actions","reasons","market"]}';

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
