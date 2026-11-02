-- Read-only queue for an external email agent (docs/trial-reminder-queue.md): accounts in a card-backed trial, and
-- accounts that canceled during their trial in the last 24 hours. One row per account (its latest trial
-- subscription). Only the backend secret key (service_role) can read it; the agent de-duplicates its own sends.
begin;

create view public.trial_reminder_queue with (security_invoker = true) as
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
