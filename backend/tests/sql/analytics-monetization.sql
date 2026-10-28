-- Admin analytics Phase 3: Monetization metrics and drill keys (20261102120000_analytics_monetization.sql).
begin;
-- Fixture timestamps without a zone are UTC; the metrics themselves never depend on the session zone (checked below).
set local timezone = 'UTC';
do $$
declare
  violations text;
  today date := (now() at time zone 'UTC')::date;
  ua uuid; ub uuid; ud uuid; ue uuid; um uuid; uk uuid; ug uuid; uh uuid; uj uuid; ul uuid; ut uuid; up uuid; uf uuid;
  internal uuid; restricted uuid;
  sa uuid; sb uuid; sd uuid; se uuid; sm uuid; sk uuid; sg uuid; sp uuid; si uuid; st2 uuid;
  erased_sub uuid := gen_random_uuid();
  k record;
  got text;
  n bigint;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- ---------------------------------------------------------------------------
  -- Fixtures
  -- ---------------------------------------------------------------------------
  -- FX: January and February final, March month-to-date, April not loaded (falls back to March), nothing before 2026.
  insert into public.fx_rates(rate_month,base_currency,quote_currency,rate,sample_days,source,is_final) values
    ('2026-01-01','USD','TRY',30,20,'test',true),
    ('2026-02-01','USD','TRY',32,20,'test',true),
    ('2026-03-01','USD','TRY',40,10,'test',false);
  insert into public.billing_price_catalog(provider_price_id,plan_code,market,currency,unit_amount,billing_interval,interval_count,is_configured) values
    ('price_mon_g','monthly','GLOBAL','usd',1000,'month',1,true),
    ('price_mon_tr','monthly','TR','try',32000,'month',1,true),
    ('price_week_g','weekly','GLOBAL','usd',500,'week',1,true);

  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-a@example.invalid','2026-01-01') returning id into ua;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-b@example.invalid','2026-01-01') returning id into ub;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-d@example.invalid','2026-01-01') returning id into ud;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-e@example.invalid','2026-01-01') returning id into ue;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-m@example.invalid','2026-01-01') returning id into um;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-k@example.invalid','2026-01-01') returning id into uk;
  insert into public.users(auth_user_id,email,created_at,analytics) values(gen_random_uuid(),'mo-g@example.invalid','2026-01-01',true) returning id into ug;
  insert into public.users(auth_user_id,email,created_at,analytics) values(gen_random_uuid(),'mo-h@example.invalid','2026-01-01',true) returning id into uh;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-j@example.invalid','2026-01-01') returning id into uj;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-l@example.invalid','2026-01-01') returning id into ul;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-t@example.invalid','2026-01-01') returning id into ut;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-p@example.invalid','2025-09-01') returning id into up;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'mo-f@example.invalid','2025-06-01') returning id into uf;
  insert into public.users(auth_user_id,email,created_at,is_internal,analytics) values(gen_random_uuid(),'mo-admin@example.invalid','2026-01-01',true,true) returning id into internal;
  insert into public.users(auth_user_id,email,created_at,analytics) values(gen_random_uuid(),'mo-restricted@example.invalid','2026-01-01',true) returning id into restricted;
  -- ul and ut have no market lock (unknown).
  insert into public.billing_markets(user_id,market) values
    (ua,'GLOBAL'),(ub,'TR'),(ud,'GLOBAL'),(ue,'GLOBAL'),(um,'GLOBAL'),(uk,'GLOBAL'),(ug,'GLOBAL'),(uh,'GLOBAL'),(uj,'GLOBAL'),
    (up,'TR'),(uf,'TR'),(internal,'GLOBAL');

  -- Subscriptions (market is stamped from billing_markets by trigger).
  -- A: monthly from Jan 10, renewed on a higher 'pro' price in March, ended by a failed payment on Apr 13.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,ended_at,cancellation_reason,created_at)
    values(ua,'stripe','sub_mo_a','pro','canceled','2026-03-10','2026-04-10','usd','month',2500,'2026-04-13','payment_failed','2026-01-10') returning id into sa;
  -- B: TRY monthly after a Feb 12-15 trial; cancel scheduled on Apr 20 (still active).
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,trial_start,trial_end,cancel_at_period_end,canceled_at,cancellation_reason,cancellation_feedback,created_at)
    values(ub,'stripe','sub_mo_b','monthly','active','2026-04-15','2026-05-15','try','month',28000,'2026-02-12','2026-02-15',true,
           '2026-04-20','cancellation_requested','unused','2026-02-12') returning id into sb;
  -- D: paid in January, lapsed, came back in March, canceled (requested Apr 1, ended Apr 20).
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,canceled_at,ended_at,cancellation_reason,cancellation_feedback,created_at)
    values(ud,'stripe','sub_mo_d','monthly','canceled','2026-03-20','2026-04-20','usd','month',500,'2026-04-01','2026-04-20',
           'cancellation_requested','too_expensive','2026-01-02') returning id into sd;
  -- E: paid Mar 1, canceled Mar 15 (live event); no Stripe price detail -> list price fallback for lost MRR.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,ended_at,created_at)
    values(ue,'stripe','sub_mo_e','monthly','canceled','2026-03-01','2026-04-01','2026-03-15','2026-03-01') returning id into se;
  -- M: annual from Mar 20 (still paying).
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,created_at)
    values(um,'stripe','sub_mo_m','annual','active','2026-03-20','2027-03-20','usd','year',12000,'2026-03-20') returning id into sm;
  -- K: weekly trial Feb 3-6 converted by a paid plan-change invoice, then replaced by a new subscription on Feb 9.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,trial_start,trial_end,canceled_at,ended_at,created_at)
    values(uk,'stripe','sub_mo_k','weekly','canceled','2026-02-03','2026-02-10','usd','week',500,'2026-02-03','2026-02-06','2026-02-09','2026-02-10','2026-02-03')
    returning id into sk;
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,created_at)
    values(uk,'stripe','sub_mo_k2','monthly','active','2026-02-09','2026-03-09','usd','month',1000,'2026-02-09');
  -- G: trial Feb 25-28 whose first charge failed.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,trial_start,trial_end,created_at)
    values(ug,'stripe','sub_mo_g','monthly','past_due','2026-02-28','2026-03-28','usd','month','2026-02-25','2026-02-28','2026-02-25') returning id into sg;
  -- H: in trial right now.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,trial_start,trial_end,created_at)
    values(uh,'stripe','sub_mo_h','weekly','trialing',now() - interval '1 day',now() + interval '2 days','usd','week',
           now() - interval '1 day',now() + interval '2 days',now() - interval '1 day');
  -- J: trial ended Feb 13, active but no paid invoice (unresolved).
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,trial_start,trial_end,created_at)
    values(uj,'stripe','sub_mo_j','monthly','active','2026-02-13','2026-03-13','usd','month','2026-02-10','2026-02-13','2026-02-10');
  -- L: no Stripe detail at all: the weekly heuristic makes it a (canceled) trial.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,ended_at,created_at)
    values(ul,'stripe','sub_mo_l','weekly','canceled','2026-02-05','2026-02-07','2026-02-07','2026-02-05');
  -- T: a canceled trial, a superseded trial, then a monthly subscription replacing it (new checkout).
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,trial_start,trial_end,canceled_at,ended_at,cancellation_reason,created_at)
    values(ut,'stripe','sub_mo_t1','weekly','canceled','2026-02-20','2026-02-23','usd','week','2026-02-20','2026-02-23','2026-02-21','2026-02-23',
           'cancellation_requested','2026-02-20');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,trial_start,trial_end,created_at)
    values(ut,'stripe','sub_mo_t2','weekly','inactive','2026-02-24T12:00Z','2026-02-27T12:00Z','usd','week','2026-02-24T12:00Z','2026-02-27T12:00Z','2026-02-24T12:00Z')
    returning id into st2;
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,created_at)
    values(ut,'stripe','sub_mo_t3','monthly','active','2026-03-05','2026-04-05','usd','month',1000,'2026-03-05');
  -- P: TRY subscription that ended unpaid (no Stripe reason) on Mar 20; paid once in 2025.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,created_at,updated_at)
    values(up,'stripe','sub_mo_p','monthly','unpaid','2025-09-20','2025-10-20','try','month',30000,'2025-09-20','2026-03-20') returning id into sp;
  -- Internal: paid in February, ended Mar 5.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,
      currency,billing_interval,unit_amount,ended_at,cancellation_reason,created_at)
    values(internal,'stripe','sub_mo_i','monthly','canceled','2026-02-01','2026-03-01','usd','month',5000,'2026-03-05','cancellation_requested','2026-02-01')
    returning id into si;
  if (select updated_at from public.subscriptions where id = sp) <> '2026-03-20' then raise exception 'fixture updated_at overwritten'; end if;

  -- Invoices (minor units). amount_subtotal / amount_total default to the paid amount.
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_subtotal,amount_discount,amount_total,amount_paid,
      amount_refunded,billing_reason,plan_code,market,period_start,period_end,paid_at,created_at) values
    (ua,sa,'in_mo_a1','paid','usd',1000,0,1000,1000,0,'subscription_create','monthly','GLOBAL','2026-01-10','2026-02-10','2026-01-10T12:00Z','2026-01-10'),
    (ua,sa,'in_mo_a2','paid','usd',1000,0,1000,1000,0,'subscription_cycle','monthly','GLOBAL','2026-02-10','2026-03-10','2026-02-10T12:00Z','2026-02-10'),
    (ua,sa,'in_mo_a3','paid','usd',2500,0,2500,2500,0,'subscription_cycle','pro','GLOBAL','2026-03-10','2026-04-10','2026-03-10T12:00Z','2026-03-10'),
    -- B: $0 trial-start invoice, 320 TRY first charge, 280 TRY renewal (40 TRY discount, paid 2 days late), 280 TRY renewal paid after a past_due.
    (ub,sb,'in_mo_b0','paid','try',0,0,0,0,0,'subscription_create','monthly','TR','2026-02-12','2026-02-15','2026-02-12T12:00Z','2026-02-12'),
    (ub,sb,'in_mo_b1','paid','try',32000,0,32000,32000,0,'subscription_cycle','monthly','TR','2026-02-15','2026-03-15','2026-02-15T12:00Z','2026-02-15'),
    (ub,sb,'in_mo_b2','paid','try',32000,4000,28000,28000,0,'subscription_cycle','monthly','TR','2026-03-15','2026-04-15','2026-03-17T00:00Z','2026-03-15'),
    (ub,sb,'in_mo_b3','paid','try',28000,0,28000,28000,0,'subscription_cycle','monthly','TR','2026-04-15','2026-05-15','2026-04-16T12:00Z','2026-04-15'),
    (ud,sd,'in_mo_d1','paid','usd',500,0,500,500,0,'subscription_create','monthly','GLOBAL','2026-01-02','2026-02-02','2026-01-02T12:00Z','2026-01-02'),
    (ud,sd,'in_mo_d2','paid','usd',500,0,500,500,0,'subscription_cycle','monthly','GLOBAL','2026-03-20','2026-04-20','2026-03-20T12:00Z','2026-03-20'),
    -- A voided invoice: a failed collection, never revenue.
    (ud,sd,'in_mo_d3','void','usd',500,0,500,0,0,'subscription_cycle','monthly','GLOBAL','2026-03-03','2026-04-03',null,'2026-03-03'),
    (ue,se,'in_mo_e1','paid','usd',800,0,800,800,0,'subscription_create','monthly','GLOBAL','2026-03-01','2026-04-01','2026-03-01T12:00Z','2026-03-01'),
    (um,sm,'in_mo_m1','paid','usd',12000,0,12000,12000,0,'subscription_create','annual','GLOBAL','2026-03-20','2027-03-20','2026-03-20T12:00Z','2026-03-20'),
    -- K: $10 plan-change invoice during the trial, $4 refunded (no service period).
    (uk,sk,'in_mo_k1','partially_refunded','usd',1000,0,1000,1000,400,'subscription_update','weekly','GLOBAL',null,null,'2026-02-04T12:00Z','2026-02-04'),
    -- G: the first charge after the trial stayed open.
    (ug,sg,'in_mo_g1','open','usd',1000,0,1000,0,0,'subscription_cycle','monthly','GLOBAL','2026-02-28','2026-03-28',null,'2026-02-28'),
    (internal,si,'in_mo_i1','paid','usd',5000,0,5000,5000,0,'subscription_create','monthly','GLOBAL','2026-02-01','2026-03-01','2026-02-01T12:00Z','2026-02-01'),
    (up,sp,'in_mo_p1','paid','try',30000,0,30000,30000,0,'subscription_create','monthly','TR','2025-09-20','2025-10-20','2025-09-20T12:00Z','2025-09-20'),
    -- F: TRY in June 2025, before any FX rate.
    (uf,null,'in_mo_f1','paid','try',30000,0,30000,30000,0,'subscription_create','monthly','TR','2025-06-05','2025-07-05','2025-06-05T12:00Z','2025-06-05');
  -- An erased account's $20 invoice (user and market gone, subscription id kept).
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_subtotal,amount_total,amount_paid,billing_reason,plan_code,
      period_start,period_end,paid_at,created_at)
    values(null,erased_sub,null,'paid','usd',2000,2000,2000,'subscription_cycle','monthly','2026-01-05','2026-02-05','2026-01-05T12:00Z','2026-01-05');

  -- Live subscription events.
  insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,source,occurred_at) values
    (se,ue,'canceled','active','canceled','monthly','monthly','stripe','2026-03-15'),
    (sg,ug,'past_due','trialing','past_due','monthly','monthly','stripe','2026-02-28T01:00Z'),
    (sa,ua,'past_due','active','past_due','pro','pro','stripe','2026-04-10T01:00Z'),
    (sa,ua,'canceled','past_due','canceled','pro','pro','stripe','2026-04-13'),
    (sb,ub,'past_due','active','past_due','monthly','monthly','stripe','2026-04-15T06:00Z'),
    (gen_random_uuid(),uh,'plan_changed','active','active','weekly','monthly','stripe','2026-03-12'),
    (gen_random_uuid(),null,'canceled','active','canceled','weekly','weekly','account_deletion','2026-04-02');

  -- Checkout attempts (March), plus one open right now.
  insert into public.checkout_attempts(user_id,plan_code,market,currency,amount,trial_requested,trial_applied,outcome,created_at,resolved_at) values
    (ua,'Monthly','GLOBAL','usd',1000,false,false,'completed','2026-03-09T10:00Z','2026-03-09T10:05Z'),
    (ua,'monthly',null,null,null,false,false,'rejected_active','2026-03-09T11:00Z','2026-03-09T11:00Z'),
    (ug,'weekly','GLOBAL','usd',500,true,true,'expired','2026-03-03T10:00Z','2026-03-04T10:00Z'),
    (ug,'weekly','GLOBAL','usd',500,true,true,'canceled','2026-03-04T10:00Z','2026-03-04T10:10Z'),
    (uh,'monthly','GLOBAL','usd',1000,true,true,'open','2026-03-05T10:00Z',null),
    (ub,'monthly','TR','try',32000,true,true,'completed','2026-03-02T10:00Z','2026-03-02T10:03Z'),
    (null,'annual','GLOBAL','usd',12000,false,false,'completed','2026-03-06T10:00Z','2026-03-06T10:02Z'),
    (internal,'monthly','GLOBAL','usd',1000,false,false,'completed','2026-03-07T10:00Z','2026-03-07T10:01Z'),
    (uj,'monthly',null,null,null,false,false,'failed','2026-03-08T10:00Z','2026-03-08T10:00Z'),
    (uh,'monthly','GLOBAL','usd',1000,true,true,'open',now() - interval '1 hour',null);

  -- Paywall denials (March): consenting G and H, an anonymous row, a later-flagged internal row, a restricted user's row.
  insert into public.entitlement_denials(day,user_id,plan_code,action,surface,reason,count) values
    ('2026-03-02',ug,'free','app_access','ai','no_subscription',3),
    ('2026-03-02',ug,'free','export_pdf','','no_subscription',1),
    ('2026-03-03',ug,'free','app_access','exports','no_subscription',2),
    ('2026-03-03',uh,'weekly','ai_action','','trial_expired',1),
    ('2026-03-02',null,'free','app_access','ai','no_subscription',4),
    ('2026-03-02',internal,'free','app_access','ai','no_subscription',5),
    ('2026-03-03',restricted,'free','app_access','ai','no_subscription',7);
  update public.users set processing_restricted_at = now() where id = restricted;

  -- ---------------------------------------------------------------------------
  -- Shared views
  -- ---------------------------------------------------------------------------
  if (select count(*) from analytics_private.mrr_invoices) <> 14 then
    raise exception 'mrr_invoices count wrong: %', (select count(*) from analytics_private.mrr_invoices);
  end if;
  if (select round(mrr_amount, 2) || '/' || coverage_end from analytics_private.mrr_invoices where subscription_id = se) <> '8.00/2026-03-15 00:00:00+00' then
    raise exception 'event did not cut coverage';
  end if;
  select string_agg(trial_source || ':' || outcome, ',' order by t_start) into got
  from analytics_private.trial_outcomes where t_start < '2026-03-01';
  if got <> 'stripe:converted_plan_change,heuristic:trial_canceled,stripe:active_no_paid_invoice,stripe:converted,stripe:trial_canceled,stripe:superseded,stripe:failed_first_charge' then
    raise exception 'trial outcomes wrong: %', got;
  end if;

  -- ---------------------------------------------------------------------------
  -- mrr_movement
  -- ---------------------------------------------------------------------------
  -- Jan: A, C (erased), D new. Feb: B new (320 TRY = $10 at 32), C and D churn. Mar: A expands (pro), B contracts
  -- (280 TRY), D reactivates, M new; E's cancel event cuts it out of the snapshot. Apr: A (past_due) and D churn.
  select string_agg(concat_ws('/', bucket, new, expansion, contraction, churn, reactivation, fx_effect, starting_mrr, ending_mrr,
                              starting_customers, new_customers, reactivated_customers, churned_customers, ending_customers, fx_provisional::text), ' ' order by bucket) into got
  from analytics.mrr_movement('2026-01-01', '2026-04-30', 'month');
  if got <> '2026-01-01/35.00/0.00/0.00/0.00/0.00/0.00/0.00/35.00/0/3/0/0/3/false '
         || '2026-02-01/10.00/0.00/0.00/-25.00/0.00/0.00/35.00/20.00/3/1/0/2/2/false '
         || '2026-03-01/10.00/15.00/-1.00/0.00/5.00/-2.00/20.00/47.00/2/1/1/0/4/true '
         || '2026-04-01/0.00/0.00/0.00/-30.00/0.00/0.00/47.00/17.00/4/0/0/2/2/true' then
    raise exception 'mrr movement usd wrong: %', got;
  end if;
  -- The bridge adds up in every bucket.
  if exists (select 1 from analytics.mrr_movement('2026-01-01', '2026-04-30', 'month')
             where starting_mrr + new + expansion + contraction + churn + reactivation + fx_effect <> ending_mrr) then
    raise exception 'mrr bridge does not add up';
  end if;
  -- TRY: starting MRR at the previous month's rate, the rest at this month's; fx_effect closes the bridge.
  select string_agg(concat_ws('/', bucket, new, expansion, contraction, churn, reactivation, fx_effect, starting_mrr, ending_mrr), ' ' order by bucket) into got
  from analytics.mrr_movement('2026-02-01', '2026-03-31', 'month', 'try');
  if got <> '2026-02-01/320.00/0.00/0.00/-800.00/0.00/70.00/1050.00/640.00 2026-03-01/400.00/600.00/-40.00/0.00/200.00/80.00/640.00/1880.00' then
    raise exception 'mrr movement try wrong: %', got;
  end if;
  -- Native: one series per invoice currency, no FX effect.
  select string_agg(concat_ws('/', bucket, dimension, new, expansion, contraction, churn, reactivation, fx_effect, starting_mrr, ending_mrr, fx_provisional::text), ' ' order by bucket, dimension) into got
  from analytics.mrr_movement('2026-03-01', '2026-04-30', 'month', 'native');
  if got <> '2026-03-01/TRY/0.00/0.00/-40.00/0.00/0.00/0.00/320.00/280.00/false 2026-03-01/USD/10.00/15.00/0.00/0.00/5.00/0.00/10.00/40.00/false '
         || '2026-04-01/TRY/0.00/0.00/0.00/0.00/0.00/0.00/280.00/280.00/false 2026-04-01/USD/0.00/0.00/0.00/-30.00/0.00/0.00/40.00/10.00/false' then
    raise exception 'mrr movement native wrong: %', got;
  end if;
  -- Market breakdown; the erased customer has no market.
  select string_agg(concat_ws('/', dimension, new, churn, starting_mrr, ending_mrr), ' ' order by dimension) into got
  from analytics.mrr_movement('2026-02-01', '2026-02-28', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL/0.00/-5.00/15.00/10.00 TR/10.00/0.00/0.00/10.00 unknown/0.00/-20.00/20.00/0.00' then
    raise exception 'mrr movement market breakdown wrong: %', got;
  end if;
  -- Plan breakdown: A's switch to pro is churn on monthly and reactivation on pro.
  select string_agg(concat_ws('/', dimension, new, contraction, churn, reactivation, fx_effect, starting_mrr, ending_mrr), ' ' order by dimension) into got
  from analytics.mrr_movement('2026-03-01', '2026-03-31', 'month', p_breakdown => 'plan');
  if got <> 'annual/10.00/0.00/0.00/0.00/0.00/0.00/10.00 monthly/0.00/-1.00/-10.00/5.00/-2.00/20.00/12.00 pro/0.00/0.00/0.00/25.00/0.00/0.00/25.00' then
    raise exception 'mrr movement plan breakdown wrong: %', got;
  end if;
  select string_agg(concat_ws('/', contraction, fx_effect, starting_mrr, ending_mrr), ' ') into got
  from analytics.mrr_movement('2026-03-01', '2026-03-31', 'month', p_filters => '{"currency":"try"}');
  if got <> '-1.00/-2.00/10.00/7.00' then raise exception 'mrr movement currency filter wrong: %', got; end if;
  select string_agg(concat_ws('/', new, churn), ' ' order by bucket) into got
  from analytics.mrr_movement('2026-02-01', '2026-03-31', 'month', p_include_internal => true);
  if got <> '60.00/-25.00 10.00/-50.00' then raise exception 'mrr movement include_internal wrong: %', got; end if;
  -- Daily buckets: gap-filled, each move on its day. A lapsed period leaves MRR at period_end (the 3-day renewal grace
  -- only applies while the renewal can still arrive, i.e. around now).
  if (select count(*) from analytics.mrr_movement('2026-02-01', '2026-02-28')) <> 28
     or (select new from analytics.mrr_movement('2026-02-01', '2026-02-28') where bucket = '2026-02-15') <> 10
     or (select churn from analytics.mrr_movement('2026-02-01', '2026-02-28') where bucket = '2026-02-02') <> -5
     or (select churn from analytics.mrr_movement('2026-02-01', '2026-02-28') where bucket = '2026-02-05') <> -20
     or (select sum(churn) || '/' || sum(new) || '/' || sum(expansion) from analytics.mrr_movement('2026-02-01', '2026-02-28')) <> '-25.00/10.00/0.00' then
    raise exception 'daily mrr movement wrong';
  end if;
  -- A range starting mid-month clips the first snapshot to p_from.
  select string_agg(concat_ws('/', bucket, new, churn, starting_mrr, ending_mrr, starting_customers, ending_customers), ' ') into got
  from analytics.mrr_movement('2026-02-10', '2026-02-20', 'month');
  if got <> '2026-02-01/10.00/0.00/10.00/20.00/1/2' then raise exception 'clipped mrr movement wrong: %', got; end if;
  -- No FX rate at all: the converted bucket is null and provisional; native still works.
  select string_agg(coalesce(new::text, 'null') || '/' || fx_provisional, ' ') into got from analytics.mrr_movement('2025-06-01', '2025-06-30', 'month');
  if got <> 'null/true' then raise exception 'mrr movement missing rate wrong: %', got; end if;
  select string_agg(dimension || '=' || new, ' ' order by dimension) into got from analytics.mrr_movement('2025-06-01', '2025-06-30', 'month', 'native');
  if got <> 'TRY=300.00 USD=0.00' then raise exception 'mrr movement native without rate wrong: %', got; end if;
  -- Consistent with the Overview MRR snapshot.
  select * into k from analytics.kpi_overview('2026-03-01', '2026-03-31');
  if (k.mrr, k.active_subscriptions) <> (47.00, 4::bigint) then raise exception 'kpi mrr disagrees: % %', k.mrr, k.active_subscriptions; end if;
  -- Day grain is capped at 366 days.
  if (select count(*) from analytics.mrr_movement('2025-05-01', '2026-05-01')) <> 366 then raise exception '366-day day grain rejected'; end if;
  begin perform analytics.mrr_movement('2025-05-01', '2026-05-02'); raise exception 'day grain over a year accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from analytics.mrr_movement('2023-10-01', '2026-09-30', 'week')) <> 158 then raise exception 'weekly 3-year range wrong'; end if;
  begin perform analytics.mrr_movement(p_currency => 'native', p_breakdown => 'market'); raise exception 'native breakdown accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.mrr_movement(p_breakdown => 'ai_flow'); raise exception 'mrr_movement accepted ai_flow';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- trial_to_paid
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', trial_to_paid, trial_starts, converted, failed_first_charge, trial_canceled, superseded, in_trial,
                              unresolved, resolved, failed_charge_rate), ' ') into got
  from analytics.trial_to_paid('2026-02-01', '2026-02-28', 'month');
  if got <> '0.4000/7/2/1/2/1/0/1/5/0.2000' then raise exception 'trial_to_paid wrong: %', got; end if;
  -- Same numbers as the Overview trial KPIs.
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28');
  if (k.trial_starts, k.trial_resolved, k.trial_conversions) <> (7::bigint, 5::bigint, 2::bigint) then
    raise exception 'kpi trials disagree: % % %', k.trial_starts, k.trial_resolved, k.trial_conversions;
  end if;
  select string_agg(concat_ws('/', dimension, trial_starts, converted, resolved, coalesce(trial_to_paid::text, 'null')), ' ' order by dimension) into got
  from analytics.trial_to_paid('2026-02-01', '2026-02-28', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL/3/1/2/0.5000 TR/1/1/1/1.0000 unknown/3/0/2/0.0000' then raise exception 'trial_to_paid market wrong: %', got; end if;
  select string_agg(trial_starts || '/' || converted, ' ') into got
  from analytics.trial_to_paid('2026-02-01', '2026-02-28', 'month', p_filters => '{"plan":"weekly"}');
  if got <> '4/1' then raise exception 'trial_to_paid plan filter wrong: %', got; end if;
  -- Weekly buckets are cohorts by trial start, gap-filled.
  select string_agg(bucket || '=' || trial_starts, ' ' order by bucket) into got from analytics.trial_to_paid('2026-02-01', '2026-02-28', 'week');
  if got <> '2026-01-26=0 2026-02-02=2 2026-02-09=2 2026-02-16=1 2026-02-23=2' then raise exception 'trial_to_paid weeks wrong: %', got; end if;
  select string_agg(concat_ws('/', trial_starts, in_trial, coalesce(trial_to_paid::text, 'null')), ' ') into got
  from analytics.trial_to_paid(today - 3, today, 'month');
  if got <> '1/1/null' then raise exception 'in_trial wrong: %', got; end if;
  begin perform analytics.trial_to_paid(p_filters => '{"currency":"usd"}'); raise exception 'trial_to_paid accepted currency';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- checkout_funnel
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', step_order, step, users, coalesce(conversion_from_prev::text, '-'), conversion_from_start,
                              coalesce(dropped::text, '-'), coalesce(pending::text, '-')), ' ' order by step_order) into got
  from analytics.checkout_funnel('2026-03-01', '2026-03-31');
  if got <> '1/attempts/8/-/1.0000/-/- 2/session_created/6/0.7500/0.7500/2/- 3/completed/3/0.5000/0.3750/3/0 4/paid_within_7d/1/0.5000/0.1250/1/1' then
    raise exception 'checkout funnel wrong: %', got;
  end if;
  select string_agg(concat_ws('/', dimension, step_order, users), ' ' order by dimension, step_order) into got
  from analytics.checkout_funnel('2026-03-01', '2026-03-31', p_breakdown => 'market');
  if got <> 'GLOBAL/1/7 GLOBAL/2/5 GLOBAL/3/2 GLOBAL/4/1 TR/1/1 TR/2/1 TR/3/1 TR/4/0' then raise exception 'checkout funnel market wrong: %', got; end if;
  if (select users from analytics.checkout_funnel('2026-03-01', '2026-03-31', p_filters => '{"plan":"monthly"}') where step_order = 1) <> 5
     or (select users from analytics.checkout_funnel('2026-03-01', '2026-03-31', p_include_internal => true) where step_order = 3) <> 4 then
    raise exception 'checkout funnel filters wrong';
  end if;
  -- An open session younger than 24h is pending, not abandoned.
  select string_agg(concat_ws('/', step_order, users, coalesce(dropped::text, '-'), coalesce(pending::text, '-')), ' ' order by step_order) into got
  from analytics.checkout_funnel(today, today);
  if got <> '1/1/-/- 2/1/0/- 3/0/0/1 4/0/0/0' then raise exception 'checkout funnel pending wrong: %', got; end if;
  -- No attempts: the four steps with zeros.
  if (select count(*) from analytics.checkout_funnel('2026-01-01', '2026-01-31')) <> 4 then raise exception 'empty funnel not filled'; end if;

  -- ---------------------------------------------------------------------------
  -- subscriber_ltv
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', dimension, ltv, customers, coalesce(ltv_usd_native::text, '-'), coalesce(ltv_try_native::text, '-'), median_ltv,
                              revenue, revenue_usd_native, revenue_try_native, still_paying, censored_share, avg_paid_invoices, erased_customers, fx_provisional::text), ' ') into got
  from analytics.subscriber_ltv('2026-01-01', '2026-03-31');
  if got <> 'annual/120.00/1/120.00/-/120.00/120.00/120.00/0.00/1/1.0000/1.00/0/false '
         || 'monthly/21.40/5/20.75/880.00/20.00/107.00/83.00/880.00/0/0.0000/2.00/1/true '
         || 'weekly/6.00/1/6.00/-/6.00/6.00/6.00/0.00/0/0.0000/1.00/0/false' then
    raise exception 'subscriber_ltv wrong: %', got;
  end if;
  select string_agg(dimension || '=' || ltv, ' ') into got from analytics.subscriber_ltv('2026-01-01', '2026-03-31', p_currency => 'try', p_filters => '{"plan":"monthly"}');
  if got <> 'monthly=754.00' then raise exception 'subscriber_ltv try wrong: %', got; end if;
  select string_agg(dimension || '=' || ltv || '/' || customers, ' ') into got from analytics.subscriber_ltv('2026-01-01', '2026-03-31', p_breakdown => 'market');
  if got <> 'GLOBAL=37.80/5 TR=24.00/1 unknown=20.00/1' then raise exception 'subscriber_ltv market wrong: %', got; end if;
  -- Realised to date: January's cohort includes A's later invoices.
  select string_agg(dimension || '=' || ltv || '/' || customers, ' ') into got from analytics.subscriber_ltv('2026-01-01', '2026-01-31');
  if got <> 'monthly=25.00/3' then raise exception 'subscriber_ltv january wrong: %', got; end if;
  select string_agg(dimension || '=' || customers, ' ') into got from analytics.subscriber_ltv('2026-02-01', '2026-02-28', p_include_internal => true);
  if got <> 'monthly=2 weekly=1' then raise exception 'subscriber_ltv include_internal wrong: %', got; end if;
  select string_agg(dimension || '=' || coalesce(ltv::text, 'null') || '/' || coalesce(ltv_usd_native, ltv_try_native) || '/' || customers, ' ') into got
  from analytics.subscriber_ltv('2026-01-01', '2026-03-31', 'day', 'native', p_breakdown => 'currency');
  if got <> 'USD=null/34.83/6 TRY=null/880.00/1' then raise exception 'subscriber_ltv native wrong: %', got; end if;
  select string_agg(coalesce(ltv::text, 'null') || '/' || ltv_try_native || '/' || fx_provisional, ' ') into got from analytics.subscriber_ltv('2025-06-01', '2025-06-30');
  if got <> 'null/300.00/true' then raise exception 'subscriber_ltv missing rate wrong: %', got; end if;

  -- ---------------------------------------------------------------------------
  -- plan_mix
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', dimension, subscriptions, share, mrr, mrr_usd_native, mrr_try_native, switched_in, switched_out, fx_provisional::text), ' ') into got
  from analytics.plan_mix('2026-03-01', '2026-03-31');
  if got <> 'monthly/2/0.5000/12.00/5.00/280.00/2/1/true annual/1/0.2500/10.00/10.00/0.00/0/0/false '
         || 'pro/1/0.2500/25.00/25.00/0.00/1/0/false weekly/0/0.0000/0.00/0.00/0.00/0/2/false' then
    raise exception 'plan_mix wrong: %', got;
  end if;
  -- Sums to the Overview's active subscriptions at the same snapshot.
  if (select sum(subscriptions) from analytics.plan_mix('2026-03-01', '2026-03-31'))
     <> (select active_subscriptions from analytics.kpi_overview('2026-03-01', '2026-03-31')) then
    raise exception 'plan_mix disagrees with kpi active_subscriptions';
  end if;
  select string_agg(dimension || '=' || coalesce(mrr::text, 'null') || '/' || subscriptions, ' ') into got
  from analytics.plan_mix('2026-03-01', '2026-03-31', p_currency => 'native', p_filters => '{"market":"TR"}');
  if got <> 'monthly=null/1' then raise exception 'plan_mix market filter wrong: %', got; end if;
  select string_agg(dimension || '=' || mrr, ' ') into got from analytics.plan_mix('2026-03-01', '2026-03-31', p_currency => 'try');
  if got <> 'monthly=480.00 annual=400.00 pro=1000.00 weekly=0.00' then raise exception 'plan_mix try wrong: %', got; end if;
  begin perform analytics.plan_mix(p_breakdown => 'market'); raise exception 'plan_mix accepted market breakdown';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- subscription_churn
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', bucket, paid_churn, paid_voluntary, paid_involuntary, paid_other_or_unknown, ended_never_paid, replaced_excluded,
                              cancel_scheduled_open, lost_to_erasure, lost_mrr, lost_mrr_usd_native, lost_mrr_try_native,
                              coalesce(involuntary_share::text, '-'), fx_provisional::text), ' ' order by bucket) into got
  from analytics.subscription_churn('2026-02-01', '2026-04-30', 'month');
  if got <> '2026-02-01/0/0/0/0/2/1/0/0/0.00/0.00/0.00/-/false '
         || '2026-03-01/2/0/1/1/0/0/0/0/17.50/10.00/300.00/0.5000/true '
         || '2026-04-01/2/1/1/0/0/0/1/1/30.00/30.00/0.00/0.5000/false' then
    raise exception 'subscription_churn wrong: %', got;
  end if;
  select string_agg(coalesce(lost_mrr::text, 'null'), ' ' order by bucket) into got from analytics.subscription_churn('2026-03-01', '2026-04-30', 'month', 'try');
  if got <> '700.00 1200.00' then raise exception 'subscription_churn try wrong: %', got; end if;
  if (select lost_mrr from analytics.subscription_churn('2026-03-01', '2026-03-31', 'month', 'native')) is not null
     or (select paid_churn from analytics.subscription_churn('2026-03-01', '2026-03-31', 'month', p_include_internal => true)) <> 3 then
    raise exception 'subscription_churn native / internal wrong';
  end if;
  select string_agg(concat_ws('/', dimension, paid_churn, lost_to_erasure), ' ' order by dimension) into got
  from analytics.subscription_churn('2026-04-01', '2026-04-30', 'month', p_breakdown => 'plan');
  if got <> 'monthly/1/0 pro/1/0 weekly/0/1' then raise exception 'subscription_churn plan breakdown wrong: %', got; end if;
  select string_agg(concat_ws('/', dimension, paid_churn, lost_to_erasure), ' ' order by dimension) into got
  from analytics.subscription_churn('2026-04-01', '2026-04-30', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL/2/0 TR/0/0 unknown/0/1' then raise exception 'subscription_churn market breakdown wrong: %', got; end if;
  if (select count(*) from analytics.subscription_churn('2026-04-01', '2026-04-30')) <> 30 then raise exception 'subscription_churn not gap-filled'; end if;

  -- ---------------------------------------------------------------------------
  -- payment_issues
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', bucket, failed_invoices, invoices_due, coalesce(failure_rate::text, '-'), paid_late_invoices, failed_amount,
                              failed_amount_usd_native, past_due_episodes, recovered_episodes, lost_episodes, refunded_invoices, refunded,
                              refunded_usd_native, coalesce(refund_rate::text, '-'), discounted_invoices, discount, discount_try_native,
                              coalesce(effective_discount_rate::text, '-'), fx_provisional::text), ' ' order by bucket) into got
  from analytics.payment_issues('2026-02-01', '2026-04-30', 'month');
  if got <> '2026-02-01/1/4/0.2500/0/10.00/10.00/1/0/0/1/4.00/4.00/0.1333/0/0.00/0.00/0.0000/false '
         || '2026-03-01/1/6/0.1667/1/5.00/5.00/0/0/0/0/0.00/0.00/0.0000/1/1.00/40.00/0.0060/true '
         || '2026-04-01/0/1/0.0000/1/0.00/0.00/2/1/1/0/0.00/0.00/0.0000/0/0.00/0.00/0.0000/false' then
    raise exception 'payment_issues wrong: %', got;
  end if;
  -- A refunded invoice without a billing_reason still counts (only legacy one-time purchases are untracked).
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_subtotal,amount_total,amount_paid,amount_refunded,
      billing_reason,plan_code,paid_at,created_at)
  values(null,null,null,'partially_refunded','usd',500,500,500,100,null,'monthly','2026-05-10T12:00Z','2026-05-10');
  if (select refunded_invoices || '/' || refunded || '/' || refund_rate from analytics.payment_issues('2026-05-01', '2026-05-31', 'month')) <> '1/1.00/0.2000' then
    raise exception 'null billing_reason refund dropped';
  end if;
  select string_agg(concat_ws('/', failed_amount, refunded, discount, fx_provisional::text), ' ' order by bucket) into got
  from analytics.payment_issues('2026-02-01', '2026-03-31', 'month', 'try');
  if got <> '320.00/128.00/0.00/false 200.00/0.00/40.00/true' then raise exception 'payment_issues try wrong: %', got; end if;
  select string_agg(concat_ws('/', dimension, past_due_episodes, recovered_episodes, lost_episodes), ' ' order by dimension) into got
  from analytics.payment_issues('2026-04-01', '2026-04-30', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL/1/0/1 TR/1/1/0' then raise exception 'payment_issues market wrong: %', got; end if;
  select string_agg(concat_ws('/', invoices_due, paid_late_invoices, discounted_invoices, coalesce(failed_amount::text, 'null')), ' ') into got
  from analytics.payment_issues('2026-03-01', '2026-03-31', 'month', 'native', p_filters => '{"currency":["TRY"]}');
  if got <> '1/1/1/null' then raise exception 'payment_issues currency filter wrong: %', got; end if;
  if (select failed_invoices || '/' || invoices_due from analytics.payment_issues('2026-02-01', '2026-02-28', 'month', p_include_internal => true)) <> '1/5' then
    raise exception 'payment_issues include_internal wrong';
  end if;

  -- ---------------------------------------------------------------------------
  -- cancellation_reasons
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', dimension, cancellations, share, reason_group_share, paid_cancellations, trial_or_unpaid_cancellations), ' | ') into got
  from analytics.cancellation_reasons('2026-01-01', '2026-04-30');
  if got <> 'unknown / (null) / (none)/2/0.3333/0.3333/1/1 | involuntary / payment_failed / (none)/1/0.1667/0.1667/1/0 | '
         || 'voluntary / cancellation_requested / (none)/1/0.1667/0.5000/0/1 | voluntary / cancellation_requested / too_expensive/1/0.1667/0.5000/1/0 | '
         || 'voluntary / cancellation_requested / unused/1/0.1667/0.5000/1/0' then
    raise exception 'cancellation_reasons wrong: %', got;
  end if;
  if (select sum(cancellations) from analytics.cancellation_reasons('2026-01-01', '2026-04-30', p_include_internal => true)) <> 7
     or (select sum(cancellations) from analytics.cancellation_reasons('2026-01-01', '2026-04-30', p_filters => '{"plan":"weekly"}')) <> 2
     or (select string_agg(cancellation_feedback, ',') from analytics.cancellation_reasons('2026-04-01', '2026-04-30', p_filters => '{"market":"TR"}')) <> 'unused' then
    raise exception 'cancellation_reasons filters wrong';
  end if;
  begin perform analytics.cancellation_reasons(p_breakdown => 'plan'); raise exception 'cancellation_reasons accepted a breakdown';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- paywall_denials
  -- ---------------------------------------------------------------------------
  select string_agg(concat_ws('/', user_days, users, hits, hits_consenting, hits_anonymous, anonymous_share), ' ') into got
  from analytics.paywall_denials('2026-03-01', '2026-03-31', 'month');
  if got <> '3/2/11/7/4/0.3636' then raise exception 'paywall_denials wrong: %', got; end if;
  select string_agg(concat_ws('/', user_days, users, hits, hits_anonymous, anonymous_share), ' ') into got
  from analytics.paywall_denials('2026-03-02', '2026-03-02');
  if got <> '1/1/8/4/0.5000' then raise exception 'paywall_denials day wrong: %', got; end if;
  select string_agg(concat_ws('/', user_days, users, hits), ' ') into got
  from analytics.paywall_denials('2026-03-01', '2026-03-31', 'month', p_include_internal => true);
  if got <> '4/3/16' then raise exception 'paywall_denials include_internal wrong: %', got; end if;
  select string_agg(dimension || '=' || hits || '/' || users, ' ' order by dimension) into got
  from analytics.paywall_denials('2026-03-01', '2026-03-31', 'month', p_breakdown => 'plan');
  if got <> 'free=10/1 weekly=1/1' then raise exception 'paywall_denials plan wrong: %', got; end if;
  if (select hits || '/' || anonymous_share from analytics.paywall_denials('2026-03-01', '2026-03-31', 'month', p_filters => '{"market":"GLOBAL"}')) <> '7/0.0000'
     or (select count(*) from analytics.paywall_denials('2026-03-01', '2026-03-31')) <> 31 then
    raise exception 'paywall_denials filter / gap fill wrong';
  end if;

  -- ---------------------------------------------------------------------------
  -- Drill keys through analytics_people.drill_users
  -- ---------------------------------------------------------------------------
  -- drill_users only runs after an audit row in the same transaction.
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}', null);
  select string_agg(email || '=' || value || ':' || (detail ->> 'outcome'), ',' order by email) into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-28', p_filters => '{"metric":"trial_conversions"}');
  if got <> 'mo-b@example.invalid=1:converted,mo-g@example.invalid=1:failed_first_charge,mo-j@example.invalid=1:unresolved,'
         || 'mo-k@example.invalid=1:converted,mo-l@example.invalid=1:trial_canceled,mo-t@example.invalid=2:superseded' then
    raise exception 'trial_conversions drill wrong: %', got;
  end if;
  select string_agg(email, ',' order by email) into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-28', p_filters => '{"metric":"trial_conversions","outcome":"converted","market":"GLOBAL"}');
  if got <> 'mo-k@example.invalid' then raise exception 'trial_conversions drill filters wrong: %', got; end if;
  select string_agg(email || '=' || value || ':' || (detail ->> 'last_outcome') || ':' || (detail ->> 'subscribed_now'), ',') into got
  from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"checkout_abandoned"}');
  if got <> 'mo-h@example.invalid=1:open:true,mo-g@example.invalid=2:canceled:false' then raise exception 'checkout_abandoned drill wrong: %', got; end if;
  -- Funnel drill: the UI sends the clicked step (and the breakdown value).
  select string_agg(email || '=' || value, ',' order by email) into got
  from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"checkout_funnel"}');
  if got <> 'mo-a@example.invalid=2,mo-b@example.invalid=1,mo-g@example.invalid=2,mo-h@example.invalid=1,mo-j@example.invalid=1' then
    raise exception 'checkout_funnel drill wrong: %', got;
  end if;
  if (select string_agg(email, ',') from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31',
        p_filters => '{"metric":"checkout_funnel","step":"paid_within_7d"}')) <> 'mo-a@example.invalid'
     or (select string_agg(email, ',') from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31',
        p_filters => '{"metric":"checkout_funnel","step":"completed","market":"TR"}')) <> 'mo-b@example.invalid'
     or (select string_agg(email, ',' order by email) from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31',
        p_filters => '{"metric":"checkout_funnel","step":"session_created","plan":"monthly"}')) <> 'mo-a@example.invalid,mo-b@example.invalid,mo-h@example.invalid' then
    raise exception 'checkout_funnel drill steps wrong';
  end if;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"checkout_funnel","step":"bogus"}'); raise exception 'drill accepted a bogus step';
  exception when invalid_parameter_value then null; end;
  -- Timeseries drill: a clicked day plus the breakdown value.
  if (select string_agg(email, ',') from analytics_people.drill_users(p_filters => '{"metric":"trial_conversions","day":"2026-02-15","market":"TR"}')) is not null
     or (select string_agg(email, ',') from analytics_people.drill_users(p_filters => '{"metric":"trial_conversions","day":"2026-02-12","market":"TR"}')) <> 'mo-b@example.invalid' then
    raise exception 'trial_conversions day drill wrong';
  end if;
  select string_agg(email || '=' || (detail ->> 'reason_group') || ':' || (detail ->> 'lost_mrr_native'), ',') into got
  from analytics_people.drill_users(p_from => '2026-04-01', p_to => '2026-04-30', p_filters => '{"metric":"churned_subscribers"}');
  if got <> 'mo-d@example.invalid=voluntary:5.00,mo-a@example.invalid=involuntary:25.00' then raise exception 'churned_subscribers drill wrong: %', got; end if;
  select string_agg(email, ',') into got
  from analytics_people.drill_users(p_from => '2026-04-01', p_to => '2026-04-30', p_filters => '{"metric":"churned_subscribers","reason_group":"involuntary"}');
  if got <> 'mo-a@example.invalid' then raise exception 'churned_subscribers drill filter wrong: %', got; end if;
  -- Internal and restricted accounts are dropped by drill_users unless include_internal (restricted always).
  select string_agg(email || '=' || value, ',') into got
  from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"paywall_denials"}');
  if got <> 'mo-g@example.invalid=6,mo-h@example.invalid=1' then raise exception 'paywall_denials drill wrong: %', got; end if;
  if (select count(*) from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31',
                                                         p_filters => '{"metric":"paywall_denials","include_internal":true}')) <> 3 then
    raise exception 'paywall_denials drill include_internal wrong';
  end if;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"trial_conversions","ai_flow":"x"}'); raise exception 'drill accepted a foreign filter';
  exception when invalid_parameter_value then null; end;
  if not (select meta -> 'drill_metrics' ?& array['trial_conversions', 'checkout_funnel', 'checkout_abandoned', 'churned_subscribers', 'paywall_denials']
          from admin_app.metric_catalog() where name = 'drill_users') then
    raise exception 'drill keys not published in drill_users meta';
  end if;

  -- ---------------------------------------------------------------------------
  -- Catalog metadata: every numeric output column has a measure; display keys as documented.
  -- ---------------------------------------------------------------------------
  select string_agg(p.proname || '.' || a.name, ', ') into got
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  cross join lateral unnest(p.proargnames, p.proallargtypes::regtype[], p.proargmodes) a(name, typ, mode)
  where ns.nspname = 'analytics'
    and p.proname in ('mrr_movement', 'trial_to_paid', 'checkout_funnel', 'subscriber_ltv', 'plan_mix', 'subscription_churn',
                      'payment_issues', 'cancellation_reasons', 'paywall_denials')
    and a.mode = 't' and a.typ in ('numeric'::regtype, 'bigint'::regtype)
    and not ((analytics_private.try_jsonb(obj_description(p.oid, 'pg_proc')) -> 'measures') ? a.name);
  if got is not null then raise exception 'measures missing: %', got; end if;
  if (select meta -> 'plot' from admin_app.metric_catalog() where name = 'mrr_movement') <> '["new","expansion","contraction","churn","reactivation"]'::jsonb
     or (select (meta ->> 'stacked')::boolean from admin_app.metric_catalog() where name = 'mrr_movement') is not true
     or (select meta ->> 'breakdown_dimension' from admin_app.metric_catalog() where name = 'plan_mix') <> 'plan'
     or (select meta ->> 'breakdown_dimension' from admin_app.metric_catalog() where name = 'subscriber_ltv') <> 'plan'
     or (select (meta ->> 'consent_scoped')::boolean from admin_app.metric_catalog() where name = 'paywall_denials') is not true
     or (select count(*) from admin_app.metric_catalog() where (meta ->> 'drill')::boolean
           and name in ('trial_to_paid', 'checkout_funnel', 'subscription_churn', 'paywall_denials')) <> 4
     or (select meta ->> 'shape' from admin_app.metric_catalog() where name = 'checkout_funnel') <> 'funnel' then
    raise exception 'catalog display keys wrong';
  end if;

  -- analytics_api reaches the metrics only through the functions.
  set local role analytics_api;
  if (select ending_mrr from analytics.mrr_movement('2026-03-01', '2026-03-31', 'month')) <> 47 then raise exception 'analytics_api cannot read mrr_movement'; end if;
  begin perform 1 from analytics_private.mrr_invoices; raise exception 'analytics_api read a private view';
  exception when insufficient_privilege then null; end;
  begin perform analytics_private.drill_trial_conversions('2026-01-01', '2026-01-31', '{}', 10, null); raise exception 'analytics_api ran a drill key directly';
  exception when insufficient_privilege then null; end;
  reset role;

  -- The session time zone does not change any bucket.
  set local timezone = 'Asia/Tokyo';
  select string_agg(concat_ws('/', bucket, new, churn, ending_mrr), ' ' order by bucket) into got
  from analytics.mrr_movement('2026-01-01', '2026-04-30', 'month');
  if got <> '2026-01-01/35.00/0.00/35.00 2026-02-01/10.00/-25.00/20.00 2026-03-01/10.00/0.00/47.00 2026-04-01/0.00/-30.00/17.00'
     or (select churn from analytics.mrr_movement('2026-02-01', '2026-02-28') where bucket = '2026-02-05') <> -20
     or (select string_agg(trial_starts::text, ' ' order by bucket) from analytics.trial_to_paid('2026-02-01', '2026-02-28', 'week')) <> '0 2 2 1 2' then
    raise exception 'results depend on the session time zone: %', got;
  end if;
  set local timezone = 'UTC';

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics monetization metrics, currency variants, drill keys and privileges passed' as verification;
rollback;
