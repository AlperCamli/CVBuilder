-- Admin analytics foundation (docs/admin-analytics/architecture.md §3, api-contract.md).
-- The dashboard backend connects directly as analytics_api, which can only execute functions in
-- analytics, analytics_people and admin_app. None of these schemas are exposed to the Data API.

create schema analytics;
create schema analytics_people;
create schema analytics_private;
create schema admin_app;
revoke all on schema analytics, analytics_people, analytics_private, admin_app from public;

-- Login works once a password is set out of band; it is never stored in a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'analytics_api') then
    create role analytics_api login noinherit connection limit 10;
  end if;
end $$;
-- A function-level statement_timeout does not cap the calling statement, so the cap lives on the role.
alter role analytics_api set statement_timeout = '15s';
alter role analytics_api set idle_in_transaction_session_timeout = '30s';
alter role analytics_api set search_path = '';

grant usage on schema analytics, analytics_people, admin_app to analytics_api;
alter default privileges in schema analytics, analytics_people, admin_app
  grant execute on functions to analytics_api;
-- Per-schema default privileges cannot revoke the built-in PUBLIC execute grant, so every analytics
-- migration ends with an explicit revoke; analytics_private.contract_violations() catches a missing one.

-- Scheduled refreshes and alert checks run inside the database (absent in the local SQL test).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function analytics_private.utc_start(p_day date) returns timestamptz
language sql immutable set search_path = ''
as $$ select p_day::timestamp at time zone 'UTC' $$;

create function analytics_private.bucket(p_at timestamptz, p_grain text) returns date
language sql immutable set search_path = ''
as $$ select date_trunc(p_grain, p_at at time zone 'UTC')::date $$;

create function analytics_private.resolve_range(p_from date, p_to date, out from_day date, out to_day date)
language plpgsql stable set search_path = ''
as $$
begin
  to_day := coalesce(p_to, (now() at time zone 'UTC')::date);
  from_day := coalesce(p_from, to_day - 29);
  if from_day > to_day then
    raise exception 'from must not be after to' using errcode = '22023';
  end if;
  if to_day - from_day > 1096 then
    raise exception 'date range is limited to 3 years' using errcode = '22023';
  end if;
end $$;

create function analytics_private.buckets(p_from date, p_to date, p_grain text) returns setof date
language sql immutable set search_path = ''
as $$
  select g::date
  from generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval) g
$$;

create function analytics_private.assert_args(
  p_grain text, p_currency text, p_breakdown text, p_filters jsonb,
  p_allowed_breakdowns text[], p_allowed_filters text[]
) returns void
language plpgsql immutable set search_path = ''
as $$
declare
  bad_key text;
begin
  if p_grain is null or p_grain not in ('day', 'week', 'month') then
    raise exception 'unsupported grain: %', p_grain using errcode = '22023';
  end if;
  if p_currency is null or p_currency not in ('native', 'usd', 'try') then
    raise exception 'unsupported currency: %', p_currency using errcode = '22023';
  end if;
  if p_breakdown is not null and not (p_breakdown = any (p_allowed_breakdowns)) then
    raise exception 'unsupported breakdown for this metric: %', p_breakdown using errcode = '22023';
  end if;
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'filters must be an object' using errcode = '22023';
  end if;
  select k into bad_key
  from jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) k
  where not (k = any (p_allowed_filters))
  limit 1;
  if bad_key is not null then
    raise exception 'unsupported filter for this metric: %', bad_key using errcode = '22023';
  end if;
end $$;

-- True when the filter is absent, or the value equals it (scalar) or is one of it (array).
create function analytics_private.filter_match(p_filters jsonb, p_key text, p_value text) returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_filters is null or not (p_filters ? p_key) then true
    when jsonb_typeof(p_filters -> p_key) = 'array'
      then p_value in (select jsonb_array_elements_text(p_filters -> p_key))
    else p_value = p_filters ->> p_key
  end
$$;

-- Accounts eligible for analysis. Metrics add `(p_include_internal or not is_internal)` themselves.
create view analytics_private.analysis_users as
select u.*
from public.users u
where u.deletion_requested_at is null
  and u.processing_restricted_at is null;

create function analytics_private.try_jsonb(p_text text) returns jsonb
language plpgsql immutable set search_path = ''
as $$
begin
  return p_text::jsonb;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog and contract check
-- ---------------------------------------------------------------------------

create function admin_app.metric_catalog()
returns table (name text, kind text, meta jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.proname::text,
         case n.nspname when 'analytics' then 'metric' else 'people' end,
         coalesce(analytics_private.try_jsonb(pg_catalog.obj_description(p.oid, 'pg_proc')), '{}'::jsonb)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('analytics', 'analytics_people') and p.prokind = 'f'
  order by 2, 1
$$;

-- One row per violation of the function contract or of the privilege model; expected to be empty.
create function analytics_private.contract_violations()
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
  cross join (select rolname from outside_roles union all select 'analytics_api') r
  where s.nspname in ('analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and pg_catalog.has_schema_privilege(r.rolname, s.oid, 'usage')
    and not (r.rolname = 'analytics_api' and s.nspname <> 'analytics_private')
  union all
  select n.nspname || '.' || c.relname, 'table privilege for ' || r.rolname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (select rolname from outside_roles union all select 'analytics_api') r
  where n.nspname in ('analytics', 'analytics_people', 'analytics_private', 'admin_app')
    and c.relkind in ('r', 'v', 'm', 'p')
    and pg_catalog.has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate')
$$;

-- ---------------------------------------------------------------------------
-- Metrics
-- ---------------------------------------------------------------------------

create function analytics.signups(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (bucket date, dimension text, signups bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['locale', 'market'], array['locale', 'market']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with base as (
    select analytics_private.bucket(u.created_at, p_grain) as b,
           u.locale,
           coalesce(m.market, 'unknown') as market
    from analytics_private.analysis_users u
    left join public.billing_markets m on m.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and u.created_at >= analytics_private.utc_start(r.from_day)
      and u.created_at < analytics_private.utc_start(r.to_day + 1)
  ),
  filtered as (
    select b,
           case p_breakdown when 'locale' then locale when 'market' then market end as dim
    from base
    where analytics_private.filter_match(p_filters, 'locale', locale)
      and analytics_private.filter_match(p_filters, 'market', market)
  ),
  dims as (
    select distinct dim from filtered
    union
    select null where p_breakdown is null
  )
  select k.b, d.dim, count(f.b)
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  cross join dims d
  left join filtered f on f.b = k.b and f.dim is not distinct from d.dim
  group by k.b, d.dim
  order by k.b, d.dim;
end $$;

comment on function analytics.signups(date, date, text, text, boolean, text, jsonb) is
'{"title":"Signups","definition":"New accounts created per period (UTC). Excludes admin accounts unless included, and accounts pending deletion or with restricted processing.","unit":"count","shape":"timeseries","breakdowns":["locale","market"],"filters":["locale","market"],"kb":"queries/monthly_new_signups.md","alertable":false}';

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
