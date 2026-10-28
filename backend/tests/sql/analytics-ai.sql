begin;
do $$
declare
  violations text;
  a uuid; b uuid; c uuid; d uuid; e uuid; i uuid; rst uuid;
  f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid;
  m uuid; tc_a uuid; tc_a2 uuid; j uuid; s_fin uuid; s_aband uuid; r4 uuid; fl uuid;
  got text;
  k record;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- FX: January and February final, March month-to-date, nothing before January 2026.
  insert into public.fx_rates(rate_month,base_currency,quote_currency,rate,sample_days,source,is_final) values
    ('2026-01-01','USD','TRY',30,20,'test',true),
    ('2026-02-01','USD','TRY',32,20,'test',true),
    ('2026-03-01','USD','TRY',40,10,'test',false);
  insert into public.ai_model_prices(model_prefix,input_usd,cached_input_usd,output_usd) values('gpt-6',1,null,2),('gpt-6-luna',0.1,0.01,0.5);

  insert into public.users(auth_user_id,email,created_at,ai_processing) values(gen_random_uuid(),'ai-a@example.invalid','2026-01-01',true) returning id into a;
  insert into public.billing_markets(user_id,market) values(a,'GLOBAL');
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ai-b@example.invalid','2026-01-01') returning id into b;
  insert into public.billing_markets(user_id,market) values(b,'TR');
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ai-c@example.invalid','2026-01-01') returning id into c;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ai-d@example.invalid','2026-01-01') returning id into d;
  insert into public.billing_markets(user_id,market) values(d,'TR');
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ai-e@example.invalid','2025-12-01') returning id into e;
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'ai-admin@example.invalid','2026-01-01',true) returning id into i;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'ai-restricted@example.invalid','2026-01-01') returning id into rst;

  -- Tailoring objects of A: an abandoned session (unfinished, created long ago) and a finished one with v2 cards.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(a,'CV','en','{"language":"en"}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(a,m,'T1','en','{}') returning id into tc_a;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(a,m,'T2','en','{}') returning id into tc_a2;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,created_at,finished_at)
    values(a,tc_a,'ready','{}','2026-02-04T09:00:00Z','2026-02-04T12:00:00Z') returning id into s_fin;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,created_at)
    values(a,tc_a2,'reviewing','{}','2026-02-01T09:00:00Z') returning id into s_aband;

  -- Week of 2026-02-01..07 (A = GLOBAL, B = TR). Exact costs unless noted.
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at,
                             input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd) values
    (a,null,'block_suggest','openai','gpt-6-luna','completed','{}',null,'2026-02-02T10:00:00Z','2026-02-02T10:00:10Z',10,null,10,20,0.10),          -- r1
    (a,null,'block_suggest','openai','gpt-6-luna','failed','{}','Structured output validation failed: x','2026-02-02T11:00:00Z','2026-02-02T11:00:02Z',10,null,10,20,0.05), -- r2 model failure
    (a,s_aband,'tailoring_block','openai','gpt-6-luna','completed','{}',null,'2026-02-03T10:00:00Z','2026-02-03T10:00:30Z',10,null,10,20,0.20), -- r3 abandoned session
    (a,null,'skills_pool','openai','gpt-6-luna','completed','{"flow_input":{"excluded_skills":["x"]}}',null,'2026-02-04T08:00:00Z','2026-02-04T08:00:05Z',5,null,5,10,0.02), -- r5 escalation
    (b,null,'import_improve','openai','gpt-6-luna','failed','{}','AI run timed out (no terminal state recorded before deadline)','2026-02-05T10:00:00Z','2026-02-05T10:05:00Z',null,null,null,null,null), -- r6 failed parent, no usage
    (b,null,'professional_summary','openai','gpt-6-mini','completed','{"flow_input":{"language":"en"}}',null,'2026-02-05T10:02:00Z','2026-02-05T10:02:40Z',100000,null,50000,150000,null), -- r7 estimated 0.2, inside the failed window
    (b,null,'block_suggest','openai','gpt-6-luna','completed','{"flow_input":{"language":"en"}}',null,'2026-02-05T11:00:00Z','2026-02-05T11:00:03Z',15,null,15,30,0.30), -- r8 sub-run after the window
    (b,null,'cv_parse','gemini','gemini-3-flash','completed','{}',null,'2026-02-06T09:00:00Z','2026-02-06T09:01:00Z',1000,null,10,1010,null), -- r9 unpriced
    (b,null,'cover_letter_generation','openai','gpt-6-luna','completed','{}',null,'2026-02-06T12:00:00Z','2026-02-06T12:00:15Z',25,null,25,50,0.15), -- r10
    (b,null,'tailored_draft','openai','gpt-6-luna','failed','{}','AI permission withdrawn','2026-02-07T09:00:00Z','2026-02-07T09:00:01Z',null,null,null,null,null), -- r12 privacy failure
    (i,null,'block_suggest','openai','gpt-6-luna','failed','{}','AI processing could not be completed','2026-02-02T12:00:00Z','2026-02-02T12:00:01Z',10,null,10,20,1.00), -- r13 internal
    (rst,null,'block_suggest','openai','gpt-6-luna','completed','{}',null,'2026-02-02T12:00:00Z','2026-02-02T12:00:01Z',10,null,10,20,5.00), -- restricted: never counted
    (a,null,'block_suggest','mock','gpt-6-luna','completed','{}',null,'2026-02-02T12:00:00Z','2026-02-02T12:00:01Z',10,null,10,20,9.00),   -- mock: never counted
    (c,null,'block_suggest','openai','gpt-6-luna','completed','{}',null,'2026-02-10T10:00:00Z','2026-02-10T10:00:01Z',10,null,10,20,0.08), -- r16, outside the week
    (a,null,'block_suggest','openai','gpt-6-luna','completed','{}',null,'2025-12-05T10:00:00Z','2025-12-05T10:00:01Z',10,null,10,20,0.50); -- no FX rate at all
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at) values
    (b,'block_suggest','openai','gpt-6-luna','pending','{}','2026-02-06T13:00:00Z');
  -- Restricted after its run was recorded.
  update public.users set processing_restricted_at = now() where id = rst;                                                         -- r11 pending
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,
                             input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd)
    values(a,s_fin,'tailoring_block','openai','gpt-6-luna','completed','{}','2026-02-04T10:00:00Z','2026-02-04T10:00:20Z',20,10,20,40,0.40) returning id into r4;
  -- r4's four v2 cards: one expired, one rejected, two accepted -> half of r4 is wasted.
  insert into public.ai_suggestions(user_id,ai_run_id,tailored_cv_id,tailoring_session_id,action_type,suggested_content,status,applied_at,created_at) values
    (a,r4,tc_a,s_fin,'tailor','{}','expired',null,'2026-02-04T10:01:00Z'),
    (a,r4,tc_a,s_fin,'tailor','{}','rejected',null,'2026-02-04T10:01:00Z'),
    (a,r4,tc_a,s_fin,'tailor','{}','applied','2026-02-04T11:00:00Z','2026-02-04T10:01:00Z'),
    (a,r4,tc_a,s_fin,'tailor','{}','applied','2026-02-04T11:05:00Z','2026-02-04T10:01:00Z');
  -- Exports: TC_A first exported in the week (a second export does not count again); TC_A2 first exported earlier.
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'export_pdf','exports','users/'||a||'/tailored-cvs/'||tc_a||'/exports/1.pdf','1.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,file_id,format,status,created_at,completed_at) values(a,tc_a,fl,'pdf','completed','2026-02-05T09:00:00Z','2026-02-05T09:00:05Z');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'export_pdf','exports','users/'||a||'/tailored-cvs/'||tc_a||'/exports/2.pdf','2.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,file_id,format,status,created_at,completed_at) values(a,tc_a,fl,'pdf','completed','2026-02-06T09:00:00Z','2026-02-06T09:00:05Z');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'export_pdf','exports','users/'||a||'/tailored-cvs/'||tc_a2||'/exports/3.pdf','3.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,file_id,format,status,created_at,completed_at) values(a,tc_a2,fl,'pdf','completed','2026-01-20T09:00:00Z','2026-01-20T09:00:05Z');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'export_pdf','exports','users/'||a||'/tailored-cvs/'||tc_a2||'/exports/4.pdf','4.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,file_id,format,status,created_at,completed_at) values(a,tc_a2,fl,'pdf','completed','2026-02-03T09:00:00Z','2026-02-03T09:00:05Z');
  -- Master CV exports of B, C and D in the week: not a tailoring outcome.
  insert into public.master_cvs(user_id,title,language,current_content,source_type)
  select x.u,'CV','en','{"language":"en"}','scratch' from unnest(array[b, c, d]) x(u);
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
  select mc.user_id,'export_pdf','exports','users/'||mc.user_id||'/master-cvs/'||mc.id||'/exports/m.pdf','m.pdf','application/pdf',10
  from public.master_cvs mc where mc.user_id in (b, c, d);
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at)
  select mc.user_id, mc.id, f.id, 'pdf', 'completed', '2026-02-05T09:00:00Z', '2026-02-05T09:00:05Z'
  from public.master_cvs mc join public.files f on f.user_id = mc.user_id and f.storage_path like '%/master-cvs/%'
  where mc.user_id in (b, c, d);
  -- Jobs of B: applied in the week; applied before the week (history only); saved.
  insert into public.jobs(user_id,company_name,job_title,job_description,status,applied_at) values(b,'Co','Role','Desc','applied','2026-02-05T15:00:00Z');
  insert into public.jobs(user_id,company_name,job_title,job_description,status) values(b,'Co','Role','Desc','applied') returning id into j;
  insert into public.job_status_history(job_id,from_status,to_status,changed_at,changed_by_user_id) values(j,'saved','applied','2026-01-20T10:00:00Z',b);
  insert into public.jobs(user_id,company_name,job_title,job_description) values(b,'Co','Role','Desc');

  -- Plans for February: A's usage is stamped 'pro' and a $10 invoice covers February; B is in a trial; C is free;
  -- D (TR) paid 320 TRY for 2026-01-29..2026-02-28 (27 of 30 days in February = 288 TRY) and has no AI runs.
  insert into public.usage_counters(user_id,period_month,plan_code) values(a,'2026-02-01','pro');
  -- C's January subscription ended without a period end: it must not make C an unpaid subscriber in February.
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,currency,billing_interval,ended_at,created_at,updated_at)
    values(c,'stripe','sub_ai_c','weekly','incomplete_expired','usd','week','2026-01-20T00:00:00Z','2026-01-10T00:00:00Z','2026-01-20T00:00:00Z');
  insert into public.billing_invoices(user_id,provider_invoice_id,status,currency,amount_paid,billing_reason,plan_code,market,period_start,period_end,paid_at,created_at)
    values(a,'in_ai_a','paid','usd',1000,'subscription_cycle','monthly','GLOBAL','2026-02-01T00:00:00Z','2026-03-01T00:00:00Z','2026-02-01T00:00:00Z','2026-02-01T00:00:00Z');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,trial_start,trial_end,created_at)
    values(b,'stripe','sub_ai_b','weekly','canceled','2026-02-03T00:00:00Z','2026-02-06T00:00:00Z','usd','week','2026-02-03T00:00:00Z','2026-02-06T00:00:00Z','2026-02-03T00:00:00Z');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,current_period_start,current_period_end,currency,billing_interval,created_at)
    values(d,'stripe','sub_ai_d','monthly','active','2026-01-29T00:00:00Z','2026-02-28T00:00:00Z','try','month','2026-01-29T00:00:00Z');
  insert into public.billing_invoices(user_id,provider_invoice_id,status,currency,amount_paid,billing_reason,plan_code,market,period_start,period_end,paid_at,created_at)
    values(d,'in_ai_d','paid','try',32000,'subscription_cycle','monthly','TR','2026-01-29T00:00:00Z','2026-02-28T00:00:00Z','2026-01-29T00:00:00Z','2026-01-29T00:00:00Z');

  -- Anomalies (E, January): cv_parse costs 1.0, 1.2, 0.8, 1.0, 1.1, 0.9, 1.0 with 100 tokens on 1-7 January; a 5.0 /
  -- 1000-token spike on the 8th (plus a cover letter flow launched that day); a failure burst (4 of 6) on the 9th.
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd)
  select e,'cv_parse','openai','gpt-6-luna','completed','{}',('2026-01-0'||g.d||'T10:00:00Z')::timestamptz,('2026-01-0'||g.d||'T10:00:01Z')::timestamptz,50,50,100,g.c
  from (values (1,1.0),(2,1.2),(3,0.8),(4,1.0),(5,1.1),(6,0.9),(7,1.0)) g(d,c);
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (e,'cv_parse','openai','gpt-6-luna','completed','{}',null,'2026-01-08T10:00:00Z','2026-01-08T10:00:01Z',500,500,1000,5.0),
    (e,'cover_letter_generation','openai','gpt-6-luna','completed','{}',null,'2026-01-08T11:00:00Z','2026-01-08T11:00:01Z',5,5,10,0.5),
    (e,'cv_parse','openai','gpt-6-luna','completed','{}',null,'2026-01-09T10:00:00Z','2026-01-09T10:00:01Z',25,25,50,0.5),
    (e,'cv_parse','openai','gpt-6-luna','completed','{}',null,'2026-01-09T10:01:00Z','2026-01-09T10:01:01Z',25,25,50,0.5),
    (e,'cv_parse','openai','gpt-6-luna','failed','{}','Structured output validation failed','2026-01-09T10:02:00Z','2026-01-09T10:02:01Z',null,null,null,null),
    (e,'cv_parse','openai','gpt-6-luna','failed','{}','Structured output validation failed','2026-01-09T10:03:00Z','2026-01-09T10:03:01Z',null,null,null,null),
    (e,'cv_parse','openai','gpt-6-luna','failed','{}','Structured output validation failed','2026-01-09T10:04:00Z','2026-01-09T10:04:01Z',null,null,null,null),
    (e,'cv_parse','openai','gpt-6-luna','failed','{}','Structured output validation failed','2026-01-09T10:05:00Z','2026-01-09T10:05:01Z',null,null,null,null);

  -- Concentration (March, month-to-date FX): five AI users costing 0.4, 0.3, 0.2, 0.1 and an unpriced one.
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'ai-f1@example.invalid') returning id into f1;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'ai-f2@example.invalid') returning id into f2;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'ai-f3@example.invalid') returning id into f3;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'ai-f4@example.invalid') returning id into f4;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'ai-f5@example.invalid') returning id into f5;
  insert into public.billing_markets(user_id,market) values(f1,'TR'),(f2,'TR');
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (f1,'block_suggest','openai','gpt-6-luna','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:00:01Z',200,200,400,0.4),
    (f2,'block_suggest','openai','gpt-6-luna','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:00:01Z',150,150,300,0.3),
    (f3,'block_suggest','openai','gpt-6-luna','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:00:01Z',100,100,200,0.2),
    (f4,'block_suggest','openai','gpt-6-luna','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:00:01Z',50,50,100,0.1),
    (f5,'cv_parse','gemini','gemini-3-flash','completed','{}','2026-03-05T10:00:00Z','2026-03-05T10:00:01Z',990,10,1000,null);

  -- Concentration (April): 20 AI users costing 0.01 .. 0.20 (10 .. 200 tokens), two per decile.
  insert into public.users(auth_user_id,email) select gen_random_uuid(),'ai-g'||g||'@example.invalid' from generate_series(1,20) g;
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd)
  select u.id,'block_suggest','openai','gpt-6-luna','completed','{}','2026-04-05T10:00:00Z','2026-04-05T10:00:01Z',x.n*5,x.n*5,x.n*10,x.n*0.01
  from public.users u cross join lateral (select substring(u.email from 'ai-g([0-9]+)@')::int as n) x
  where u.email like 'ai-g%@example.invalid';

  -- ---------------------------------------------------------------------------
  -- ai_reliability (week of 2026-02-01, one month bucket clipped to the range)
  -- 12 runs: 8 completed, 3 failed (1 model failure; a no-usage timeout and a privacy failure are not), 1 pending.
  -- Completed durations 3, 5, 10, 15, 20, 30, 40, 60 s -> p50 17.5, p95 53.
  -- ---------------------------------------------------------------------------
  select string_agg(bucket || '/' || coalesce(dimension, '-') || '/' || failure_rate || '/' || runs || '/' || completed_runs || '/' || failed_runs || '/' || pending_runs
                    || '/' || model_failure_rate || '/' || model_failed_runs || '/' || p50_duration_seconds || '/' || p95_duration_seconds || '/' || avg_tokens_per_run, ',')
    into got from analytics.ai_reliability('2026-02-01', '2026-02-07', 'month');
  if got <> '2026-02-01/-/0.2727/12/8/3/1/0.1111/1/17.50/53.00/18897.5' then raise exception 'ai_reliability wrong: %', got; end if;
  select string_agg(failure_rate || '/' || runs || '/' || model_failure_rate, ',') into got
  from analytics.ai_reliability('2026-02-01', '2026-02-07', 'month', p_include_internal => true);
  if got <> '0.3333/13/0.2000' then raise exception 'ai_reliability include_internal wrong: %', got; end if;
  select string_agg(dimension || '=' || coalesce(failure_rate::text, 'null') || '/' || runs, ',' order by dimension) into got
  from analytics.ai_reliability('2026-02-01', '2026-02-07', 'month', p_breakdown => 'ai_flow');
  if got <> 'block_suggest=0.3333/4,cover_letter_generation=0.0000/1,cv_parse=0.0000/1,import_improve=1.0000/1,professional_summary=0.0000/1,skills_pool=0.0000/1,tailored_draft=1.0000/1,tailoring_block=0.0000/2' then
    raise exception 'ai_reliability flow breakdown wrong: %', got;
  end if;
  select string_agg(failure_rate || '/' || runs || '/' || model_failure_rate, ',') into got
  from analytics.ai_reliability('2026-02-01', '2026-02-07', 'month', p_filters => '{"market":"TR"}');
  if got <> '0.3333/7/0.0000' then raise exception 'ai_reliability market filter wrong: %', got; end if;
  -- Day buckets are gap-filled; a quiet day has no rate.
  if (select count(*) from analytics.ai_reliability('2026-02-01', '2026-02-14')) <> 14
     or (select runs || '/' || coalesce(failure_rate::text, 'null') from analytics.ai_reliability('2026-02-01', '2026-02-14') where bucket = '2026-02-01') <> '0/null'
     or (select failure_rate from analytics.ai_reliability('2026-02-01', '2026-02-14') where bucket = '2026-02-02') <> 0.5000 then
    raise exception 'ai_reliability daily gap fill wrong';
  end if;
  begin perform analytics.ai_reliability(p_filters => '{"plan":"pro"}'); raise exception 'ai_reliability accepted plan';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- ai_wasted_spend: total 1.42 USD; wasted = r2 0.05 (failed) + r3 0.20 (abandoned session) + r4 0.20 (half its cards)
  -- + r5 0.02 (escalation) + r7 0.20 (failed import_improve window) = 0.67.
  -- ---------------------------------------------------------------------------
  select string_agg(wasted_share || '/' || wasted_cost || '/' || total_cost || '/' || failed_runs_cost || '/' || expired_cards_cost || '/' || rejected_cards_cost
                    || '/' || unfinished_sessions_cost || '/' || failed_import_improve_cost || '/' || skills_pool_escalation_cost || '/' || wasted_tokens_share
                    || '/' || runs || '/' || failed_runs || '/' || unpriced_runs || '/' || fx_provisional, ',')
    into got from analytics.ai_wasted_spend('2026-02-01', '2026-02-07', 'month');
  if got <> '0.4718/0.670000/1.420000/0.050000/0.100000/0.100000/0.200000/0.200000/0.020000/0.9925/12/3/1/false' then
    raise exception 'ai_wasted_spend wrong: %', got;
  end if;
  select string_agg(wasted_share || '/' || wasted_cost || '/' || total_cost || '/' || fx_provisional, ',') into got
  from analytics.ai_wasted_spend('2026-02-01', '2026-02-07', 'month', 'try');
  if got <> '0.4718/21.440000/45.440000/false' then raise exception 'ai_wasted_spend try wrong: %', got; end if;
  if (select string_agg(wasted_cost::text, ',') from analytics.ai_wasted_spend('2026-02-01', '2026-02-07', 'month', 'native')) <> '0.670000' then
    raise exception 'ai_wasted_spend native is not usd';
  end if;
  select string_agg(dimension || '=' || wasted_cost || '/' || total_cost, ',' order by dimension) into got
  from analytics.ai_wasted_spend('2026-02-01', '2026-02-07', 'month', p_breakdown => 'ai_provider');
  if got <> 'gemini=0.000000/0.000000,openai=0.670000/1.420000' then raise exception 'ai_wasted_spend provider breakdown wrong: %', got; end if;
  select string_agg(wasted_cost || '/' || total_cost, ',') into got
  from analytics.ai_wasted_spend('2026-02-01', '2026-02-07', 'month', p_filters => '{"ai_flow":["tailoring_block"]}');
  if got <> '0.400000/0.600000' then raise exception 'ai_wasted_spend flow filter wrong: %', got; end if;

  -- ---------------------------------------------------------------------------
  -- ai_tokens_by_model
  -- ---------------------------------------------------------------------------
  select string_agg(dimension || '=' || total_tokens || '/' || input_tokens || '/' || cached_input_tokens || '/' || output_tokens || '/' || runs || '/' || runs_without_tokens
                    || '/' || completed_runs || '/' || failed_runs || '/' || cost || '/' || unpriced_runs, ',' order by dimension) into got
  from analytics.ai_tokens_by_model('2026-02-01', '2026-02-07', 'month', p_breakdown => 'ai_model');
  if got <> 'gemini-3-flash=1010/1000/0/10/1/0/1/0/0.000000/1,gpt-6-luna=190/95/10/95/10/3/6/3/1.220000/0,gpt-6-mini=150000/100000/0/50000/1/0/1/0/0.200000/0' then
    raise exception 'ai_tokens_by_model wrong: %', got;
  end if;
  -- try needs the run month's rate: none exists for December 2025, so cost is null and flagged.
  select string_agg(coalesce(cost::text, 'null') || '/' || fx_provisional || '/' || total_tokens, ',') into got
  from analytics.ai_tokens_by_model('2025-12-01', '2025-12-31', 'month', 'try');
  if got <> 'null/true/20' then raise exception 'ai_tokens_by_model missing rate wrong: %', got; end if;
  select string_agg(cost || '/' || fx_provisional, ',') into got from analytics.ai_tokens_by_model('2025-12-01', '2025-12-31', 'month', 'usd');
  if got <> '0.500000/false' then raise exception 'ai_tokens_by_model usd wrong: %', got; end if;

  -- ---------------------------------------------------------------------------
  -- ai_cost_anomalies: baseline mean 1.0, sd sqrt(0.1/6); 8 January = 5.5 -> z 34.86; flat 100-token baseline jumps to 1010.
  -- ---------------------------------------------------------------------------
  select string_agg(bucket || '/' || cost || '/' || runs || '/' || tokens || '/' || coalesce(cost_baseline::text, 'null') || '/' || coalesce(cost_upper_band::text, 'null')
                    || '/' || coalesce(cost_z::text, 'null') || '/' || coalesce(tokens_z::text, 'null') || '/' || baseline_buckets || '/' || cost_spike || '/' || token_spike
                    || '/' || jump_from_flat_baseline || '/' || failure_spike || '/' || is_anomaly || '/' || coalesce(model_failure_rate::text, 'null'), ',' order by bucket) into got
  from analytics.ai_cost_anomalies('2026-01-08', '2026-01-10');
  if got <> '2026-01-08/5.500000/2/1010/1.000000/1.387298/34.86/null/7/true/false/true/false/true/0.0000,'
         || '2026-01-09/1.000000/6/100/1.642857/6.760055/-0.38/-0.38/7/false/false/false/true/true/0.6667,'
         || '2026-01-10/0.000000/0/0/1.614286/6.762378/-0.94/-0.67/7/false/false/false/false/false/null' then
    raise exception 'ai_cost_anomalies wrong: %', got;
  end if;
  select string_agg(bucket || '/' || cost || '/' || cost_baseline || '/' || cost_z || '/' || is_anomaly || '/' || fx_provisional, ',') into got
  from analytics.ai_cost_anomalies('2026-01-08', '2026-01-08', p_currency => 'try');
  if got <> '2026-01-08/165.000000/30.000000/34.86/true/false' then raise exception 'ai_cost_anomalies try wrong: %', got; end if;
  -- Per flow: the cover letter series starts on its first run, so it has no baseline and is not flagged.
  select string_agg(dimension || '=' || cost || '/' || baseline_buckets || '/' || coalesce(cost_z::text, 'null') || '/' || is_anomaly, ',' order by dimension) into got
  from analytics.ai_cost_anomalies('2026-01-08', '2026-01-08', p_breakdown => 'ai_flow');
  if got <> 'cover_letter_generation=0.500000/0/null/false,cv_parse=5.000000/7/30.98/true' then
    raise exception 'ai_cost_anomalies flow breakdown wrong: %', got;
  end if;
  if (select count(*) from analytics.ai_cost_anomalies('2026-01-01', '2026-01-31', 'week')) <> 5 then
    raise exception 'ai_cost_anomalies weekly spine wrong';
  end if;

  -- ---------------------------------------------------------------------------
  -- ai_cost_concentration (March): 5 users -> five single-user deciles show only their user count (min_group 2);
  -- Gini 0.4 on cost and on tokens.
  -- ---------------------------------------------------------------------------
  select string_agg(dimension || '=' || coalesce(cost_share::text, 'null') || '/' || coalesce(cumulative_cost_share::text, 'null') || '/' || coalesce(cost::text, 'null')
                    || '/' || users || '/' || coalesce(runs::text, 'null') || '/' || coalesce(tokens::text, 'null') || '/' || coalesce(token_share::text, 'null')
                    || '/' || coalesce(unpriced_runs::text, 'null'), ',') into got
  from analytics.ai_cost_concentration('2026-03-01', '2026-03-31');
  if got <> 'top 10%=null/null/null/1/null/null/null/null,10-20%=null/null/null/1/null/null/null/null,20-30%=null/null/null/1/null/null/null/null,'
         || '30-40%=null/null/null/1/null/null/null/null,40-50%=null/null/null/1/null/null/null/null,50-60%=0.0000/1.0000/0.000000/0/0/0/0.0000/0,'
         || '60-70%=0.0000/1.0000/0.000000/0/0/0/0.0000/0,70-80%=0.0000/1.0000/0.000000/0/0/0/0.0000/0,80-90%=0.0000/1.0000/0.000000/0/0/0/0.0000/0,'
         || '90-100%=0.0000/1.0000/0.000000/0/0/0/0.0000/0' then
    raise exception 'ai_cost_concentration small deciles wrong: %', got;
  end if;
  if (select count(distinct gini_cost || '/' || gini_tokens) from analytics.ai_cost_concentration('2026-03-01', '2026-03-31')) <> 1
     or (select max(gini_cost) || '/' || max(gini_tokens) from analytics.ai_cost_concentration('2026-03-01', '2026-03-31')) <> '0.4000/0.4000' then
    raise exception 'ai_cost_concentration gini wrong';
  end if;
  select string_agg(coalesce(cost_share::text, 'null') || '/' || users || '/' || gini_cost, ',') into got
  from analytics.ai_cost_concentration('2026-03-01', '2026-03-31', p_filters => '{"market":"TR"}') where users > 0;
  if got <> 'null/1/0.0714,null/1/0.0714' then raise exception 'ai_cost_concentration market filter wrong: %', got; end if;
  -- April: 20 users, two per decile; total 2.10, top decile 0.20 + 0.19, bottom 0.02 + 0.01; Gini 2*28.7/(20*2.1) - 21/20.
  select string_agg(dimension || '=' || cost_share || '/' || cumulative_cost_share || '/' || cost || '/' || users || '/' || runs || '/' || tokens || '/' || token_share, ',') into got
  from analytics.ai_cost_concentration('2026-04-01', '2026-04-30') where dimension in ('top 10%', '90-100%');
  if got <> 'top 10%=0.1857/0.1857/0.390000/2/2/390/0.1857,90-100%=0.0143/1.0000/0.030000/2/2/30/0.0143' then
    raise exception 'ai_cost_concentration deciles wrong: %', got;
  end if;
  if (select count(*) from analytics.ai_cost_concentration('2026-04-01', '2026-04-30') where users = 2 and cost is not null) <> 10
     or (select max(gini_cost) || '/' || max(gini_tokens) from analytics.ai_cost_concentration('2026-04-01', '2026-04-30')) <> '0.3167/0.3167' then
    raise exception 'ai_cost_concentration April gini or suppression wrong';
  end if;
  -- No April rate: March's month-to-date rate (40) is used and flagged; shares stay in USD.
  select string_agg(cost || '/' || cost_share || '/' || fx_provisional, ',') into got
  from analytics.ai_cost_concentration('2026-04-01', '2026-04-30', p_currency => 'try') where dimension = 'top 10%';
  if got <> '15.600000/0.1857/true' then raise exception 'ai_cost_concentration try wrong: %', got; end if;
  begin perform analytics.ai_cost_concentration(p_breakdown => 'ai_flow'); raise exception 'ai_cost_concentration accepted a breakdown';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- ai_cost_per_outcome (week of 2026-02-01): tailoring v2 = r3 + r4 = 0.60; v1 = r12 (no cost); cover letter = 0.15;
  -- import_improve = r6 + r7 (0.20 estimated) + r8 (0.30, a sub-run by flow_input.language); all spend 1.42.
  -- ---------------------------------------------------------------------------
  select string_agg(dimension || '=' || coalesce(cost_per_outcome::text, 'null') || '/' || outcomes || '/' || users || '/' || attributed_cost || '/' || attributed_cost_exact
                    || '/' || attributed_cost_estimated || '/' || attributed_runs || '/' || unpriced_runs || '/' || coalesce(tokens_per_outcome::text, 'null')
                    || '/' || coalesce(fully_loaded_cost_per_outcome::text, 'null'), ',') into got
  from analytics.ai_cost_per_outcome('2026-02-01', '2026-02-07');
  if got <> 'job_applied=0.750000/1/1/0.750000/0.750000/0.000000/4/0/110/1.420000,'
         || 'tailoring_finished=0.600000/1/1/0.600000/0.600000/0.000000/3/0/60/1.420000,'
         || 'tailored_cv_exported=0.600000/1/1/0.600000/0.600000/0.000000/3/0/60/1.420000,'
         || 'v2_card_accepted=0.300000/2/1/0.600000/0.600000/0.000000/2/0/30/0.710000,'
         || 'cover_letter_generated=0.150000/1/1/0.150000/0.150000/0.000000/1/0/50/1.420000,'
         || 'import_improved=null/0/0/0.500000/0.300000/0.200000/3/0/null/null' then
    raise exception 'ai_cost_per_outcome wrong: %', got;
  end if;
  -- Market: outcomes and cost of TR accounts only. Provider: cost side only.
  select string_agg(dimension || '=' || coalesce(cost_per_outcome::text, 'null') || '/' || outcomes, ',') into got
  from analytics.ai_cost_per_outcome('2026-02-01', '2026-02-07', p_filters => '{"market":"TR"}') where outcomes > 0;
  if got <> 'job_applied=0.150000/1,cover_letter_generated=0.150000/1' then raise exception 'ai_cost_per_outcome market filter wrong: %', got; end if;
  select string_agg(dimension || '=' || outcomes || '/' || attributed_runs || '/' || coalesce(fully_loaded_cost_per_outcome::text, 'null'), ',') into got
  from analytics.ai_cost_per_outcome('2026-02-01', '2026-02-07', p_filters => '{"ai_provider":"gemini"}') where dimension in ('job_applied', 'cover_letter_generated');
  if got <> 'job_applied=1/0/0.000000,cover_letter_generated=1/0/0.000000' then raise exception 'ai_cost_per_outcome provider filter wrong: %', got; end if;
  if (select cost_per_outcome from analytics.ai_cost_per_outcome('2026-02-01', '2026-02-07', p_currency => 'try') where dimension = 'job_applied') <> 24.000000 then
    raise exception 'ai_cost_per_outcome try wrong';
  end if;
  begin perform analytics.ai_cost_per_outcome(p_filters => '{"ai_flow":"cv_parse"}'); raise exception 'ai_cost_per_outcome accepted ai_flow';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- ai_cost_by_plan (February): pro (A, usage stamp wins over the invoice plan), trial (B), free (C), monthly (D).
  -- ---------------------------------------------------------------------------
  select string_agg(dimension || '=' || ai_cost || '/' || users || '/' || paying_users || '/' || ai_active_users || '/' || runs || '/' || unpriced_runs
                    || '/' || coalesce(cost_per_paying_user::text, 'null') || '/' || revenue || '/' || revenue_usd_native || '/' || revenue_try_native
                    || '/' || coalesce(ai_cost_share_of_revenue::text, 'null') || '/' || gross_margin || '/' || coalesce(exact_share::text, 'null') || '/' || fx_provisional, ',') into got
  from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28');
  if got <> 'pro=0.770000/1/1/1/5/0/0.770000/10.00/10.00/0.00/0.0770/9.23/1.0000/false,'
         || 'trial=0.650000/1/0/1/7/1/null/0.00/0.00/0.00/null/-0.65/0.6923/false,'
         || 'free=0.080000/1/0/1/1/0/null/0.00/0.00/0.00/null/-0.08/1.0000/false,'
         || 'monthly=0.000000/1/1/0/0/0/0.000000/9.00/0.00/288.00/0.0000/9.00/null/false' then
    raise exception 'ai_cost_by_plan wrong: %', got;
  end if;
  select string_agg(dimension || '=' || ai_cost || '/' || revenue || '/' || gross_margin, ',') into got
  from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28', p_currency => 'try');
  if got <> 'pro=24.640000/320.00/295.36,trial=20.800000/0.00/-20.80,free=2.560000/0.00/-2.56,monthly=0.000000/288.00/288.00' then
    raise exception 'ai_cost_by_plan try wrong: %', got;
  end if;
  select string_agg(dimension || '=' || coalesce(revenue::text, 'null') || '/' || revenue_try_native, ',') into got
  from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28', p_currency => 'native') where dimension = 'monthly';
  if got <> 'monthly=null/288.00' then raise exception 'ai_cost_by_plan native wrong: %', got; end if;
  select string_agg(dimension, ',') into got from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28', p_filters => '{"market":"TR"}');
  if got <> 'trial,monthly' then raise exception 'ai_cost_by_plan market filter wrong: %', got; end if;
  select string_agg(dimension, ',') into got from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28', p_filters => '{"plan":["trial","pro"]}');
  if got <> 'pro,trial' then raise exception 'ai_cost_by_plan plan filter wrong: %', got; end if;
  select string_agg(dimension || '=' || ai_cost || '/' || users, ',') into got
  from analytics.ai_cost_by_plan('2026-02-01', '2026-02-28', p_include_internal => true) where dimension = 'free';
  if got <> 'free=1.080000/2' then raise exception 'ai_cost_by_plan include_internal wrong: %', got; end if;
  begin perform analytics.ai_cost_by_plan(p_breakdown => 'plan'); raise exception 'ai_cost_by_plan accepted a breakdown';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- Drill-downs through analytics_people.drill_users (people reads must be audited in the same transaction)
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}'::jsonb, null);
  -- ---------------------------------------------------------------------------
  select string_agg(email || '=' || value || '/' || (detail ->> 'failed_runs') || '/' || (detail -> 'failure_classes')::text, ',') into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-07', p_filters => '{"metric":"ai_failures_by_flow"}');
  if got <> 'ai-b@example.invalid=2/2/{"privacy_or_claim": 1, "watchdog_timeout_no_usage": 1},ai-a@example.invalid=1/1/{"output_contract_invalid": 1}' then
    raise exception 'drill ai_failures_by_flow wrong: %', got;
  end if;
  select string_agg(email || '=' || value || '/' || (detail ->> 'failure_rate'), ',' order by email) into got
  from analytics_people.drill_users(p_filters => '{"metric":"ai_failures_by_flow","day":"2026-02-02","ai_flow":"block_suggest","include_internal":true}');
  if got <> 'ai-a@example.invalid=1/0.5000,ai-admin@example.invalid=1/1.0000' then raise exception 'drill ai_failures_by_flow day/flow wrong: %', got; end if;
  select string_agg(email || '=' || value || '/' || (detail ->> 'total_cost_usd') || '/' || (detail ->> 'wasted_runs'), ',') into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-07', p_filters => '{"metric":"ai_wasted_spend"}');
  if got <> 'ai-a@example.invalid=0.470000/0.770000/4,ai-b@example.invalid=0.200000/0.650000/3' then raise exception 'drill ai_wasted_spend wrong: %', got; end if;
  select string_agg(email, ',') into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-07', p_filters => '{"metric":"ai_wasted_spend","market":"TR"}');
  if got <> 'ai-b@example.invalid' then raise exception 'drill ai_wasted_spend market wrong: %', got; end if;
  -- Paging follows the sort key.
  select string_agg(email, ',') into got
  from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-07', p_filters => '{"metric":"ai_wasted_spend"}', p_limit => 1,
    p_cursor => (select cursor from analytics_people.drill_users(p_from => '2026-02-01', p_to => '2026-02-07', p_filters => '{"metric":"ai_wasted_spend"}', p_limit => 1)));
  if got <> 'ai-b@example.invalid' then raise exception 'drill ai_wasted_spend paging wrong: %', got; end if;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"ai_wasted_spend","locale":"tr"}'); raise exception 'drill accepted locale';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- Catalog metadata: display keys, drill keys, and a measure for every numeric column.
  -- ---------------------------------------------------------------------------
  if (select meta -> 'plot' = '["failure_rate"]'::jsonb and meta -> 'drill' = 'true'::jsonb and meta ->> 'unit' = 'ratio'
      from admin_app.metric_catalog() where name = 'ai_reliability') is not true
     or (select meta ->> 'flag_column' = 'is_anomaly' and not (meta ? 'drill') from admin_app.metric_catalog() where name = 'ai_cost_anomalies') is not true
     or (select meta -> 'stacked' = 'true'::jsonb and meta -> 'plot' = '["input_tokens","output_tokens"]'::jsonb from admin_app.metric_catalog() where name = 'ai_tokens_by_model') is not true
     or (select not (meta ? 'breakdown_dimension') and meta ->> 'shape' = 'breakdown' from admin_app.metric_catalog() where name = 'ai_cost_by_plan') is not true
     or (select meta -> 'drill' = 'true'::jsonb and meta -> 'plot' = '["wasted_share","wasted_tokens_share"]'::jsonb from admin_app.metric_catalog() where name = 'ai_wasted_spend') is not true
     or (select meta -> 'measures' -> 'outcomes' -> 'ignores_filters' = '["ai_model","ai_provider"]'::jsonb from admin_app.metric_catalog() where name = 'ai_cost_per_outcome') is not true
     or (select meta ->> 'shape' = 'breakdown' and meta -> 'breakdowns' = '[]'::jsonb and (meta ->> 'min_group')::int = 2 from admin_app.metric_catalog() where name = 'ai_cost_concentration') is not true then
    raise exception 'AI catalog meta wrong';
  end if;
  select string_agg(p.proname || '.' || a.name, ', ') into got
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes) a(name, typ, mode)
  where n.nspname = 'analytics'
    and p.proname in ('ai_reliability', 'ai_wasted_spend', 'ai_cost_anomalies', 'ai_tokens_by_model', 'ai_cost_concentration', 'ai_cost_per_outcome', 'ai_cost_by_plan')
    and a.mode = 't' and a.typ in ('numeric'::regtype, 'bigint'::regtype)
    and not (analytics_private.try_jsonb(obj_description(p.oid, 'pg_proc')) -> 'measures' ? a.name);
  if got is not null then raise exception 'numeric columns without measures: %', got; end if;
  if (select count(*) from admin_app.drill_keys() where key in ('ai_failures_by_flow', 'ai_wasted_spend')) <> 2
     or (select meta ->> 'metric' from admin_app.drill_keys() where key = 'ai_failures_by_flow') <> 'ai_reliability'
     or (select meta -> 'drill_metrics' -> 'ai_wasted_spend' ->> 'metric' from admin_app.metric_catalog() where name = 'drill_users') <> 'ai_wasted_spend' then
    raise exception 'AI drill keys not published';
  end if;
  -- Every metric flagged drill = true has a drill key naming it.
  if exists (select 1 from admin_app.metric_catalog() mc where mc.kind = 'metric' and mc.meta -> 'drill' = 'true'::jsonb
             and not exists (select 1 from admin_app.drill_keys() dk where dk.meta ->> 'metric' = mc.name)) then
    raise exception 'drill = true without a drill key';
  end if;

  -- Access: analytics_api reaches the metrics, never the private helpers.
  set local role analytics_api;
  if (select runs from analytics.ai_reliability('2026-02-01', '2026-02-07', 'month')) <> 12 then raise exception 'analytics_api cannot read ai_reliability'; end if;
  begin perform analytics_private.ai_run_scope('2026-02-01', '2026-02-07', false, '{}'); raise exception 'analytics_api reached ai_run_scope';
  exception when insufficient_privilege then null; end;
  reset role;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics AI cost and reliability metrics, drill-downs and currency variants passed' as verification;
rollback;
