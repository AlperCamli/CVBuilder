-- =============================================================================
-- Subscription Conversion & Revenue Report
-- =============================================================================
-- Free-to-paid conversion, plan distribution, upgrade/downgrade behaviour, churn,
-- recurring revenue (MRR), trial performance, and which actions users take
-- before they subscribe.
--
-- Tables: public.users, public.subscriptions, public.ai_runs,
--         public.tailored_cvs, public.exports, public.jobs
--
-- ⚠️ PLAN PRICING / TIER CAVEAT
-- subscriptions.plan_code and .status are free-form text and there is no price
-- column. EDIT the `plan_catalog` CTE (repeated in each query) so every plan_code
-- you use maps to its monthly USD price and a tier rank (higher = more premium).
-- Tier rank powers the upgrade vs. downgrade detection.
--
-- This file has FIVE independent queries:
--   QUERY A — conversion, plan distribution & MRR snapshot
--   QUERY B — trial performance
--   QUERY C — churn
--   QUERY D — upgrade / downgrade behaviour
--   QUERY E — actions taken before first subscription
-- =============================================================================


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY A — free-to-paid conversion, plan distribution, MRR                   │
-- └───────────────────────────────────────────────────────────────────────────┘
with plan_catalog(plan_code, monthly_usd, tier_rank) as (
  values
    -- plan_code     monthly $   tier   <-- EDIT THESE to match your real plans
    ('free',          0.00,      0),
    ('pro_monthly',   12.00,     1),
    ('pro_yearly',    9.00,      1),   -- effective monthly (annual / 12)
    ('team',          29.00,     2)
),

current_sub as (
  -- the user's current active/trialing subscription (one enforced by unique idx)
  select distinct on (s.user_id)
    s.user_id, s.plan_code, s.status
  from public.subscriptions s
  where s.status in ('active', 'trialing')
  order by s.user_id, s.current_period_start desc nulls last
),

totals as (
  select
    (select count(*) from public.users)                                   as total_users,
    (select count(distinct user_id) from public.subscriptions
       where status in ('active', 'trialing'))                            as users_with_active_sub,
    (select count(distinct user_id) from public.subscriptions)            as users_ever_subscribed
)

select
  'ALL_USERS'                                                  as plan_code,
  t.total_users                                                as users,
  null::numeric                                                as mrr_usd,
  round(t.users_ever_subscribed::numeric
        / nullif(t.total_users, 0), 3)                         as free_to_paid_conversion_rate,
  round(t.users_with_active_sub::numeric
        / nullif(t.total_users, 0), 3)                         as active_paid_rate
from totals t

union all

select
  coalesce(cs.plan_code, '(unpriced)')                         as plan_code,
  count(*)                                                     as users,
  round(sum(pc.monthly_usd)::numeric, 2)                       as mrr_usd,
  null, null
from current_sub cs
left join plan_catalog pc on pc.plan_code = cs.plan_code
where cs.status = 'active'              -- MRR counts only paying (not trialing)
group by cs.plan_code
order by mrr_usd desc nulls last;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY B — trial performance                                                │
-- └───────────────────────────────────────────────────────────────────────────┘
-- A user "trialed" if they ever held a trialing subscription. They "converted"
-- if they later (or now) hold an active subscription.
-- ⚠️ Status transitions appear to update the subscription row in place (a unique
-- index allows only one active/trialing row per user), so a trial that already
-- converted no longer shows status='trialing'. This query therefore measures
-- CURRENT trials + ever-active users; for true historical trial→paid conversion
-- you need a subscription-events/webhook log (not present in this schema).
with trialed as (
  -- any user who has ever held a trialing subscription
  select distinct user_id
  from public.subscriptions
  where status = 'trialing'
),
converted as (
  select distinct user_id
  from public.subscriptions
  where status = 'active'
),
still_trialing as (
  select distinct user_id
  from public.subscriptions
  where status = 'trialing'
)
select
  count(distinct t.user_id)                                    as users_trialed,
  count(distinct c.user_id)                                    as trials_converted_to_active,
  round(count(distinct c.user_id)::numeric
        / nullif(count(distinct t.user_id), 0), 3)             as trial_conversion_rate,
  count(distinct st.user_id)                                   as currently_in_trial
from trialed t
left join converted c     on c.user_id = t.user_id
left join still_trialing st on st.user_id = t.user_id;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY C — churn                                                            │
-- └───────────────────────────────────────────────────────────────────────────┘
-- Churn signals: subscriptions in a cancelled/expired state, plus active subs
-- flagged to cancel at period end (pending/voluntary churn).
select
  count(*) filter (where status in ('canceled', 'cancelled', 'expired'))   as churned_subscriptions,
  count(distinct user_id) filter (where status in ('canceled', 'cancelled', 'expired'))
                                                                            as churned_users,
  count(*) filter (where status in ('active', 'trialing')
                     and cancel_at_period_end)                             as pending_cancellations,
  count(*) filter (where status = 'past_due')                             as past_due_subscriptions,
  -- voluntary churn rate among everyone who ever held an active sub
  round(
    count(distinct user_id) filter (where status in ('canceled', 'cancelled', 'expired'))::numeric
    / nullif(count(distinct user_id), 0), 3
  )                                                                        as churn_rate_of_subscribers
from public.subscriptions;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY D — upgrade / downgrade behaviour                                    │
-- └───────────────────────────────────────────────────────────────────────────┘
-- Walks each user's subscription rows in created_at order and compares the tier
-- rank of consecutive plans. Requires plan rows in subscriptions for each change.
with plan_catalog(plan_code, monthly_usd, tier_rank) as (
  values
    ('free', 0.00, 0), ('pro_monthly', 12.00, 1),
    ('pro_yearly', 9.00, 1), ('team', 29.00, 2)
),
seq as (
  select
    s.user_id,
    s.created_at,
    s.plan_code,
    coalesce(pc.tier_rank, -1) as tier_rank,
    lag(coalesce(pc.tier_rank, -1)) over (partition by s.user_id order by s.created_at) as prev_tier,
    lag(s.plan_code)            over (partition by s.user_id order by s.created_at)     as prev_plan
  from public.subscriptions s
  left join plan_catalog pc on pc.plan_code = s.plan_code
),
transitions as (
  select
    case
      when prev_tier is null            then 'initial'
      when tier_rank > prev_tier        then 'upgrade'
      when tier_rank < prev_tier        then 'downgrade'
      else 'lateral_or_renew'
    end as transition_type,
    prev_plan,
    plan_code
  from seq
)
select
  transition_type,
  count(*) as transitions,
  count(*) filter (where prev_plan is not null) as plan_change_events
from transitions
group by transition_type
order by transitions desc;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY E — actions taken before first subscription                          │
-- └───────────────────────────────────────────────────────────────────────────┘
-- For every user who eventually subscribed, counts the product actions that
-- happened BEFORE their first subscription row — the behaviours that precede a
-- purchase. Reported as avg per converting user + share of converters who did it.
with first_sub as (
  select user_id, min(created_at) as first_sub_at
  from public.subscriptions
  group by user_id
),
pre_events as (
  select fs.user_id, 'ai_run'        as action, r.started_at as ts
    from first_sub fs join public.ai_runs r     on r.user_id = fs.user_id and r.started_at < fs.first_sub_at
  union all
  select fs.user_id, 'tailored_cv',  t.created_at
    from first_sub fs join public.tailored_cvs t on t.user_id = fs.user_id and t.created_at  < fs.first_sub_at
  union all
  select fs.user_id, 'export',       e.created_at
    from first_sub fs join public.exports e      on e.user_id = fs.user_id and e.created_at  < fs.first_sub_at
  union all
  select fs.user_id, 'job_added',    j.created_at
    from first_sub fs join public.jobs j         on j.user_id = fs.user_id and j.created_at  < fs.first_sub_at
)
select
  action,
  count(*)                                                       as total_events_before_subscribe,
  count(distinct user_id)                                        as converters_who_did_it,
  round(
    count(distinct user_id)::numeric
    / nullif((select count(*) from first_sub), 0), 3
  )                                                              as share_of_converters,
  round(count(*)::numeric / nullif(count(distinct user_id), 0), 1)
                                                                 as avg_per_converter
from pre_events
group by action
order by converters_who_did_it desc;
