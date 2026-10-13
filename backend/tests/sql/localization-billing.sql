begin;
do $$
declare u uuid; other_user uuid; master_en uuid; master_tr uuid; prior_revision uuid; f uuid; imported uuid; run_id uuid; nonce jsonb; retried jsonb; updated public.master_cvs; completed public.ai_runs;
begin
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'localization-fixture@example.test') returning id into u;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'other-fixture@example.test') returning id into other_user;
  insert into public.master_cvs(user_id,title,language,current_content,source_type)
    values(u,'English master','en','{"version":"v1","language":"en","metadata":{},"sections":[]}','scratch') returning id into master_en;
  insert into public.master_cvs(user_id,title,language,current_content,source_type)
    values(u,'Turkish master','tr','{"version":"v1","language":"tr","metadata":{},"sections":[]}','scratch') returning id into master_tr;
  begin
    insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Duplicate','en','{"language":"en"}','scratch');
    raise exception 'duplicate master unexpectedly allowed';
  exception when unique_violation then null; end;
  begin
    update public.master_cvs set language='tr',current_content='{"language":"tr"}' where id=master_en;
    raise exception 'relabel unexpectedly allowed';
  exception when raise_exception then if sqlerrm <> 'cv_language_requires_translation' then raise; end if; end;
  if public.lock_billing_market(u,'TR','TR') <> 'TR' then raise exception 'market not locked'; end if;
  if public.lock_billing_market(u,'GLOBAL','US') <> 'TR' then raise exception 'market was changed'; end if;
  nonce:=public.reserve_billing_checkout(u,'weekly-key');
  retried:=public.reserve_billing_checkout(u,'weekly-key');
  if nonce->>'nonce' is distinct from retried->>'nonce' then raise exception 'checkout retry was not idempotent'; end if;
  begin
    perform public.reserve_billing_checkout(u,'monthly-key');
    raise exception 'different pending checkout allowed';
  exception when raise_exception then if sqlerrm <> 'checkout_already_pending' then raise; end if; end;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(u,'source_upload','imports','fixture/cv.docx','cv.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',100) returning id into f;
  insert into public.imports(user_id,source_file_id,status,parsed_content) values(u,f,'parsed','{"version":"v1","language":"en","metadata":{"full_name":"Updated"},"sections":[]}') returning id into imported;
  updated:=public.replace_master_from_import(u,master_en,imported,'{"version":"v1","language":"en","metadata":{"full_name":"Updated"},"sections":[]}','Updated');
  if updated.id <> master_en then raise exception 'reimport changed master ID'; end if;
  if (select count(*) from public.cv_block_revisions where master_cv_id=master_en and block_id='__document__') <> 1 then raise exception 'missing prior revision'; end if;
  perform public.replace_master_from_import(u,master_en,imported,'{"language":"en"}',null);
  if (select count(*) from public.cv_block_revisions where master_cv_id=master_en and block_id='__document__') <> 1 then raise exception 'reimport retry added revisions'; end if;
  select id into prior_revision from public.cv_block_revisions where master_cv_id=master_en and block_id='__document__' limit 1;
  updated:=public.restore_master_document_revision(u,master_en,prior_revision);
  if updated.current_content->'metadata' <> '{}'::jsonb then raise exception 'prior master content not restored'; end if;
  if (select count(*) from public.cv_block_revisions where master_cv_id=master_en and block_id='__document__') <> 2 then raise exception 'restore did not preserve current content'; end if;
  if not exists(select 1 from public.master_cvs where id=master_tr and not is_deleted) then raise exception 'other language was deleted'; end if;
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload)
  values(u,master_en,'cv_translate','mock','fixture','pending','persisting_result','{}') returning id into run_id;
  completed:=public.complete_cv_translation_run(other_user,run_id,'{}',20,null);
  if completed.id is not null then raise exception 'other owner completed translation'; end if;
  completed:=public.complete_cv_translation_run(u,run_id,'{"current_content":{"language":"tr"}}',20,null);
  if completed.status <> 'completed' then raise exception 'translation not completed'; end if;
  perform public.complete_cv_translation_run(u,run_id,'{}',20,null);
  if (select ai_actions_count from public.usage_counters where user_id=u) <> 1 then raise exception 'translation retry charged twice'; end if;
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload)
  values(u,master_en,'cv_translate','mock','fixture','pending','persisting_result','{}') returning id into run_id;
  begin
    perform public.complete_cv_translation_run(u,run_id,'{}',1,null);
    raise exception 'translation completed above allowance';
  exception when raise_exception then if sqlerrm <> 'translation_allowance_exhausted' then raise; end if; end;
  if (select status from public.ai_runs where id=run_id) <> 'pending' or (select ai_actions_count from public.usage_counters where user_id=u) <> 1 then raise exception 'failed translation partially completed or charged'; end if;
  if has_table_privilege('authenticated','public.billing_markets','UPDATE') or has_function_privilege('authenticated','public.lock_billing_market(uuid,text,text)','EXECUTE') or has_function_privilege('anon','public.replace_master_from_import(uuid,uuid,uuid,jsonb,text)','EXECUTE') then raise exception 'browser pricing/write bypass'; end if;
end $$;
rollback;
select 'Master language limits, reimport revisions, immutable billing markets and checkout reservations passed' as verification;
