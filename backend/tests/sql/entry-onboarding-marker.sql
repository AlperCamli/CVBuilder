begin;
do $$
declare g uuid:=gen_random_uuid(); claimed uuid; creator uuid; direct uuid; stamp timestamptz;
begin
  set local role service_role;

  -- A new account starts without the marker, so the app shell sends it to the onboarding.
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'entry-direct@example.invalid') returning id into direct;
  if (select entry_onboarding_completed_at from public.users where id=direct) is not null then raise exception 'new account starts onboarded'; end if;

  -- Upload path: claiming the guest upload marks the account, and a replayed claim keeps the first time.
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content)
    values(g,'entry-hash','cv.pdf','application/pdf',20,'guests/'||g||'/source.pdf','parsed','{"version":"v1","language":"en","metadata":{},"sections":[]}');
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'entry-claim@example.invalid') returning id into claimed;
  perform public.claim_guest_import(g,'entry-hash',claimed);
  select entry_onboarding_completed_at into stamp from public.users where id=claimed;
  if stamp is null then raise exception 'claim did not mark onboarding'; end if;
  perform public.claim_guest_import(g,'entry-hash',claimed);
  if (select entry_onboarding_completed_at from public.users where id=claimed)<>stamp then raise exception 'claim replay moved the marker'; end if;

  -- Owning a CV counts too, whatever created it.
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'entry-cv@example.invalid') returning id into creator;
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(creator,'Synthetic','en','{}','import');
  if (select entry_onboarding_completed_at from public.users where id=creator) is null then raise exception 'master CV did not mark onboarding'; end if;
  if (select entry_onboarding_completed_at from public.users where id=direct) is not null then raise exception 'another account was marked'; end if;
  reset role;

  if has_function_privilege('authenticated','public.mark_entry_onboarding_completed()','EXECUTE')
    or has_function_privilege('anon','public.mark_entry_onboarding_completed()','EXECUTE') then
    raise exception 'browser can call the onboarding marker';
  end if;
end $$;
rollback;
select 'Entry onboarding marker on claim and CV creation passed' as verification;
