begin;
-- A write failure after updating the master must roll back the revision too.
create function public.fixture_reject_translation_apply() returns trigger language plpgsql as $$
begin
  if new.model_name='atomic-failure' and new.output_payload ? 'applied_master_cv_id' then raise exception 'fixture_replacement_failure'; end if;
  return new;
end $$;
create trigger fixture_reject_translation_apply before update on public.ai_runs for each row execute function public.fixture_reject_translation_apply();
do $$
declare
  u uuid; outsider uuid; source_id uuid; target_id uuid; linked_id uuid; run_id uuid; failed_id uuid; broken_id uuid;
  source_content jsonb := '{"version":"v1","language":"en","metadata":{"full_name":"Source"},"sections":[]}';
  previous jsonb := '{"version":"v1","language":"tr","metadata":{"full_name":"Existing"},"sections":[]}';
  translated_content jsonb := '{"version":"v1","language":"tr","metadata":{"full_name":"Source","font_scale":0.85,"spacing_scale":0.8,"layout_scale":1.1},"sections":[]}';
  snapshot jsonb; updated public.master_cvs;
begin
  insert into public.users(auth_user_id,email,ai_processing) values(gen_random_uuid(),'translation-replace@example.test',true) returning id into u;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'translation-outsider@example.test') returning id into outsider;
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Source CV','en',source_content,'scratch') returning id into source_id;
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'My Turkish CV','tr',previous,'import') returning id into target_id;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,status) values(u,target_id,'Linked CV','tr',previous,'draft') returning id into linked_id;
  snapshot := jsonb_build_object('target_language','tr','source',jsonb_build_object('template_id',null,'source_type','scratch'),'replace_master_cv_id',target_id);
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload)
    values(u,source_id,'cv_translate','mock','fixture','pending','queued',snapshot) returning id into run_id;
  begin
    perform public.replace_master_from_translation(u,target_id,run_id,'Translated summary');
    raise exception 'pending run replaced the target';
  exception when raise_exception then if sqlerrm<>'translation_not_ready' then raise; end if; end;
  if (select current_content from public.master_cvs where id=target_id)<>previous then raise exception 'target changed before translation completed'; end if;
  update public.ai_runs set status='completed',progress_stage='completed',completed_at=now(),output_payload=jsonb_build_object('current_content',translated_content) where id=run_id;
  begin
    perform public.replace_master_from_translation(outsider,target_id,run_id,null);
    raise exception 'another user applied the run';
  exception when raise_exception then if sqlerrm<>'translation_not_found' then raise; end if; end;
  begin
    perform public.replace_master_from_translation(u,source_id,run_id,null);
    raise exception 'source overwritten';
  exception when raise_exception then if sqlerrm<>'cannot_replace_translation_source' then raise; end if; end;
  update public.cv_languages set is_active=false where code='tr';
  begin
    perform public.replace_master_from_translation(u,target_id,run_id,null);
    raise exception 'disabled target language replaced';
  exception when raise_exception then if sqlerrm<>'unsupported_cv_language' then raise; end if; end;
  update public.cv_languages set is_active=true where code='tr';
  update public.master_cvs set is_deleted=true where id=source_id;
  begin
    perform public.replace_master_from_translation(u,target_id,run_id,null);
    raise exception 'deleted source applied';
  exception when raise_exception then if sqlerrm<>'translation_source_not_found' then raise; end if; end;
  update public.master_cvs set is_deleted=false where id=source_id;
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload,output_payload,completed_at)
    values(u,source_id,'cv_translate','mock','fixture','failed','failed',snapshot,jsonb_build_object('current_content',translated_content),now()) returning id into failed_id;
  begin
    perform public.replace_master_from_translation(u,target_id,failed_id,null);
    raise exception 'failed run applied';
  exception when raise_exception then if sqlerrm<>'translation_not_ready' then raise; end if; end;
  insert into public.ai_runs(user_id,master_cv_id,flow_type,provider,model_name,status,progress_stage,input_payload,output_payload,completed_at)
    values(u,source_id,'cv_translate','mock','atomic-failure','completed','completed',snapshot,jsonb_build_object('current_content',translated_content),now()) returning id into broken_id;
  begin
    perform public.replace_master_from_translation(u,target_id,broken_id,null);
    raise exception 'write failure did not roll back';
  exception when raise_exception then if sqlerrm<>'fixture_replacement_failure' then raise; end if; end;
  if (select current_content from public.master_cvs where id=target_id)<>previous then raise exception 'write failure changed target'; end if;
  if exists(select 1 from public.cv_block_revisions where master_cv_id=target_id) then raise exception 'write failure left partial revision'; end if;
  updated := public.replace_master_from_translation(u,target_id,run_id,'Translated summary');
  if updated.id<>target_id or updated.title<>'My Turkish CV' or updated.is_deleted or updated.source_type<>'scratch' or updated.current_content<>translated_content then raise exception 'wrong replacement'; end if;
  if (select current_content from public.master_cvs where id=source_id)<>source_content then raise exception 'source changed'; end if;
  if not exists(select 1 from public.cv_block_revisions where master_cv_id=target_id and block_id='__document__' and content_snapshot=previous) then raise exception 'prior content not backed up'; end if;
  if not exists(select 1 from public.tailored_cvs where id=linked_id and master_cv_id=target_id and current_content=previous) then raise exception 'linked CV changed'; end if;
  update public.master_cvs set current_content=jsonb_set(current_content,'{metadata,full_name}','"Later edit"') where id=target_id;
  updated := public.replace_master_from_translation(u,target_id,run_id,'Ignored summary');
  if updated.current_content->'metadata'->>'full_name'<>'Later edit' then raise exception 'retry overwrote subsequent edit'; end if;
  if (select count(*) from public.cv_block_revisions where master_cv_id=target_id and block_id='__document__')<>1 then raise exception 'retry duplicated backup'; end if;
  if exists(select 1 from public.usage_counters where user_id=u and ai_actions_count>0) then raise exception 'apply charged an AI action'; end if;
  if has_function_privilege('authenticated','public.replace_master_from_translation(uuid,uuid,uuid,text)','EXECUTE') or has_function_privilege('anon','public.replace_master_from_translation(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'browser can bypass confirmation'; end if;
end $$;
rollback;
select 'Translation replacement safety, rollback, ownership, revisions and idempotency passed' as verification;
