begin;
do $$
declare
  violations text;
  tr uuid; en uuid; internal uuid; restricted uuid; leaving uuid;
  n bigint;
begin
  -- The privilege model and function contract hold for everything the migrations created.
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
  if not exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                 where r.rolname = 'analytics_api' and 'statement_timeout=15s' = any (s.setconfig)) then
    raise exception 'analytics_api has no statement timeout';
  end if;

  insert into public.users(auth_user_id,email,locale,created_at) values(gen_random_uuid(),'tr@example.invalid','tr','2026-01-05T10:00:00Z') returning id into tr;
  insert into public.billing_markets(user_id,market) values(tr,'TR');
  insert into public.users(auth_user_id,email,locale,created_at) values(gen_random_uuid(),'en@example.invalid','en','2026-01-07T23:59:59Z') returning id into en;
  insert into public.users(auth_user_id,email,locale,created_at,is_internal) values(gen_random_uuid(),'admin@example.invalid','en','2026-01-05T12:00:00Z',true) returning id into internal;
  insert into public.users(auth_user_id,email,locale,created_at,processing_restricted_at) values(gen_random_uuid(),'restricted@example.invalid','en','2026-01-05T12:00:00Z',now()) returning id into restricted;
  insert into public.users(auth_user_id,email,locale,created_at,deletion_requested_at) values(gen_random_uuid(),'leaving@example.invalid','en','2026-01-06T12:00:00Z',now()) returning id into leaving;

  -- Daily buckets are gap-filled; internal, restricted and pending-deletion accounts are excluded.
  if (select string_agg(bucket || '=' || signups, ',' order by bucket) from analytics.signups('2026-01-05','2026-01-08'))
    <> '2026-01-05=1,2026-01-06=0,2026-01-07=1,2026-01-08=0' then
    raise exception 'daily signups wrong: %', (select string_agg(bucket || '=' || signups, ',' order by bucket) from analytics.signups('2026-01-05','2026-01-08'));
  end if;
  if (select sum(signups) from analytics.signups('2026-01-05','2026-01-08', p_include_internal => true)) <> 3 then
    raise exception 'include_internal ignored';
  end if;
  -- Weeks start on Monday (2026-01-05) and a week straddling the range start is still bucketed by its Monday.
  if (select string_agg(bucket || '=' || signups, ',') from analytics.signups('2026-01-06','2026-01-08', 'week')) <> '2026-01-05=1' then
    raise exception 'weekly bucket wrong';
  end if;
  -- Breakdowns return one series per value; users without a locked market are "unknown".
  if (select string_agg(dimension || '=' || signups, ',' order by dimension) from analytics.signups('2026-01-05','2026-01-07', 'month', p_breakdown => 'market'))
    <> 'TR=1,unknown=1' then
    raise exception 'market breakdown wrong';
  end if;
  select sum(signups) into n from analytics.signups('2026-01-01','2026-01-31', p_filters => '{"locale":["tr"]}');
  if n <> 1 then raise exception 'locale filter wrong: %', n; end if;

  -- Invalid arguments surface as 22023 so the API answers 400.
  begin perform analytics.signups(p_grain => 'year'); raise exception 'grain accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.signups(p_breakdown => 'plan'); raise exception 'breakdown accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.signups(p_filters => '{"plan":"pro"}'); raise exception 'filter accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.signups('2026-02-01','2026-01-01'); raise exception 'reversed range accepted';
  exception when invalid_parameter_value then null; end;
  begin perform analytics.signups('2020-01-01','2026-01-01'); raise exception 'long range accepted';
  exception when invalid_parameter_value then null; end;

  if (select meta ->> 'title' from admin_app.metric_catalog() where name = 'signups' and kind = 'metric') <> 'Signups' then
    raise exception 'catalog missing signups';
  end if;

  -- analytics_api reaches data only through the dashboard functions.
  set local role analytics_api;
  if (select sum(signups) from analytics.signups('2026-01-05','2026-01-08')) <> 2 then raise exception 'analytics_api cannot read metric'; end if;
  perform admin_app.metric_catalog();
  begin perform 1 from public.users limit 1; raise exception 'analytics_api read public.users';
  exception when insufficient_privilege then null; end;
  begin perform analytics_private.contract_violations(); raise exception 'analytics_api reached analytics_private';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Browser and service roles cannot call dashboard functions.
  set local role authenticated;
  begin perform analytics.signups(); raise exception 'authenticated executed a metric';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  begin perform admin_app.metric_catalog(); raise exception 'service_role reached admin_app';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'Analytics foundation contract, privileges and signups metric passed' as verification;
rollback;
