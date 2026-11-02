-- Trial reminder queue for the external email agent (20261107130000_trial_reminder_queue.sql).
begin;

create function pg_temp.mk_user(p_email text, p_locale text default 'en') returns uuid
language sql as $$
  insert into public.users(auth_user_id, email, full_name, locale) values (gen_random_uuid(), p_email, 'Name ' || p_email, p_locale) returning id
$$;

create function pg_temp.mk_trial(p_user uuid, p_status text, p_start timestamptz, p_end timestamptz,
  p_cancel boolean default false, p_canceled timestamptz default null, p_currency text default 'try', p_amount bigint default 14999)
returns uuid
language sql as $$
  insert into public.subscriptions(user_id, provider, provider_subscription_id, plan_code, status, trial_start, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, currency, unit_amount, billing_interval, created_at)
  values (p_user, 'stripe', 'sub_' || gen_random_uuid(), 'weekly', p_status, p_start, p_end, p_start, p_end, p_cancel, p_canceled,
          p_currency, p_amount, 'week', p_start)
  returning id
$$;

do $$
declare
  got text;
  soon uuid; later uuid; canceled_scheduled uuid; canceled_now uuid; canceled_old uuid; converted uuid;
  after_trial uuid; internal uuid; deleting uuid; restricted uuid; retried uuid; s_old uuid; s_new uuid;
  r record;
begin
  -- in_trial: soonest end first. soon = USD on the GLOBAL market, later = TRY with no subscription market (locked market).
  soon := pg_temp.mk_user('queue-soon@example.invalid');
  insert into public.billing_markets(user_id, market) values (soon, 'GLOBAL');
  perform pg_temp.mk_trial(soon, 'trialing', now() - interval '60 hours', now() + interval '12 hours', p_currency => 'usd', p_amount => 499);
  later := pg_temp.mk_user('queue-later@example.invalid', 'tr');
  insert into public.billing_markets(user_id, market) values (later, 'TR');
  perform pg_temp.mk_trial(later, 'trialing', now() - interval '10 hours', now() + interval '62 hours');

  -- trial_canceled: cancel scheduled during a live trial, and canceled 2 h after its trial ended.
  canceled_scheduled := pg_temp.mk_user('queue-cancel-scheduled@example.invalid');
  perform pg_temp.mk_trial(canceled_scheduled, 'trialing', now() - interval '20 hours', now() + interval '52 hours', true, now() - interval '1 hour');
  canceled_now := pg_temp.mk_user('queue-cancel-ended@example.invalid');
  perform pg_temp.mk_trial(canceled_now, 'canceled', now() - interval '74 hours', now() - interval '2 hours', true, now() - interval '30 hours');

  -- Not queued: a trial canceled more than 24 h after its end, a converted trial, a cancel after the trial,
  -- internal, pending deletion and restricted accounts.
  canceled_old := pg_temp.mk_user('queue-cancel-old@example.invalid');
  perform pg_temp.mk_trial(canceled_old, 'canceled', now() - interval '6 days', now() - interval '3 days', false, now() - interval '4 days');
  converted := pg_temp.mk_user('queue-converted@example.invalid');
  perform pg_temp.mk_trial(converted, 'active', now() - interval '5 days', now() - interval '2 days');
  after_trial := pg_temp.mk_user('queue-after-trial@example.invalid');
  perform pg_temp.mk_trial(after_trial, 'active', now() - interval '4 days', now() - interval '1 day', true, now() - interval '2 hours');
  internal := pg_temp.mk_user('queue-internal@example.invalid');
  perform pg_temp.mk_trial(internal, 'trialing', now(), now() + interval '72 hours');
  update public.users set is_internal = true where id = internal;
  deleting := pg_temp.mk_user('queue-deleting@example.invalid');
  perform pg_temp.mk_trial(deleting, 'trialing', now(), now() + interval '72 hours');
  update public.users set deletion_requested_at = now() where id = deleting;
  restricted := pg_temp.mk_user('queue-restricted@example.invalid');
  perform pg_temp.mk_trial(restricted, 'trialing', now(), now() + interval '72 hours');
  update public.users set processing_restricted_at = now() where id = restricted;

  -- Only the latest trial subscription counts: an older canceled trial is replaced by a live one.
  retried := pg_temp.mk_user('queue-retried@example.invalid');
  s_old := pg_temp.mk_trial(retried, 'canceled', now() - interval '30 hours', now() + interval '42 hours', true, now() - interval '29 hours');
  s_new := pg_temp.mk_trial(retried, 'trialing', now() - interval '1 hour', now() + interval '71 hours');

  select string_agg(email || ':' || category || ':' || sort_order, ' ' order by sort_order) into got
  from public.trial_reminder_queue where email like 'queue-%';
  if got <> 'queue-soon@example.invalid:in_trial:1 queue-later@example.invalid:in_trial:2 queue-retried@example.invalid:in_trial:3 '
            'queue-cancel-ended@example.invalid:trial_canceled:4 queue-cancel-scheduled@example.invalid:trial_canceled:5' then
    raise exception 'queue rows or order wrong: %', got;
  end if;
  if (select string_agg(email, ' ') from public.trial_reminder_queue) <> (select string_agg(email, ' ' order by sort_order) from public.trial_reminder_queue) then
    raise exception 'view is not ordered by sort_order';
  end if;

  select * into r from public.trial_reminder_queue where user_id = soon;
  if r.price_display <> '$4.99' or r.currency <> 'USD' or r.unit_amount <> 499 or r.market <> 'GLOBAL' or r.locale <> 'en'
    or r.hours_until_trial_end not between 11.9 and 12.0 or r.billing_interval <> 'week' or r.canceled_at is not null then
    raise exception 'in_trial row wrong: %', row_to_json(r);
  end if;
  select * into r from public.trial_reminder_queue where user_id = later;
  if r.price_display <> '149,99 TL' or r.currency <> 'TRY' or r.market <> 'TR' or r.locale <> 'tr' or r.full_name <> 'Name queue-later@example.invalid' then
    raise exception 'TRY row wrong: %', row_to_json(r);
  end if;
  select * into r from public.trial_reminder_queue where user_id = canceled_now;
  if r.hours_until_trial_end not between -2.1 and -1.9 or r.canceled_at is null then
    raise exception 'ended canceled trial row wrong: %', row_to_json(r);
  end if;
  if (select subscription_id from public.trial_reminder_queue where user_id = retried) <> s_new then
    raise exception 'latest trial subscription not used';
  end if;

  -- service_role only; the browser roles and the analytics role cannot read it.
  if has_table_privilege('anon', 'public.trial_reminder_queue', 'select')
    or has_table_privilege('authenticated', 'public.trial_reminder_queue', 'select')
    or has_table_privilege('analytics_api', 'public.trial_reminder_queue', 'select')
    or has_table_privilege('service_role', 'public.trial_reminder_queue', 'insert, update, delete')
    or not has_table_privilege('service_role', 'public.trial_reminder_queue', 'select') then
    raise exception 'trial_reminder_queue privileges wrong';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.trial_reminder_queue'::regclass and 'security_invoker=true' = any (reloptions)) then
    raise exception 'trial_reminder_queue must be security_invoker';
  end if;
  set local role service_role;
  if (select count(*) from public.trial_reminder_queue where email like 'queue-%') <> 5 then
    raise exception 'service_role cannot read the queue';
  end if;
  reset role;
end $$;

rollback;
select 'Trial reminder queue categories, order, exclusions and privileges passed' as verification;
