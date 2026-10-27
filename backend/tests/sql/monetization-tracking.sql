begin;
do $$
declare u uuid; consenting uuid; internal uuid; sub uuid; other uuid; usage public.usage_counters; today date:=(now() at time zone 'UTC')::date;
begin
  set local role service_role;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'money@example.invalid') returning id into u;
  insert into public.billing_markets(user_id,market) values(u,'TR');

  -- An invoice that arrives before its subscription is linked once the row exists.
  insert into public.billing_invoices(user_id,provider_invoice_id,provider_subscription_id,status,currency,amount_total,created_at)
    values(u,'in_early','sub_money','paid','try',29900,now());
  if (select market from public.billing_invoices where provider_invoice_id='in_early')<>'TR' then raise exception 'invoice market not stamped'; end if;

  -- Customer-link placeholders are not subscriptions and write no history.
  insert into public.subscriptions(user_id,provider,provider_customer_id,plan_code,status) values(u,'stripe','cus_money','free','inactive');
  if exists(select 1 from public.subscription_events where user_id=u) then raise exception 'placeholder wrote history'; end if;

  insert into public.subscriptions(user_id,provider,provider_customer_id,provider_subscription_id,plan_code,status,current_period_start,current_period_end,last_provider_event_id,last_provider_event_at)
    values(u,'stripe','cus_money','sub_money','weekly','trialing',now(),now()+interval '3 days','evt_1','2026-10-01T00:00:00Z') returning id into sub;
  if (select market from public.subscriptions where id=sub)<>'TR' then raise exception 'subscription market not stamped'; end if;
  if (select subscription_id from public.billing_invoices where provider_invoice_id='in_early')<>sub then raise exception 'early invoice not linked'; end if;
  if (select count(*) from public.subscription_events where subscription_id=sub and event_type in ('created','trial_started') and stripe_event_id='evt_1' and occurred_at='2026-10-01T00:00:00Z')<>2 then raise exception 'creation history missing'; end if;

  -- Usage is stamped with the plan in force.
  usage:=public.increment_usage_counters(u,null,0,1,0,0);
  if usage.plan_code<>'weekly' or usage.subscription_id<>sub then raise exception 'usage not plan-stamped'; end if;

  -- Cancel scheduled during the trial, then the trial converts after an un-cancel.
  update public.subscriptions set cancel_at_period_end=true,last_provider_event_id='evt_2' where id=sub;
  update public.subscriptions set cancel_at_period_end=false,last_provider_event_id='evt_3' where id=sub;
  update public.subscriptions set status='active',current_period_start=now()+interval '3 days',last_provider_event_id='evt_4' where id=sub;
  -- A replayed event with no change records nothing.
  update public.subscriptions set status='active',last_provider_event_id='evt_4' where id=sub;
  update public.subscriptions set current_period_start=now()+interval '10 days',last_provider_event_id='evt_5' where id=sub;
  update public.subscriptions set plan_code='annual',status='past_due',last_provider_event_id='evt_6' where id=sub;
  if (select string_agg(event_type,',' order by stripe_event_id,event_type) from public.subscription_events where subscription_id=sub and source='stripe')
    <>'created,trial_started,cancel_scheduled,cancel_unscheduled,trial_converted,renewed,past_due,plan_changed' then
    raise exception 'unexpected history: %',(select string_agg(event_type||':'||stripe_event_id,',' order by stripe_event_id,event_type) from public.subscription_events where subscription_id=sub);
  end if;

  -- Superseding by the app is recorded without a Stripe event id.
  insert into public.subscriptions(user_id,provider,provider_customer_id,provider_subscription_id,plan_code,status)
    values(u,'stripe','cus_money','sub_other','monthly','active') returning id into other;
  update public.subscriptions set status='inactive' where id=other;
  if not exists(select 1 from public.subscription_events where subscription_id=other and event_type='superseded' and source='app' and stripe_event_id is null) then raise exception 'supersede not recorded'; end if;

  -- Paywall hits: anonymous without consent, attributed with consent, skipped for internal accounts.
  perform public.record_entitlement_denial(u,'free','app_access','ai','subscription_inactive');
  perform public.record_entitlement_denial(u,'free','app_access','ai','subscription_inactive');
  insert into public.users(auth_user_id,email,analytics) values(gen_random_uuid(),'money-consent@example.invalid',true) returning id into consenting;
  perform public.record_entitlement_denial(consenting,'free','export_pdf',null,'no_subscription');
  insert into public.users(auth_user_id,email,is_internal) values(gen_random_uuid(),'money-internal@example.invalid',true) returning id into internal;
  perform public.record_entitlement_denial(internal,'free','export_pdf',null,'no_subscription');
  if (select count from public.entitlement_denials where user_id is null and action='app_access' and surface='ai' and day=today)<>2 then raise exception 'anonymous denials not counted'; end if;
  if (select count from public.entitlement_denials where user_id=consenting)<>1 then raise exception 'consented denial not attributed'; end if;
  if (select sum(count) from public.entitlement_denials)<>3 then raise exception 'internal denial counted'; end if;

  perform public.record_user_activity(u);
  perform public.record_user_activity(consenting);
  perform public.record_user_activity(consenting);
  if (select count(*) from public.user_activity_days)<>1 then raise exception 'activity recorded without consent or twice'; end if;
  -- Restricted processing stops attribution even with consent.
  update public.users set processing_restricted_at=now() where id=consenting;
  delete from public.user_activity_days where user_id=consenting;
  perform public.record_user_activity(consenting);
  perform public.record_entitlement_denial(consenting,'free','export_pdf',null,'no_subscription');
  if exists(select 1 from public.user_activity_days where user_id=consenting) or (select count from public.entitlement_denials where user_id=consenting)<>1 then raise exception 'restricted account tracked'; end if;
  update public.users set processing_restricted_at=null where id=consenting;

  -- Withdrawing consent removes attribution but keeps the totals.
  update public.users set analytics=false where id=consenting;
  if exists(select 1 from public.user_activity_days where user_id=consenting) or exists(select 1 from public.entitlement_denials where user_id=consenting) then raise exception 'consent withdrawal kept attribution'; end if;
  if (select sum(count) from public.entitlement_denials)<>3 then raise exception 'consent withdrawal lost totals'; end if;

  -- Erasure keeps anonymised history, counts the cohort once and is safe to repeat.
  update public.users set analytics=true where id=u;
  perform public.record_entitlement_denial(u,'free','export_pdf',null,'no_subscription');
  insert into public.checkout_attempts(user_id,plan_code,trial_requested,checkout_session_id,outcome) values(u,'weekly',true,'cs_money','completed');
  insert into public.trial_transition_cohorts(cohort,granted_at,cohort_size) values('release_2026_10_24',now(),10) on conflict(cohort) do nothing;
  insert into public.trial_transition_grants(user_id,redeemed_at) values(u,now()) on conflict(user_id) do update set redeemed_at=now();
  perform public.archive_billing_history(u);
  perform public.archive_billing_history(u);
  delete from public.users where id=u;
  if exists(select 1 from public.subscriptions where user_id=u) then raise exception 'subscriptions kept'; end if;
  if (select count(*) from public.subscription_events where subscription_id=sub and event_type='canceled' and source='account_deletion')<>1 then raise exception 'erasure cancel not recorded once'; end if;
  if exists(select 1 from public.subscription_events where subscription_id=sub and (user_id is not null or stripe_event_id is not null)) then raise exception 'events not anonymised'; end if;
  if exists(select 1 from public.billing_invoices where provider_invoice_id is not null or user_id is not null) or (select amount_total from public.billing_invoices where subscription_id=sub)<>29900 then raise exception 'invoice not anonymised'; end if;
  if exists(select 1 from public.checkout_attempts where checkout_session_id is not null or user_id is not null) then raise exception 'checkout attempt not anonymised'; end if;
  if (select sum(count) from public.subscription_erasure_stats)<>2 then raise exception 'erasure stats not counted once'; end if;
  if (select erased_count from public.trial_transition_cohorts where cohort='release_2026_10_24')<>1
    or (select erased_redeemed_count from public.trial_transition_cohorts where cohort='release_2026_10_24')<>1 then raise exception 'cohort erasure not counted once'; end if;
  if (select sum(count) from public.entitlement_denials)<>4 then raise exception 'erasure lost denial totals'; end if;

  -- Browser roles can neither read nor write any of the analysis tables.
  set local role authenticated;
  begin
    perform 1 from public.billing_invoices limit 1;
    raise exception 'browser read billing_invoices';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_entitlement_denial(consenting,'free','export_pdf',null,'no_subscription');
    raise exception 'browser recorded a denial';
  exception when insufficient_privilege then null;
  end;
end $$;
select 'Monetization history, invoices, paywall counts, consent split and erasure archiving passed' as verification;
rollback;
