-- Phase 0 review follow-ups for admin analytics (docs/admin-analytics/architecture.md §3.8).

-- analytics_api reached this definer function only through the built-in PUBLIC grant; the API roles keep
-- their explicit grants.
revoke execute on function public.is_current_user(uuid) from public;

-- The daily refresh flags admin accounts; emails are compared case-insensitively like the admin check.
create function public.mark_internal_users(p_emails text[]) returns integer
language sql security definer set search_path = ''
as $$
  with updated as (
    update public.users u
    set is_internal = true
    where not u.is_internal
      and lower(u.email) in (select lower(trim(e)) from unnest(p_emails) e)
    returning 1
  )
  select count(*)::integer from updated
$$;
revoke all on function public.mark_internal_users(text[]) from public, anon, authenticated;
grant execute on function public.mark_internal_users(text[]) to service_role;

-- Also catches ways analytics_api could gain access outside its schemas: role membership, role
-- attributes, definer functions elsewhere, and sequence, foreign-table or column grants.
create or replace function analytics_private.contract_violations()
returns table (object_name text, problem text)
language sql stable set search_path = ''
as $$
  with fns as (
    select p.oid, n.nspname as schema_name, p.proname as fn, p.provolatile, p.prosecdef, p.proconfig, p.proacl,
           p.proowner = n.nspowner as owned_by_schema_owner,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
           analytics_private.try_jsonb(pg_catalog.obj_description(p.oid, 'pg_proc')) as meta
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('analytics', 'analytics_people', 'admin_app', 'analytics_private')
  ),
  outside_roles as (
    select r.rolname from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
  ),
  checked_roles as (
    select rolname from outside_roles union all select 'analytics_api'
  )
  select f.schema_name || '.' || f.fn, v.problem
  from fns f
  cross join lateral (values
    (case when f.schema_name = 'analytics' and f.args <>
       'p_from date, p_to date, p_grain text, p_currency text, p_include_internal boolean, p_breakdown text, p_filters jsonb'
       then 'non-standard metric signature: ' || f.args end),
    (case when f.schema_name = 'analytics_people' and f.args <>
       'p_user_id uuid, p_query text, p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text'
       then 'non-standard people signature: ' || f.args end),
    (case when f.schema_name in ('analytics', 'analytics_people') and f.provolatile <> 's'
       then 'must be STABLE' end),
    (case when f.schema_name <> 'analytics_private' and not f.prosecdef
       then 'must be SECURITY DEFINER' end),
    (case when not ('search_path=""' = any (coalesce(f.proconfig, '{}'::text[])))
       then 'must set search_path = ''''' end),
    (case when not f.owned_by_schema_owner then 'not owned by the schema owner' end),
    (case when f.schema_name in ('analytics', 'analytics_people')
            and (f.meta is null or not (f.meta ?& array['title', 'definition', 'unit', 'shape', 'breakdowns', 'filters']))
       then 'comment must be MetricMeta JSON' end),
    (case when f.schema_name in ('analytics', 'analytics_people')
            and (select count(*) from fns o where o.schema_name = f.schema_name and o.fn = f.fn) > 1
       then 'overloaded name' end),
    (case when f.schema_name <> 'analytics_private' and not pg_catalog.has_function_privilege('analytics_api', f.oid, 'execute')
       then 'analytics_api cannot execute' end),
    -- A null ACL means the built-in default, which includes EXECUTE for PUBLIC.
    (case when f.proacl is null
            or exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
       then 'executable by PUBLIC' end),
    (case when exists (select 1 from outside_roles r where pg_catalog.has_function_privilege(r.rolname, f.oid, 'execute'))
       then 'executable by anon/authenticated/service_role' end)
  ) v(problem)
  where v.problem is not null
  union all
  select s.nspname::text, 'schema usable by ' || r.rolname
  from pg_catalog.pg_namespace s
  cross join checked_roles r
  where s.nspname in ('analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and pg_catalog.has_schema_privilege(r.rolname, s.oid, 'usage')
    and not (r.rolname = 'analytics_api' and s.nspname <> 'analytics_private')
  union all
  select n.nspname || '.' || c.relname, 'relation privilege for ' || r.rolname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join checked_roles r
  where n.nspname in ('analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (pg_catalog.has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate, references, trigger')
         or pg_catalog.has_any_column_privilege(r.rolname, c.oid, 'select, insert, update, references'))
  union all
  select n.nspname || '.' || c.relname, 'sequence privilege for ' || r.rolname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join checked_roles r
  where n.nspname in ('analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and c.relkind = 'S'
    and pg_catalog.has_sequence_privilege(r.rolname, c.oid, 'usage, select, update')
  -- analytics_api itself: no memberships, no elevated attributes, nothing readable or writable elsewhere.
  union all
  select 'role analytics_api', 'member of ' || g.rolname
  from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles g on g.oid = m.roleid
  join pg_catalog.pg_roles a on a.oid = m.member
  where a.rolname = 'analytics_api'
  union all
  select 'role analytics_api', 'has elevated attribute'
  from pg_catalog.pg_roles a
  where a.rolname = 'analytics_api'
    and (a.rolsuper or a.rolbypassrls or a.rolcreaterole or a.rolcreatedb or a.rolreplication)
  union all
  select n.nspname || '.' || p.proname, 'definer function executable by analytics_api'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('pg_catalog', 'information_schema', 'analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and pg_catalog.has_schema_privilege('analytics_api', n.oid, 'usage')
    and pg_catalog.has_function_privilege('analytics_api', p.oid, 'execute')
  union all
  select n.nspname || '.' || c.relname, 'readable or writable by analytics_api'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
    and pg_catalog.has_schema_privilege('analytics_api', n.oid, 'usage')
    and (case when c.relkind = 'S'
              then pg_catalog.has_sequence_privilege('analytics_api', c.oid, 'usage, select, update')
              else pg_catalog.has_table_privilege('analytics_api', c.oid, 'select, insert, update, delete, truncate, references, trigger')
                   or pg_catalog.has_any_column_privilege('analytics_api', c.oid, 'select, insert, update, references') end)
$$;

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
