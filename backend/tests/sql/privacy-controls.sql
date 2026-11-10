begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid(); run uuid; imp uuid; job uuid; rev integer; m uuid; t uuid; j uuid; c uuid; s uuid; tbl text; other uuid:=gen_random_uuid();
begin
  insert into public.users(id,auth_user_id,email) values(u,a,'privacy-test@example.invalid');
  if (select ai_processing or analytics from public.users where id=u) then raise exception 'Historical consent inferred'; end if;
  if has_table_privilege('authenticated','public.users','update') then raise exception 'Protection fields writable'; end if;
  if has_table_privilege('anon','public.privacy_receipts','select') then raise exception 'Receipts exposed'; end if;
  if has_function_privilege('authenticated','public.request_account_erasure(uuid,uuid)','execute') then raise exception 'Erasure RPC exposed'; end if;
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,answers)
    values(g,'proof','cv.pdf','application/pdf',20,'guests/test/'||g,'parsed','{"schema_version":"1.0","language":"en","sections":[]}','{"career":"student","source":"friend"}');
  perform public.record_privacy_choices(null,g,'2026-10-06.1',true,true,'openai');
  select privacy_revision into rev from public.guest_imports where id=g;
  perform public.record_privacy_choices(null,g,'2026-10-06.1',true,false,'openai');
  if (select privacy_revision from public.guest_imports where id=g)<>rev then raise exception 'Analytics invalidated CV processing'; end if;
  perform public.record_privacy_choices(null,g,'2026-10-06.1',true,true,'openai');
  if (select count(distinct purpose) from public.privacy_receipts where guest_id=g)<>3 then raise exception 'Independent receipts missing'; end if;
  imp:=public.claim_guest_import(g,'proof',u);
  if (select not ai_processing or not analytics or ai_provider<>'openai' from public.users where id=u) then raise exception 'Privacy transfer missing'; end if;
  if exists(select 1 from public.privacy_receipts where guest_id=g) or (select count(distinct purpose) from public.privacy_receipts where user_id=u)<>3 then raise exception 'Receipts not transferred'; end if;
  if (select onboarding_answers->>'career' from public.users where id=u)<>'student' then raise exception 'Personalization missing'; end if;
  if (select onboarding_answers ? 'source' from public.users where id=u) then raise exception 'Referral copied into profile'; end if;
  if (select answers from public.guest_imports where id=g)<>'{}'::jsonb then raise exception 'Claim answers duplicated'; end if;
  perform public.claim_guest_import(g,'proof',u);
  if (select sum(count) from public.onboarding_monthly_stats where metric='signup')<>1 then raise exception 'Double counted claim'; end if;
  if exists(select 1 from public.onboarding_stats_report) then raise exception 'Small report cells exposed'; end if;

  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload) values(u,'cv_parse','openai','test','pending','{}') returning id into run;
  perform public.record_privacy_choices(u,null,'2026-10-06.1',false,true,null);
  if (select status from public.ai_runs where id=run)<>'failed' then raise exception 'Pending call not invalidated'; end if;
  if not exists(select 1 from public.privacy_receipts where user_id=u and purpose='ai_processing' and retain_until is not null) then raise exception 'Withdrawal retention missing'; end if;
  -- Withdraw/re-enable must not revive an old outstanding call.
  perform public.record_privacy_choices(u,null,'2026-10-06.1',true,true,'openai');
  begin
    update public.ai_runs set status='completed',completed_at=now(),output_payload='{}' where id=run;
    raise exception 'Stale AI result accepted';
  exception when others then if sqlerrm<>'ai_permission_changed' then raise; end if; end;

  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content)
    values(d,'delete-proof','cv.pdf','application/pdf',20,'guests/test/'||d,'parsed','{}');
  perform public.delete_guest_import(d,'delete-proof'); perform public.delete_guest_import(d,'delete-proof');
  if (select deleted_at is null or parsed_content is not null from public.guest_imports where id=d) then raise exception 'Guest erasure missing'; end if;
  if not exists(select 1 from public.privacy_guest_erasure_ledger where guest_id=d) then raise exception 'Guest restore ledger missing'; end if;
  begin update public.guest_imports set deleted_at=null where id=d; raise exception 'Guest erasure revived';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  if public.begin_guest_import_parse(d,gen_random_uuid()) then raise exception 'Deleted guest acquired lease'; end if;
  begin perform public.claim_guest_import(d,'delete-proof',u); raise exception 'Deleted guest claimed';
  exception when others then if sqlerrm<>'guest_not_found' then raise; end if; end;
  begin perform public.delete_guest_import(g,'proof'); raise exception 'Account-owned guest deleted';
  exception when others then if sqlerrm<>'guest_claimed' then raise; end if; end;
  -- Database file ownership wins even if a legacy guest claim flag is missing.
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path)
    values(legacy,'legacy-proof','cv.pdf','application/pdf',20,'guests/test/'||legacy);
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(u,'source_upload','imports','guests/test/'||legacy,'cv.pdf','application/pdf',20);
  begin perform public.delete_guest_import(legacy,'legacy-proof'); raise exception 'Legacy account-owned file deleted';
  exception when others then if sqlerrm<>'guest_claimed' then raise; end if; end;

  -- Exercise the circular job/CV/letter links with the real erasure order.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'CV','en','{}','scratch') returning id into m;
  insert into public.jobs(user_id,company_name,job_title,job_description) values(u,'Test','Test','Test') returning id into j;
  insert into public.tailored_cvs(user_id,master_cv_id,job_id,title,language,current_content) values(u,m,j,'CV','en','{}') returning id into t;
  insert into public.cover_letters(user_id,job_id,tailored_cv_id,title) values(u,j,t,'Letter') returning id into c;
  update public.jobs set tailored_cv_id=t,cover_letter_id=c where id=j;
  -- The run is linked to an import: erasing imports first would null import_id and trip the AI privacy guard.
  insert into public.ai_runs(user_id,tailored_cv_id,import_id,flow_type,provider,model_name,status,input_payload) values(u,t,imp,'block_suggest','mock','test','pending','{}') returning id into run;
  insert into public.ai_suggestions(user_id,ai_run_id,tailored_cv_id,action_type,suggested_content) values(u,run,t,'rewrite','{}') returning id into s;
  insert into public.cv_block_revisions(user_id,cv_kind,tailored_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,ai_suggestion_id) values(u,'tailored',t,'test','test',1,'{}','ai',s);
  perform public.set_privacy_restriction(u,null,true);
  begin update public.jobs set notes='Late edit' where id=j; raise exception 'Restricted processing allowed';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  perform public.set_privacy_restriction(u,null,false);
  if (select ai_processing or analytics from public.users where id=u) then raise exception 'Lifting restriction inferred consent'; end if;
  if exists(select 1 from storage.buckets where public) then raise exception 'CV bucket public'; end if;
  insert into storage.objects(bucket_id,name) values('imports','users/'||u||'/orphan.pdf'),('imports','users/'||a||'/other-user.pdf');
  if not exists(select 1 from public.privacy_storage_inventory(u,0,500) where path='users/'||u||'/orphan.pdf') then raise exception 'Orphan object missing'; end if;
  if exists(select 1 from public.privacy_storage_inventory(u,0,500) where path='users/'||a||'/other-user.pdf') then raise exception 'Foreign object inventoried'; end if;
  -- Cleanup drops a claimed guest row a day after upload; the account's files row must still bring its guests/ object into erasure.
  delete from public.guest_imports where id=g;
  if not exists(select 1 from public.privacy_storage_inventory(u,0,500) where bucket='imports' and path='guests/test/'||g) then raise exception 'Claimed guest file not inventoried'; end if;
  insert into public.users(id,auth_user_id,email) values(other,gen_random_uuid(),'privacy-other@example.invalid');
  -- The path index only covers live rows, so a second account can still hold a soft-deleted row for the same object.
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,is_deleted) values(other,'source_upload','imports','guests/test/'||g,'cv.pdf','application/pdf',20,true);
  if exists(select 1 from public.privacy_storage_inventory(u,0,500) where path='guests/test/'||g) or exists(select 1 from public.privacy_storage_inventory(other,0,500) where path='guests/test/'||g) then raise exception 'Shared guest path inventoried'; end if;
  delete from public.files where user_id=other; delete from public.users where id=other;
  job:=public.request_account_erasure(u,a);
  if public.request_account_erasure(u,a)<>job then raise exception 'Erasure not idempotent'; end if;
  begin
    insert into public.users(auth_user_id,email) values(a,'stale-auth@example.invalid');
    raise exception 'Erased identity recreated';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  begin
    update public.users set full_name='Late profile' where id=u;
    raise exception 'Erased profile updated';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  if not exists(select 1 from public.privacy_erasure_ledger where user_id=u) then raise exception 'Restore ledger missing'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  if public.is_current_user(u) then raise exception 'Revoked JWT still has RLS access'; end if;
  begin
    insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes) values(u,'source_upload','imports','late','late.pdf','application/pdf',20);
    raise exception 'Late work recreated user data';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  begin
    insert into public.privacy_jobs(user_id,subject_user_id,kind) values(u,u,'export');
    raise exception 'Late export registered';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  if not public.acquire_privacy_job(job) or public.acquire_privacy_job(job) then raise exception 'Concurrent job lease accepted'; end if;
  foreach tbl in array array['cover_letter_exports','exports','cv_score_improvements','cv_block_revisions','ai_suggestions','tailoring_session_tasks','tailoring_sessions','ai_runs','imports','cover_letters','tailored_cvs','jobs','master_cvs','files','usage_counters','subscriptions'] loop
    execute format('delete from public.%I where user_id=$1',tbl) using u;
  end loop;
  delete from public.guest_imports where claimed_user_id=u;
  delete from public.users where id=u;
  if exists(select 1 from public.master_cvs where user_id=u) or exists(select 1 from public.files where user_id=u) then raise exception 'Erasure dependency order failed'; end if;
end $$;

-- Erasure must not depend on table order: the database's own ON DELETE SET NULL clearing
-- passes the privacy guards, any other write for an erased or restricted subject does not.
-- fk_hits records every column a successful UPDATE set to NULL; probes run nested writes
-- from an AFTER DELETE trigger on imports, after the parent row is gone but before its RI action.
create temp table fk_hits(link text); create temp table probes(name text,stmt text); create temp table probe_results(name text,result text);
create function public.test_fk_hit() returns trigger language plpgsql as $$
begin insert into fk_hits select tg_table_name||'.'||n.key from jsonb_each(to_jsonb(new)) n where n.value='null' and to_jsonb(old)->n.key<>'null'; return null; end $$;
create function public.test_probe() returns trigger language plpgsql as $$
declare p record;
begin
  for p in select * from probes order by name loop
    begin execute p.stmt; insert into probe_results values(p.name,'ok');
    exception when others then insert into probe_results values(p.name,sqlerrm); end;
  end loop;
  delete from probes; return null;
end $$;
do $$ declare r regclass; begin
  foreach r in array array['ai_runs','imports','master_cvs','tailored_cvs','jobs','cover_letters','cv_block_revisions','ai_suggestions','tailoring_sessions','tailoring_session_tasks','exports','privacy_jobs']::regclass[] loop
    execute format('create trigger zz_fk_hit after update on %s for each row execute function public.test_fk_hit()',r);
  end loop;
end $$;
-- "A_" sorts before "RI_ConstraintTrigger", so the probe runs before the SET NULL action.
create trigger "A_probe" after delete on public.imports for each row execute function public.test_probe();
do $$
declare u uuid; a uuid; h uuid; tpl uuid; f uuid; m uuid; im uuid; j uuid; t uuid; c uuid; s uuid; k uuid; r0 uuid; r uuid; r2 uuid; sg uuid; ord text[]; tbl text; i integer:=0; got text;
begin
  -- 1: the order before 5fe12e4 (imports before ai_runs); 2 and 3: parents first, as far as RESTRICT FKs and
  -- the cv_block_revisions scope check (which turns its CV SET NULLs into a hard error) allow.
  foreach ord slice 1 in array array[
    ['cover_letter_exports','exports','cv_score_improvements','imports','cv_block_revisions','ai_suggestions','tailoring_session_tasks','tailoring_sessions','ai_runs','cover_letters','tailored_cvs','jobs','master_cvs','files','usage_counters','subscriptions'],
    ['jobs','tailoring_session_tasks','ai_suggestions','cv_block_revisions','imports','tailored_cvs','master_cvs','ai_runs','tailoring_sessions','cover_letters','exports','cover_letter_exports','cv_score_improvements','files','usage_counters','subscriptions'],
    ['cv_block_revisions','ai_runs','tailored_cvs','master_cvs','imports','cover_letters','jobs','tailoring_session_tasks','tailoring_sessions','ai_suggestions','exports','cover_letter_exports','cv_score_improvements','files','usage_counters','subscriptions']] loop
    i:=i+1; u:=gen_random_uuid(); a:=gen_random_uuid(); h:=gen_random_uuid();
    insert into public.users(id,auth_user_id,email) values(u,a,'order-'||i||'@example.invalid'),(h,gen_random_uuid(),'editor-'||i||'@example.invalid');
    insert into public.cv_templates(name,slug,status) values('T','erasure-order-'||i,'active') returning id into tpl;
    insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes) values(u,'source_upload','imports','users/'||u||'/cv.pdf','cv.pdf','application/pdf',20) returning id into f;
    insert into public.master_cvs(user_id,title,language,current_content,source_type,template_id) values(u,'CV','en','{}','scratch',tpl) returning id into m;
    insert into public.imports(user_id,source_file_id,status,target_master_cv_id) values(u,f,'parsed',m) returning id into im;
    insert into public.jobs(user_id,company_name,job_title,job_description,notes) values(u,'Test','Test','Test','n') returning id into j;
    insert into public.tailored_cvs(user_id,master_cv_id,job_id,title,language,current_content,template_id) values(u,m,j,'CV','en','{}',tpl) returning id into t;
    insert into public.cover_letters(user_id,job_id,tailored_cv_id,title) values(u,j,t,'Letter') returning id into c;
    update public.jobs set tailored_cv_id=t,cover_letter_id=c where id=j;
    insert into public.tailoring_sessions(user_id,base_snapshot,job_id,tailored_cv_id) values(u,'{}',j,t) returning id into s;
    insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload) values(u,'tailoring_analysis','mock','test','pending','{}') returning id into r0;
    insert into public.ai_runs(user_id,import_id,master_cv_id,tailored_cv_id,job_id,parent_run_id,flow_type,provider,model_name,status,input_payload)
      values(u,im,m,t,j,r0,'tailoring_block','mock','test','pending','{}') returning id into r;
    insert into public.ai_runs(user_id,import_id,flow_type,provider,model_name,status,input_payload) values(u,im,'cv_parse','mock','test','pending','{}') returning id into r2;
    update public.tailoring_sessions set analysis_run_id=r where id=s;
    insert into public.tailoring_session_tasks(session_id,user_id,kind,ai_run_id) values(s,u,'block',r) returning id into k;
    insert into public.ai_suggestions(user_id,ai_run_id,tailored_cv_id,tailoring_task_id,action_type,suggested_content) values(u,r,t,k,'rewrite','{}') returning id into sg;
    insert into public.cv_block_revisions(user_id,cv_kind,tailored_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,ai_suggestion_id,created_by_user_id) values(u,'tailored',t,'b','b',1,'{}','ai',sg,h);
    insert into public.exports(user_id,tailored_cv_id,format,status,template_id) values(u,t,'pdf','processing',tpl);
    insert into public.privacy_jobs(user_id,subject_user_id,kind) values(u,u,'export');
    update public.privacy_jobs set status='complete' where subject_user_id=u and kind='export';
    if i=1 then
      -- A restricted subject may still delete its own rows; the SET NULL on the child run must pass.
      perform public.set_privacy_restriction(u,null,true);
      delete from public.ai_runs where id=r0;
      perform public.set_privacy_restriction(u,null,false);
    end if;
    perform public.request_account_erasure(u,a);
    if i>1 then delete from public.ai_runs where id=r0; end if;
    delete from public.cv_templates where id=tpl;
    delete from public.users where id=h;
    if i=1 then
      -- Direct application writes stay rejected, even one that only nulls a foreign key.
      begin update public.ai_runs set import_id=null where id=r; raise exception 'Late FK clear accepted';
      exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
      begin update public.ai_runs set model_name='late' where id=r; raise exception 'Late AI run edit accepted';
      exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
      begin update public.jobs set tailored_cv_id=null where id=j; raise exception 'Late job FK clear accepted';
      exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
      insert into probes values
        ('a',format('update public.ai_runs set import_id=null,model_name=%L where id=%L','probe',r)),
        ('b',format('update public.ai_runs set import_id=null,master_cv_id=null where id=%L',r)),
        ('c',format('update public.ai_runs set import_id=null,status=%L,completed_at=now() where id=%L','completed',r2)),
        ('d',format('update public.ai_runs set import_id=null,parent_run_id=%L where id=%L',r2,r)),
        ('e',format('update public.jobs set notes=null where id=%L',j)),
        ('f',format('update public.jobs set updated_at=now() where id=%L',j)),
        ('g',format('update public.jobs set tailored_cv_id=null where id=%L',j)),
        ('h',format('insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes) values(%L,%L,%L,%L,%L,%L,1)',u,'source_upload','imports','late','late.pdf','application/pdf')),
        ('i',format('update public.ai_runs set import_id=null where id=%L',r2));
    end if;
    foreach tbl in array ord loop
      execute format('delete from public.%I where user_id=$1',tbl) using u;
    end loop;
    -- Export jobs are deliberately left for the users delete to null privacy_jobs.user_id.
    delete from public.users where id=u;
    if exists(select 1 from public.ai_runs where user_id=u) or exists(select 1 from public.privacy_jobs where user_id=u) then raise exception 'Erasure order % left rows',i; end if;
  end loop;
  -- Nested writes: only nulling SET NULL FKs whose parent is gone passes (i), never other columns,
  -- non-NULL values, a live parent (b, g) or inserts.
  select string_agg(name||'='||result,',' order by name) into got from probe_results;
  if got is distinct from 'a=privacy_subject_unavailable,b=privacy_subject_unavailable,c=privacy_subject_unavailable,d=privacy_subject_unavailable,e=privacy_subject_unavailable,f=privacy_subject_unavailable,g=privacy_subject_unavailable,h=privacy_subject_unavailable,i=ok' then
    raise exception 'Nested write not limited to FK clearing: %',got;
  end if;
  select string_agg(l,',' order by l) into got from unnest(array['ai_runs.import_id','ai_runs.master_cv_id','ai_runs.tailored_cv_id','ai_runs.job_id','ai_runs.parent_run_id',
    'imports.target_master_cv_id','master_cvs.template_id','tailored_cvs.template_id','tailored_cvs.job_id','exports.template_id','jobs.tailored_cv_id','jobs.cover_letter_id',
    'cover_letters.tailored_cv_id','tailoring_sessions.tailored_cv_id','tailoring_sessions.job_id','tailoring_sessions.analysis_run_id','tailoring_session_tasks.ai_run_id',
    'ai_suggestions.tailoring_task_id','cv_block_revisions.ai_suggestion_id','cv_block_revisions.created_by_user_id','privacy_jobs.user_id']) l where l not in(select link from fk_hits);
  if got is not null then raise exception 'SET NULL links not exercised: %',got; end if;
end $$;
rollback;
select 'Privacy defaults, receipts, claim transfer, metrics, AI withdrawal, deletion races, leases, RLS and order-independent erasure passed' as verification;
