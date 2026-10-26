begin;
do $$
declare g uuid:=gen_random_uuid(); quiet uuid; consenting uuid; mon date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
  delete from public.onboarding_monthly_stats;
  set local role service_role;

  -- Upload path: picking a file starts the funnel; claiming it after signup completes it, once.
  insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content)
    values(g,'funnel-hash','cv.pdf','application/pdf',20,'guests/'||g||'/source.pdf','parsed','{"version":"v1","language":"en","metadata":{},"sections":[]}');
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'funnel-quiet@example.invalid') returning id into quiet;
  perform public.claim_guest_import(g,'funnel-hash',quiet);
  perform public.claim_guest_import(g,'funnel-hash',quiet);
  if (select count from public.onboarding_monthly_stats where month=mon and metric='started' and option='upload')<>1 then raise exception 'upload start not counted once'; end if;
  if (select count from public.onboarding_monthly_stats where month=mon and metric='completed' and option='upload')<>1 then raise exception 'upload completion not counted once'; end if;

  -- New-CV path without analytics consent: only the anonymous totals are kept.
  perform public.bump_onboarding_metric('started','manual_create');
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'funnel-manual@example.invalid') returning id into quiet;
  if not public.count_manual_onboarding_signup(quiet,'{"career":"student","source":"friend"}') then raise exception 'manual signup not counted'; end if;
  if public.count_manual_onboarding_signup(quiet,'{"career":"student","source":"friend"}') then raise exception 'manual signup replay counted twice'; end if;
  if (select count from public.onboarding_monthly_stats where month=mon and metric='completed' and option='manual_create')<>1 then raise exception 'manual completion not counted once'; end if;
  if exists(select 1 from public.onboarding_monthly_stats where metric in ('signup','questions','referral')) then raise exception 'answers counted without consent'; end if;

  -- With analytics consent the answer breakdowns are added as well.
  insert into public.users(auth_user_id,email,analytics) values(gen_random_uuid(),'funnel-consent@example.invalid',true) returning id into consenting;
  perform public.count_manual_onboarding_signup(consenting,'{"career":"student","source":"friend"}');
  if (select count from public.onboarding_monthly_stats where month=mon and metric='referral' and option='friend')<>1
    or (select count from public.onboarding_monthly_stats where month=mon and metric='questions' and option='total')<>1
    or (select count from public.onboarding_monthly_stats where month=mon and metric='signup' and option='total')<>1 then
    raise exception 'consented answer breakdown missing';
  end if;
  if (select sum(count) from public.onboarding_monthly_stats where metric='completed' and option='manual_create')<>2 then raise exception 'consented completion missing'; end if;

  begin
    perform public.bump_onboarding_metric('started','somewhere_else');
    raise exception 'unknown funnel path accepted';
  exception when check_violation then null; end;
  reset role;

  if has_function_privilege('anon','public.bump_onboarding_metric(text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.count_manual_onboarding_signup(uuid,jsonb)','EXECUTE') then
    raise exception 'browser can write onboarding metrics';
  end if;
end $$;
rollback;
select 'Onboarding funnel starts, completions, consent split and replay safety passed' as verification;
