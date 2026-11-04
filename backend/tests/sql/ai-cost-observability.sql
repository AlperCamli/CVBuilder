begin;
do $$
declare
  violations text;
  ext uuid; adm uuid; rst uuid; del uuid;
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); lease1 uuid := gen_random_uuid(); lease2 uuid := gen_random_uuid();
  r_ext2 uuid := gen_random_uuid(); r_del2 uuid := gen_random_uuid(); r_guest2 uuid := gen_random_uuid();
  r_est uuid := gen_random_uuid(); r_rst_est uuid := gen_random_uuid(); r_h1 uuid := gen_random_uuid(); r_h2 uuid := gen_random_uuid();
  call1 uuid := gen_random_uuid();
  all_segments jsonb := '{"ai_segment":["external","internal","guest","restricted","script","unattributed"]}';
  got text;
  n numeric;
  ev record;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'obs-ext@example.invalid','2026-05-01') returning id into ext;
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'obs-admin@example.invalid','2026-05-01',true) returning id into adm;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'obs-rst@example.invalid','2026-05-01') returning id into rst;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'obs-del@example.invalid','2026-05-01') returning id into del;
  insert into public.ai_model_prices(model_prefix,input_usd,cached_input_usd,cache_write_usd,output_usd) values('gpt-6-luna',0.1,0.01,0.125,0.5);
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,
    ai_processing,ai_provider,ai_notice_version,lease_id,lease_expires_at)
  values (g1,'obs-g1','cv.pdf','application/pdf',20,'guests/obs-g1/'||g1,'parsed','{"version":"v1","language":"en","sections":[]}',
          true,'openai','test-notice',lease1,now()+interval '5 minutes'),
         (g2,'obs-g2','cv.pdf','application/pdf',20,'guests/obs-g2/'||g2,'parsed','{"version":"v1","language":"en","sections":[]}',
          true,'openai','test-notice',lease2,now()+interval '5 minutes');

  -- 2026-06-01, before the ledger: one run per segment (ai_runs only).
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (ext,'block_suggest','openai','gpt-6-luna','completed','{}','2026-06-01T10:00:00Z','2026-06-01T10:01:00Z',10,10,20,1),
    (adm,'block_suggest','openai','gpt-6-luna','completed','{}','2026-06-01T10:00:00Z','2026-06-01T10:01:00Z',10,10,20,2),
    (rst,'block_suggest','openai','gpt-6-luna','completed','{}','2026-06-01T10:00:00Z','2026-06-01T10:01:00Z',10,10,20,4),
    (del,'block_suggest','openai','gpt-6-luna','completed','{}','2026-06-01T10:00:00Z','2026-06-01T10:01:00Z',10,10,20,16);
  insert into public.ai_runs(user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload,started_at,input_tokens,output_tokens,total_tokens,cost_usd)
    values(null,g1,lease1,'cv_parse','openai','gpt-6-luna','pending','{}','2026-06-01T11:00:00Z',10,10,20,8);
  -- 2026-06-02, with the ledger: these runs are counted from their ledger attempts, never twice.
  insert into public.ai_runs(id,user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (r_ext2,ext,'cv_review','openai','gpt-6-luna','completed','{}','2026-06-02T10:00:00Z','2026-06-02T10:01:00Z',10,10,20,0.5),
    (r_del2,del,'cv_review','openai','gpt-6-luna','completed','{}','2026-06-02T10:00:00Z','2026-06-02T10:01:00Z',10,10,20,0.03125);
  insert into public.ai_runs(id,user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload,started_at,input_tokens,output_tokens,total_tokens,cost_usd)
    values(r_guest2,null,g2,lease2,'cv_parse','openai','gpt-6-luna','pending','{}','2026-06-02T11:00:00Z',10,10,20,0.125);
  -- 2026-05-01: runs with tokens but no cost, for the backfill.
  insert into public.ai_runs(id,user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,cached_input_tokens,output_tokens,total_tokens) values
    (r_est,ext,'cv_translate','openai','gpt-6-luna','completed','{}','2026-05-01T10:00:00Z','2026-05-01T10:01:00Z',1000000,200000,100000,1100000),
    (r_rst_est,rst,'cv_translate','openai','gpt-6-luna','completed','{}','2026-05-01T10:00:00Z','2026-05-01T10:01:00Z',1000000,0,0,1000000);
  update public.users set processing_restricted_at = now() where id = rst;

  -- Ledger attempts (2026-06-02 unless noted). The first production app attempt starts the ledger.
  insert into public.ai_usage_events(occurred_at,source,environment,call_id,provider,flow_type,model_requested,model_reported,attempt_no,is_fallback,outcome,http_status,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_tokens,cost_usd,ai_run_id,user_id,subject) values
    -- A timeout and a 429 before the success: no usage, no cost, but counted.
    ('2026-06-02T09:59:00Z','app','production',call1,'openai','cv_review','gpt-6-luna',null,1,false,'timeout',null,null,null,null,null,null,null,r_ext2,ext,'user'),
    ('2026-06-02T09:59:30Z','app','production',call1,'openai','cv_review','gpt-6-luna',null,2,false,'http_error',429,null,null,null,null,null,null,r_ext2,ext,'user'),
    ('2026-06-02T10:00:00Z','app','production',call1,'openai','cv_review','gpt-6-luna','gpt-6-luna',3,false,'success',200,10,0,0,10,0,0.5,r_ext2,ext,'user'),
    ('2026-06-02T10:00:00Z','app','production',gen_random_uuid(),'openai','block_suggest','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,0.25,null,adm,'user'),
    ('2026-06-02T11:00:00Z','app','production',gen_random_uuid(),'openai','cv_parse','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,0.125,r_guest2,null,'guest'),
    ('2026-06-02T12:00:00Z','app','production',gen_random_uuid(),'openai','block_suggest','gpt-6-luna','gpt-6-luna',1,false,'refusal',200,10,0,0,10,0,0.0625,null,rst,'user'),
    ('2026-06-02T10:00:00Z','app','production',gen_random_uuid(),'openai','cv_review','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,0.03125,r_del2,del,'user'),
    ('2026-06-02T13:00:00Z','script','development',gen_random_uuid(),'openai','cv_review','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,1.5,null,null,null),
    ('2026-06-02T13:00:00Z','app','production',gen_random_uuid(),'openai','cv_parse','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,0.75,null,null,null),
    -- Unpriced model: tokens, no cost.
    ('2026-06-02T14:00:00Z','app','production',gen_random_uuid(),'gemini','cv_parse','gemini-x','gemini-x',1,false,'success',200,1000,0,0,10,0,null,null,ext,'user'),
    -- Re-priced in SQL, with a heavy-to-light fallback: (700k*0.1 + 200k*0.01 + 100k*0.125 + 100k*0.5) / 1M = 0.1345.
    ('2026-06-02T15:00:00Z','app','production',gen_random_uuid(),'openai','tailored_draft','gpt-6-luna','gpt-6-luna-2026-09-01',2,true,'success',200,1000000,200000,100000,100000,40000,null,null,ext,'user'),
    -- A development app attempt before the ledger start duplicates an ai_runs row: never counted.
    ('2026-06-01T08:00:00Z','app','development',gen_random_uuid(),'openai','block_suggest','gpt-6-luna','gpt-6-luna',1,false,'success',200,10,0,0,10,0,100,null,ext,'user');

  -- Segments and links derived on insert.
  select string_agg(e.subject_segment || ':' || (e.user_id is not null), ',' order by e.cost_usd) into got
  from public.ai_usage_events e where e.occurred_at::date = '2026-06-02' and e.cost_usd is not null;
  if got <> 'external:true,restricted:false,guest:false,internal:true,external:true,unattributed:false,script:false' then
    raise exception 'ledger segments wrong: %', got;
  end if;
  if analytics_private.ai_ledger_start() <> '2026-06-02T09:59:00Z'::timestamptz then
    raise exception 'ledger start wrong: %', analytics_private.ai_ledger_start();
  end if;
  if (select round(cost_usd, 6) from analytics_private.ai_usage_ledger where model_name = 'gpt-6-luna-2026-09-01') <> 0.1345 then
    raise exception 'ledger re-pricing wrong: %', (select cost_usd from analytics_private.ai_usage_ledger where model_name = 'gpt-6-luna-2026-09-01');
  end if;
  -- A dangling run link is dropped instead of failing the write.
  insert into public.ai_usage_events(source,environment,call_id,provider,flow_type,model_requested,attempt_no,outcome,ai_run_id,subject)
    values('app','production',gen_random_uuid(),'openai','cv_parse','gpt-6-luna',1,'network_error',gen_random_uuid(),'guest')
    returning * into ev;
  if ev.ai_run_id is not null or ev.subject_segment <> 'guest' then raise exception 'dangling run link kept: %', ev; end if;

  -- AI cost (ai_runs): no ai_segment = the previous external-only population, unchanged.
  select sum(cost) into n from analytics.ai_cost('2026-06-01', '2026-06-01');
  if n <> (select sum(rc.cost_usd) from analytics_private.run_cost rc
           where not rc.is_guest and rc.is_analysis_user and not rc.is_internal_user and rc.started_at::date = '2026-06-01')
     or n <> 17 then
    raise exception 'ai_cost default population changed: %', n;
  end if;
  if (select sum(cost) from analytics.ai_cost('2026-06-01', '2026-06-01', p_filters => '{"ai_segment":["external"]}')) <> 17
     or (select sum(cost) from analytics.ai_cost('2026-06-01', '2026-06-01', p_include_internal => true)) <> 19
     or (select sum(cost) from analytics.ai_cost('2026-06-01', '2026-06-01', p_filters => '{"ai_segment":["external","internal"]}')) <> 19 then
    raise exception 'ai_cost segment filter wrong';
  end if;
  -- Every segment: the parts add up to the total.
  select string_agg(dimension || '=' || cost, ',' order by dimension) into got
  from analytics.ai_cost('2026-06-01', '2026-06-01', p_breakdown => 'ai_segment', p_filters => all_segments);
  if got <> 'external=17.000000,guest=8.000000,internal=2.000000,restricted=4.000000' then raise exception 'ai_cost by segment wrong: %', got; end if;
  if (select sum(cost) from analytics.ai_cost('2026-06-01', '2026-06-01', p_filters => all_segments)) <> 31 then
    raise exception 'ai_cost all segments wrong';
  end if;
  begin perform analytics.ai_cost(p_breakdown => 'market'); raise exception 'ai_cost accepted market';
  exception when sqlstate '22023' then null; end;

  -- AI spend (ledger after the start, ai_runs before): every segment, the parts add up to the total.
  select sum(cost) into n from analytics.ai_spend('2026-06-01', '2026-06-02', p_filters => all_segments);
  if n <> 34.353250 then raise exception 'ai_spend total wrong: %', n; end if;
  select string_agg(dimension || '=' || cost, ',' order by dimension) into got
  from analytics.ai_spend('2026-06-01', '2026-06-02', 'month', p_breakdown => 'ai_segment', p_filters => all_segments);
  if got <> 'external=17.665750,guest=8.125000,internal=2.250000,restricted=4.062500,script=1.500000,unattributed=0.750000' then
    raise exception 'ai_spend by segment wrong: %', got;
  end if;
  select string_agg(bucket || '/' || cost || '/' || attempts || '/' || failed_attempts || '/' || no_usage_attempts || '/' || unpriced_attempts || '/' || pre_ledger_cost, ',') into got
  from analytics.ai_spend('2026-06-01', '2026-06-02', p_filters => all_segments);
  if got <> '2026-06-01/31.000000/5/0/0/0/31.000000,2026-06-02/3.353250/11/3/2/1/0.000000' then raise exception 'ai_spend series wrong: %', got; end if;
  -- Without ai_segment: external accounts only, as everywhere else.
  if (select sum(cost) from analytics.ai_spend('2026-06-02', '2026-06-02')) <> 0.665750 then
    raise exception 'ai_spend default population wrong: %', (select sum(cost) from analytics.ai_spend('2026-06-02', '2026-06-02'));
  end if;
  if (select sum(cost) from analytics.ai_spend('2026-06-02', '2026-06-02', p_currency => 'try', p_filters => all_segments)) is not null then
    raise exception 'ai_spend try without a rate must be null';
  end if;

  -- The other Spend metrics accept the segment filter too.
  if (select sum(cost) from analytics.ai_cost_anomalies('2026-06-01', '2026-06-01', p_filters => all_segments)) <> 31
     or (select sum(cost) from analytics.ai_cost_anomalies('2026-06-01', '2026-06-01')) <> 17
     or (select sum(cost) from analytics.ai_tokens_by_model('2026-06-01', '2026-06-01', p_filters => '{"ai_segment":["guest"]}')) <> 8 then
    raise exception 'anomalies / tokens segment filter wrong';
  end if;

  -- Guest cleanup deletes the guest's runs; its ledger attempt stays, unlinked, in the guest segment.
  delete from public.guest_imports where id = g2;
  if exists (select 1 from public.ai_runs where id = r_guest2) then raise exception 'guest run not deleted'; end if;
  if (select count(*) from public.ai_usage_events where flow_type = 'cv_parse' and subject_segment = 'guest' and cost_usd = 0.125 and ai_run_id is null) <> 1 then
    raise exception 'guest attempt lost or still linked';
  end if;
  -- Account erasure (privacy job order: runs, then the account); the attempt keeps its segment.
  delete from public.ai_runs where user_id = del;
  delete from public.users where id = del;
  if (select count(*) from public.ai_usage_events where cost_usd = 0.03125 and user_id is null and ai_run_id is null and subject_segment = 'external') <> 1 then
    raise exception 'erased account attempt lost or still linked';
  end if;
  if (select sum(cost) from analytics.ai_spend('2026-06-02', '2026-06-02', p_filters => all_segments)) <> 3.353250 then
    raise exception 'ai_spend changed after guest cleanup / erasure: %', (select sum(cost) from analytics.ai_spend('2026-06-02', '2026-06-02', p_filters => all_segments));
  end if;

  -- Append-only.
  begin update public.ai_usage_events set cost_usd = 0 where call_id = call1; raise exception 'ledger update allowed';
  exception when raise_exception then if sqlerrm <> 'ai_usage_events is append-only' then raise; end if; end;
  begin delete from public.ai_usage_events where call_id = call1; raise exception 'ledger delete allowed';
  exception when raise_exception then if sqlerrm <> 'ai_usage_events is append-only' then raise; end if; end;
  if has_table_privilege('anon', 'public.ai_usage_events', 'select') or has_table_privilege('authenticated', 'public.ai_usage_events', 'select, insert')
     or not has_table_privilege('service_role', 'public.ai_usage_events', 'insert')
     or has_table_privilege('service_role', 'public.ai_usage_events', 'update, delete')
     or has_function_privilege('anon', 'public.backfill_ai_run_cost_estimates()', 'execute')
     or not has_function_privilege('service_role', 'public.backfill_ai_run_cost_estimates()', 'execute') then
    raise exception 'ledger grants wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ai_usage_events'::regclass) then raise exception 'ledger RLS off'; end if;

  -- Backfill: the priced run gets an estimated cost; the restricted account's run is skipped (re-priced on read).
  -- (800k * 0.1 + 200k * 0.01 + 100k * 0.5) / 1M = 0.132
  if public.backfill_ai_run_cost_estimates() <> 1 then raise exception 'backfill count wrong'; end if;
  if (select (cost_usd, cost_usd_estimated) from public.ai_runs where id = r_est) is distinct from (0.132::numeric, true)
     or (select cost_usd from public.ai_runs where id = r_rst_est) is not null then
    raise exception 'backfill wrong';
  end if;
  if (select cost_is_exact from analytics_private.run_cost where id = r_est)
     or (select exact_share from analytics.ai_cost('2026-05-01', '2026-05-01')) <> 0 then
    raise exception 'backfilled cost counted as exact';
  end if;
  if public.backfill_ai_run_cost_estimates() <> 0 then raise exception 'backfill not idempotent'; end if;

  -- Drill: the AI cost key accepts the segment filter the card sends.
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}', null);
  if (select count(*) from analytics_people.drill_users(null, null, '2026-06-01', '2026-06-02',
        '{"metric":"ai_cost_users","ai_segment":["external","internal","guest","restricted","script","unattributed"]}', 50, null)) <> 1 then
    raise exception 'ai_cost drill with segments wrong';
  end if;

  -- Ledger health: one recent run has no attempt and the ledger holds less cost than ai_runs.
  insert into public.ai_runs(id,user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (r_h1,ext,'block_suggest','openai','gpt-6-luna','completed','{}',now(),now(),10,10,20,0.2),
    (r_h2,ext,'block_suggest','openai','gpt-6-luna','completed','{}',now(),now(),10,10,20,0.3);
  insert into public.ai_usage_events(source,environment,call_id,provider,flow_type,model_requested,model_reported,attempt_no,outcome,http_status,input_tokens,output_tokens,cost_usd,ai_run_id,user_id,subject)
    values('app','production',gen_random_uuid(),'openai','block_suggest','gpt-6-luna','gpt-6-luna',1,'success',200,10,10,0.2,r_h1,ext,'user');
  select string_agg(item || '=' || status || '/' || coalesce(value::text, 'null'), ',') into got from analytics.ai_ledger_health();
  if got not like 'ai_ledger_last_attempt=ok/%' or got not like '%ai_runs_without_attempts=warn/1,%' or got not like '%ai_ledger_vs_runs_cost=warn/-0.300000,%'
     or got not like '%ai_attempts_without_run=info/1,%' or got not like '%ai_failed_attempts=info/1,%' or got not like '%ai_unpriced_attempts=ok/0' then
    raise exception 'ai_ledger_health wrong: %', got;
  end if;

  -- Catalog.
  if (select count(*) from admin_app.metric_catalog() where name in ('ai_spend', 'ai_ledger_health')) <> 2
     or (select (meta ->> 'drill')::boolean and meta -> 'filters' ? 'ai_segment' and meta -> 'breakdowns' ? 'ai_segment'
                and meta #>> '{measures,exact_share,label}' = 'Stored-cost share'
         from admin_app.metric_catalog() where name = 'ai_cost') is not true
     or (select meta -> 'filters' ? 'ai_segment' and meta ->> 'flag_column' = 'is_anomaly' from admin_app.metric_catalog() where name = 'ai_cost_anomalies') is not true
     or (select meta -> 'filters' ? 'ai_segment' and meta ? 'plot' from admin_app.metric_catalog() where name = 'ai_tokens_by_model') is not true
     or (select meta -> 'measures' ?& array['cost','attempts','failed_attempts','no_usage_attempts','unpriced_attempts','pre_ledger_cost'] from admin_app.metric_catalog() where name = 'ai_spend') is not true then
    raise exception 'AI cost catalog entries wrong';
  end if;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
rollback;
