begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid(); run uuid; imp uuid; job uuid; rev integer; m uuid; t uuid; j uuid; c uuid; s uuid; tbl text;
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
  insert into public.ai_runs(user_id,tailored_cv_id,flow_type,provider,model_name,status,input_payload) values(u,t,'block_suggest','mock','test','pending','{}') returning id into run;
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
  foreach tbl in array array['cover_letter_exports','exports','imports','cv_block_revisions','ai_suggestions','ai_runs','cover_letters','tailored_cvs','jobs','master_cvs','files','usage_counters','subscriptions'] loop
    execute format('delete from public.%I where user_id=$1',tbl) using u;
  end loop;
  delete from public.guest_imports where claimed_user_id=u;
  delete from public.users where id=u;
  if exists(select 1 from public.master_cvs where user_id=u) or exists(select 1 from public.files where user_id=u) then raise exception 'Erasure dependency order failed'; end if;
end $$;
rollback;
select 'Privacy defaults, receipts, claim transfer, metrics, AI withdrawal, deletion races, leases and RLS passed' as verification;
