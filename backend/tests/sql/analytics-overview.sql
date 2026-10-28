begin;
do $$
declare
  violations text;
  usd_user uuid; try_user uuid; trial_user uuid; internal uuid; restricted uuid; recent_user uuid;
  today date := (now() at time zone 'UTC')::date;
  usd_sub uuid; try_sub uuid; cv uuid; f uuid; g uuid := gen_random_uuid(); lease uuid := gen_random_uuid();
  run_a uuid := gen_random_uuid(); guest_run uuid := gen_random_uuid();
  k record;
  got text;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- FX: January and February are final; March is month-to-date; April is not loaded (falls back to March);
  -- May is final and June is not loaded (falls back to May: final, but from an earlier month = provisional).
  -- Nothing exists before January 2026.
  insert into public.fx_rates(rate_month,base_currency,quote_currency,rate,sample_days,source,is_final) values
    ('2026-01-01','USD','TRY',30,20,'test',true),
    ('2026-02-01','USD','TRY',32,20,'test',true),
    ('2026-03-01','USD','TRY',40,10,'test',false),
    ('2026-05-01','USD','TRY',45,20,'test',true);

  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ov-usd@example.invalid','2026-02-01T09:00:00Z') returning id into usd_user;
  insert into public.billing_markets(user_id,market) values(usd_user,'GLOBAL');
  insert into public.users(auth_user_id,email,locale,created_at) values(gen_random_uuid(),'ov-try@example.invalid','tr','2026-02-02T09:00:00Z') returning id into try_user;
  insert into public.billing_markets(user_id,market) values(try_user,'TR');
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ov-trial@example.invalid','2026-02-03T09:00:00Z') returning id into trial_user;
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'ov-admin@example.invalid','2026-02-01T10:00:00Z',true) returning id into internal;
  insert into public.users(auth_user_id,email,created_at,processing_restricted_at) values(gen_random_uuid(),'ov-restricted@example.invalid','2026-02-04T10:00:00Z',now()) returning id into restricted;

  -- Activation: the USD user exports within 7 days, the TRY user only after 18 days.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(usd_user,'CV','en','{"language":"en"}','scratch') returning id into cv;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(usd_user,'export_pdf','exports','users/'||usd_user||'/master-cvs/'||cv||'/exports/a.pdf','a.pdf','application/pdf',10) returning id into f;
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at)
    values(usd_user,cv,f,'pdf','completed','2026-02-03T10:00:00Z','2026-02-03T10:01:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(try_user,'CV','en','{"language":"en"}','scratch') returning id into cv;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(try_user,'export_pdf','exports','users/'||try_user||'/master-cvs/'||cv||'/exports/b.pdf','b.pdf','application/pdf',10) returning id into f;
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at)
    values(try_user,cv,f,'pdf','completed','2026-02-20T10:00:00Z','2026-02-20T10:01:00Z');
  -- A signup two days ago who already exported: activated, but not yet eligible for the rate.
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ov-recent@example.invalid',now() - interval '2 days') returning id into recent_user;
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(recent_user,'CV','en','{"language":"en"}','scratch') returning id into cv;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(recent_user,'export_pdf','exports','users/'||recent_user||'/master-cvs/'||cv||'/exports/c.pdf','c.pdf','application/pdf',10) returning id into f;
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at)
    values(recent_user,cv,f,'pdf','completed',now() - interval '1 day',now() - interval '1 day');

  -- Subscriptions: USD paid directly, TRY converted after a trial, a canceled trial, an internal trial.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,created_at)
    values(usd_user,'stripe','sub_ov_usd','monthly','active','2026-02-10','2026-03-10','usd','month','2026-02-10') returning id into usd_sub;
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,trial_start,trial_end,created_at)
    values(try_user,'stripe','sub_ov_try','monthly','active','2026-02-15','2026-03-15','try','month','2026-02-12','2026-02-15','2026-02-12') returning id into try_sub;
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,trial_start,trial_end,created_at)
    values(trial_user,'stripe','sub_ov_trial','weekly','canceled','2026-02-20','2026-02-23','usd','week','2026-02-20','2026-02-23','2026-02-20');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,trial_start,trial_end,created_at)
    values(internal,'stripe','sub_ov_admin','weekly','canceled','2026-02-21','2026-02-24','usd','week','2026-02-21','2026-02-24','2026-02-21');
  -- A trial superseded by the app: started, but not resolved.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,trial_start,trial_end,created_at)
    values(trial_user,'stripe','sub_ov_trial2','weekly','inactive','2026-02-24','2026-02-27','usd','week','2026-02-24','2026-02-27','2026-02-24');

  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_paid,amount_refunded,billing_reason,plan_code,market,period_start,period_end,paid_at,created_at) values
    -- $10 monthly renewal.
    (usd_user,usd_sub,'in_ov_1','paid','usd',1000,0,'subscription_cycle','monthly','GLOBAL','2026-02-10','2026-03-10','2026-02-10T12:00:00Z','2026-02-10'),
    -- 320 TRY first charge after the trial, 32 TRY refunded -> 288 TRY = $9 at 32.
    (try_user,try_sub,'in_ov_2','partially_refunded','try',32000,3200,'subscription_cycle','monthly','TR','2026-02-15','2026-03-15','2026-02-15T12:00:00Z','2026-02-15'),
    -- $0 trial-start invoice: not revenue.
    (try_user,try_sub,'in_ov_3','paid','try',0,0,'subscription_create','monthly','TR','2026-02-12','2026-02-15','2026-02-12T12:00:00Z','2026-02-12'),
    -- Internal account.
    (internal,null,'in_ov_4','paid','usd',5000,0,'subscription_cycle','monthly','GLOBAL','2026-02-20','2026-03-20','2026-02-20T12:00:00Z','2026-02-20'),
    -- 400 TRY in April: no April rate, so March's provisional 40 is used -> $10.
    (try_user,try_sub,'in_ov_6','paid','try',40000,0,'subscription_cycle','monthly','TR','2026-04-05','2026-05-05','2026-04-05T12:00:00Z','2026-04-05'),
    -- 450 TRY in June: falls back to May's final 45 -> $10, provisional because the rate is from an earlier month.
    (try_user,try_sub,'in_ov_8','paid','try',45000,0,'subscription_cycle','monthly','TR','2026-06-10','2026-07-10','2026-06-10T12:00:00Z','2026-06-10'),
    -- Unpaid invoice.
    (usd_user,usd_sub,'in_ov_7','open','usd',0,0,'subscription_cycle','monthly','GLOBAL','2026-03-10','2026-04-10',null,'2026-03-10');
  -- An erased account's anonymised $20 invoice (user and provider ids cleared, subscription id kept).
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_paid,billing_reason,plan_code,period_start,period_end,paid_at,created_at)
    values(null,gen_random_uuid(),null,'paid','usd',2000,'subscription_cycle','monthly','2026-02-25','2026-03-25','2026-02-25T12:00:00Z','2026-02-25');
  -- A fully refunded $15 subscription: a paying customer with 0 revenue and 0 MRR, so not an active subscription.
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_paid,amount_refunded,billing_reason,plan_code,period_start,period_end,paid_at,created_at)
    values(null,gen_random_uuid(),null,'refunded','usd',1500,1500,'subscription_cycle','monthly','2026-02-20','2026-03-20','2026-02-20T13:00:00Z','2026-02-20');

  -- AI: prices per 1M tokens; the longest prefix must win over 'gpt-6'.
  insert into public.ai_model_prices(model_prefix,input_usd,cached_input_usd,output_usd) values('gpt-6',1,null,2),('gpt-6-luna',0.1,0.01,0.5);
  insert into public.ai_runs(id,user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,cached_input_tokens,output_tokens,total_tokens) values
    -- Estimated: (500k * 0.1 + 500k * 0.01 + 1M * 0.5) / 1M = 0.555
    (run_a,usd_user,'block_suggest','openai','gpt-6-luna-2026-09-01','completed','{}','2026-02-05T10:00:00Z','2026-02-05T10:01:00Z',1000000,500000,1000000,2000000);
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (usd_user,'tailoring_analysis','openai','gpt-6-luna','completed','{}','2026-02-06T10:00:00Z','2026-02-06T10:01:00Z',10,10,20,0.25),            -- exact
    (try_user,'cv_parse','gemini','gemini-3-flash','completed','{}','2026-02-06T11:00:00Z','2026-02-06T11:01:00Z',1000,10,1010,null),               -- unpriced
    (try_user,'block_suggest','openai','gpt-6-mini','completed','{}','2026-02-07T11:00:00Z','2026-02-07T11:01:00Z',1000000,0,1000000,null),         -- 'gpt-6' -> 1.0
    (try_user,'block_suggest','mock','gpt-6-luna','completed','{}','2026-02-07T12:00:00Z','2026-02-07T12:01:00Z',1000000,0,1000000,9),              -- mock: never counted
    (internal,'block_suggest','openai','gpt-6-luna','completed','{}','2026-02-07T13:00:00Z','2026-02-07T13:01:00Z',10,10,20,1),                     -- internal
    (usd_user,'block_suggest','openai','gpt-6-luna','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:01:00Z',10,10,20,0.5),                   -- March: month-to-date rate
    (usd_user,'block_suggest','openai','gpt-6-luna','completed','{}','2025-12-05T10:00:00Z','2025-12-05T10:01:00Z',10,10,20,0.5);                   -- no rate at all
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,
    ai_processing,ai_provider,ai_notice_version,lease_id,lease_expires_at)
  values(g,'overview-test','cv.pdf','application/pdf',20,'guests/overview-test/'||g,'parsed','{"version":"v1","language":"en","sections":[]}',
    true,'openai','test-notice',lease,now()+interval '5 minutes');
  insert into public.ai_runs(id,user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload,started_at,input_tokens,output_tokens,total_tokens,cost_usd)
    values(guest_run,null,g,lease,'cv_parse','openai','gpt-6-luna','pending','{}','2026-02-08T10:00:00Z',10,10,20,5);

  -- Shared views.
  if (select round(cost_usd, 6) from analytics_private.run_cost where id = run_a) <> 0.555
     or (select cost_is_exact from analytics_private.run_cost where id = run_a) then
    raise exception 'longest-prefix estimate wrong: %', (select cost_usd from analytics_private.run_cost where id = run_a);
  end if;
  if not (select is_guest from analytics_private.run_cost where id = guest_run) then raise exception 'guest run not flagged'; end if;
  if exists (select 1 from analytics_private.run_cost where provider = 'mock') then raise exception 'mock run in run_cost'; end if;
  if (select count(*) from analytics_private.invoice_revenue where user_id is null and not is_internal_user) <> 2 then
    raise exception 'erased invoice missing or internal';
  end if;
  if (select usd_try || '/' || fx_is_final || '/' || fx_is_provisional || '/' || round(revenue_usd, 2) from analytics_private.invoice_revenue where paid_at = '2026-04-05T12:00:00Z')
     <> '40.00000000/false/true/10.00' then
    raise exception 'FX fallback wrong: %', (select usd_try || '/' || fx_is_final || '/' || revenue_usd from analytics_private.invoice_revenue where paid_at = '2026-04-05T12:00:00Z');
  end if;
  if (select fx_rate_month || '/' || fx_is_final || '/' || fx_is_provisional from analytics_private.invoice_revenue where paid_at = '2026-06-10T12:00:00Z')
     <> '2026-05-01/true/true' then
    raise exception 'fallback to a final earlier month not provisional';
  end if;
  if (select bool_or(fx_is_provisional) from analytics_private.invoice_revenue where paid_at >= '2026-02-01' and paid_at < '2026-03-01') then
    raise exception 'same-month final rate marked provisional';
  end if;
  -- Empty filter arrays match nothing, for every key.
  if analytics_private.filter_values('{"plan":[]}', 'plan') <> '{}'::text[] or analytics_private.filter_values('{"currency":[]}', 'currency') <> '{}'::text[]
     or analytics_private.filter_values('{}', 'plan') is not null then
    raise exception 'filter_values empty-array handling wrong';
  end if;
  if (select count(*) from analytics.revenue('2026-02-01', '2026-02-28', 'month', 'native', p_filters => '{"currency":[]}')) <> 0
     or (select sum(invoices) from analytics.revenue('2026-02-01', '2026-02-28', 'month', p_filters => '{"plan":[]}')) <> 0 then
    raise exception 'empty filter arrays matched rows';
  end if;
  if (select count(*) from analytics_private.internal_users where id = internal) <> 1 then raise exception 'internal_users view wrong'; end if;

  -- Revenue: USD 10 + TRY 288/32 + erased 20 = 39; refunds are netted; $0 and open invoices are not revenue.
  select string_agg(coalesce(dimension, '-') || '=' || revenue || '/' || refunded || '/' || invoices || '/' || fx_provisional, ',') into got
  from analytics.revenue('2026-02-01', '2026-02-28', 'month');
  if got <> '-=39.00/16.00/4/false' then raise exception 'usd revenue wrong: %', got; end if;
  select string_agg(revenue || '/' || refunded, ',') into got from analytics.revenue('2026-02-01', '2026-02-28', 'month', 'try');
  if got <> '1248.00/512.00' then raise exception 'try revenue wrong: %', got; end if;
  select string_agg(revenue || '/' || invoices, ',') into got from analytics.revenue('2026-02-01', '2026-02-28', 'month', p_include_internal => true);
  if got <> '89.00/5' then raise exception 'include_internal revenue wrong: %', got; end if;
  -- Native: one series per invoice currency, no conversion.
  select string_agg(dimension || '=' || revenue || '/' || refunded || '/' || invoices || '/' || fx_provisional, ',' order by dimension) into got
  from analytics.revenue('2026-02-01', '2026-02-28', 'month', 'native');
  if got <> 'TRY=288.00/32.00/1/false,USD=30.00/15.00/3/false' then raise exception 'native revenue wrong: %', got; end if;
  begin perform analytics.revenue(p_currency => 'native', p_breakdown => 'market'); raise exception 'native breakdown accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.revenue(p_breakdown => 'ai_model'); raise exception 'revenue accepted ai_model';
  exception when invalid_parameter_value then null; end;
  select string_agg(dimension || '=' || revenue, ',' order by dimension) into got
  from analytics.revenue('2026-02-01', '2026-02-28', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL=10.00,TR=9.00,unknown=20.00' then raise exception 'market breakdown wrong: %', got; end if;
  if (select sum(revenue) from analytics.revenue('2026-02-01', '2026-02-28', 'month', p_filters => '{"market":"TR"}')) <> 9 then
    raise exception 'market filter wrong';
  end if;
  -- Fallback to March's month-to-date rate marks April as provisional; TRY needs no conversion there.
  select string_agg(revenue || '/' || fx_provisional, ',') into got from analytics.revenue('2026-04-01', '2026-04-30', 'month');
  if got <> '10.00/true' then raise exception 'april usd revenue wrong: %', got; end if;
  select string_agg(revenue || '/' || fx_provisional, ',') into got from analytics.revenue('2026-04-01', '2026-04-30', 'month', 'try');
  if got <> '400.00/false' then raise exception 'april try revenue wrong: %', got; end if;
  select string_agg(revenue || '/' || fx_provisional, ',') into got from analytics.revenue('2026-06-01', '2026-06-30', 'month');
  if got <> '10.00/true' then raise exception 'june usd revenue wrong: %', got; end if;
  -- Daily buckets are gap-filled.
  if (select count(*) from analytics.revenue('2026-02-01', '2026-02-28')) <> 28
     or (select revenue from analytics.revenue('2026-02-01', '2026-02-28') where bucket = '2026-02-11') <> 0 then
    raise exception 'daily revenue not gap-filled';
  end if;

  -- AI cost: 0.555 (estimated) + 0.25 (exact) + 1.0 ('gpt-6' prefix) + unpriced gemini; mock, guest, internal excluded.
  select string_agg(cost || '/' || runs || '/' || unpriced_runs || '/' || exact_share || '/' || fx_provisional, ',') into got from analytics.ai_cost('2026-02-01', '2026-02-28', 'month');
  if got <> '1.805000/4/1/0.1385/false' then raise exception 'ai cost wrong: %', got; end if;
  select string_agg(cost::text, ',') into got from analytics.ai_cost('2026-02-01', '2026-02-28', 'month', 'try');
  if got <> '57.760000' then raise exception 'ai cost try wrong: %', got; end if;
  -- try needs the run month's rate: month-to-date in March is provisional; before any rate the bucket is null.
  select string_agg(cost || '/' || fx_provisional, ',') into got from analytics.ai_cost('2026-03-01', '2026-03-31', 'month', 'try');
  if got <> '20.000000/true' then raise exception 'ai cost march try wrong: %', got; end if;
  select string_agg(coalesce(cost::text, 'null') || '/' || fx_provisional, ',') into got from analytics.ai_cost('2025-12-01', '2025-12-31', 'month', 'try');
  if got <> 'null/true' then raise exception 'ai cost missing rate wrong: %', got; end if;
  select string_agg(cost || '/' || fx_provisional, ',') into got from analytics.ai_cost('2025-12-01', '2025-12-31', 'month', 'usd');
  if got <> '0.500000/false' then raise exception 'ai cost usd without rate wrong: %', got; end if;
  select string_agg(cost || '/' || runs, ',') into got from analytics.ai_cost('2026-02-01', '2026-02-28', 'month', p_include_internal => true);
  if got <> '2.805000/5' then raise exception 'ai cost include_internal wrong: %', got; end if;
  select string_agg(dimension || '=' || cost || '/' || unpriced_runs, ',' order by dimension) into got
  from analytics.ai_cost('2026-02-01', '2026-02-28', 'month', p_breakdown => 'ai_provider');
  if got <> 'gemini=0.000000/1,openai=1.805000/0' then raise exception 'ai provider breakdown wrong: %', got; end if;
  select string_agg(runs || '/' || coalesce(exact_share::text, 'null'), ',') into got
  from analytics.ai_cost('2026-02-01', '2026-02-28', 'month', p_filters => '{"ai_model":["gemini-3-flash"]}');
  if got <> '1/null' then raise exception 'ai model filter wrong: %', got; end if;
  begin perform analytics.ai_cost(p_breakdown => 'market'); raise exception 'ai_cost accepted market';
  exception when invalid_parameter_value then null; end;

  -- KPI overview for February.
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28');
  if (k.signups, k.activated_users, k.activation_eligible, k.activated_eligible, k.activation_rate, k.new_paying_customers)
     <> (3::bigint, 1::bigint, 3::bigint, 1::bigint, 0.3333, 4::bigint) then
    raise exception 'kpi acquisition wrong: % % % % % %', k.signups, k.activated_users, k.activation_eligible, k.activated_eligible, k.activation_rate, k.new_paying_customers;
  end if;
  if (k.revenue, k.revenue_usd_native, k.revenue_try_native) <> (39.00, 30.00, 288.00) then
    raise exception 'kpi revenue wrong: % % %', k.revenue, k.revenue_usd_native, k.revenue_try_native;
  end if;
  -- MRR at 2026-02-28: $10 + $20 (erased) + 288 TRY; the fully refunded subscription has 0 MRR and is not active.
  if (k.mrr, k.mrr_usd_native, k.mrr_try_native, k.active_subscriptions) <> (39.00, 30.00, 288.00, 3::bigint) then
    raise exception 'kpi mrr wrong: % % % %', k.mrr, k.mrr_usd_native, k.mrr_try_native, k.active_subscriptions;
  end if;
  -- Trials: converted, canceled, superseded (started but unresolved).
  if (k.trial_starts, k.trial_resolved, k.trial_conversions, k.trial_to_paid_rate) <> (3::bigint, 2::bigint, 1::bigint, 0.5000) then
    raise exception 'kpi trials wrong: % % % %', k.trial_starts, k.trial_resolved, k.trial_conversions, k.trial_to_paid_rate;
  end if;
  if (k.ai_cost, k.ai_runs, k.unpriced_ai_runs, k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional)
     <> (1.805000, 4::bigint, 1::bigint, false, false, false) then
    raise exception 'kpi ai wrong: % % % % % %', k.ai_cost, k.ai_runs, k.unpriced_ai_runs, k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional;
  end if;
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_currency => 'try');
  if (k.revenue, k.mrr, k.ai_cost, k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional)
     <> (1248.00, 1248.00, 57.760000, false, false, false) then
    raise exception 'kpi try wrong: % % %', k.revenue, k.mrr, k.ai_cost;
  end if;
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_currency => 'native');
  if k.revenue is not null or k.mrr is not null or k.revenue_try_native <> 288 or k.ai_cost <> 1.805 then
    raise exception 'kpi native wrong: % % %', k.revenue, k.mrr, k.ai_cost;
  end if;
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_include_internal => true);
  if (k.signups, k.revenue, k.trial_starts, k.mrr) <> (4::bigint, 89.00, 4::bigint, 89.00) then
    raise exception 'kpi include_internal wrong: % % % %', k.signups, k.revenue, k.trial_starts, k.mrr;
  end if;
  -- Market: the locked market for users and AI cost, the invoice / subscription market for money and trials.
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_filters => '{"market":"TR"}');
  if (k.signups, k.activation_eligible, k.activated_eligible, k.new_paying_customers, k.revenue, k.mrr, k.active_subscriptions,
      k.trial_starts, k.trial_resolved, k.trial_conversions, k.ai_cost, k.ai_runs, k.unpriced_ai_runs)
     <> (1::bigint, 1::bigint, 0::bigint, 1::bigint, 9.00, 9.00, 1::bigint, 1::bigint, 1::bigint, 1::bigint, 1.000000, 2::bigint, 1::bigint) then
    raise exception 'kpi market filter wrong: %', row_to_json(k);
  end if;
  -- Plan: money, subscriptions and trials only; users and AI cost ignore it.
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_filters => '{"plan":["weekly"]}');
  if (k.signups, k.new_paying_customers, k.revenue, k.mrr, k.active_subscriptions, k.trial_starts, k.trial_resolved, k.trial_conversions, k.trial_to_paid_rate, k.ai_cost)
     <> (3::bigint, 0::bigint, 0.00, 0.00, 0::bigint, 2::bigint, 1::bigint, 0::bigint, 0.0000, 1.805000) then
    raise exception 'kpi plan filter wrong: %', row_to_json(k);
  end if;
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-28', p_filters => '{"market":[]}');
  if (k.signups, k.revenue, k.ai_runs, k.trial_starts) <> (0::bigint, 0.00, 0::bigint, 0::bigint) then
    raise exception 'kpi empty market filter matched rows: %', row_to_json(k);
  end if;
  begin perform analytics.kpi_overview(p_filters => '{"ai_flow":"cv_parse"}'); raise exception 'kpi accepted ai_flow filter';
  exception when invalid_parameter_value then null; end;
  -- Activation eligibility: a 2-day-old activated signup counts as activated but not in the rate.
  select * into k from analytics.kpi_overview(today - 3, today);
  if (k.signups, k.activated_users, k.activation_eligible, k.activated_eligible) <> (1::bigint, 1::bigint, 0::bigint, 0::bigint)
     or k.activation_rate is not null then
    raise exception 'kpi eligibility wrong: %', row_to_json(k);
  end if;
  -- The snapshot follows p_to: by the end of March every period has lapsed without a renewal.
  select * into k from analytics.kpi_overview('2026-03-01', '2026-03-31');
  if (k.mrr, k.active_subscriptions, k.revenue, k.new_paying_customers, k.ai_cost) <> (0.00, 0::bigint, 0.00, 0::bigint, 0.500000) then
    raise exception 'kpi march wrong: %', row_to_json(k);
  end if;
  -- Separate flags: in March only the AI cost needed a (month-to-date) rate.
  select * into k from analytics.kpi_overview('2026-03-01', '2026-03-31', p_currency => 'try');
  if (k.ai_cost, k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional) <> (20.000000, false, false, true) then
    raise exception 'kpi march try flags wrong: %', row_to_json(k);
  end if;
  select * into k from analytics.kpi_overview('2026-02-01', '2026-02-12');
  if (k.mrr, k.active_subscriptions) <> (10.00, 1::bigint) then raise exception 'kpi mid-february snapshot wrong: % %', k.mrr, k.active_subscriptions; end if;
  select * into k from analytics.kpi_overview('2026-04-01', '2026-04-30');
  if (k.revenue, k.revenue_fx_provisional, k.new_paying_customers) <> (10.00, true, 0::bigint) then
    raise exception 'kpi april wrong: %', row_to_json(k);
  end if;
  -- June: revenue and MRR use May's final rate from an earlier month -> both provisional; AI cost needs no rate in usd.
  select * into k from analytics.kpi_overview('2026-06-01', '2026-06-30');
  if (k.revenue, k.mrr, k.active_subscriptions, k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional)
     <> (10.00, 10.00, 1::bigint, true, true, false) then
    raise exception 'kpi june wrong: %', row_to_json(k);
  end if;
  select * into k from analytics.kpi_overview('2026-06-01', '2026-06-30', p_currency => 'native');
  if (k.revenue_fx_provisional, k.mrr_fx_provisional, k.ai_cost_fx_provisional) <> (false, false, false) then
    raise exception 'kpi native flags wrong: %', row_to_json(k);
  end if;
  -- No rate at all: the converted AI cost is null and flagged.
  select * into k from analytics.kpi_overview('2025-12-01', '2025-12-31', p_currency => 'try');
  if k.ai_cost is not null or not k.ai_cost_fx_provisional or k.ai_runs <> 1 then
    raise exception 'kpi missing rate wrong: %', row_to_json(k);
  end if;
  begin perform analytics.kpi_overview(p_breakdown => 'market'); raise exception 'kpi accepted a breakdown';
  exception when invalid_parameter_value then null; end;

  -- Catalog metadata.
  if (select (meta ->> 'alertable')::boolean and meta -> 'measures' ? 'unpriced_ai_runs'
            and meta -> 'measures' -> 'activation_rate' -> 'ignores_filters' ? 'plan'
            and not (meta -> 'measures' -> 'revenue' ? 'ignores_filters')
            and meta -> 'filters' = '["market","plan"]'::jsonb
     from admin_app.metric_catalog() where name = 'kpi_overview') is not true
     or (select meta -> 'measures' ? 'signups' from admin_app.metric_catalog() where name = 'signups') is not true
     or (select meta -> 'measures' ?& array['revenue','refunded','invoices'] from admin_app.metric_catalog() where name = 'revenue') is not true
     or (select meta -> 'measures' ?& array['cost','runs','unpriced_runs','exact_share'] from admin_app.metric_catalog() where name = 'ai_cost') is not true then
    raise exception 'catalog meta incomplete';
  end if;

  -- Access: analytics_api only through the functions; model prices are backend-only.
  set local role analytics_api;
  if (select signups from analytics.kpi_overview('2026-02-01', '2026-02-28')) <> 3 then raise exception 'analytics_api cannot read kpi'; end if;
  begin perform 1 from public.ai_model_prices; raise exception 'analytics_api read ai_model_prices';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  begin perform 1 from public.ai_model_prices; raise exception 'browser read ai_model_prices';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  update public.ai_model_prices set refreshed_at = now() where model_prefix = 'gpt-6';
  reset role;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics overview metrics, currency variants, AI cost and privileges passed' as verification;
rollback;
