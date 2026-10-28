begin;
do $$
declare
  admin_upper uuid; admin_lower uuid; customer uuid;
  flagged integer;
begin
  -- The contract check flags each way analytics_api could gain access beyond its schemas.
  create function analytics_private.leaky() returns int language sql set search_path = '' as 'select 1';
  grant execute on function analytics_private.leaky() to public;
  if not exists (select 1 from analytics_private.contract_violations() where object_name = 'analytics_private.leaky' and problem = 'executable by PUBLIC') then
    raise exception 'PUBLIC-executable helper not flagged';
  end if;
  drop function analytics_private.leaky();

  grant authenticated to analytics_api;
  if not exists (select 1 from analytics_private.contract_violations() where problem = 'member of authenticated') then
    raise exception 'role membership not flagged';
  end if;
  revoke authenticated from analytics_api;

  alter role analytics_api bypassrls;
  if not exists (select 1 from analytics_private.contract_violations() where problem = 'has elevated attribute') then
    raise exception 'bypassrls not flagged';
  end if;
  alter role analytics_api nobypassrls;

  create function public.leaky_definer() returns int language sql security definer set search_path = '' as 'select 1';
  if not exists (select 1 from analytics_private.contract_violations() where object_name = 'public.leaky_definer') then
    raise exception 'definer function outside analytics not flagged';
  end if;
  drop function public.leaky_definer();

  create table public.leaky_table(id int);
  grant select (id) on public.leaky_table to analytics_api;
  if not exists (select 1 from analytics_private.contract_violations() where object_name = 'public.leaky_table') then
    raise exception 'column grant not flagged';
  end if;
  drop table public.leaky_table;

  if exists (select 1 from analytics_private.contract_violations()) then
    raise exception 'unexpected violations: %', (select string_agg(object_name || ': ' || problem, '; ') from analytics_private.contract_violations());
  end if;

  -- Admin accounts are flagged regardless of email case; customers are untouched.
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'Admin.Person@Example.invalid') returning id into admin_upper;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'second@example.invalid') returning id into admin_lower;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'customer@example.invalid') returning id into customer;
  set local role service_role;
  flagged := public.mark_internal_users(array['admin.person@example.invalid', ' SECOND@example.invalid ']);
  reset role;
  if flagged <> 2 then raise exception 'expected 2 flagged, got %', flagged; end if;
  if not (select is_internal from public.users where id = admin_upper) or not (select is_internal from public.users where id = admin_lower)
     or (select is_internal from public.users where id = customer) then
    raise exception 'internal flags wrong';
  end if;
  set local role authenticated;
  begin perform public.mark_internal_users(array['customer@example.invalid']); raise exception 'authenticated flagged users';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'Analytics contract hardening and case-insensitive internal flags passed' as verification;
rollback;
