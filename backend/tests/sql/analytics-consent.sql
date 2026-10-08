begin;
do $$
declare u uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); rev integer;
begin
  insert into public.users(id,auth_user_id,email) values(u,gen_random_uuid(),'analytics-check@example.invalid');
  perform public.record_analytics_choice(u,null,'new-notice',true);
  if (select not analytics or ai_processing from public.users where id=u) then raise exception 'Account analytics did not persist independently'; end if;
  if exists(select 1 from public.privacy_receipts where user_id=u and purpose='ai_processing') then raise exception 'Invented AI choice'; end if;
  perform public.record_analytics_choice(u,null,'new-notice',true);
  if (select count(*) from public.privacy_receipts where user_id=u and purpose='analytics')<>1 then raise exception 'Duplicate acceptance receipts'; end if;
  perform public.record_analytics_choice(u,null,'next-notice',true);
  if not exists(select 1 from public.privacy_receipts where user_id=u and purpose='analytics' and document_version='next-notice') then raise exception 'New notice consent receipt missing'; end if;
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,
    ai_processing,ai_provider,ai_notice_version,lease_id,lease_expires_at,status)
    values(g,'test','cv.pdf','application/pdf',20,'guests/analytics/'||g,true,'openai','old-ai-notice',l,now()+interval '5 minutes','parsing');
  select privacy_revision into rev from public.guest_imports where id=g;
  perform public.record_analytics_choice(null,g,'new-notice',true);
  if not exists(select 1 from public.guest_imports where id=g and analytics and ai_processing and ai_notice_version='old-ai-notice' and privacy_revision=rev and lease_id=l and status='parsing') then raise exception 'Analytics altered AI grant or lease'; end if;
  perform public.record_analytics_choice(null,g,'new-notice',false);
  if exists(select 1 from public.guest_imports where id=g and analytics) then raise exception 'Withdrawal lost'; end if;
  if exists(select 1 from public.privacy_receipts where guest_id=g and purpose='ai_processing') then raise exception 'Invented renewed AI consent'; end if;
  if has_function_privilege('authenticated','public.record_analytics_choice(uuid,uuid,text,boolean)','execute') then raise exception 'Analytics RPC exposed'; end if;
end $$;
rollback;
select 'analytics persistence, idempotent receipts and independent AI grants/leases passed (rolled back)' as verification;
