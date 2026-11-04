-- Cancel-flow offers (docs/promotions/cancel-flow-offer.md): a promotion shown on the cancel screen instead of
-- emailed, one per audience: a trial, or a paid weekly, monthly or annual plan. It is set up from
-- promotions/<slug>/campaign.json like an email campaign, but has no cohorts, recipients or link tokens, so it never
-- reaches promotion_email_queue.
-- - promotion_cancel_offers records each time the screen showed the offer, opened its checkout, or went on to cancel,
--   and when the account accepted it. A trial accepts through a Stripe Checkout paid at once (the backend then ends
--   the trial at Stripe, so its weekly price is never charged); a paid plan accepts in place, with no payment now.
-- - subscriptions.scheduled_plan_code / scheduled_change_at: a plan change waiting for the end of the paid period
--   (a downgrade, or the paid-weekly offer's switch to Monthly), copied from the Stripe subscription's metadata.
-- - trial_reminder_queue leaves out a trial that such a paid subscription replaced, so nobody who just paid gets a
--   "your trial is canceled" email.
-- Backend-only (service_role); account deletion removes the rows through the user foreign key.
begin;

alter table public.promotions
  add column channel text not null default 'email' check (channel in ('email', 'cancel_flow')),
  -- Whose cancellation shows it: a trial, or a paid plan.
  add column cancel_audience text check (cancel_audience in ('trial', 'weekly', 'monthly', 'annual')),
  add constraint promotions_cancel_flow_audience_check check ((channel = 'cancel_flow') = (cancel_audience is not null)),
  -- The cancel flow moves the subscription to exactly one plan.
  add constraint promotions_cancel_flow_plan_check check (channel <> 'cancel_flow' or cardinality(plan_codes) = 1);
create index promotions_cancel_flow_idx on public.promotions(cancel_audience, created_at desc)
  where channel = 'cancel_flow' and archived_at is null;

alter table public.subscriptions
  add column scheduled_plan_code text,
  add column scheduled_change_at timestamptz;

create table public.promotion_cancel_offers (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- The trialing subscription the offer was made for (Stripe id; the subscriptions row can be replaced).
  provider_subscription_id text not null,
  from_plan_code text not null,
  first_shown_at timestamptz not null default now(),
  last_shown_at timestamptz not null default now(),
  show_count integer not null default 1 check (show_count > 0),
  -- Last time the account passed over the offer and opened the cancellation.
  declined_at timestamptz,
  -- Last time "Keep Pro" opened the offer's Stripe Checkout.
  last_checkout_at timestamptz,
  -- Set once, after the offer's checkout was paid and the trial it replaces was ended at Stripe.
  accepted_at timestamptz,
  primary key (promotion_id, user_id)
);
create index promotion_cancel_offers_user_idx on public.promotion_cancel_offers(user_id);

alter table public.promotion_cancel_offers enable row level security;
revoke all on public.promotion_cancel_offers from public, anon, authenticated;
grant select, insert, update, delete on public.promotion_cancel_offers to service_role;

-- Same as 20261107130000_trial_reminder_queue.sql, except that the trial of an account that now has another active
-- or past-due paid subscription is left out. (A trial the backend kept as superseded, 'inactive', already has no
-- category; this also covers the moment before Stripe's cancellation of the trial reaches the database.)
create or replace view public.trial_reminder_queue with (security_invoker = true) as
with latest_trial as (
  select distinct on (s.user_id) s.*
  from public.subscriptions s
  where s.trial_start is not null and s.trial_end is not null
  order by s.user_id, s.trial_start desc, s.created_at desc, s.id desc
),
queued as (
  select t.*,
         case
           when t.status = 'trialing' and t.trial_end > now() and not t.cancel_at_period_end and t.canceled_at is null
             then 'in_trial'
           when t.trial_end > now() - interval '24 hours'
                and ((t.cancel_at_period_end and (t.status = 'trialing' or t.canceled_at < t.trial_end))
                     or (t.status = 'canceled' and t.canceled_at >= t.trial_start and t.canceled_at < t.trial_end))
             then 'trial_canceled'
         end as category
  from latest_trial t
  where not exists (
    select 1 from public.subscriptions p
    where p.user_id = t.user_id and p.id <> t.id and p.plan_code <> 'free' and p.status in ('active', 'past_due')
  )
)
select q.user_id,
       q.id as subscription_id,
       u.email,
       u.full_name,
       u.locale,
       q.plan_code,
       coalesce(q.market, bm.market) as market,
       upper(q.currency) as currency,
       q.unit_amount,
       q.billing_interval,
       case
         when q.unit_amount is null or q.currency is null then null
         when lower(q.currency) = 'usd' then '$' || to_char(q.unit_amount / 100.0, 'FM999999990.00')
         when lower(q.currency) = 'try' then replace(to_char(q.unit_amount / 100.0, 'FM999999990.00'), '.', ',') || ' TL'
         else to_char(q.unit_amount / 100.0, 'FM999999990.00') || ' ' || upper(q.currency)
       end as price_display,
       q.trial_start,
       q.trial_end,
       round((extract(epoch from (q.trial_end - now())) / 3600)::numeric, 1) as hours_until_trial_end,
       q.category,
       q.canceled_at,
       row_number() over (
         order by case q.category when 'in_trial' then 1 else 2 end, q.trial_end, q.user_id
       ) as sort_order
from queued q
join public.users u on u.id = q.user_id
left join public.billing_markets bm on bm.user_id = q.user_id
where q.category is not null
  and not u.is_internal
  and u.deletion_requested_at is null
  and u.processing_restricted_at is null
order by sort_order;

comment on view public.trial_reminder_queue is
  'Trial reminder queue for the external email agent (docs/trial-reminder-queue.md). service_role only.';

revoke all on public.trial_reminder_queue from public, anon, authenticated, service_role;
grant select on public.trial_reminder_queue to service_role;

commit;
