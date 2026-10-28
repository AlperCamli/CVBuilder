-- Admin analytics Phase 2: user lookup (docs/admin-analytics/api-contract.md "Phase 2", requirements.md FR4/FR7,
-- architecture.md §3.4 and §3.7).
-- - admin_app.audit_log: append-only record of every people call and user-list export, written through
--   admin_app.log_access in the same transaction as the read.
-- - analytics_people.search_users / user_summary / user_timeline / drill_users: user-level reads, metadata only.
-- Privacy rules shared by every people function: accounts pending deletion are never returned (erased accounts no
-- longer exist), accounts with restricted processing show a "restricted" marker only, and no CV, job, cover-letter,
-- AI prompt/response or file content is read into an output column. Every people function refuses to run (42501)
-- unless admin_app.log_access wrote its audit row earlier in the same transaction.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table admin_app.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_email text not null check (length(admin_email) between 3 and 320),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,40}(\.[a-z][a-z0-9_]{0,40}){1,3}$'),
  -- Erasing the account nulls the reference (the erasure flow deletes public.users), keeping the access record.
  target_user_id uuid references public.users(id) on delete set null,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  request_id text check (length(request_id) <= 128),
  -- The analytics_people function this row authorises, and the transaction it was written in: people functions only
  -- run after a matching row in their own transaction (analytics_private.assert_audited).
  people_function text check (people_function ~ '^[a-z][a-z0-9_]{0,62}$'),
  xact_id xid8 not null default pg_current_xact_id()
);
create index audit_log_at_idx on admin_app.audit_log (at desc);
-- Also serves the FK's on-delete action, so erasing a user never scans the log.
create index audit_log_target_user_idx on admin_app.audit_log (target_user_id);
create index audit_log_xact_idx on admin_app.audit_log (xact_id);
alter table admin_app.audit_log enable row level security;
revoke all on admin_app.audit_log from public, anon, authenticated, service_role;

-- Rejects every UPDATE, DELETE and TRUNCATE. The one exception is the FK's on-delete action: it may only null
-- target_user_id, and only once the referenced account is gone.
create function analytics_private.audit_log_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.target_user_id is not null
       and new.target_user_id is null
       and (new.id, new.at, new.admin_email, new.action, new.params, new.request_id, new.people_function, new.xact_id)
           is not distinct from
           (old.id, old.at, old.admin_email, old.action, old.params, old.request_id, old.people_function, old.xact_id)
       and not exists (select 1 from public.users u where u.id = old.target_user_id) then
      return new;
    end if;
  end if;
  raise exception 'admin_app.audit_log is append-only' using errcode = '42501';
end $$;

create trigger audit_log_append_only
  before update or delete on admin_app.audit_log
  for each row execute function analytics_private.audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on admin_app.audit_log
  for each statement execute function analytics_private.audit_log_append_only();

-- Secret key for the search-text HMAC. It never leaves the database: no grants, read only by log_access.
create table admin_app.audit_pepper (
  id boolean primary key default true check (id),
  pepper bytea not null check (length(pepper) = 32)
);
alter table admin_app.audit_pepper enable row level security;
revoke all on admin_app.audit_pepper from public, anon, authenticated, service_role;
insert into admin_app.audit_pepper (pepper) values (extensions.gen_random_bytes(32));

-- Writes one audit row and returns its id. Called by the backend first in the transaction that reads the data, so
-- the read is refused without it and a failed insert returns no data. The raw search text (p_query) is never stored:
-- params gets query_hmac = HMAC-SHA256(lower(trim(p_query)), pepper) instead.
create function admin_app.log_access(
  p_admin_email text, p_action text, p_target_user_id uuid, p_params jsonb, p_request_id text,
  p_query text default null
) returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_admin_email));
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_function text;
  v_target uuid;
  v_id bigint;
begin
  if v_email is null or length(v_email) not between 3 and 320 or position('@' in v_email) < 2 then
    raise exception 'admin_email is required' using errcode = '22023';
  end if;
  if p_action is null or length(p_action) > 100
     or p_action !~ '^[a-z][a-z0-9_]{0,40}(\.[a-z][a-z0-9_]{0,40}){1,3}$' then
    raise exception 'action must look like <area>.<name>' using errcode = '22023';
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'params must be a JSON object' using errcode = '22023';
  end if;
  if length(v_params::text) > 8192 then
    raise exception 'params must not exceed 8192 characters' using errcode = '22023';
  end if;
  if v_params ?| array['q', 'query', 'p_query', 'query_hmac', 'query_sha256'] then
    raise exception 'params must not carry search text or its hash' using errcode = '22023';
  end if;
  if p_request_id is not null and (length(p_request_id) > 128 or p_request_id !~ '^[-A-Za-z0-9_.:]+$') then
    raise exception 'request_id is malformed' using errcode = '22023';
  end if;
  if p_query is not null and length(p_query) > 1000 then
    raise exception 'query is too long' using errcode = '22023';
  end if;

  -- people.<function> authorises that function; export.csv authorises params.function.
  v_function := case when p_action like 'people.%' then substr(p_action, 8)
                     when p_action = 'export.csv' then v_params ->> 'function' end;
  if (p_action like 'people.%' or p_action = 'export.csv')
     and (v_function is null or not exists (
           select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'analytics_people' and p.proname = v_function)) then
    raise exception 'unknown people function' using errcode = '22023';
  end if;

  if p_query is not null then
    v_params := v_params || jsonb_build_object('query_hmac', encode(extensions.hmac(
      convert_to(lower(btrim(p_query)), 'UTF8'), (select ap.pepper from admin_app.audit_pepper ap), 'sha256'), 'hex'));
  end if;

  -- An unknown or already erased id is logged without the reference (the FK would reject it).
  if p_target_user_id is not null then
    select u.id into v_target from public.users u where u.id = p_target_user_id;
    if v_target is null then
      v_params := v_params || '{"target_user_missing": true}'::jsonb;
    end if;
  end if;

  insert into admin_app.audit_log (admin_email, action, target_user_id, params, request_id, people_function, xact_id)
  values (v_email, p_action, v_target, v_params, p_request_id, v_function, pg_current_xact_id())
  returning id into v_id;
  return v_id;
end $$;

-- Latest audit rows, newest first (Phase 5 Data health page). p_limit is clamped to 1..500 (default 100).
create function admin_app.audit_recent(p_limit integer default 100)
returns table (id bigint, at timestamptz, admin_email text, action text, target_user_id uuid, params jsonb, request_id text)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.at, a.admin_email, a.action, a.target_user_id, a.params, a.request_id
  from admin_app.audit_log a
  order by a.at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Every analytics_people function calls this first: the current transaction must already hold an audit row for that
-- function (and, for a per-user read, for that user; an unknown or erased id is logged without a reference).
-- Otherwise 42501, so no people data can be read without an audit row, whoever the caller is.
create function analytics_private.assert_audited(p_function text, p_user_id uuid) returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not exists (
    select 1
    from admin_app.audit_log a
    where a.xact_id = pg_current_xact_id_if_assigned()
      and a.people_function = p_function
      and (p_user_id is null
           or a.target_user_id = p_user_id
           or (a.target_user_id is null and not exists (select 1 from public.users u where u.id = p_user_id)))
  ) then
    raise exception 'call admin_app.log_access for % in this transaction first', p_function using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- People helpers
-- ---------------------------------------------------------------------------

-- Rejects p_filters that are not an object or carry a key outside p_allowed.
create function analytics_private.assert_filter_keys(p_filters jsonb, p_allowed text[]) returns void
language plpgsql immutable set search_path = ''
as $$
declare
  bad_key text;
begin
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'filters must be an object' using errcode = '22023';
  end if;
  select k into bad_key
  from jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) k
  where not (k = any (p_allowed))
  limit 1;
  if bad_key is not null then
    raise exception 'unsupported filter for this function: %', bad_key using errcode = '22023';
  end if;
end $$;

-- Page size: default 50, at most 200.
create function analytics_private.people_limit(p_limit integer) returns integer
language plpgsql immutable set search_path = ''
as $$
begin
  if p_limit is null then
    return 50;
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'limit must be between 1 and 200' using errcode = '22023';
  end if;
  return p_limit;
end $$;

-- People ranges default to the whole history: [from 00:00 UTC, to + 1 day 00:00 UTC).
create function analytics_private.people_range(p_from date, p_to date, out from_ts timestamptz, out to_ts timestamptz)
language plpgsql immutable set search_path = ''
as $$
begin
  if p_from > p_to then
    raise exception 'from must not be after to' using errcode = '22023';
  end if;
  from_ts := coalesce(analytics_private.utc_start(p_from), '-infinity'::timestamptz);
  to_ts := coalesce(analytics_private.utc_start(p_to + 1), 'infinity'::timestamptz);
end $$;

-- Microsecond-exact UTC text for cursors: 2026-10-28T09:15:00.123456Z.
create function analytics_private.cursor_time(p_at timestamptz) returns text
language sql immutable set search_path = ''
as $$ select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

-- Timeline cursor: occurred_at|event_type|entity_id. Malformed -> 22023.
create function analytics_private.parse_timeline_cursor(
  p_cursor text, out at timestamptz, out event_type text, out entity_id uuid
)
language plpgsql stable set search_path = ''
as $$
begin
  if p_cursor is null then
    return;
  end if;
  if p_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[a-z][a-z_]{0,62}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'malformed cursor' using errcode = '22023';
  end if;
  begin
    at := split_part(p_cursor, '|', 1)::timestamptz;
  exception when others then
    raise exception 'malformed cursor' using errcode = '22023';
  end;
  event_type := split_part(p_cursor, '|', 2);
  entity_id := split_part(p_cursor, '|', 3)::uuid;
end $$;

-- List cursor: sort_key|user_id, where sort_key is a number, optionally prefixed by a rank ("1~1761600000123456").
-- Malformed -> 22023.
create function analytics_private.parse_list_cursor(
  p_cursor text, out rank integer, out sort_num numeric, out user_id uuid
)
language plpgsql immutable set search_path = ''
as $$
begin
  if p_cursor is null then
    return;
  end if;
  if p_cursor !~ '^([0-9]~)?-?\d{1,30}(\.\d{1,20})?\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'malformed cursor' using errcode = '22023';
  end if;
  if position('~' in p_cursor) > 0 then
    rank := split_part(p_cursor, '~', 1)::integer;
    sort_num := split_part(split_part(p_cursor, '~', 2), '|', 1)::numeric;
  else
    sort_num := split_part(p_cursor, '|', 1)::numeric;
  end if;
  user_id := split_part(p_cursor, '|', 2)::uuid;
end $$;

-- A user's current paid-provider subscription: the active/trialing one, else the latest. Checkout placeholder rows
-- (plan 'free', no provider subscription id) are not subscriptions and are skipped.
create function analytics_private.current_subscription(p_user_id uuid) returns setof public.subscriptions
language sql stable set search_path = ''
as $$
  select s.*
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.provider_subscription_id is not null
  order by (s.status in ('active', 'trialing')) desc, s.created_at desc, s.id desc
  limit 1
$$;

-- Event types of analytics_people.user_timeline, in documentation order.
create function analytics_private.timeline_event_types() returns text[]
language sql immutable set search_path = ''
as $$
  select array[
    'signup', 'file_upload', 'import', 'master_cv_created', 'job_saved', 'job_status_changed',
    'tailored_cv_created', 'cv_block_revision', 'ai_run', 'ai_suggestion_created', 'ai_suggestion_applied',
    'cv_export', 'cover_letter_created', 'cover_letter_export', 'tailoring_session', 'tailoring_task',
    'checkout_attempt', 'subscription_created', 'subscription_event', 'invoice', 'entitlement_denial'
  ]
$$;

-- AI failure reason codes live in debug_payload (details.reason for flow errors, reason for provider errors). Only
-- code-shaped values are returned; a raw provider message is not.
create function analytics_private.ai_error_code(p_debug jsonb) returns text
language sql immutable set search_path = ''
as $$
  select c
  from (select coalesce(p_debug -> 'details' ->> 'reason', p_debug ->> 'reason') as c) x
  where c ~ '^[a-z][a-z0-9_]{0,63}$'
$$;

create function analytics_private.duration_ms(p_start timestamptz, p_end timestamptz) returns bigint
language sql immutable set search_path = ''
as $$ select round(extract(epoch from (p_end - p_start)) * 1000)::bigint $$;

-- Stripe minor units (cents / kuruş) -> major units, as in analytics_private.invoice_revenue.
create function analytics_private.major_units(p_minor bigint) returns numeric
language sql immutable set search_path = ''
as $$ select round(p_minor / 100.0, 2) $$;

-- Stored error messages can quote user or model content (raw parser / provider / JSON errors, zod messages that echo
-- received values), so the timeline shows a message only when it is one the app writes verbatim: the fixed messages
-- below (from ai.service / ai.repository / imports / exports / cover letters / tailoring and the privacy SQL) or the
-- path+code form of an output-contract failure. Anything else is null; error_code still says what failed.
create function analytics_private.safe_error_message(p_message text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_message = any (array[
      -- ai_runs
      'AI processing could not be completed',
      'AI run timed out (no terminal state recorded before deadline)',
      'AI permission withdrawn',
      'Processing restricted',
      'Guest processing superseded',
      'Guest AI permission changed',
      'Structured output validation failed',
      'Some numbers could not be verified. Review the affected text below.',
      -- imports (app-authored validation messages, else the generic one)
      'Import parsing failed',
      'Invalid storage location for import session',
      'Enable AI processing before analyzing your CV.',
      'Tracked guest AI analysis is unavailable. Please retry later.',
      'AI analysis is unavailable. Please try again later.',
      'AI analysis could not be completed. Please retry your CV analysis.',
      'Tracked AI run context is required',
      'Please reload to review the current privacy notice.',
      -- exports and cover-letter exports
      'Export generation failed',
      'Export failed',
      'Failed to generate cover letter export',
      'Export was not found',
      'Export file metadata was not found',
      'Master CV was not found',
      'Tailored CV was not found',
      'Template does not support requested export format',
      'Cover letter was not found',
      'Cover letter export was not found',
      'Cover letter export file metadata was not found',
      'Job was not found',
      -- tailoring sessions and tasks
      'The job analysis could not be completed. Please try again.',
      'Something went wrong while preparing this suggestion. Try again.',
      'The AI could not prepare this suggestion. Try again.',
      'Tailoring is available for standard CVs only.',
      'Add your experience to the CV before tailoring it for a job.',
      'Choose a master CV in the desired language before tailoring',
      'CV was not found',
      'Tailoring session was not found'
    ]) then p_message
    -- Output-contract failures written as "<path>: <zod issue code>; ..." (no zod message text).
    when p_message ~ '^Structured output validation failed: [A-Za-z0-9_.*]{1,200}: [a-z_]{1,40}(; [A-Za-z0-9_.*]{1,200}: [a-z_]{1,40}){0,19}$'
      then p_message
  end
$$;

-- ---------------------------------------------------------------------------
-- analytics_people.search_users
-- ---------------------------------------------------------------------------

create function analytics_people.search_users(
  p_user_id uuid default null, p_query text default null, p_from date default null, p_to date default null,
  p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_cursor text default null
)
returns table (
  user_id uuid, email text, created_at timestamptz, market text, plan_code text, subscription_status text,
  analytics_consent boolean, is_internal boolean, restricted boolean, cursor text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := lower(btrim(p_query));
  v_uuid uuid;
  v_limit integer;
  c record;
begin
  perform analytics_private.assert_audited('search_users', null);
  perform analytics_private.assert_filter_keys(p_filters, array[]::text[]);
  v_limit := analytics_private.people_limit(p_limit);
  if v_q is null or length(v_q) < 3 or length(v_q) > 200 then
    raise exception 'query must be 3 to 200 characters' using errcode = '22023';
  end if;
  if v_q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
  end if;
  select * into c from analytics_private.parse_list_cursor(p_cursor);
  if p_cursor is not null and (c.rank is null or c.rank > 2 or c.sort_num <> trunc(c.sort_num)) then
    raise exception 'malformed cursor' using errcode = '22023';
  end if;

  -- Order: exact id match, then email prefix, then email contains; newest signup first within a rank. Restricted
  -- accounts sort last within their rank with a constant key, so the cursor reveals nothing about them.
  return query
  with matches as (
    select u.id, u.email, u.created_at, u.is_internal, u.analytics,
           (u.processing_restricted_at is not null) as is_restricted,
           case when v_uuid is not null then 0 when starts_with(lower(u.email), v_q) then 1 else 2 end as rank
    from public.users u
    where u.deletion_requested_at is null
      and ((v_uuid is not null and u.id = v_uuid)
           or (v_uuid is null and strpos(lower(u.email), v_q) > 0))
  ),
  keyed as (
    select m.*,
           case when m.is_restricted then 0
                else floor(extract(epoch from m.created_at) * 1000000)::numeric end as sort_num
    from matches m
  ),
  page as (
    select k.*
    from keyed k
    where c.user_id is null
       or k.rank > c.rank
       or (k.rank = c.rank and (k.sort_num < c.sort_num or (k.sort_num = c.sort_num and k.id > c.user_id)))
    order by k.rank, k.sort_num desc, k.id
    limit v_limit
  )
  select p.id,
         case when not p.is_restricted or lower(p.email) = v_q then p.email end,
         case when p.is_restricted then null else p.created_at end,
         case when p.is_restricted then null else bm.market end,
         s.plan_code,
         s.status,
         case when p.is_restricted then null else p.analytics end,
         case when p.is_restricted then null else p.is_internal end,
         p.is_restricted,
         p.rank || '~' || p.sort_num || '|' || p.id
  from page p
  left join public.billing_markets bm on bm.user_id = p.id
  left join lateral analytics_private.current_subscription(p.id) s on not p.is_restricted
  order by p.rank, p.sort_num desc, p.id;
end $$;

comment on function analytics_people.search_users(uuid, text, date, date, jsonb, integer, text) is
'{"title":"Find users","definition":"Signed-up accounts matching p_query: an exact user id, otherwise a case-insensitive email match (prefix matches first, then contains), newest signup first within each group. Accounts pending deletion are never returned (erased accounts no longer exist). Accounts with restricted processing return only user_id and restricted = true, plus their email when p_query is that exact full email (case-insensitive). plan_code / subscription_status come from the current provider subscription (active or trialing, else the latest; checkout placeholders ignored), null when there is none. Admin accounts are included and flagged with is_internal.","unit":"count","shape":"table","breakdowns":[],"filters":[],"filter_keys":[],"kb":"tables/users.md","consent_scoped":false}';

-- ---------------------------------------------------------------------------
-- analytics_people.user_summary
-- ---------------------------------------------------------------------------

create function analytics_people.user_summary(
  p_user_id uuid default null, p_query text default null, p_from date default null, p_to date default null,
  p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_cursor text default null
)
returns table (
  user_id uuid, email text, created_at timestamptz, locale text, market text, is_internal boolean,
  analytics_consent boolean, ai_consent boolean, plan_code text, subscription_status text,
  trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean, usage jsonb,
  entitlement_denials bigint, invoices bigint, paid_usd_native numeric, paid_try_native numeric,
  last_activity_at timestamptz, restricted boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  u public.users%rowtype;
  r record;
begin
  perform analytics_private.assert_audited('user_summary', p_user_id);
  perform analytics_private.assert_filter_keys(p_filters, array[]::text[]);
  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '22023';
  end if;
  select * into r from analytics_private.people_range(p_from, p_to);

  select * into u from public.users x where x.id = p_user_id and x.deletion_requested_at is null;
  if not found then
    return;
  end if;
  if u.processing_restricted_at is not null then
    return query select u.id, null::text, null::timestamptz, null::text, null::text, null::boolean, null::boolean,
      null::boolean, null::text, null::text, null::timestamptz, null::timestamptz, null::boolean, null::jsonb,
      null::bigint, null::bigint, null::numeric, null::numeric, null::timestamptz, true;
    return;
  end if;

  return query
  with sub as (
    select * from analytics_private.current_subscription(u.id)
  ),
  usage_row as (
    -- The current UTC month's meter against the limits of the effective plan (free without a live subscription).
    select jsonb_build_object(
             'tailored_cv_generations', jsonb_build_object('used', coalesce(uc.tailored_cv_generations_count, 0),
                                                           'limit', p.limits -> 'tailored_cv_generations'),
             'exports', jsonb_build_object('used', coalesce(uc.exports_count, 0), 'limit', p.limits -> 'exports'),
             'ai_actions', jsonb_build_object('used', coalesce(uc.ai_actions_count, 0), 'limit', p.limits -> 'ai_actions'),
             'storage_bytes', jsonb_build_object('used', coalesce(uc.storage_bytes_used, 0), 'limit', p.limits -> 'storage_bytes')
           ) as usage
    from (select coalesce((select s.plan_code from sub s where s.status in ('active', 'trialing')), 'free') as code) e
    left join public.billing_plan_catalog p on p.plan_code = e.code
    left join public.usage_counters uc
      on uc.user_id = u.id and uc.period_month = date_trunc('month', now() at time zone 'UTC')::date
  ),
  denials as (
    select coalesce(sum(d.count), 0)::bigint as n
    from public.entitlement_denials d
    where d.user_id = u.id
      and analytics_private.utc_start(d.day) >= r.from_ts and analytics_private.utc_start(d.day) < r.to_ts
  ),
  paid as (
    -- Collected invoices (shared revenue definition: amount_paid > 0, net of refunds, native currency).
    select count(*) as invoices,
           coalesce(sum(ir.revenue) filter (where ir.currency = 'USD'), 0) as usd,
           coalesce(sum(ir.revenue) filter (where ir.currency = 'TRY'), 0) as try_
    from analytics_private.invoice_revenue ir
    where ir.user_id = u.id and ir.paid_at >= r.from_ts and ir.paid_at < r.to_ts
  ),
  activity as (
    -- Latest timestamped action, or the latest active day (00:00 UTC) when that is later.
    select greatest(
      (select max(a.started_at) from public.ai_runs a where a.user_id = u.id),
      (select max(e.created_at) from public.exports e where e.user_id = u.id),
      (select max(e.created_at) from public.cover_letter_exports e where e.user_id = u.id),
      (select max(v.created_at) from public.cv_block_revisions v where v.user_id = u.id),
      (select max(t.created_at) from public.tailoring_sessions t where t.user_id = u.id),
      (select max(m.updated_at) from public.master_cvs m where m.user_id = u.id),
      (select max(t.updated_at) from public.tailored_cvs t where t.user_id = u.id),
      (select max(c.updated_at) from public.cover_letters c where c.user_id = u.id),
      (select max(j.updated_at) from public.jobs j where j.user_id = u.id),
      (select max(c.created_at) from public.checkout_attempts c where c.user_id = u.id),
      (select analytics_private.utc_start(max(d.activity_date)) from public.user_activity_days d where d.user_id = u.id),
      u.created_at
    ) as at
  )
  select u.id, u.email, u.created_at, u.locale, bm.market, u.is_internal, u.analytics, u.ai_processing,
         s.plan_code, s.status, s.trial_end, s.current_period_end, s.cancel_at_period_end,
         ur.usage, dn.n, pd.invoices, round(pd.usd, 2), round(pd.try_, 2), ac.at, false
  from usage_row ur
  cross join denials dn
  cross join paid pd
  cross join activity ac
  left join sub s on true
  left join public.billing_markets bm on bm.user_id = u.id;
end $$;

comment on function analytics_people.user_summary(uuid, text, date, date, jsonb, integer, text) is
'{"title":"Account summary","definition":"One row for p_user_id: signup, locale, market, consent flags (analytics, AI processing), current provider subscription (active or trialing, else the latest; checkout placeholders ignored), usage = {counter: {used, limit}} for tailored_cv_generations, exports, ai_actions and storage_bytes: this UTC month''s usage_counters against the effective plan''s billing_plan_catalog limits (free without an active or trialing subscription; a null limit is unlimited), plan-limit denials, collected invoices and net paid amounts per native currency (amount_paid > 0, net of refunds), and last activity (latest timestamped action or active day). p_from / p_to narrow denials and invoices (default whole history). Restricted processing: every column except user_id and restricted is null. Pending deletion or unknown: no row.","unit":"count","shape":"table","breakdowns":[],"filters":[],"filter_keys":[],"kb":"tables/users.md","consent_scoped":false,"measures":{"entitlement_denials":{"label":"Plan-limit denials","unit":"count"},"invoices":{"label":"Collected invoices","unit":"count"},"paid_usd_native":{"label":"Paid (USD)","unit":"currency","description":"Net of refunds, USD invoices"},"paid_try_native":{"label":"Paid (TRY)","unit":"currency","description":"Net of refunds, TRY invoices"}}}';

-- ---------------------------------------------------------------------------
-- analytics_people.user_timeline
-- ---------------------------------------------------------------------------

create function analytics_people.user_timeline(
  p_user_id uuid default null, p_query text default null, p_from date default null, p_to date default null,
  p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_cursor text default null
)
returns table (
  occurred_at timestamptz, event_type text, entity text, entity_id uuid, status text, is_failure boolean,
  duration_ms bigint, detail jsonb, error_code text, error_message text, cursor text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid;
  v_limit integer;
  v_types text[];
  v_failures_only boolean := false;
  v_from timestamptz;
  v_to timestamptz;
  r record;
  c record;
  bad_type text;
begin
  perform analytics_private.assert_audited('user_timeline', p_user_id);
  perform analytics_private.assert_filter_keys(p_filters, array['event_type', 'failures_only']);
  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '22023';
  end if;
  v_limit := analytics_private.people_limit(p_limit);
  select * into r from analytics_private.people_range(p_from, p_to);
  select * into c from analytics_private.parse_timeline_cursor(p_cursor);
  if p_filters ? 'event_type' then
    if jsonb_typeof(p_filters -> 'event_type') not in ('string', 'array') then
      raise exception 'event_type must be a string or an array of strings' using errcode = '22023';
    end if;
    v_types := analytics_private.filter_values(p_filters, 'event_type');
    select t into bad_type from unnest(v_types) t where not (t = any (analytics_private.timeline_event_types())) limit 1;
    if bad_type is not null or cardinality(v_types) = 0 then
      raise exception 'unsupported event_type: %', coalesce(bad_type, '[]') using errcode = '22023';
    end if;
  end if;

  if p_filters ? 'failures_only' then
    if jsonb_typeof(p_filters -> 'failures_only') <> 'boolean' then
      raise exception 'failures_only must be a boolean' using errcode = '22023';
    end if;
    v_failures_only := (p_filters ->> 'failures_only')::boolean;
  end if;

  -- Restricted, pending-deletion and unknown accounts have no timeline.
  select u.id into v_uid
  from public.users u
  where u.id = p_user_id and u.deletion_requested_at is null and u.processing_restricted_at is null;
  if v_uid is null then
    return;
  end if;

  -- Keyset: every branch takes only rows strictly before the cursor and at most one page, newest first, using its
  -- user index; the outer sort merges the branches. (occurred_at, event_type, entity_id) is unique because each
  -- event type comes from one table and entity_id is that table's primary key.
  v_from := r.from_ts;
  v_to := least(r.to_ts, coalesce(c.at + interval '1 microsecond', 'infinity'::timestamptz));

  return query
  select t.occurred_at, t.event_type, t.entity, t.entity_id, t.status, t.is_failure, t.duration_ms,
         t.detail, t.error_code, left(analytics_private.safe_error_message(t.error_message), 300),
         analytics_private.cursor_time(t.occurred_at) || '|' || t.event_type || '|' || t.entity_id
  from (
    -- Account creation. full_name is not shown.
    (select u.created_at as occurred_at, 'signup'::text as event_type, 'users'::text as entity, u.id as entity_id,
            null::text as status, false as is_failure, null::bigint as duration_ms,
            jsonb_strip_nulls(jsonb_build_object('locale', u.locale, 'default_cv_language', u.default_cv_language,
              'onboarding_completed', u.onboarding_completed)) as detail,
            null::text as error_code, null::text as error_message
     from public.users u
     where u.id = v_uid and (v_types is null or 'signup' = any (v_types)) and not v_failures_only
       and u.created_at >= v_from and u.created_at < v_to
       and (c.at is null or (u.created_at, 'signup' collate "C", u.id) < (c.at, c.event_type collate "C", c.entity_id)))

    union all
    -- File uploads. The original filename and storage path are not shown.
    (select f.created_at, 'file_upload', 'files', f.id,
            case when f.is_deleted then 'deleted' else 'active' end, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('file_type', f.file_type, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes)),
            null, null
     from public.files f
     where f.user_id = v_uid and (v_types is null or 'file_upload' = any (v_types)) and not v_failures_only
       and f.created_at >= v_from and f.created_at < v_to
       and (c.at is null or (f.created_at, 'file_upload' collate "C", f.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by f.created_at desc, f.id desc
     limit v_limit)

    union all
    -- CV imports. Extracted text and parsed content are not shown.
    (select i.created_at, 'import', 'imports', i.id, i.status, i.status = 'failed', null::bigint,
            jsonb_strip_nulls(jsonb_build_object('parser_name', i.parser_name, 'module_type', i.module_type,
              'source_file_id', i.source_file_id, 'target_master_cv_id', i.target_master_cv_id)),
            null, i.error_message
     from public.imports i
     where i.user_id = v_uid and (v_types is null or 'import' = any (v_types)) and (not v_failures_only or i.status = 'failed')
       and i.created_at >= v_from and i.created_at < v_to
       and (c.at is null or (i.created_at, 'import' collate "C", i.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by i.created_at desc, i.id desc
     limit v_limit)

    union all
    -- Master CVs, with the CV language from cv_languages. Title and content are not shown.
    (select m.created_at, 'master_cv_created', 'master_cvs', m.id,
            case when m.is_deleted then 'deleted' else 'active' end, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('source_type', m.source_type, 'language', m.language,
              'language_name', l.name, 'module_type', m.module_type, 'template_id', m.template_id)),
            null, null
     from public.master_cvs m
     left join public.cv_languages l on l.code = m.language
     where m.user_id = v_uid and (v_types is null or 'master_cv_created' = any (v_types)) and not v_failures_only
       and m.created_at >= v_from and m.created_at < v_to
       and (c.at is null or (m.created_at, 'master_cv_created' collate "C", m.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by m.created_at desc, m.id desc
     limit v_limit)

    union all
    -- Saved jobs. Company, title, description, URL, location and notes are not shown.
    (select j.created_at, 'job_saved', 'jobs', j.id, j.status, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('applied_at', j.applied_at, 'tailored_cv_id', j.tailored_cv_id,
              'cover_letter_id', j.cover_letter_id)),
            null, null
     from public.jobs j
     where j.user_id = v_uid and (v_types is null or 'job_saved' = any (v_types)) and not v_failures_only
       and j.created_at >= v_from and j.created_at < v_to
       and (c.at is null or (j.created_at, 'job_saved' collate "C", j.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by j.created_at desc, j.id desc
     limit v_limit)

    union all
    -- Application-status transitions on the user's own jobs (owner, not actor), as in the KB query.
    (select h.changed_at, 'job_status_changed', 'job_status_history', h.id, h.to_status, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('job_id', h.job_id, 'from_status', h.from_status, 'to_status', h.to_status)),
            null, null
     from public.jobs j
     join public.job_status_history h on h.job_id = j.id
     where j.user_id = v_uid and (v_types is null or 'job_status_changed' = any (v_types)) and not v_failures_only
       and h.changed_at >= v_from and h.changed_at < v_to
       and (c.at is null or (h.changed_at, 'job_status_changed' collate "C", h.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by h.changed_at desc, h.id desc
     limit v_limit)

    union all
    -- Tailored CVs. Title, content and review are not shown.
    (select tc.created_at, 'tailored_cv_created', 'tailored_cvs', tc.id,
            case when tc.is_deleted then 'deleted' else tc.status end, coalesce(tc.ai_generation_status = 'failed', false), null::bigint,
            jsonb_strip_nulls(jsonb_build_object('master_cv_id', tc.master_cv_id, 'job_id', tc.job_id,
              'language', tc.language, 'language_name', l.name, 'module_type', tc.module_type,
              'template_id', tc.template_id, 'ai_generation_status', tc.ai_generation_status)),
            null, null
     from public.tailored_cvs tc
     left join public.cv_languages l on l.code = tc.language
     where tc.user_id = v_uid and (v_types is null or 'tailored_cv_created' = any (v_types)) and (not v_failures_only or tc.ai_generation_status = 'failed')
       and tc.created_at >= v_from and tc.created_at < v_to
       and (c.at is null or (tc.created_at, 'tailored_cv_created' collate "C", tc.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by tc.created_at desc, tc.id desc
     limit v_limit)

    union all
    -- Block revisions (AI applies, imports, restores; manual master edits create none). No content snapshot.
    (select v.created_at, 'cv_block_revision', 'cv_block_revisions', v.id, v.change_source, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('cv_kind', v.cv_kind, 'block_type', v.block_type,
              'change_source', v.change_source, 'revision_number', v.revision_number, 'master_cv_id', v.master_cv_id,
              'tailored_cv_id', v.tailored_cv_id, 'ai_suggestion_id', v.ai_suggestion_id)),
            null, null
     from public.cv_block_revisions v
     where v.user_id = v_uid and (v_types is null or 'cv_block_revision' = any (v_types)) and not v_failures_only
       and v.created_at >= v_from and v.created_at < v_to
       and (c.at is null or (v.created_at, 'cv_block_revision' collate "C", v.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by v.created_at desc, v.id desc
     limit v_limit)

    union all
    -- AI runs (mock runs included). Payloads are never read except the cv_translate target language code and the
    -- failure stage / reason code from debug_payload. cost_usd is the stored exact cost (null when not recorded).
    (select a.started_at, 'ai_run', 'ai_runs', a.id, a.status, a.status = 'failed',
            analytics_private.duration_ms(a.started_at, a.completed_at),
            jsonb_strip_nulls(jsonb_build_object('flow_type', a.flow_type, 'provider', a.provider,
              'model_name', a.model_name, 'progress_stage', a.progress_stage,
              'failed_stage', case when a.status = 'failed' and a.debug_payload ->> 'stage' ~ '^[a-z][a-z0-9_]{0,63}$'
                                   then a.debug_payload ->> 'stage' end,
              'input_tokens', a.input_tokens, 'cached_input_tokens', a.cached_input_tokens,
              'output_tokens', a.output_tokens, 'reasoning_tokens', a.reasoning_tokens, 'total_tokens', a.total_tokens,
              'cost_usd', a.cost_usd,
              'target_language', case when a.flow_type = 'cv_translate'
                                        and a.input_payload ->> 'target_language' ~ '^[a-z]{2,3}(-[a-z0-9]{2,8}){0,3}$'
                                      then a.input_payload ->> 'target_language' end,
              'master_cv_id', a.master_cv_id, 'tailored_cv_id', a.tailored_cv_id, 'job_id', a.job_id,
              'import_id', a.import_id, 'tailoring_session_id', a.tailoring_session_id, 'parent_run_id', a.parent_run_id)),
            case when a.status = 'failed' then analytics_private.ai_error_code(a.debug_payload) end,
            a.error_message
     from public.ai_runs a
     where a.user_id = v_uid and (v_types is null or 'ai_run' = any (v_types)) and (not v_failures_only or a.status = 'failed')
       and a.started_at >= v_from and a.started_at < v_to
       and (c.at is null or (a.started_at, 'ai_run' collate "C", a.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by a.started_at desc, a.id desc
     limit v_limit)

    union all
    -- AI suggestions generated. Before/suggested content and rationale are not shown.
    (select s.created_at, 'ai_suggestion_created', 'ai_suggestions', s.id, s.status, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('action_type', s.action_type, 'kind', s.kind, 'block_id', s.block_id,
              'ai_run_id', s.ai_run_id, 'master_cv_id', s.master_cv_id, 'tailored_cv_id', s.tailored_cv_id,
              'tailoring_session_id', s.tailoring_session_id)),
            null, null
     from public.ai_suggestions s
     where s.user_id = v_uid and (v_types is null or 'ai_suggestion_created' = any (v_types)) and not v_failures_only
       and s.created_at >= v_from and s.created_at < v_to
       and (c.at is null or (s.created_at, 'ai_suggestion_created' collate "C", s.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by s.created_at desc, s.id desc
     limit v_limit)

    union all
    -- AI suggestions applied.
    (select s.applied_at, 'ai_suggestion_applied', 'ai_suggestions', s.id, 'applied', false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('action_type', s.action_type, 'kind', s.kind, 'block_id', s.block_id,
              'ai_run_id', s.ai_run_id, 'master_cv_id', s.master_cv_id, 'tailored_cv_id', s.tailored_cv_id,
              'tailoring_session_id', s.tailoring_session_id)),
            null, null
     from public.ai_suggestions s
     where s.user_id = v_uid and s.applied_at is not null
       and (v_types is null or 'ai_suggestion_applied' = any (v_types)) and not v_failures_only
       and s.applied_at >= v_from and s.applied_at < v_to
       and (c.at is null or (s.applied_at, 'ai_suggestion_applied' collate "C", s.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by s.applied_at desc, s.id desc
     limit v_limit)

    union all
    -- CV exports (master or tailored).
    (select e.created_at, 'cv_export', 'exports', e.id, e.status, e.status = 'failed',
            analytics_private.duration_ms(e.created_at, e.completed_at),
            jsonb_strip_nulls(jsonb_build_object('format', e.format,
              'target', case when e.master_cv_id is not null then 'master' else 'tailored' end,
              'master_cv_id', e.master_cv_id, 'tailored_cv_id', e.tailored_cv_id, 'template_id', e.template_id)),
            null, e.error_message
     from public.exports e
     where e.user_id = v_uid and (v_types is null or 'cv_export' = any (v_types)) and (not v_failures_only or e.status = 'failed')
       and e.created_at >= v_from and e.created_at < v_to
       and (c.at is null or (e.created_at, 'cv_export' collate "C", e.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by e.created_at desc, e.id desc
     limit v_limit)

    union all
    -- Cover letters, with the language from cv_languages. Title and content are not shown.
    (select cl.created_at, 'cover_letter_created', 'cover_letters', cl.id, cl.status, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('language', cl.language, 'language_name', l.name,
              'job_id', cl.job_id, 'tailored_cv_id', cl.tailored_cv_id)),
            null, null
     from public.cover_letters cl
     left join public.cv_languages l on l.code = cl.language
     where cl.user_id = v_uid and (v_types is null or 'cover_letter_created' = any (v_types)) and not v_failures_only
       and cl.created_at >= v_from and cl.created_at < v_to
       and (c.at is null or (cl.created_at, 'cover_letter_created' collate "C", cl.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by cl.created_at desc, cl.id desc
     limit v_limit)

    union all
    -- Cover letter exports.
    (select e.created_at, 'cover_letter_export', 'cover_letter_exports', e.id, e.status, e.status = 'failed',
            analytics_private.duration_ms(e.created_at, e.completed_at),
            jsonb_strip_nulls(jsonb_build_object('format', e.format, 'cover_letter_id', e.cover_letter_id)),
            null, e.error_message
     from public.cover_letter_exports e
     where e.user_id = v_uid and (v_types is null or 'cover_letter_export' = any (v_types)) and (not v_failures_only or e.status = 'failed')
       and e.created_at >= v_from and e.created_at < v_to
       and (c.at is null or (e.created_at, 'cover_letter_export' collate "C", e.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by e.created_at desc, e.id desc
     limit v_limit)

    union all
    -- Tailoring v2 sessions. Job snapshot, analysis, decisions, answers and base snapshot are not shown; a session
    -- with a stored error is a failure.
    (select ts.created_at, 'tailoring_session', 'tailoring_sessions', ts.id, ts.status, ts.error_message is not null,
            analytics_private.duration_ms(ts.created_at, ts.finished_at),
            jsonb_strip_nulls(jsonb_build_object('tailored_cv_id', ts.tailored_cv_id, 'job_id', ts.job_id,
              'questions_completed', ts.questions_completed, 'analysis_run_id', ts.analysis_run_id,
              'finished_at', ts.finished_at)),
            null, ts.error_message
     from public.tailoring_sessions ts
     where ts.user_id = v_uid and (v_types is null or 'tailoring_session' = any (v_types)) and (not v_failures_only or ts.error_message is not null)
       and ts.created_at >= v_from and ts.created_at < v_to
       and (c.at is null or (ts.created_at, 'tailoring_session' collate "C", ts.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by ts.created_at desc, ts.id desc
     limit v_limit)

    union all
    -- Tailoring v2 tasks, reached through the user's sessions (tasks have no user index). The brief is not shown.
    (select k.created_at, 'tailoring_task', 'tailoring_session_tasks', k.id, k.status, k.status = 'failed',
            analytics_private.duration_ms(k.started_at, k.completed_at),
            jsonb_strip_nulls(jsonb_build_object('session_id', k.session_id, 'kind', k.kind, 'block_id', k.block_id,
              'section_id', k.section_id, 'attempts', k.attempts, 'rerun_for_answer', k.rerun_for_answer,
              'ai_run_id', k.ai_run_id)),
            null, k.error_message
     from public.tailoring_sessions ts
     join public.tailoring_session_tasks k on k.session_id = ts.id
     where ts.user_id = v_uid and (v_types is null or 'tailoring_task' = any (v_types)) and (not v_failures_only or k.status = 'failed')
       and k.created_at >= v_from and k.created_at < v_to
       and (c.at is null or (k.created_at, 'tailoring_task' collate "C", k.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by k.created_at desc, k.id desc
     limit v_limit)

    union all
    -- Checkout attempts; expired, canceled, rejected and failed checkouts are failed/cancelled actions.
    (select ca.created_at, 'checkout_attempt', 'checkout_attempts', ca.id, ca.outcome,
            ca.outcome in ('expired', 'canceled', 'failed', 'rejected_pending', 'rejected_active', 'rejected_pricing_changed'),
            analytics_private.duration_ms(ca.created_at, ca.resolved_at),
            jsonb_strip_nulls(jsonb_build_object('plan_code', ca.plan_code, 'market', ca.market,
              'currency', upper(ca.currency), 'amount', analytics_private.major_units(ca.amount), 'trial_requested', ca.trial_requested,
              'trial_applied', ca.trial_applied)),
            null, null
     from public.checkout_attempts ca
     where ca.user_id = v_uid and (v_types is null or 'checkout_attempt' = any (v_types)) and (not v_failures_only or ca.outcome in ('expired', 'canceled', 'failed', 'rejected_pending', 'rejected_active', 'rejected_pricing_changed'))
       and ca.created_at >= v_from and ca.created_at < v_to
       and (c.at is null or (ca.created_at, 'checkout_attempt' collate "C", ca.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by ca.created_at desc, ca.id desc
     limit v_limit)

    union all
    -- Subscription rows as in the KB query (including checkout placeholders). Provider ids are not shown; the
    -- cancellation feedback is the portal survey choice (no free text is stored).
    (select sb.created_at, 'subscription_created', 'subscriptions', sb.id, sb.status, false, null::bigint,
            jsonb_strip_nulls(jsonb_build_object('plan_code', sb.plan_code, 'provider', sb.provider, 'market', sb.market,
              'currency', upper(sb.currency), 'billing_interval', sb.billing_interval, 'unit_amount', analytics_private.major_units(sb.unit_amount),
              'trial_start', sb.trial_start, 'trial_end', sb.trial_end, 'current_period_end', sb.current_period_end,
              'cancel_at_period_end', sb.cancel_at_period_end, 'canceled_at', sb.canceled_at, 'ended_at', sb.ended_at,
              'cancellation_reason', sb.cancellation_reason, 'cancellation_feedback', sb.cancellation_feedback)),
            null, null
     from public.subscriptions sb
     where sb.user_id = v_uid and (v_types is null or 'subscription_created' = any (v_types)) and not v_failures_only
       and sb.created_at >= v_from and sb.created_at < v_to
       and (c.at is null or (sb.created_at, 'subscription_created' collate "C", sb.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by sb.created_at desc, sb.id desc
     limit v_limit)

    union all
    -- Subscription lifecycle events (live from 2026-10-29, backfilled before; source tells which). past_due is a
    -- failed payment.
    (select se.occurred_at, 'subscription_event', 'subscription_events', se.id, se.to_status, se.event_type = 'past_due',
            null::bigint,
            jsonb_strip_nulls(jsonb_build_object('event_type', se.event_type, 'from_status', se.from_status,
              'to_status', se.to_status, 'from_plan_code', se.from_plan_code, 'to_plan_code', se.to_plan_code,
              'source', se.source, 'subscription_id', se.subscription_id)),
            null, null
     from public.subscription_events se
     where se.user_id = v_uid and (v_types is null or 'subscription_event' = any (v_types)) and (not v_failures_only or se.event_type = 'past_due')
       and se.occurred_at >= v_from and se.occurred_at < v_to
       and (c.at is null or (se.occurred_at, 'subscription_event' collate "C", se.id) < (c.at, c.event_type collate "C", c.entity_id))
     order by se.occurred_at desc, se.id desc
     limit v_limit)

    union all
    -- Invoices at their paid time (created time while unpaid). Amounts in major units; void and uncollectible
    -- invoices are failures.
    (select coalesce(bi.paid_at, bi.created_at), 'invoice', 'billing_invoices', bi.id, bi.status,
            bi.status in ('void', 'uncollectible'), null::bigint,
            jsonb_strip_nulls(jsonb_build_object('billing_reason', bi.billing_reason, 'plan_code', bi.plan_code,
              'market', bi.market, 'currency', upper(bi.currency), 'amount_total', analytics_private.major_units(bi.amount_total),
              'amount_paid', analytics_private.major_units(bi.amount_paid), 'amount_refunded', analytics_private.major_units(bi.amount_refunded),
              'period_start', bi.period_start, 'period_end', bi.period_end, 'paid_at', bi.paid_at,
              'subscription_id', bi.subscription_id)),
            null, null
     from public.billing_invoices bi
     where bi.user_id = v_uid and (v_types is null or 'invoice' = any (v_types)) and (not v_failures_only or bi.status in ('void', 'uncollectible'))
       and coalesce(bi.paid_at, bi.created_at) >= v_from and coalesce(bi.paid_at, bi.created_at) < v_to
       and (c.at is null or (coalesce(bi.paid_at, bi.created_at), 'invoice' collate "C", bi.id)
                            < (c.at, c.event_type collate "C", c.entity_id))
     order by coalesce(bi.paid_at, bi.created_at) desc, bi.id desc
     limit v_limit)

    union all
    -- Plan-limit denials: one row per day x action x surface x reason (only the day is stored, shown at 00:00 UTC).
    (select analytics_private.utc_start(d.day), 'entitlement_denial', 'entitlement_denials', d.id, 'denied', true,
            null::bigint,
            jsonb_strip_nulls(jsonb_build_object('day', d.day, 'action', d.action, 'surface', d.surface,
              'reason', d.reason, 'plan_code', d.plan_code, 'count', d.count)),
            d.reason, null
     from public.entitlement_denials d
     where d.user_id = v_uid and (v_types is null or 'entitlement_denial' = any (v_types))
       and analytics_private.utc_start(d.day) >= v_from and analytics_private.utc_start(d.day) < v_to
       and (c.at is null or (analytics_private.utc_start(d.day), 'entitlement_denial' collate "C", d.id)
                            < (c.at, c.event_type collate "C", c.entity_id))
     order by d.day desc, d.id desc
     limit v_limit)
  ) t
  where not v_failures_only or t.is_failure
  order by t.occurred_at desc, t.event_type collate "C" desc, t.entity_id desc
  limit v_limit;
end $$;

comment on function analytics_people.user_timeline(uuid, text, date, date, jsonb, integer, text) is
'{"title":"Activity timeline","definition":"Every recorded action of p_user_id, newest first: the KB user_activity_timeline query extended with tailoring v2 sessions and tasks, checkout attempts, subscription events, invoices and plan-limit denials; CV languages appear as language / language_name on master CV, tailored CV and cover letter events and as target_language on cv_translate runs. Metadata only: ids, statuses, types, sizes, tokens, amounts and timings; never CV, job, cover-letter, file, AI prompt or AI response content, titles, filenames or names. is_failure flags failed or cancelled actions (failed runs, imports, exports and tasks, errored tailoring sessions, failed AI tailored drafts, expired / canceled / rejected / failed checkouts, past_due events, void / uncollectible invoices, plan-limit denials); error_message is the stored error only when it is one of the app''s fixed messages (else null), truncated to 300 characters; error_code is a stored reason code where one exists. duration_ms is processing time (AI runs, exports, tailoring sessions and tasks, checkouts). p_from / p_to bound occurred_at by whole UTC days, both inclusive (default whole history); p_filters.event_type is a string or array of event types and p_filters.failures_only (boolean) keeps only is_failure rows, both applied before paging. Restricted, pending-deletion and unknown accounts return no rows. Cursor: occurred_at|event_type|entity_id.","unit":"count","shape":"table","breakdowns":[],"filters":[],"filter_keys":["event_type","failures_only"],"event_types":["signup","file_upload","import","master_cv_created","job_saved","job_status_changed","tailored_cv_created","cv_block_revision","ai_run","ai_suggestion_created","ai_suggestion_applied","cv_export","cover_letter_created","cover_letter_export","tailoring_session","tailoring_task","checkout_attempt","subscription_created","subscription_event","invoice","entitlement_denial"],"kb":"queries/user_activity_timeline.md","consent_scoped":false,"measures":{"duration_ms":{"label":"Duration (ms)","unit":"count","description":"Server-side processing time in milliseconds"}}}';

-- ---------------------------------------------------------------------------
-- Drill-down: analytics_people.drill_users dispatches to analytics_private.drill_<key>
-- ---------------------------------------------------------------------------
-- Convention (a later phase adds a drill key without touching drill_users):
--   create function analytics_private.drill_<key>(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
--   returns table (user_id uuid, value numeric, detail jsonb, sort_key text) language ... stable set search_path = ''
--   - p_from / p_to: the resolved range (never null); p_filters: the request filters without metric, include_internal
--     and day. The function validates its own filter keys (22023 for others).
--   - It returns every user behind the point, one row per user, and does not page: drill_users applies the privacy
--     rules and include_internal afterwards, then pages. p_limit / p_cursor are passed for information only.
--   - sort_key is a decimal number as text; rows are listed by it descending, then user_id.
--   - detail is metadata only (no CV, job, cover-letter, file or AI content).
--   - Its comment is JSON: {"description", "metric" (the analytics.<metric> it drills, or null), "filters", "value",
--     "unit", "order", "detail"}; then `select analytics_private.refresh_drill_metrics();` republishes the list in
--     drill_users' comment, and the metric gets "drill": true in its own comment.

-- Signups (analytics.signups): accounts created in the range, newest first.
create function analytics_private.drill_signups(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
declare
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['locale', 'market']);
  return query
  select u.id,
         1::numeric,
         jsonb_build_object('created_at', u.created_at, 'locale', u.locale, 'market', coalesce(m.market, 'unknown'),
                            'is_internal', u.is_internal),
         floor(extract(epoch from u.created_at) * 1000000)::text
  from public.users u
  left join public.billing_markets m on m.user_id = u.id
  where u.created_at >= analytics_private.utc_start(p_from)
    and u.created_at < analytics_private.utc_start(p_to + 1)
    and (v_locales is null or u.locale = any (v_locales))
    and (v_markets is null or coalesce(m.market, 'unknown') = any (v_markets));
end $$;

comment on function analytics_private.drill_signups(date, date, jsonb, integer, text) is
'{"description":"Accounts that signed up in the range (UTC), newest first.","metric":"signups","filters":["locale","market"],"value":"1 per account","unit":"count","order":"newest signup first","detail":["created_at","locale","market","is_internal"]}';

-- Per-user AI runs of the analytics.ai_cost population (non-mock, non-guest) in the range.
create function analytics_private.ai_runs_by_user(p_from date, p_to date, p_filters jsonb, p_failed_only boolean)
returns table (user_id uuid, runs bigint, failed_runs bigint, unpriced_runs bigint, cost_usd numeric,
               last_run_at timestamptz, last_failed_at timestamptz, flows jsonb, models jsonb)
language plpgsql stable set search_path = ''
as $$
declare
  v_flows text[] := analytics_private.filter_values(p_filters, 'ai_flow');
  v_models text[] := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers text[] := analytics_private.filter_values(p_filters, 'ai_provider');
begin
  perform analytics_private.assert_filter_keys(p_filters, array['ai_flow', 'ai_model', 'ai_provider']);
  return query
  select rc.user_id,
         count(*),
         count(*) filter (where rc.status = 'failed'),
         count(*) filter (where rc.cost_usd is null and rc.has_tokens),
         round(coalesce(sum(rc.cost_usd), 0), 6),
         max(rc.started_at),
         max(rc.started_at) filter (where rc.status = 'failed'),
         to_jsonb(array_agg(distinct rc.flow_type order by rc.flow_type)),
         coalesce(to_jsonb(array_agg(distinct rc.model_name order by rc.model_name) filter (where rc.model_name is not null)), '[]'::jsonb)
  from analytics_private.run_cost rc
  where not rc.is_guest
    and rc.started_at >= analytics_private.utc_start(p_from)
    and rc.started_at < analytics_private.utc_start(p_to + 1)
    and (not p_failed_only or rc.status = 'failed')
    and (v_flows is null or rc.flow_type = any (v_flows))
    and (v_models is null or rc.model_name = any (v_models))
    and (v_providers is null or rc.provider = any (v_providers))
  group by rc.user_id;
end $$;

create function analytics_private.drill_ai_failures(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language sql stable set search_path = ''
as $$
  select a.user_id, a.failed_runs::numeric,
         jsonb_build_object('failed_runs', a.failed_runs, 'last_failed_at', a.last_failed_at, 'flows', a.flows, 'models', a.models),
         a.failed_runs::text
  from analytics_private.ai_runs_by_user(p_from, p_to, p_filters, true) a
$$;

comment on function analytics_private.drill_ai_failures(date, date, jsonb, integer, text) is
'{"description":"Accounts with failed AI runs in the range (analytics.ai_cost population: non-mock, non-guest runs), most failures first.","metric":null,"filters":["ai_flow","ai_model","ai_provider"],"value":"failed runs in range","unit":"count","order":"most failures first","detail":["failed_runs","last_failed_at","flows","models"]}';

create function analytics_private.drill_ai_cost_users(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language sql stable set search_path = ''
as $$
  select a.user_id, a.cost_usd,
         jsonb_build_object('cost_usd', a.cost_usd, 'runs', a.runs, 'unpriced_runs', a.unpriced_runs,
                            'last_run_at', a.last_run_at, 'flows', a.flows, 'models', a.models),
         a.cost_usd::text
  from analytics_private.ai_runs_by_user(p_from, p_to, p_filters, false) a
$$;

comment on function analytics_private.drill_ai_cost_users(date, date, jsonb, integer, text) is
'{"description":"Accounts with AI runs in the range, highest AI cost (USD, exact + estimated as in analytics.ai_cost) first.","metric":"ai_cost","filters":["ai_flow","ai_model","ai_provider"],"value":"AI cost in USD","unit":"currency","order":"highest cost first","detail":["cost_usd","runs","unpriced_runs","last_run_at","flows","models"]}';

-- Supported drill keys: every analytics_private.drill_<key> with the convention's signature, with its comment.
create function admin_app.drill_keys()
returns table (key text, description text, meta jsonb)
language sql stable security definer set search_path = ''
as $$
  select substr(p.proname, 7)::text,
         coalesce(x.meta ->> 'description', pg_catalog.obj_description(p.oid, 'pg_proc')),
         coalesce(x.meta, '{}'::jsonb)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral (select analytics_private.try_jsonb(pg_catalog.obj_description(p.oid, 'pg_proc')) as meta) x
  where n.nspname = 'analytics_private'
    and p.proname ~ '^drill_[a-z][a-z0-9_]{0,40}$'
    and p.oid = pg_catalog.to_regprocedure(format('analytics_private.%I(date, date, jsonb, integer, text)', p.proname))
  order by 1
$$;

create function analytics_people.drill_users(
  p_user_id uuid default null, p_query text default null, p_from date default null, p_to date default null,
  p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_cursor text default null
)
returns table (user_id uuid, email text, value numeric, detail jsonb, cursor text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_key text;
  v_limit integer;
  v_internal boolean := false;
  v_day date;
  r record;
  c record;
begin
  perform analytics_private.assert_audited('drill_users', null);
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' or jsonb_typeof(p_filters -> 'metric') is distinct from 'string' then
    raise exception 'filters.metric is required' using errcode = '22023';
  end if;
  v_key := p_filters ->> 'metric';
  if v_key !~ '^[a-z][a-z0-9_]{0,40}$'
     or pg_catalog.to_regprocedure(format('analytics_private.%I(date, date, jsonb, integer, text)', 'drill_' || v_key)) is null then
    raise exception 'unsupported drill metric: %', left(v_key, 60) using errcode = '22023';
  end if;
  v_limit := analytics_private.people_limit(p_limit);

  if p_filters ? 'include_internal' then
    if jsonb_typeof(p_filters -> 'include_internal') <> 'boolean' then
      raise exception 'include_internal must be a boolean' using errcode = '22023';
    end if;
    v_internal := (p_filters ->> 'include_internal')::boolean;
  end if;
  -- A clicked point narrows the range to one day; otherwise the metric range applies (default last 30 days).
  if p_filters ? 'day' then
    if jsonb_typeof(p_filters -> 'day') <> 'string' or (p_filters ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'day must be YYYY-MM-DD' using errcode = '22023';
    end if;
    begin
      v_day := (p_filters ->> 'day')::date;
    exception when others then
      raise exception 'day must be YYYY-MM-DD' using errcode = '22023';
    end;
    select * into r from analytics_private.resolve_range(v_day, v_day);
  else
    select * into r from analytics_private.resolve_range(p_from, p_to);
  end if;

  select * into c from analytics_private.parse_list_cursor(p_cursor);
  if p_cursor is not null and c.rank is not null then
    raise exception 'malformed cursor' using errcode = '22023';
  end if;

  -- Privacy and the internal-account rule are applied here, for every key: accounts pending deletion or with
  -- restricted processing are dropped by analysis_users.
  return query execute format($q$
    select d.user_id, u.email, d.value, d.detail, d.sort_num::text || '|' || d.user_id
    from (select x.user_id, x.value, x.detail, x.sort_key::numeric as sort_num
          from analytics_private.%I($1, $2, $3, $4, $5) x) d
    join analytics_private.analysis_users u on u.id = d.user_id
    where ($6 or not u.is_internal)
      and ($7::uuid is null or d.sort_num < $8 or (d.sort_num = $8 and d.user_id > $7))
    order by d.sort_num desc, d.user_id
    limit $4
  $q$, 'drill_' || v_key)
  using r.from_day, r.to_day, p_filters - array['metric', 'include_internal', 'day'], v_limit, p_cursor,
        v_internal, c.user_id, c.sort_num;
end $$;

comment on function analytics_people.drill_users(uuid, text, date, date, jsonb, integer, text) is
'{"title":"Users behind a metric point","definition":"The accounts behind one point of a metric. p_filters.metric names a drill key; drill_users calls analytics_private.drill_<key> (keys: drill_metrics here, or admin_app.drill_keys()). The range is p_from..p_to (default the last 30 days, at most 3 years) or the single UTC day in p_filters.day. Accounts pending deletion or with restricted processing are always excluded, and admin accounts unless p_filters.include_internal is true, as in the metrics. Other p_filters keys are the drill key''s own filters. A metric with meta.drill = true is drilled with the drill_metrics key whose metric property names it, passing the clicked bucket as p_from / p_to (or day) and its breakdown value as the matching filter. value and detail depend on the key; detail is metadata only. Cursor: sort_key|user_id.","unit":"count","shape":"table","breakdowns":[],"filters":["locale","market","ai_flow","ai_model","ai_provider"],"filter_keys":["metric","include_internal","day"],"kb":"new_analysis/README.md","consent_scoped":false,"measures":{"value":{"label":"Value","unit":"count","description":"Per drill key; see drill_metrics"}}}';

-- Republishes the supported drill keys into drill_users' comment (drill_metrics), so the catalog lists them.
create function analytics_private.refresh_drill_metrics() returns void
language plpgsql set search_path = ''
as $$
declare
  v_fn regprocedure := 'analytics_people.drill_users(uuid, text, date, date, jsonb, integer, text)'::regprocedure;
begin
  execute format('comment on function %s is %L', v_fn,
    (coalesce(analytics_private.try_jsonb(pg_catalog.obj_description(v_fn, 'pg_proc')), '{}'::jsonb)
     || jsonb_build_object('drill_metrics',
          coalesce((select jsonb_object_agg(k.key, k.meta) from admin_app.drill_keys() k), '{}'::jsonb)))::text);
end $$;

select analytics_private.refresh_drill_metrics();

-- ---------------------------------------------------------------------------
-- meta.drill = true on the metrics that support drill-down (merged into whatever comment the metric has).
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select 'analytics.signups(date, date, text, text, boolean, text, jsonb)'::regprocedure
    union all
    select 'analytics.ai_cost(date, date, text, text, boolean, text, jsonb)'::regprocedure
  loop
    execute format('comment on function %s is %L', v_fn,
      (coalesce(analytics_private.try_jsonb(pg_catalog.obj_description(v_fn, 'pg_proc')), '{}'::jsonb)
       || '{"drill": true}'::jsonb)::text);
  end loop;
end $$;

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
