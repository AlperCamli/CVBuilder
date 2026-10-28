-- Admin analytics Phase 2: people functions and the audit log (20261101120000_analytics_people.sql).
begin;
do $$
declare
  violations text;
  main uuid := gen_random_uuid(); other uuid; internal uuid;
  prefix_user uuid; contains_user uuid; pending uuid; restricted uuid; erased uuid;
  f_src uuid; f_out uuid; imp uuid; m uuid; j uuid; tc uuid; sess uuid; task uuid; run_fail uuid; run_ok uuid;
  sugg uuid; cl uuid; sub uuid; audit_id bigint; audit_missing bigint;
  n bigint; t text; d jsonb; rec record;
  full_cursors text[]; paged_cursors text[]; page_cursor text; page_rows integer; pages integer;
  types text[];
  uid uuid;
  expected_hmac text;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- -------------------------------------------------------------------------
  -- Fixtures. Every content column carries SECRET; no output may contain it.
  -- -------------------------------------------------------------------------
  insert into public.billing_plan_catalog(plan_code,name,limits,features,checkout_allowed,trial_supported,trial_days,legacy) values
    ('free','Free','{"tailored_cv_generations":3,"exports":5,"ai_actions":20,"storage_bytes":26214400}','{}',false,false,0,false),
    ('monthly','Monthly','{"tailored_cv_generations":null,"exports":null,"ai_actions":null,"storage_bytes":null}','{}',true,true,3,false);

  insert into public.users(id,auth_user_id,email,full_name,locale,created_at,analytics,ai_processing)
    values(main,gen_random_uuid(),'people-main@example.invalid','SECRET Name','tr','2026-03-01T10:00:00Z',true,true);
  insert into public.billing_markets(user_id,market) values(main,'TR');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at)
    values(main,'source_upload','imports','users/'||main||'/SECRET.pdf','SECRET.pdf','application/pdf',2048,'2026-03-01T10:05:00Z') returning id into f_src;
  -- Two uploads at the same instant: ties must page deterministically.
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at) values
    (main,'avatar','cv-assets','users/'||main||'/a1.png','SECRET-a.png','image/png',10,'2026-03-01T10:06:00Z'),
    (main,'avatar','cv-assets','users/'||main||'/a2.png','SECRET-b.png','image/png',11,'2026-03-01T10:06:00Z');
  insert into public.imports(user_id,source_file_id,status,parser_name,raw_extracted_text,parsed_content,error_message,created_at)
    values(main,f_src,'failed','pdf','SECRET text','{"secret":"SECRET"}','Import parsing failed','2026-03-01T10:07:00Z') returning id into imp;
  insert into public.master_cvs(user_id,title,language,current_content,summary_text,source_type,created_at)
    values(main,'SECRET title','tr','{"language":"tr","secret":"SECRET"}','SECRET summary','import','2026-03-01T10:10:00Z') returning id into m;
  insert into public.jobs(user_id,company_name,job_title,job_description,job_posting_url,location_text,notes,created_at)
    values(main,'SECRET Co','SECRET role','SECRET description','https://SECRET.example','SECRET city','SECRET notes','2026-03-01T10:20:00Z') returning id into j;
  insert into public.job_status_history(job_id,from_status,to_status,changed_at,changed_by_user_id) values(j,'saved','applied','2026-03-01T10:25:00Z',main);
  insert into public.tailored_cvs(user_id,master_cv_id,job_id,title,language,current_content,ai_generation_status,created_at)
    values(main,m,j,'SECRET tailored','tr','{"secret":"SECRET"}','failed','2026-03-01T10:30:00Z') returning id into tc;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,job_id,status,job_snapshot,analysis,answers,requirement_decisions,base_snapshot,error_message,created_at,finished_at)
    values(main,tc,j,'generating','{"job_description":"SECRET"}','{"requirements":["SECRET"]}','{"q1":"SECRET"}','{"r1":"SECRET"}',
           '{"sections":["SECRET"]}','The job analysis could not be completed. Please try again.','2026-03-01T10:31:00Z','2026-03-01T10:33:00Z') returning id into sess;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,block_id,status,brief,error_message,created_at,started_at,completed_at)
    values(sess,main,'block','b1','failed','{"focus":"SECRET"}','Something went wrong while preparing this suggestion. Try again.','2026-03-01T10:32:00Z','2026-03-01T10:32:00Z','2026-03-01T10:32:05Z') returning id into task;
  insert into public.ai_runs(user_id,tailored_cv_id,tailoring_session_id,flow_type,provider,model_name,status,progress_stage,input_payload,output_payload,debug_payload,
                             error_message,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd)
    values(main,tc,sess,'tailoring_block','openai','gpt-6','failed','failed','{"prompt":"SECRET prompt","target_language":"de"}',null,
           '{"details":{"reason":"output_semantically_empty"},"stage":"validating_output","raw_output_excerpt":"SECRET output"}',
           'Structured output validation failed: kind: Invalid enum value. Expected ''a'', received ''SECRET''','2026-03-01T10:34:00Z','2026-03-01T10:34:02.5Z',100,50,150,0.01) returning id into run_fail;
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload,output_payload,started_at,completed_at,cost_usd)
    values(main,m,'cv_translate','openai','gpt-6','completed','completed','{"target_language":"en","document":"SECRET"}','{"translated":"SECRET"}',
           '2026-03-01T10:40:00Z','2026-03-01T10:41:00Z',0.2) returning id into run_ok;
  insert into public.ai_suggestions(user_id,ai_run_id,master_cv_id,block_id,action_type,before_content,suggested_content,rationale,status,applied_at,created_at)
    values(main,run_ok,m,'b1','rewrite','{"t":"SECRET"}','{"t":"SECRET"}','SECRET rationale','applied','2026-03-01T10:45:00Z','2026-03-01T10:42:00Z') returning id into sugg;
  insert into public.cv_block_revisions(user_id,cv_kind,master_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,ai_suggestion_id,created_at)
    values(main,'master',m,'b1','experience',1,'{"t":"SECRET"}','ai',sugg,'2026-03-01T10:46:00Z');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at)
    values(main,'export_pdf','exports','users/'||main||'/master-cvs/'||m||'/exports/SECRET.pdf','SECRET.pdf','application/pdf',99,'2026-03-01T10:49:00Z') returning id into f_out;
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at)
    values(main,m,f_out,'pdf','completed','2026-03-01T10:50:00Z','2026-03-01T10:50:03Z');
  insert into public.exports(user_id,master_cv_id,format,status,error_message,created_at)
    values(main,m,'docx','failed','Export generation failed','2026-03-01T10:51:00Z');
  insert into public.cover_letters(user_id,job_id,tailored_cv_id,title,content,language,created_at)
    values(main,j,tc,'SECRET letter','SECRET body','tr','2026-03-01T10:55:00Z') returning id into cl;
  insert into public.cover_letter_exports(user_id,cover_letter_id,format,status,error_message,created_at)
    values(main,cl,'pdf','failed','Font SECRET could not be embedded','2026-03-01T10:56:00Z');
  insert into public.checkout_attempts(user_id,plan_code,market,currency,amount,trial_requested,trial_applied,checkout_session_id,outcome,created_at,resolved_at)
    values(main,'monthly','TR','try',32000,true,false,'cs_people','expired','2026-03-01T11:00:00Z','2026-03-01T11:30:00Z');
  insert into public.subscriptions(user_id,provider,provider_customer_id,provider_subscription_id,plan_code,status,currency,billing_interval,
                                   current_period_start,current_period_end,trial_end,created_at)
    values(main,'stripe','cus_people','sub_people','monthly','active','try','month','2026-03-01T11:35:00Z','2099-04-01T11:35:00Z',
           '2026-03-04T11:35:00Z','2026-03-01T11:35:00Z') returning id into sub;
  insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,stripe_event_id,source,occurred_at)
    values(sub,main,'past_due','active','past_due','evt_people_pd','stripe','2026-03-05T08:00:00Z');
  insert into public.billing_invoices(user_id,subscription_id,provider_invoice_id,status,currency,amount_total,amount_paid,amount_refunded,billing_reason,plan_code,market,paid_at,created_at) values
    (main,sub,'in_people_1','paid','try',32000,32000,2000,'subscription_cycle','monthly','TR','2026-03-02T12:00:00Z','2026-03-02T11:59:00Z'),
    (main,sub,'in_people_2','uncollectible','try',32000,0,0,'subscription_cycle','monthly','TR',null,'2026-03-06T12:00:00Z');
  -- Two denial rows of the same day share 00:00 UTC.
  insert into public.entitlement_denials(day,user_id,plan_code,action,surface,reason,count) values
    ('2026-03-07',main,'free','export_pdf','editor','no_subscription',2),
    ('2026-03-07',main,'free','app_access','ai','subscription_inactive',3);
  insert into public.usage_counters(user_id,period_month,tailored_cv_generations_count,exports_count,ai_actions_count,storage_bytes_used)
    values(main,date_trunc('month',now() at time zone 'UTC')::date,1,2,4,99);

  -- Search fixtures.
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'FindMe.One@example.invalid','2026-03-02T09:00:00Z') returning id into prefix_user;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'x.findme@example.invalid','2026-03-03T09:00:00Z') returning id into contains_user;
  insert into public.users(auth_user_id,email,created_at,deletion_requested_at) values(gen_random_uuid(),'findme.pending@example.invalid','2026-03-04T09:00:00Z',now()) returning id into pending;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'findme.restricted@example.invalid','2026-03-05T09:00:00Z') returning id into restricted;
  insert into public.billing_markets(user_id,market) values(restricted,'GLOBAL');
  perform public.set_privacy_restriction(restricted,null,true);
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'findme.admin@example.invalid','2026-03-01T12:00:00Z',true) returning id into internal;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'findme.erased@example.invalid') returning id into erased;
  delete from public.users where id = erased;

  -- Another spender for the AI cost drill.
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'people-other@example.invalid','2026-02-01T09:00:00Z') returning id into other;
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,cost_usd) values
    (other,'block_suggest','gemini','gemini-3','completed','{}','2026-03-01T13:00:00Z','2026-03-01T13:00:01Z',0.5),
    (internal,'block_suggest','gemini','gemini-3','failed','{}','2026-03-01T13:00:00Z','2026-03-01T13:00:01Z',0.9);

  -- -------------------------------------------------------------------------
  -- Audit enforcement: no people function runs without its audit row in this transaction.
  -- -------------------------------------------------------------------------
  foreach t in array array['search_users', 'user_summary', 'user_timeline', 'drill_users'] loop
    begin
      execute format('select * from analytics_people.%I(p_user_id => $1, p_query => $2, p_filters => $3)', t)
        using main, 'findme', case when t = 'drill_users' then '{"metric":"signups"}'::jsonb else '{}'::jsonb end;
      raise exception '% ran without an audit row', t;
    exception when insufficient_privilege then null; end;
  end loop;
  -- A row for another user or another function does not authorise the read.
  perform admin_app.log_access('admin@example.invalid', 'people.user_timeline', other, '{}', null);
  begin perform analytics_people.user_timeline(p_user_id => main); raise exception 'timeline of an unaudited user ran';
  exception when insufficient_privilege then null; end;
  begin perform analytics_people.user_summary(p_user_id => other); raise exception 'summary ran on a timeline audit row';
  exception when insufficient_privilege then null; end;
  if (select xact_id from admin_app.audit_log order by id desc limit 1) <> pg_current_xact_id()
     or (select people_function from admin_app.audit_log order by id desc limit 1) <> 'user_timeline' then
    raise exception 'audit row not bound to the transaction and function';
  end if;
  -- Authorise the reads below.
  perform admin_app.log_access('admin@example.invalid', 'people.search_users', null, '{}', null, 'findme');
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}', null);
  foreach uid in array array[main, other, restricted, pending, erased] loop
    perform admin_app.log_access('admin@example.invalid', 'people.user_summary', uid, '{}', null);
    perform admin_app.log_access('admin@example.invalid', 'people.user_timeline', uid, '{}', null);
  end loop;

  -- -------------------------------------------------------------------------
  -- search_users
  -- -------------------------------------------------------------------------
  select string_agg(coalesce(s.email, 'null') || ':' || coalesce(s.restricted::text, 'null'), ',' order by ord) into t
  from analytics_people.search_users(p_query => '  FINDME ') with ordinality s(user_id, email, created_at, market, plan_code,
       subscription_status, analytics_consent, is_internal, restricted, cursor, ord);
  if t is distinct from 'FindMe.One@example.invalid:false,findme.admin@example.invalid:false,null:true,x.findme@example.invalid:false' then
    raise exception 'search order / visibility wrong: %', t;
  end if;
  select * into rec from analytics_people.search_users(p_query => 'findme.restricted');
  if rec.user_id <> restricted or not rec.restricted or rec.email is not null or rec.created_at is not null or rec.market is not null or rec.plan_code is not null
     or rec.subscription_status is not null or rec.analytics_consent is not null or rec.is_internal is not null then
    raise exception 'restricted search row leaks: %', row_to_json(rec);
  end if;
  if rec.cursor !~ '^1~0\|' then raise exception 'restricted cursor carries data: %', rec.cursor; end if;
  -- The email of a restricted account is shown only for an exact full-email query.
  if (select email from analytics_people.search_users(p_query => ' FINDME.Restricted@Example.invalid ')) is distinct from 'findme.restricted@example.invalid'
     or (select email from analytics_people.search_users(p_query => restricted::text)) is not null then
    raise exception 'restricted email rule wrong';
  end if;
  select * into rec from analytics_people.search_users(p_query => 'people-main');
  if rec.user_id <> main or rec.market <> 'TR' or rec.plan_code <> 'monthly' or rec.subscription_status <> 'active'
     or not rec.analytics_consent or rec.is_internal or rec.restricted then
    raise exception 'search row wrong: %', row_to_json(rec);
  end if;
  if (select count(*) from analytics_people.search_users(p_query => upper(main::text))) <> 1
     or (select user_id from analytics_people.search_users(p_query => main::text)) <> main then
    raise exception 'uuid search not exact';
  end if;
  if exists(select 1 from analytics_people.search_users(p_query => pending::text))
     or exists(select 1 from analytics_people.search_users(p_query => 'findme.pending'))
     or exists(select 1 from analytics_people.search_users(p_query => 'findme.erased')) then
    raise exception 'pending deletion or erased user found';
  end if;
  -- Paging one row at a time reproduces the full list.
  select array_agg(s.cursor order by ord) into full_cursors
  from analytics_people.search_users(p_query => 'findme') with ordinality s(user_id, email, created_at, market, plan_code,
       subscription_status, analytics_consent, is_internal, restricted, cursor, ord);
  paged_cursors := '{}'; page_cursor := null;
  loop
    select s.cursor into t from analytics_people.search_users(p_query => 'findme', p_limit => 1, p_cursor => page_cursor) s;
    exit when t is null;
    paged_cursors := paged_cursors || t; page_cursor := t;
  end loop;
  if paged_cursors is distinct from full_cursors then raise exception 'search paging differs: % vs %', paged_cursors, full_cursors; end if;
  foreach t in array array['ab', repeat('a', 201), '  ', null] loop
    begin perform analytics_people.search_users(p_query => t); raise exception 'bad query % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  foreach t in array array['garbage', '3~1|' || main, '1~1.5|' || main, '1~1|not-a-uuid', '5|' || main] loop
    begin perform analytics_people.search_users(p_query => 'findme', p_cursor => t); raise exception 'bad search cursor % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform analytics_people.search_users(p_query => 'findme', p_filters => '{"market":"TR"}'); raise exception 'search filter accepted';
  exception when sqlstate '22023' then null; end;
  foreach page_rows in array array[0, 201] loop
    begin perform analytics_people.search_users(p_query => 'findme', p_limit => page_rows); raise exception 'limit % accepted', page_rows;
    exception when sqlstate '22023' then null; end;
  end loop;

  -- -------------------------------------------------------------------------
  -- user_summary
  -- -------------------------------------------------------------------------
  select * into rec from analytics_people.user_summary(p_user_id => main);
  if rec.email <> 'people-main@example.invalid' or rec.locale <> 'tr' or rec.market <> 'TR' or rec.is_internal
     or not rec.analytics_consent or not rec.ai_consent or rec.plan_code <> 'monthly' or rec.subscription_status <> 'active'
     or rec.trial_ends_at <> '2026-03-04T11:35:00Z' or rec.cancel_at_period_end or rec.entitlement_denials <> 5
     or rec.invoices <> 1 or rec.paid_try_native <> 300 or rec.paid_usd_native <> 0 or rec.restricted
     or rec.last_activity_at < '2026-03-01T11:00:00Z' then
    raise exception 'summary wrong: %', row_to_json(rec);
  end if;
  if rec.usage <> '{"tailored_cv_generations":{"used":1,"limit":null},"exports":{"used":2,"limit":null},"ai_actions":{"used":4,"limit":null},"storage_bytes":{"used":99,"limit":null}}'::jsonb then
    raise exception 'usage wrong: %', rec.usage;
  end if;
  -- Without a live subscription the free limits apply.
  select usage into d from analytics_people.user_summary(p_user_id => other);
  if d <> '{"tailored_cv_generations":{"used":0,"limit":3},"exports":{"used":0,"limit":5},"ai_actions":{"used":0,"limit":20},"storage_bytes":{"used":0,"limit":26214400}}'::jsonb then
    raise exception 'free usage wrong: %', d;
  end if;
  -- The range narrows denials and invoices.
  select * into rec from analytics_people.user_summary(p_user_id => main, p_from => '2026-03-03', p_to => '2026-03-31');
  if rec.invoices <> 0 or rec.entitlement_denials <> 5 then raise exception 'summary range ignored: %', row_to_json(rec); end if;
  select * into rec from analytics_people.user_summary(p_user_id => restricted);
  if rec.user_id <> restricted or not rec.restricted or rec.email is not null or rec.created_at is not null or rec.market is not null
     or rec.usage is not null or rec.invoices is not null or rec.last_activity_at is not null or rec.analytics_consent is not null then
    raise exception 'restricted summary leaks: %', row_to_json(rec);
  end if;
  if exists(select 1 from analytics_people.user_summary(p_user_id => pending))
     or exists(select 1 from analytics_people.user_summary(p_user_id => erased))
     or exists(select 1 from analytics_people.user_summary(p_user_id => gen_random_uuid())) then
    raise exception 'pending / erased / unknown summary returned';
  end if;
  begin perform analytics_people.user_summary(); raise exception 'summary without user accepted';
  exception when sqlstate '22023' then null; end;

  -- Error messages: only the app's fixed messages and the path+code contract form pass.
  if analytics_private.safe_error_message('Structured output validation failed: sections.0.title: invalid_type; kind: invalid_enum_value')
       is null
     or analytics_private.safe_error_message('Structured output validation failed: kind: Invalid enum value. Expected ''a''') is not null
     or analytics_private.safe_error_message('Unexpected token S in JSON at position 0: SECRET') is not null
     or analytics_private.safe_error_message('AI processing could not be completed') is null
     or analytics_private.safe_error_message(null) is not null then
    raise exception 'error message allow-list wrong';
  end if;
  -- Stage and language codes are passed through only when code-shaped.
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,progress_stage,input_payload,debug_payload,error_message,started_at,completed_at)
    values(other,'cv_translate','openai','gpt-6','failed','failed','{"target_language":"SECRET text"}','{"stage":"Contains SECRET"}',
           'AI processing could not be completed','2026-02-02T10:00:00Z','2026-02-02T10:00:01Z');
  select detail into d from analytics_people.user_timeline(p_user_id => other, p_filters => '{"event_type":"ai_run","failures_only":true}');
  if d ? 'target_language' or d ? 'failed_stage' then raise exception 'non-code stage / language shown: %', d; end if;

  -- -------------------------------------------------------------------------
  -- user_timeline
  -- -------------------------------------------------------------------------
  create temp table tl on commit drop as
    select * from analytics_people.user_timeline(p_user_id => main, p_limit => 200) with ordinality x(occurred_at, event_type, entity,
      entity_id, status, is_failure, duration_ms, detail, error_code, error_message, cursor, ord);

  select array_agg(distinct event_type order by event_type) into types from tl;
  if types is distinct from (select array_agg(e order by e) from unnest(analytics_private.timeline_event_types()) e) then
    raise exception 'event types missing: got %', types;
  end if;
  if exists(select 1 from tl where concat_ws('|', event_type, entity, status, detail::text, error_code, error_message) like '%SECRET%') then
    raise exception 'content leaked: %', (select string_agg(event_type || ' ' || detail::text, '; ') from tl where detail::text like '%SECRET%');
  end if;
  if exists(select 1 from tl t1 join tl t2 on t2.ord = t1.ord + 1
            where (t1.occurred_at, t1.event_type collate "C", t1.entity_id) <= (t2.occurred_at, t2.event_type collate "C", t2.entity_id)) then
    raise exception 'timeline not newest first';
  end if;
  if (select count(*) from tl) <> (select count(distinct cursor) from tl) then raise exception 'cursors not unique'; end if;

  select * into rec from tl where entity_id = run_fail;
  if not rec.is_failure or rec.status <> 'failed' or rec.duration_ms <> 2500 or rec.error_code <> 'output_semantically_empty'
     or rec.error_message is not null or rec.detail ->> 'failed_stage' <> 'validating_output'
     or rec.detail ? 'target_language' or rec.detail ->> 'model_name' <> 'gpt-6' or (rec.detail ->> 'total_tokens')::int <> 150 then
    raise exception 'failed run wrong: %', row_to_json(rec);
  end if;
  if (select detail ->> 'target_language' from tl where entity_id = run_ok) <> 'en'
     or (select is_failure from tl where entity_id = run_ok) then
    raise exception 'translation run wrong';
  end if;
  if (select detail ->> 'language_name' from tl where event_type = 'master_cv_created') <> 'Türkçe' then
    raise exception 'CV language name missing';
  end if;
  -- Failed or cancelled actions are flagged; the rest are not.
  select string_agg(event_type || ':' || coalesce(status, ''), ',' order by event_type, status) into t from tl where is_failure;
  if t is distinct from 'ai_run:failed,checkout_attempt:expired,cover_letter_export:failed,cv_export:failed,entitlement_denial:denied,entitlement_denial:denied,import:failed,invoice:uncollectible,subscription_event:past_due,tailored_cv_created:draft,tailoring_session:generating,tailoring_task:failed' then
    raise exception 'failure flags wrong: %', t;
  end if;
  if (select error_message from tl where event_type = 'import') <> 'Import parsing failed'
     or (select error_message from tl where event_type = 'cv_export' and is_failure) <> 'Export generation failed'
     or (select error_message from tl where event_type = 'cover_letter_export') is not null
     or (select error_message from tl where event_type = 'tailoring_task') <> 'Something went wrong while preparing this suggestion. Try again.'
     or (select duration_ms from tl where event_type = 'cv_export' and not is_failure) <> 3000
     or (select duration_ms from tl where event_type = 'checkout_attempt') <> 1800000
     or (select duration_ms from tl where event_type = 'tailoring_task') <> 5000
     or (select error_code from tl where event_type = 'entitlement_denial' and status = 'denied' limit 1) is null
     or (select (detail ->> 'amount_paid')::numeric from tl where event_type = 'invoice' and status = 'paid') <> 320
     or (select detail ->> 'to_status' from tl where event_type = 'job_status_changed') <> 'applied'
     or (select occurred_at from tl where event_type = 'entitlement_denial' limit 1) <> '2026-03-07T00:00:00Z' then
    raise exception 'timeline metadata wrong';
  end if;

  -- Paging with ties (two uploads, two denials and the trigger-written subscription events share instants) is stable.
  foreach page_rows in array array[1, 2, 3, 7] loop
    paged_cursors := '{}'; page_cursor := null; pages := 0;
    loop
      select array_agg(x.cursor order by ord) into full_cursors
      from analytics_people.user_timeline(p_user_id => main, p_limit => page_rows, p_cursor => page_cursor)
           with ordinality x(occurred_at, event_type, entity, entity_id, status, is_failure, duration_ms, detail, error_code, error_message, cursor, ord);
      exit when full_cursors is null;
      paged_cursors := paged_cursors || full_cursors;
      page_cursor := full_cursors[cardinality(full_cursors)];
      pages := pages + 1;
      if pages > 200 then raise exception 'paging does not terminate'; end if;
    end loop;
    if paged_cursors is distinct from (select array_agg(cursor order by ord) from tl) then
      raise exception 'paging by % differs from the full timeline', page_rows;
    end if;
  end loop;

  -- Filters and windows.
  if exists(select 1 from analytics_people.user_timeline(p_user_id => main, p_filters => '{"event_type":"ai_run"}') where event_type <> 'ai_run')
     or (select count(*) from analytics_people.user_timeline(p_user_id => main, p_filters => '{"event_type":"ai_run"}')) <> 2
     or (select count(*) from analytics_people.user_timeline(p_user_id => main, p_filters => '{"event_type":["invoice","cv_export"]}')) <> 4 then
    raise exception 'event_type filter wrong';
  end if;
  -- failures_only is applied before paging: one row per page still walks every failure.
  select array_agg(cursor order by ord) into full_cursors from tl where is_failure;
  paged_cursors := '{}'; page_cursor := null;
  loop
    select x.cursor into t from analytics_people.user_timeline(p_user_id => main, p_limit => 1, p_cursor => page_cursor,
      p_filters => '{"failures_only":true}') x;
    exit when t is null;
    paged_cursors := paged_cursors || t; page_cursor := t;
  end loop;
  if paged_cursors is distinct from full_cursors or cardinality(full_cursors) <> 12 then
    raise exception 'failures_only paging wrong: % vs %', paged_cursors, full_cursors;
  end if;
  if (select count(*) from analytics_people.user_timeline(p_user_id => main, p_limit => 200, p_filters => '{"failures_only":false}')) <> (select count(*) from tl)
     or (select count(*) from analytics_people.user_timeline(p_user_id => main, p_filters => '{"failures_only":true,"event_type":"ai_run"}')) <> 1 then
    raise exception 'failures_only combination wrong';
  end if;
  if exists(select 1 from tl where is_failure is null) then raise exception 'is_failure must never be null'; end if;
  -- p_to is inclusive (the whole UTC day).
  select string_agg(event_type, ',' order by occurred_at) into t
  from analytics_people.user_timeline(p_user_id => main, p_from => '2026-03-05', p_to => '2026-03-06');
  if t is distinct from 'subscription_event,invoice' then raise exception 'time window wrong: %', t; end if;
  foreach d in array array['{"event_type":"nope"}', '{"event_type":[]}', '{"event_type":{"a":1}}', '{"market":"TR"}', '[]', '{"failures_only":"yes"}']::jsonb[] loop
    begin perform analytics_people.user_timeline(p_user_id => main, p_filters => d); raise exception 'bad timeline filter % accepted', d;
    exception when sqlstate '22023' then null; end;
  end loop;
  foreach t in array array['nope', '2026-13-01T00:00:00.000000Z|ai_run|' || main, '2026-03-01T00:00:00Z|ai_run|' || main,
                           '2026-03-01T00:00:00.000000Z|AI|' || main, '2026-03-01T00:00:00.000000Z|ai_run|x', '|||'] loop
    begin perform analytics_people.user_timeline(p_user_id => main, p_cursor => t); raise exception 'bad timeline cursor % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform analytics_people.user_timeline(p_user_id => main, p_from => '2026-03-02', p_to => '2026-03-01'); raise exception 'reversed window accepted';
  exception when sqlstate '22023' then null; end;
  begin perform analytics_people.user_timeline(); raise exception 'timeline without user accepted';
  exception when sqlstate '22023' then null; end;
  if exists(select 1 from analytics_people.user_timeline(p_user_id => restricted))
     or exists(select 1 from analytics_people.user_timeline(p_user_id => pending))
     or exists(select 1 from analytics_people.user_timeline(p_user_id => erased))
     or exists(select 1 from analytics_people.user_timeline(p_user_id => gen_random_uuid())) then
    raise exception 'restricted / pending / erased / unknown timeline returned rows';
  end if;

  -- -------------------------------------------------------------------------
  -- drill_users
  -- -------------------------------------------------------------------------
  select string_agg(user_id::text, ',') into t from analytics_people.drill_users(p_filters => '{"metric":"signups","day":"2026-03-01"}');
  if t is distinct from main::text then raise exception 'signups drill wrong: %', t; end if;
  if (select count(*) from analytics_people.drill_users(p_filters => '{"metric":"signups","day":"2026-03-01","include_internal":true}')) <> 2
     or exists(select 1 from analytics_people.drill_users(p_filters => '{"metric":"signups","day":"2026-03-01","market":"GLOBAL"}'))
     or (select count(*) from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"signups","locale":"tr"}')) <> 1
     or (select count(*) from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"signups"}')) <> 3 then
    raise exception 'signups drill filters wrong';
  end if;
  select * into rec from analytics_people.drill_users(p_filters => '{"metric":"ai_failures","day":"2026-03-01"}');
  if rec.user_id <> main or rec.value <> 1 or rec.detail -> 'flows' <> '["tailoring_block"]'::jsonb
     or (select count(*) from analytics_people.drill_users(p_filters => '{"metric":"ai_failures","day":"2026-03-01"}')) <> 1
     or (select count(*) from analytics_people.drill_users(p_filters => '{"metric":"ai_failures","day":"2026-03-01","include_internal":true}')) <> 2
     or exists(select 1 from analytics_people.drill_users(p_filters => '{"metric":"ai_failures","day":"2026-03-01","ai_flow":"cv_translate"}')) then
    raise exception 'ai_failures drill wrong: %', row_to_json(rec);
  end if;
  select string_agg(user_id || '=' || value, ',' order by ord) into t
  from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01"}') with ordinality x(user_id, email, value, detail, cursor, ord);
  if t is distinct from other || '=0.500000,' || main || '=0.210000' then raise exception 'ai_cost_users drill wrong: %', t; end if;
  select cursor into page_cursor from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01"}', p_limit => 1);
  if (select user_id from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01"}', p_limit => 1, p_cursor => page_cursor)) <> main
     or exists(select 1 from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01"}', p_limit => 1,
                 p_cursor => (select cursor from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01"}', p_limit => 1, p_cursor => page_cursor)))) then
    raise exception 'ai_cost_users paging wrong';
  end if;
  if exists(select 1 from analytics_people.drill_users(p_filters => '{"metric":"ai_cost_users","day":"2026-03-01","ai_provider":"anthropic"}')) then
    raise exception 'ai_cost_users provider filter ignored';
  end if;
  foreach d in array array['{}', '{"metric":"nope"}', '{"metric":["signups"]}', '{"metric":"signups","ai_flow":"x"}',
                           '{"metric":"signups","day":"2026-02-30"}', '{"metric":"signups","day":"yesterday"}',
                           '{"metric":"ai_failures","include_internal":"yes"}']::jsonb[] loop
    begin perform analytics_people.drill_users(p_filters => d); raise exception 'bad drill filters % accepted', d;
    exception when sqlstate '22023' then null; end;
  end loop;
  -- Dispatch by naming convention: a new analytics_private.drill_<key> is picked up without changing drill_users,
  -- and drill_users still applies the privacy and internal-account rules to whatever the key returns.
  if not ((select array_agg(key) from admin_app.drill_keys()) @> array['ai_cost_users', 'ai_failures', 'signups'])
     or (select meta ->> 'metric' from admin_app.drill_keys() where key = 'ai_cost_users') <> 'ai_cost'
     or (select description from admin_app.drill_keys() where key = 'signups') is null then
    raise exception 'drill_keys wrong: %', (select json_agg(k) from admin_app.drill_keys() k);
  end if;
  execute format($f$
    create function analytics_private.drill_test_key(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
    returns table (user_id uuid, value numeric, detail jsonb, sort_key text) language sql stable set search_path = ''
    as $b$ select u, 7::numeric, '{}'::jsonb, '7' from unnest(array[%L, %L, %L, %L]::uuid[]) u $b$
  $f$, main, restricted, pending, internal);
  if (select array_agg(user_id) from analytics_people.drill_users(p_filters => '{"metric":"test_key"}')) is distinct from array[main]
     or (select count(*) from analytics_people.drill_users(p_filters => '{"metric":"test_key","include_internal":true}')) <> 2
     or not exists(select 1 from admin_app.drill_keys() where key = 'test_key') then
    raise exception 'convention dispatch or privacy filtering wrong';
  end if;
  drop function analytics_private.drill_test_key(date, date, jsonb, integer, text);
  foreach t in array array['Bad-Key', 'signups;drop', repeat('a', 50), 'test_key'] loop
    begin perform analytics_people.drill_users(p_filters => jsonb_build_object('metric', t)); raise exception 'drill key % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  if has_function_privilege('analytics_api', 'analytics_private.drill_signups(date, date, jsonb, integer, text)', 'execute')
     or not has_function_privilege('analytics_api', 'admin_app.drill_keys()', 'execute') then
    raise exception 'drill helper privileges wrong';
  end if;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"signups"}', p_cursor => '1~5|' || main); raise exception 'ranked drill cursor accepted';
  exception when sqlstate '22023' then null; end;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"signups"}', p_from => '2020-01-01', p_to => '2026-01-01'); raise exception 'drill span accepted';
  exception when sqlstate '22023' then null; end;

  -- Drill keys are documented on the metrics without losing their other metadata.
  select meta into d from admin_app.metric_catalog() where name = 'ai_cost' and kind = 'metric';
  if d -> 'drill' <> 'true'::jsonb or d ->> 'title' <> 'AI cost' or not d ? 'measures' then
    raise exception 'ai_cost drill meta wrong: %', d;
  end if;
  select meta into d from admin_app.metric_catalog() where name = 'signups' and kind = 'metric';
  if d -> 'drill' <> 'true'::jsonb or d ->> 'title' <> 'Signups' then raise exception 'signups drill meta wrong: %', d; end if;
  select meta into d from admin_app.metric_catalog() where name = 'drill_users' and kind = 'people';
  if not (d -> 'drill_metrics' ?& array['signups', 'ai_failures', 'ai_cost_users']) or d ->> 'shape' <> 'table'
     or d -> 'drill_metrics' -> 'ai_cost_users' ->> 'metric' <> 'ai_cost' or d -> 'drill_metrics' -> 'signups' ->> 'metric' <> 'signups' then
    raise exception 'drill_users meta wrong: %', d;
  end if;
  -- Every metric marked drillable has a drill key.
  if exists(select 1 from admin_app.metric_catalog() m where m.kind = 'metric' and m.meta -> 'drill' = 'true'::jsonb
            and not exists(select 1 from jsonb_each(d -> 'drill_metrics') k where k.value ->> 'metric' = m.name)) then
    raise exception 'drillable metric without a drill key';
  end if;
  if (select count(*) from admin_app.metric_catalog() where kind = 'people' and meta ->> 'shape' = 'table') <> 4 then
    raise exception 'people catalog incomplete';
  end if;

  -- -------------------------------------------------------------------------
  -- Audit log
  -- -------------------------------------------------------------------------
  if not has_function_privilege('analytics_api', 'admin_app.log_access(text, text, uuid, jsonb, text, text)', 'execute')
     or not has_function_privilege('analytics_api', 'admin_app.audit_recent(integer)', 'execute') then
    raise exception 'analytics_api cannot audit';
  end if;
  foreach t in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(t, 'admin_app.log_access(text, text, uuid, jsonb, text, text)', 'execute')
       or has_function_privilege(t, 'admin_app.audit_recent(integer)', 'execute')
       or has_table_privilege(t, 'admin_app.audit_log', 'select, insert, update, delete, truncate') then
      raise exception '% can reach the audit log', t;
    end if;
  end loop;
  foreach t in array array['analytics_api', 'anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(t, 'admin_app.audit_pepper', 'select, insert, update, delete') then raise exception '% can reach the pepper', t; end if;
  end loop;
  if (select count(*) from admin_app.audit_pepper) <> 1 or (select length(pepper) from admin_app.audit_pepper) <> 32 then
    raise exception 'pepper missing';
  end if;
  if exists(select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'admin_app.log_access(text, text, uuid, jsonb, text, text)'::regprocedure and a.grantee = 0) then
    raise exception 'log_access executable by PUBLIC';
  end if;

  set local role analytics_api;
  audit_id := admin_app.log_access(' Admin@Example.invalid ', 'people.user_timeline', main,
    '{"limit":50}', 'req_abc123', '  FindMe ');
  audit_missing := admin_app.log_access('admin@example.invalid', 'people.user_summary', gen_random_uuid(), '{}', null);
  begin insert into admin_app.audit_log(admin_email, action) values('x@y.z', 'people.search'); raise exception 'analytics_api wrote the table';
  exception when insufficient_privilege then null; end;
  begin perform 1 from admin_app.audit_log; raise exception 'analytics_api read the table';
  exception when insufficient_privilege then null; end;
  begin perform analytics_people.search_users(p_query => 'findme'); exception when others then raise exception 'analytics_api cannot search: %', sqlerrm; end;
  begin perform analytics_people.user_summary(p_user_id => internal); raise exception 'analytics_api read without an audit row';
  exception when insufficient_privilege then null; end;
  perform admin_app.log_access('admin@example.invalid', 'people.user_summary', internal, '{}', null);
  begin perform analytics_people.user_summary(p_user_id => internal); exception when others then raise exception 'audited read refused: %', sqlerrm; end;
  begin perform 1 from admin_app.audit_pepper; raise exception 'analytics_api read the pepper';
  exception when insufficient_privilege then null; end;
  reset role;

  expected_hmac := encode(extensions.hmac(convert_to('findme', 'UTF8'), (select pepper from admin_app.audit_pepper), 'sha256'), 'hex');
  select * into rec from admin_app.audit_log where id = audit_id;
  if rec.admin_email <> 'admin@example.invalid' or rec.action <> 'people.user_timeline' or rec.target_user_id <> main
     or rec.params <> jsonb_build_object('limit', 50, 'query_hmac', expected_hmac) or rec.request_id <> 'req_abc123' or rec.at is null
     or rec.people_function <> 'user_timeline' or rec.xact_id <> pg_current_xact_id() or row_to_json(rec)::text ilike '%findme%' then
    raise exception 'audit row wrong: %', row_to_json(rec);
  end if;
  select * into rec from admin_app.audit_log where id = audit_missing;
  if rec.target_user_id is not null or rec.params <> '{"target_user_missing":true}'::jsonb then
    raise exception 'unknown target not handled: %', row_to_json(rec);
  end if;
  perform admin_app.log_access('admin@example.invalid', 'audit.read', null, '{}', null);
  if (select array_agg(a.id) from admin_app.audit_recent(500) a)[1] <> (select max(id) from admin_app.audit_log)
     or (select count(*) from admin_app.audit_recent(2)) <> 2
     or array_position((select array_agg(a.id) from admin_app.audit_recent(500) a), audit_missing)
        <> array_position((select array_agg(a.id) from admin_app.audit_recent(500) a), audit_id) - 1 then
    raise exception 'audit_recent order wrong';
  end if;
  foreach d in array array['{"q":"x"}', '{"query":"x"}', '{"query_hmac":"x"}', '{"query_sha256":"x"}', '[]', ('{"a":"' || repeat('x', 9000) || '"}')]::jsonb[] loop
    begin perform admin_app.log_access('a@b.c', 'people.search_users', null, d, null); raise exception 'bad params accepted';
    exception when sqlstate '22023' then null; end;
  end loop;
  foreach t in array array['people', 'People.search', 'people.', 'export csv', '', 'people.not_a_function', 'export.csv'] loop
    begin perform admin_app.log_access('a@b.c', t, null, '{}', null); raise exception 'bad action % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  foreach t in array array[null, 'nobody', ''] loop
    begin perform admin_app.log_access(t, 'people.search_users', null, '{}', null); raise exception 'bad email % accepted', t;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform admin_app.log_access('a@b.c', 'people.search_users', null, '{}', 'bad id!'); raise exception 'bad request id accepted';
  exception when sqlstate '22023' then null; end;

  -- Append-only, even for the owner.
  begin update admin_app.audit_log set action = 'people.other' where id = audit_id; raise exception 'audit update allowed';
  exception when insufficient_privilege then null; end;
  begin update admin_app.audit_log set target_user_id = null where id = audit_id; raise exception 'audit target nulled for a live user';
  exception when insufficient_privilege then null; end;
  begin delete from admin_app.audit_log where id = audit_id; raise exception 'audit delete allowed';
  exception when insufficient_privilege then null; end;
  begin truncate admin_app.audit_log; raise exception 'audit truncate allowed';
  exception when insufficient_privilege then null; end;

  -- Erasing the account nulls the reference and keeps the record.
  delete from public.job_status_history where changed_by_user_id = main;
  delete from public.subscription_events where user_id = main;
  delete from public.billing_invoices where user_id = main;
  delete from public.subscriptions where user_id = main;
  delete from public.users where id = main;
  select * into rec from admin_app.audit_log where id = audit_id;
  if not found or rec.target_user_id is not null or rec.action <> 'people.user_timeline' or rec.params ->> 'query_hmac' <> expected_hmac then
    raise exception 'erasure did not null the audit reference: %', row_to_json(rec);
  end if;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics people functions, privacy masking, cursors, drill-down and the append-only audit log passed' as verification;
rollback;
