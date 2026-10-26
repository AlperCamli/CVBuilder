begin;
-- The landing-page onboarding flow reaches the database only through the backend's
-- service role. Replay its writes in order under that role, after browser writes were revoked.
do $$
declare g uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); u uuid; i uuid; stats bigint;
begin
  set local role service_role;
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path)
    values(g,'onboarding-hash','cv.pdf','application/pdf',20,'guests/'||g||'/source.pdf');
  perform public.record_privacy_choices(null,g,'2026-10-06.1',true,true,'openai');
  perform public.record_analytics_choice(null,g,'2026-10-06.1',true);
  update public.guest_imports set answers='{"career":"student","source":"friend"}'
    where id=g and claimed_user_id is null and deleted_at is null and processing_restricted_at is null and expires_at>now();
  if not public.begin_guest_import_parse(g,lease) then raise exception 'guest parse lease refused'; end if;
  update public.guest_imports set status='parsed',parser_name='fixture',raw_extracted_text='CV',
    parsed_content='{"version":"v1","language":"en","metadata":{},"sections":[]}',lease_id=null,lease_expires_at=null
    where id=g and lease_id=lease;
  if (select status from public.guest_imports where id=g)<>'parsed' then raise exception 'guest parse result not saved'; end if;

  insert into public.users(auth_user_id,email) values(a,'onboarding-claim@example.invalid') returning id into u;
  i:=public.claim_guest_import(g,'onboarding-hash',u);
  if not exists(select 1 from public.imports where id=i and user_id=u and status='parsed') then raise exception 'claimed import missing'; end if;
  if not exists(select 1 from public.files f join public.imports im on im.source_file_id=f.id where im.id=i and f.storage_path='guests/'||g||'/source.pdf') then
    raise exception 'claimed source file missing';
  end if;
  update public.users set onboarding_answers='{"career":"student"}' where id=u and deletion_requested_at is null;
  update public.guest_imports set answers='{}' where claimed_user_id=u;
  select coalesce(sum(count),0) into stats from public.onboarding_monthly_stats where metric='upload';
  if stats<1 then raise exception 'onboarding upload metric not recorded'; end if;
  reset role;
end $$;
rollback;
select 'Landing onboarding flow (guest upload, consent, answers, parse, claim, metrics) passed as service_role' as verification;
