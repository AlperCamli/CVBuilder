-- Trial outcomes: "charge pending" and conversions through a replacement subscription.
--
-- 1. Stripe moves a subscription to active at trial end but charges the first renewal invoice about an hour later,
--    so every converting trial used to show as unresolved for that hour. A trial that is active (or still
--    trialing) within a day of its trial end, with no paid first invoice yet, is now its own state,
--    charge_pending. It is not resolved, so it never counts against the rate.
-- 2. A trial replaced by another paid subscription of the same account (the cancel-flow offer, or buying monthly /
--    annual directly during the trial) used to stay superseded. It now counts as converted (outcome
--    converted_switch) when the replacement was created between the trial start and the trial end + 1 day and has
--    a collected subscription_create or subscription_cycle invoice (amount_paid > 0). A replacement paid only with a
--    100% coupon stays superseded. The rule reads subscriptions and invoices only, so it does not depend on the
--    cancel-flow tables (20261111120000_cancel_flow_offers.sql).
-- 3. analytics.kpi_overview reads its trial numbers from analytics_private.trial_outcomes instead of repeating the
--    rules inline, so the Overview and the Trial to paid chart cannot drift apart.

-- ---------------------------------------------------------------------------
-- analytics_private.trial_outcomes (same columns in the same order; replacement_subscription_id appended)
-- ---------------------------------------------------------------------------

-- KB trial_to_paid_conversion trials + outcomes (analytics.trial_to_paid and analytics.kpi_overview): one row per trial
-- of a real subscription of an analysis user. outcome_group folds converted_plan_change and converted_switch into
-- converted, awaiting_first_charge into charge_pending and active_no_paid_invoice into unresolved.
create or replace view analytics_private.trial_outcomes as
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
         coalesce(i.first_cycle_paid_at, i.first_update_paid_at, sw.switch_paid_at) as first_paid_at,
         case
           when i.first_cycle_paid_at is not null then 'converted'
           when i.first_update_paid_at is not null then 'converted_plan_change'
           when sw.switch_paid_at is not null then 'converted_switch'
           when t.status = 'trialing' and t.t_end > now() then 'in_trial'
           when t.status in ('past_due', 'unpaid') or i.failed_first_charge_at is not null
                or exists (select 1 from public.subscription_events e
                           where e.subscription_id = t.id and e.source <> 'backfill'
                             and e.event_type = 'past_due' and e.from_status = 'trialing') then 'failed_first_charge'
           when t.status in ('canceled', 'incomplete_expired', 'paused') then 'trial_canceled'
           when t.status = 'inactive' then 'superseded'
           -- Stripe charges the first renewal about an hour after the trial ends.
           when t.status in ('active', 'trialing') and t.t_end >= now() - interval '1 day' then 'awaiting_first_charge'
           else 'active_no_paid_invoice'
         end as outcome,
         sw.replacement_subscription_id
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
  -- A superseded trial (inactive, or a live superseded event) replaced by another real subscription of the same
  -- account, created between the trial start and the trial end + 1 day, with a collected first invoice. Covers the
  -- cancel-flow offer (a new paid subscription; the trial is then ended) and a direct monthly / annual purchase.
  left join lateral (
    select r.id as replacement_subscription_id, rp.paid_at as switch_paid_at
    from public.subscriptions r
    cross join lateral (
      select min(rbi.paid_at) as paid_at
      from public.billing_invoices rbi
      where (rbi.subscription_id = r.id
             or (rbi.subscription_id is null and rbi.provider_subscription_id = r.provider_subscription_id))
        and rbi.billing_reason in ('subscription_create', 'subscription_cycle')
        and rbi.paid_at is not null and rbi.amount_paid > 0
        and rbi.status in ('paid', 'refunded', 'partially_refunded')
    ) rp
    where (t.status = 'inactive'
           or exists (select 1 from public.subscription_events se
                      where se.subscription_id = t.id and se.source <> 'backfill' and se.event_type = 'superseded'))
      and r.user_id = t.user_id
      and r.id <> t.id
      and r.provider_subscription_id is not null
      and r.plan_code <> 'free'
      and r.created_at >= t.t_start
      and r.created_at < t.t_end + interval '1 day'
      and rp.paid_at is not null
    order by r.created_at, r.id
    limit 1
  ) sw on true
)
select c.subscription_id, c.user_id, c.is_internal, c.plan_code, c.market, c.status, c.trial_source, c.trial_type,
       c.t_start, c.t_end, c.canceled_at, c.first_paid_at, c.outcome,
       case when c.outcome in ('converted', 'converted_plan_change', 'converted_switch') then 'converted'
            when c.outcome = 'awaiting_first_charge' then 'charge_pending'
            when c.outcome = 'active_no_paid_invoice' then 'unresolved'
            else c.outcome end as outcome_group,
       c.replacement_subscription_id
from classified c;

-- ---------------------------------------------------------------------------
-- analytics.trial_to_paid: new charge_pending column (return type change: drop and recreate; default privileges
-- re-grant analytics_api, the final revoke removes PUBLIC again)
-- ---------------------------------------------------------------------------

drop function analytics.trial_to_paid(date, date, text, text, boolean, text, jsonb);

create function analytics.trial_to_paid(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, trial_to_paid numeric, trial_starts bigint, converted bigint,
  failed_first_charge bigint, trial_canceled bigint, superseded bigint, in_trial bigint, charge_pending bigint,
  unresolved bigint, resolved bigint, failed_charge_rate numeric
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
         count(*) filter (where t.og = 'charge_pending'),
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
'{"title":"Trial to paid","definition":"Trials by trial-start period (UTC cohort) and their outcome today (KB trial_to_paid_conversion section A; same rules as the Overview trial KPIs, which read the same view). A trial is a real subscription (not free) with trial_start, the redeemed transition-grant trial, or (only for rows with no Stripe detail) the weekly/pro heuristic; start = trial_start, else created_at; end = trial_end, else start + 3 days. Outcome, first match wins: converted = a paid subscription_cycle invoice (amount_paid > 0, refunds included) whose service starts at trial end (-1h), a paid subscription_update invoice during the trial (portal plan switch), or a replacement subscription: the trial was superseded (inactive) by another real subscription of the same account created between the trial start and the trial end + 1 day with a paid subscription_create or subscription_cycle invoice (amount_paid > 0; the cancel-flow offer, or buying monthly / annual during the trial); in_trial = trialing and trial end in the future; failed_first_charge = past_due / unpaid, an open / uncollectible / void first cycle invoice, or a trialing -> past_due event; trial_canceled = canceled / incomplete_expired / paused; superseded = replaced by another subscription (inactive) without a paid replacement (e.g. a 100% coupon); charge_pending = active or trialing, trial ended less than a day ago, first charge not collected yet (Stripe charges the first renewal about an hour after the trial ends); unresolved (Needs check) = everything else, mostly active more than a day after trial end with no synced paid invoice. resolved = converted + failed_first_charge + trial_canceled; trial_to_paid = converted / resolved; failed_charge_rate = failed_first_charge / resolved. charge_pending, superseded, in_trial and unresolved are not resolved. Recent cohorts are still maturing. Market = subscription market, else the locked market. Excludes internal accounts unless included, and accounts pending deletion or with restricted processing; trials of erased accounts are gone (survivorship). Grant trials (release cohort) are included, as in the KB overall rows. Currency does not apply.","unit":"ratio","shape":"timeseries","breakdowns":["market","plan"],"filters":["market","plan"],"kb":"new_analysis/monetization/trial_to_paid_conversion.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"plot":["converted","failed_first_charge","trial_canceled","superseded","in_trial","charge_pending","unresolved"],"stacked":true,"measures":{"trial_to_paid":{"label":"Trial to paid","unit":"ratio","description":"converted / resolved"},"trial_starts":{"label":"Trial starts","unit":"count"},"converted":{"label":"Converted","unit":"count","description":"Paid first renewal, a paid plan-change invoice during the trial, or a paid replacement subscription (cancel offer, direct monthly / annual purchase)"},"failed_first_charge":{"label":"Failed first charge","unit":"count"},"trial_canceled":{"label":"Canceled in trial","unit":"count"},"superseded":{"label":"Superseded","unit":"count","description":"Replaced by another subscription that has not been paid for; not resolved"},"in_trial":{"label":"In trial","unit":"count"},"charge_pending":{"label":"Charge pending","unit":"count","color":"pending","description":"The trial ended and Stripe charges the first renewal about an hour later; not resolved yet"},"unresolved":{"label":"Needs check","unit":"count","color":"attention","description":"Active more than a day after trial end with no synced paid invoice; check Stripe"},"resolved":{"label":"Resolved trials","unit":"count"},"failed_charge_rate":{"label":"Failed charge rate","unit":"ratio","description":"failed_first_charge / resolved"}}}';

-- ---------------------------------------------------------------------------
-- Drill key trial_conversions: the outcome filter accepts charge_pending (the function itself is unchanged)
-- ---------------------------------------------------------------------------

comment on function analytics_private.drill_trial_conversions(date, date, jsonb, integer, text) is
'{"description":"Accounts with a trial started in the range (analytics.trial_to_paid population), newest trial first. outcome filters by outcome group: converted (including plan-change and replacement conversions), failed_first_charge, trial_canceled, superseded, in_trial, charge_pending, unresolved (Needs check).","metric":"trial_to_paid","filters":["market","plan","outcome"],"value":"trials started in range","unit":"count","order":"newest trial start first","detail":["trials","outcome","plan","market","trial_type","trial_start","trial_end","first_paid_at"]}';

-- ---------------------------------------------------------------------------
-- analytics.kpi_overview: same signature and body; only the trial block now reads analytics_private.trial_outcomes
-- ---------------------------------------------------------------------------

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
'{"title":"Overview KPIs","definition":"One row for the whole range (UTC); internal accounts excluded unless included. Signups: new accounts, excluding accounts pending deletion or with restricted processing. Activated users: signups of the range whose first completed export (master or tailored CV) came within 7 days of signup; activation_eligible = signups whose 7-day window has closed, activated_eligible = activated among them, activation_rate = activated_eligible / activation_eligible (compare periods by the rate). New paying customers: customers whose first collected invoice (amount_paid > 0, refunds included) falls in the range; erased accounts count per subscription. Revenue: net cash from billing_invoices paid in the range, in the requested currency (null for native) and natively per invoice currency. MRR and active subscriptions: snapshot at the end of p_to (or now): per subscription, the latest paid recurring invoice covering the snapshot, normalised to one month (trials and lifetime excluded); active subscriptions have MRR > 0. Trials (analytics_private.trial_outcomes, the same rules as analytics.trial_to_paid): trials started in the range; trial_resolved = converted, failed first charge or canceled; trial_conversions = converted trials (a paid first subscription_cycle invoice from trial end, a paid plan-change invoice during the trial, or a paid replacement subscription such as the cancel-flow offer); trials still running, superseded, with the first charge pending or needing a check are not resolved; trial_to_paid_rate = trial_conversions / trial_resolved. AI cost: exact + estimated cost of non-mock, non-guest runs started in the range (USD; TRY when currency = try), with unpriced runs counted. Filters: market uses the user''s locked market for signups, activation and AI cost, and the invoice or subscription market for revenue, MRR, subscriptions, new paying customers and trials; plan applies to revenue, MRR, active subscriptions, new paying customers and trials. The *_fx_provisional flags are true when that measure needed a USD/TRY conversion whose rate was month-to-date, from an earlier month or missing (the measure is then null); always false for native. Sources: queries/user_acquisition_activation_report.md, queries/new_paying_customers_monthly.md, new_analysis/monetization/revenue_monthly_by_currency.md, mrr_movement_waterfall.md, trial_to_paid_conversion.md, queries/active_subscriptions_by_plan.md, new_analysis/ai_cost/ai_cost_per_outcome.md.","unit":"count","shape":"kpi","breakdowns":[],"filters":["market","plan"],"kb":"new_analysis/README.md","consent_scoped":false,"alertable":true,"measures":{"signups":{"label":"Signups","unit":"count","ignores_filters":["plan"]},"activated_users":{"label":"Activated users","unit":"count","description":"First completed export within 7 days of signup","ignores_filters":["plan"]},"activation_eligible":{"label":"Activation-eligible signups","unit":"count","description":"Signups whose 7-day window has closed","ignores_filters":["plan"]},"activated_eligible":{"label":"Activated (eligible)","unit":"count","description":"Activated users among eligible signups","ignores_filters":["plan"]},"activation_rate":{"label":"Activation rate","unit":"ratio","description":"activated_eligible / activation_eligible","ignores_filters":["plan"]},"new_paying_customers":{"label":"New paying customers","unit":"count","description":"First collected invoice in the range"},"revenue":{"label":"Revenue","unit":"currency","description":"Net cash, requested currency"},"revenue_usd_native":{"label":"Revenue (USD invoices)","unit":"currency"},"revenue_try_native":{"label":"Revenue (TRY invoices)","unit":"currency"},"mrr":{"label":"MRR","unit":"currency","description":"Snapshot at the end of the range"},"mrr_usd_native":{"label":"MRR (USD)","unit":"currency"},"mrr_try_native":{"label":"MRR (TRY)","unit":"currency"},"active_subscriptions":{"label":"Active subscriptions","unit":"count","description":"Subscriptions with MRR > 0 at the end of the range"},"trial_starts":{"label":"Trial starts","unit":"count"},"trial_resolved":{"label":"Resolved trials","unit":"count","description":"Converted, failed first charge or canceled"},"trial_conversions":{"label":"Trial conversions","unit":"count","description":"Includes plan-change and replacement-subscription conversions"},"trial_to_paid_rate":{"label":"Trial to paid","unit":"ratio","description":"trial_conversions / trial_resolved"},"ai_cost":{"label":"AI cost","unit":"currency","description":"USD; TRY when currency = try","ignores_filters":["plan"]},"ai_runs":{"label":"AI runs","unit":"count","ignores_filters":["plan"]},"unpriced_ai_runs":{"label":"Unpriced AI runs","unit":"count","ignores_filters":["plan"]}}}';

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
