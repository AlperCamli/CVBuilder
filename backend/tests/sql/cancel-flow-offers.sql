-- Cancel-flow offers and the trial reminder queue (20261111120000_cancel_flow_offers.sql).
-- The trial audience covers both trial plans: the legacy weekly trials and the monthly trials from 2026-11-05. The offer
-- (Monthly, first month 50% off, paid at once) and the queue rules are the same for both.
begin;

create function pg_temp.mk_user(p_email text) returns uuid
language sql as $$
  insert into public.users(auth_user_id, email, full_name, locale) values (gen_random_uuid(), p_email, 'Name', 'en') returning id
$$;

create function pg_temp.mk_sub(p_user uuid, p_sub text, p_plan text, p_status text, p_trial boolean, p_canceled timestamptz default null) returns uuid
language sql as $$
  insert into public.subscriptions(user_id, provider, provider_subscription_id, plan_code, status, trial_start, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at, currency, unit_amount, billing_interval)
  values (p_user, 'stripe', p_sub, p_plan, p_status,
          case when p_trial then now() - interval '10 hours' end, case when p_trial then now() + interval '62 hours' end,
          now() - interval '10 hours', now() + case when p_trial then interval '62 hours' else interval '30 days' end,
          false, p_canceled, 'try', case p_plan when 'weekly' then 14990 else 34990 end, case p_plan when 'weekly' then 'week' else 'month' end)
  returning id
$$;

do $$
declare
  promo uuid; email_promo uuid; trialing uuid; upgraded uuid; upgraded_canceled uuid; superseded uuid; plain_cancel uuid;
  m_trialing uuid; m_upgraded uuid; m_upgraded_canceled uuid; m_plain_cancel uuid;
begin
  insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, channel, cancel_audience)
  values ('cancel-test', 'Cancel test', 50, array['monthly'], 'once', 'coupon_cancel', 'https://example.invalid', 'cancel_flow', 'trial')
  returning id into promo;
  insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url)
  values ('email-test', 'Email test', 50, array['monthly'], 'once', 'coupon_email', 'https://example.invalid')
  returning id into email_promo;
  if (select channel from public.promotions where id = email_promo) <> 'email' then
    raise exception 'existing and new email promotions must default to the email channel';
  end if;

  -- A cancel-flow promotion moves the subscription to exactly one plan.
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, channel, cancel_audience)
    values ('cancel-two-plans', 'x', 50, array['monthly','annual'], 'once', 'c', 'https://example.invalid', 'cancel_flow', 'monthly');
    raise exception 'two-plan cancel-flow promotion was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, channel)
    values ('bad-channel', 'x', 50, array['monthly'], 'once', 'c', 'https://example.invalid', 'sms');
    raise exception 'unknown channel was accepted';
  exception when check_violation then null;
  end;
  -- A cancel-flow promotion names its audience; an email campaign has none.
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, channel)
    values ('no-audience', 'x', 50, array['monthly'], 'once', 'c', 'https://example.invalid', 'cancel_flow');
    raise exception 'cancel-flow promotion without an audience was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, cancel_audience)
    values ('email-audience', 'x', 50, array['monthly'], 'once', 'c', 'https://example.invalid', 'trial');
    raise exception 'email promotion with a cancel audience was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, channel, cancel_audience)
    values ('bad-audience', 'x', 50, array['monthly'], 'once', 'c', 'https://example.invalid', 'cancel_flow', 'lifetime');
    raise exception 'unknown audience was accepted';
  exception when check_violation then null;
  end;

  -- Still in the trial: queued as before.
  trialing := pg_temp.mk_user('offer-trialing@example.invalid');
  perform pg_temp.mk_sub(trialing, 'sub_trialing', 'weekly', 'trialing', true);
  insert into public.promotion_cancel_offers(promotion_id, user_id, provider_subscription_id, from_plan_code, declined_at)
  values (promo, trialing, 'sub_trialing', 'weekly', now());

  -- Paid the offer: monthly is active. Whether the trial row was kept as superseded ('inactive', the normal case) or
  -- ended up 'canceled', no reminder or "trial canceled" email is queued.
  upgraded := pg_temp.mk_user('offer-upgraded@example.invalid');
  perform pg_temp.mk_sub(upgraded, 'sub_upgraded_trial', 'weekly', 'inactive', true);
  perform pg_temp.mk_sub(upgraded, 'sub_upgraded_monthly', 'monthly', 'active', false);
  upgraded_canceled := pg_temp.mk_user('offer-upgraded-canceled@example.invalid');
  perform pg_temp.mk_sub(upgraded_canceled, 'sub_uc_trial', 'weekly', 'canceled', true, now() - interval '1 minute');
  perform pg_temp.mk_sub(upgraded_canceled, 'sub_uc_monthly', 'monthly', 'past_due', false);
  superseded := pg_temp.mk_user('offer-superseded@example.invalid');
  perform pg_temp.mk_sub(superseded, 'sub_sup_trial', 'weekly', 'canceled', true, now() - interval '2 minutes');
  perform pg_temp.mk_sub(superseded, 'sub_sup_monthly', 'monthly', 'active', false);
  insert into public.promotion_cancel_offers(promotion_id, user_id, provider_subscription_id, from_plan_code, last_checkout_at, accepted_at)
  values (promo, upgraded, 'sub_upgraded_trial', 'weekly', now(), now());

  -- An ordinary cancel during the trial still gets its "trial canceled" email.
  plain_cancel := pg_temp.mk_user('offer-plain-cancel@example.invalid');
  perform pg_temp.mk_sub(plain_cancel, 'sub_plain', 'weekly', 'canceled', true, now() - interval '1 hour');

  -- The same cases for a monthly trial (the trial plan from 2026-11-05): the offer is made for the monthly trial, and
  -- paying it replaces the monthly trial with a paid monthly subscription. The monthly trial ends a little later so the
  -- queue order is fixed.
  m_trialing := pg_temp.mk_user('offer-m-trialing@example.invalid');
  perform pg_temp.mk_sub(m_trialing, 'sub_m_trialing', 'monthly', 'trialing', true);
  update public.subscriptions set trial_end = now() + interval '70 hours', current_period_end = now() + interval '70 hours'
  where provider_subscription_id = 'sub_m_trialing';
  insert into public.promotion_cancel_offers(promotion_id, user_id, provider_subscription_id, from_plan_code, declined_at)
  values (promo, m_trialing, 'sub_m_trialing', 'monthly', now());
  m_upgraded := pg_temp.mk_user('offer-m-upgraded@example.invalid');
  perform pg_temp.mk_sub(m_upgraded, 'sub_m_upgraded_trial', 'monthly', 'inactive', true);
  perform pg_temp.mk_sub(m_upgraded, 'sub_m_upgraded_monthly', 'monthly', 'active', false);
  insert into public.promotion_cancel_offers(promotion_id, user_id, provider_subscription_id, from_plan_code, last_checkout_at, accepted_at)
  values (promo, m_upgraded, 'sub_m_upgraded_trial', 'monthly', now(), now());
  m_upgraded_canceled := pg_temp.mk_user('offer-m-upgraded-canceled@example.invalid');
  perform pg_temp.mk_sub(m_upgraded_canceled, 'sub_m_uc_trial', 'monthly', 'canceled', true, now() - interval '1 minute');
  perform pg_temp.mk_sub(m_upgraded_canceled, 'sub_m_uc_monthly', 'monthly', 'active', false);
  m_plain_cancel := pg_temp.mk_user('offer-m-plain-cancel@example.invalid');
  perform pg_temp.mk_sub(m_plain_cancel, 'sub_m_plain', 'monthly', 'canceled', true, now() - interval '1 hour');
  update public.subscriptions set trial_end = now() + interval '70 hours' where provider_subscription_id = 'sub_m_plain';

  if (select string_agg(email || ':' || category, ' ' order by sort_order) from public.trial_reminder_queue where email like 'offer-%')
     <> 'offer-trialing@example.invalid:in_trial offer-m-trialing@example.invalid:in_trial '
        'offer-plain-cancel@example.invalid:trial_canceled offer-m-plain-cancel@example.invalid:trial_canceled' then
    raise exception 'queue rows wrong: %', (select string_agg(email || ':' || category, ' ' order by sort_order) from public.trial_reminder_queue where email like 'offer-%');
  end if;
  -- The monthly trial's row carries the monthly price and interval (the reminder says "a month").
  if (select concat_ws('/', plan_code, billing_interval, unit_amount, price_display) from public.trial_reminder_queue where user_id = m_trialing)
     is distinct from 'monthly/month/34990/349,90 TL' then
    raise exception 'monthly trial queue row wrong: %', (select row_to_json(q) from public.trial_reminder_queue q where q.user_id = m_trialing);
  end if;
  if (select from_plan_code from public.promotion_cancel_offers where user_id = m_upgraded) is distinct from 'monthly'
     or (select accepted_at from public.promotion_cancel_offers where user_id = m_upgraded) is null then
    raise exception 'monthly trial offer row wrong';
  end if;

  -- A pending plan change is stored on the subscription.
  update public.subscriptions set scheduled_plan_code = 'monthly', scheduled_change_at = now() + interval '5 days' where provider_subscription_id = 'sub_trialing';
  if (select scheduled_plan_code from public.subscriptions where provider_subscription_id = 'sub_trialing') <> 'monthly' then
    raise exception 'scheduled plan change not stored';
  end if;

  -- Cancel-flow promotions never enter the email queue (they have no recipients).
  if exists (select 1 from public.promotion_email_queue where promotion_slug = 'cancel-test') then
    raise exception 'cancel-flow promotion reached the email queue';
  end if;

  -- Deleting the account removes its offer rows.
  delete from public.users where id = trialing;
  if exists (select 1 from public.promotion_cancel_offers where user_id = trialing) then
    raise exception 'offer rows outlived the account';
  end if;

  -- service_role only.
  if has_table_privilege('anon', 'public.promotion_cancel_offers', 'select')
    or has_table_privilege('authenticated', 'public.promotion_cancel_offers', 'select, insert, update')
    or not has_table_privilege('service_role', 'public.promotion_cancel_offers', 'select, insert, update') then
    raise exception 'promotion_cancel_offers privileges wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.promotion_cancel_offers'::regclass) then
    raise exception 'promotion_cancel_offers must have RLS on';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.trial_reminder_queue'::regclass and 'security_invoker=true' = any (reloptions))
    or has_table_privilege('authenticated', 'public.trial_reminder_queue', 'select')
    or not has_table_privilege('service_role', 'public.trial_reminder_queue', 'select') then
    raise exception 'trial_reminder_queue lost its privileges';
  end if;
end $$;

rollback;
select 'Cancel-flow offers, replaced trials in the reminder queue and privileges passed' as verification;
