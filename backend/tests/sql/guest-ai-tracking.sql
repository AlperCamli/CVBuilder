begin;
-- Model Supabase's authenticated table grants so assertions exercise RLS,
-- rather than succeeding merely because the isolated fixture lacks grants.
grant select on public.ai_runs to authenticated;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
  l uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); pending_r uuid:=gen_random_uuid(); i uuid; cv uuid:=gen_random_uuid();
begin
  insert into public.users(id,auth_user_id,email) values
    (u,a,'ai-tracking@example.invalid'),(other_u,gen_random_uuid(),'ai-tracking-other@example.invalid');
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,
    ai_processing,ai_provider,ai_notice_version,lease_id,lease_expires_at)
  values(g,'tracking-test','cv.pdf','application/pdf',20,'guests/tracking-test/'||g,'parsed','{"version":"v1","language":"en","sections":[]}',
    true,'openai','test-notice',l,now()+interval '5 minutes');
  insert into public.ai_runs(id,user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload)
    values(r,null,g,l,'cv_parse','openai','test-model','pending','{}');
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  if exists(select 1 from public.ai_runs where id=r) then raise exception 'Guest AI exposed to browser'; end if;
  reset role;
  begin
    insert into public.ai_runs(user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload)
      values(null,g,l,'cv_parse','openai','test-model','pending','{}');
    raise exception 'Duplicate lease accepted';
  exception when unique_violation then null; end;
  update public.ai_runs set status='completed',completed_at=now(),output_payload='{"parsed_content":{}}',input_tokens=100,output_tokens=20,total_tokens=120 where id=r;
  update public.guest_imports set lease_id=gen_random_uuid() where id=g returning lease_id into l;
  insert into public.ai_runs(id,user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload)
    values(pending_r,null,g,l,'cv_parse','openai','test-model','pending','{}');
  -- An unrelated account cannot transfer guest telemetry directly.
  begin
    update public.ai_runs set user_id=other_u,guest_import_id=null,guest_lease_id=null where id=r;
    raise exception 'Unclaimed owner transfer accepted';
  exception when others then if sqlerrm<>'ai_run_owner_transfer_invalid' then raise; end if; end;
  i:=public.claim_guest_import(g,'tracking-test',u);
  if public.claim_guest_import(g,'tracking-test',u)<>i then raise exception 'Claim replay changed import'; end if;
  if (select count(*) from public.ai_runs where user_id=u and import_id=i and guest_import_id is null and guest_lease_id is null)<>2 then raise exception 'Guest run transfer failed'; end if;
  set local role authenticated;
  if (select count(*) from public.ai_runs where import_id=i)<>2 then raise exception 'Claimed run history not visible to owner'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',(select auth_user_id::text from public.users where id=other_u),true);
  set local role authenticated;
  if exists(select 1 from public.ai_runs where import_id=i) then raise exception 'Claimed history exposed to another account'; end if;
  reset role;
  if not exists(select 1 from public.ai_runs where id=r and status='completed' and total_tokens=120) then raise exception 'Claim lost usage'; end if;
  if not exists(select 1 from public.ai_runs where id=pending_r and status='failed') then raise exception 'Claim retained stale pending run'; end if;
  insert into public.master_cvs(id,user_id,title,language,current_content,source_type) values(cv,u,'Synthetic','en','{}','import');
  update public.imports set target_master_cv_id=cv where id=i;
  if (select count(*) from public.ai_runs where import_id=i and master_cv_id=cv)<>2 then raise exception 'CV history link failed'; end if;
  delete from public.guest_imports where id=g;
  if (select count(*) from public.ai_runs where import_id=i)<>2 then raise exception 'Cleanup deleted claimed history'; end if;
  begin
    insert into public.ai_runs(user_id,import_id,flow_type,provider,model_name,status,input_payload)
      values(other_u,i,'cv_parse','openai','test-model','pending','{}');
    raise exception 'Cross-account import accepted';
  exception when others then if sqlerrm<>'ai_run_import_owner_mismatch' then raise; end if; end;
  update public.users set deletion_requested_at=now() where id=other_u;
  begin
    insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload)
      values(other_u,'cv_parse','openai','test-model','pending','{}');
    raise exception 'Deleted account write accepted';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
end $$;

do $$
declare g uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
begin
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,
    ai_processing,ai_provider,ai_notice_version,lease_id,lease_expires_at)
  values(g,'test','cv.pdf','application/pdf',20,'guests/race-test/'||g,true,'openai','test-notice',l,now()+interval '5 minutes');
  insert into public.ai_runs(id,user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload)
    values(r,null,g,l,'cv_parse','openai','test-model','pending','{}');
  update public.guest_imports set lease_id=gen_random_uuid() where id=g;
  begin
    update public.ai_runs set status='completed',completed_at=now(),output_payload='{}' where id=r;
    raise exception 'Stale lease completed';
  exception when others then if sqlerrm<>'ai_permission_changed' then raise; end if; end;
  update public.guest_imports set lease_id=l,ai_processing=false,privacy_revision=privacy_revision+1 where id=g;
  if not exists(select 1 from public.ai_runs where id=r and status='failed' and input_payload='{}' and output_payload is null) then raise exception 'Withdrawal did not invalidate run'; end if;
  update public.ai_runs set input_tokens=100,output_tokens=20,total_tokens=120 where id=r;
  update public.guest_imports set ai_processing=true,privacy_revision=privacy_revision+1 where id=g;
  begin
    update public.ai_runs set status='completed',completed_at=now(),output_payload='{}' where id=r;
    raise exception 'Old grant revived';
  exception when others then if sqlerrm<>'ai_permission_changed' then raise; end if; end;
  update public.guest_imports set expires_at=now()-interval '1 second',lease_id=gen_random_uuid() where id=g returning lease_id into l;
  begin
    insert into public.ai_runs(user_id,guest_import_id,guest_lease_id,flow_type,provider,model_name,status,input_payload)
      values(null,g,l,'cv_parse','openai','test-model','pending','{}');
    raise exception 'Expired guest call accepted';
  exception when others then if sqlerrm<>'ai_permission_changed' then raise; end if; end;
  update public.guest_imports set deleted_at=now() where id=g;
  if exists(select 1 from public.ai_runs where id=r) then raise exception 'Deletion retained guest run'; end if;
end $$;
rollback;
select 'guest AI lifecycle, usage, transfer, CV history, expiry and deletion races passed (rolled back)' as verification;
