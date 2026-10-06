begin;
do $$
declare u uuid := gen_random_uuid(); other_user uuid := gen_random_uuid(); g uuid := gen_random_uuid(); i uuid; replay uuid;
begin
  if has_table_privilege('anon','public.guest_imports','select') then raise exception 'Guest table exposed to anon'; end if;
  if has_function_privilege('authenticated','public.claim_guest_import(uuid,text,uuid)','execute') then raise exception 'Claim RPC exposed'; end if;
  insert into public.users(id,auth_user_id,email) values(u,gen_random_uuid(),'onboarding-sql-check@example.invalid'),(other_user,gen_random_uuid(),'onboarding-sql-other@example.invalid');
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,answers)
  values(g,'testhash','cv.pdf','application/pdf',20,'guests/sql-test/'||g,'parsed','{"schema_version":"1.0","language":"en","sections":[]}', '{"career":"student","source":"friend"}');
  begin
    perform public.claim_guest_import(g,'wrong',u); raise exception 'Wrong token accepted';
  exception when others then if sqlerrm <> 'guest_not_found' then raise; end if; end;
  i := public.claim_guest_import(g,'testhash',u);
  replay := public.claim_guest_import(g,'testhash',u);
  if i <> replay then raise exception 'Duplicate import on replay'; end if;
  if (select count(*) from public.imports where id=i and user_id=u) <> 1 then raise exception 'Import ownership missing'; end if;
  if (select onboarding_answers->>'career' from public.users where id=u) <> 'student' then raise exception 'Answers not saved'; end if;
  begin
    perform public.claim_guest_import(g,'testhash',other_user); raise exception 'Second owner accepted';
  exception when others then if sqlerrm <> 'guest_not_found' then raise; end if; end;
  update public.guest_imports set expires_at=now()-interval '1 second' where id=g;
  begin
    perform public.claim_guest_import(g,'testhash',u); raise exception 'Expired proof accepted';
  exception when others then if sqlerrm <> 'guest_not_found' then raise; end if; end;
end; $$;
rollback;
select 'claim replay, ownership, expiry and role isolation passed (all test data rolled back)' as verification;
