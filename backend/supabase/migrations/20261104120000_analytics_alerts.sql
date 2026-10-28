-- Admin analytics Phase 5: in-app alerts and the audited Data health reads (docs/admin-analytics/api-contract.md
-- "Phase 5", requirements.md FR5/FR6, architecture.md §3.5-3.7).
-- - analytics.kpi_health: one-row operational health KPIs (failure and abandon rates), alertable.
-- - admin_app.alert_rules / alert_events: rules on a measure of an alertable KPI metric and the events they fired.
--   No grants: analytics_api reaches them only through the admin_app definer functions below. Every write function
--   validates its input (22023), writes its own audit row through admin_app.log_access in the same transaction
--   (actions alert.rule.create|update|delete and alert.event.ack) and is the only way to change the tables.
-- - analytics_private.evaluate_alerts(): hourly (pg_cron job analytics_alerts, scheduled only where pg_cron exists).
-- - analytics.data_freshness (copied from the engagement migration): the scheduler row also requires analytics_alerts,
--   active jobs and no failed runs in 24 hours; a new alerts_evaluated row reports the hourly evaluation.
-- - admin_app.audit_recent now refuses to run (42501) unless an audit.read row was written by log_access earlier in
--   the same transaction, as the people functions do for their reads.
-- admin_app.log_access needs no change: actions outside people.* / export.csv (alert.*, recompute.request,
-- audit.read) are already logged without a people_function, and people auditing stays as strict as before.

-- ---------------------------------------------------------------------------
-- analytics.kpi_health
-- ---------------------------------------------------------------------------

create function analytics.kpi_health(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  ai_runs bigint, ai_failed_runs bigint, ai_failure_rate numeric,
  failed_payments bigint, payment_failure_rate numeric,
  checkout_attempts bigint, checkout_abandon_rate numeric,
  export_failures bigint, export_failure_rate numeric,
  import_failures bigint, import_failure_rate numeric,
  tailoring_task_failures bigint, tailoring_task_failure_rate numeric,
  unpriced_ai_runs bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_plans text[];
  -- Helpers that also understand other keys only ever see the market filter.
  v_market_filter jsonb;
  v_ai_runs bigint; v_ai_failed bigint; v_ai_terminal bigint; v_unpriced bigint;
  v_pay_failed bigint; v_pay_due bigint;
  v_co_attempts bigint; v_co_abandoned bigint; v_co_completed bigint;
  v_exp_failed bigint; v_exp_terminal bigint;
  v_imp_failed bigint; v_imp_terminal bigint;
  v_task_failed bigint; v_task_terminal bigint;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'plan']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_plans := analytics_private.filter_values(p_filters, 'plan');
  v_market_filter := case when coalesce(p_filters, '{}'::jsonb) ? 'market'
                          then jsonb_build_object('market', p_filters -> 'market') else '{}'::jsonb end;

  -- AI runs: the analytics.ai_cost / ai_reliability population (non-mock, non-guest runs of analysis accounts).
  -- failure rate = failed / (completed + failed), as ai_reliability; unpriced = tokens but no stored cost or price.
  select count(*),
         count(*) filter (where s.status = 'failed'),
         count(*) filter (where s.status in ('completed', 'failed')),
         count(*) filter (where s.unpriced)
  into v_ai_runs, v_ai_failed, v_ai_terminal, v_unpriced
  from analytics_private.ai_run_scope(r.from_day, r.to_day, p_include_internal, v_market_filter) s;

  -- Failed payments (analytics.payment_issues section A): invoices that asked for money (not draft, amount_total > 0),
  -- by creation time, with nothing paid and uncollectible, void or still open after 1 day. Due excludes the ones still
  -- pending (open < 1 day). Market and plan are the invoice's.
  with due as (
    select case when i.amount_paid > 0 then 'paid'
                when i.status in ('paid', 'refunded', 'partially_refunded') then 'paid'
                when i.status = 'open' and i.created_at > now() - interval '1 day' then 'pending'
                when i.status in ('open', 'uncollectible', 'void') then 'failed'
                else 'other' end as outcome
    from public.billing_invoices i
    left join public.users u on u.id = i.user_id
    where i.status <> 'draft'
      and i.amount_total > 0
      and i.created_at >= v_start
      and i.created_at < v_end
      and (p_include_internal or i.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(i.market, 'unknown') = any (v_markets))
      and (v_plans is null or coalesce(i.plan_code, 'unknown') = any (v_plans))
  )
  select count(*) filter (where d.outcome = 'failed'), count(*) filter (where d.outcome <> 'pending')
  into v_pay_failed, v_pay_due
  from due d;

  -- Checkout attempts (analytics.checkout_funnel stages): abandon rate = abandoned / (completed + abandoned), i.e. over
  -- the attempts that reached Stripe and resolved; rejected attempts and ones open < 24h stay out of it.
  with att as (
    select case when ca.outcome in ('rejected_pending', 'rejected_active', 'rejected_pricing_changed', 'failed') then 'rejected'
                when ca.outcome = 'completed' then 'completed'
                when ca.outcome in ('expired', 'canceled') then 'abandoned'
                when ca.created_at < now() - interval '24 hours' then 'abandoned'
                else 'pending' end as stage
    from public.checkout_attempts ca
    left join public.users u on u.id = ca.user_id
    left join public.billing_markets bm on bm.user_id = ca.user_id
    where ca.created_at >= v_start
      and ca.created_at < v_end
      and (p_include_internal or ca.user_id is null or not u.is_internal)
      and (v_markets is null or coalesce(ca.market, bm.market, 'unknown') = any (v_markets))
      and (v_plans is null or lower(ca.plan_code) = any (v_plans))
  )
  select count(*), count(*) filter (where a.stage = 'abandoned'), count(*) filter (where a.stage = 'completed')
  into v_co_attempts, v_co_abandoned, v_co_completed
  from att a;

  -- Exports: CV and cover-letter exports created in the range; failure rate = failed / (completed + failed).
  with ex as (
    select e.user_id, e.status from public.exports e
    where e.created_at >= v_start and e.created_at < v_end
    union all
    select c.user_id, c.status from public.cover_letter_exports c
    where c.created_at >= v_start and c.created_at < v_end
  )
  select count(*) filter (where x.status = 'failed'), count(*) filter (where x.status in ('completed', 'failed'))
  into v_exp_failed, v_exp_terminal
  from ex x
  join analytics_private.analysis_users u on u.id = x.user_id
  left join public.billing_markets bm on bm.user_id = x.user_id
  where (p_include_internal or not u.is_internal)
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));

  -- Imports (analytics.import_quality): failure rate = failed / (parsed + failed); mock parses excluded.
  select count(*) filter (where i.status = 'failed'),
         count(*) filter (where i.status in ('parsed', 'reviewed', 'converted', 'failed'))
  into v_imp_failed, v_imp_terminal
  from public.imports i
  join analytics_private.analysis_users u on u.id = i.user_id
  left join public.billing_markets bm on bm.user_id = i.user_id
  where i.parser_name is distinct from 'mock_cv_parser_v1'
    and (p_include_internal or not u.is_internal)
    and i.created_at >= v_start
    and i.created_at < v_end
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets));

  -- Tailoring v2 tasks (analytics.tailoring_task_reliability): failed / (done + skipped + failed), by task creation.
  select count(*) filter (where t.status = 'failed'),
         count(*) filter (where t.status in ('done', 'skipped', 'failed'))
  into v_task_failed, v_task_terminal
  from public.tailoring_session_tasks t
  join analytics_private.tailoring_v2_sessions(timestamptz '2026-10-27 00:00:00+00', v_end, p_include_internal,
                                               v_market_filter) s on s.session_id = t.session_id
  where t.created_at >= v_start and t.created_at < v_end;

  return query select
    v_ai_runs, v_ai_failed, round(v_ai_failed::numeric / nullif(v_ai_terminal, 0), 4),
    v_pay_failed, round(v_pay_failed::numeric / nullif(v_pay_due, 0), 4),
    v_co_attempts, round(v_co_abandoned::numeric / nullif(v_co_abandoned + v_co_completed, 0), 4),
    v_exp_failed, round(v_exp_failed::numeric / nullif(v_exp_terminal, 0), 4),
    v_imp_failed, round(v_imp_failed::numeric / nullif(v_imp_terminal, 0), 4),
    v_task_failed, round(v_task_failed::numeric / nullif(v_task_terminal, 0), 4),
    v_unpriced;
end $$;

comment on function analytics.kpi_health(date, date, text, text, boolean, text, jsonb) is
'{"title":"Health KPIs","definition":"One row of operational failure and abandon rates for the whole range (UTC); internal accounts excluded unless included. AI: runs of the analytics.ai_cost population (non-mock, non-guest; accounts pending deletion or restricted excluded) started in the range; ai_failure_rate = failed / (completed + failed), pending runs excluded; unpriced_ai_runs have tokens but no stored cost and no model price. Payments (payment_issues A): invoices due (not draft, amount_total > 0) created in the range; failed = nothing paid and uncollectible, void or open for more than 1 day; payment_failure_rate = failed / due, where due excludes invoices still open for less than 1 day. Checkout (checkout_funnel): attempts created in the range; checkout_abandon_rate = abandoned (expired, canceled, or open > 24h) / (completed + abandoned). Exports: CV and cover-letter exports created in the range; export_failure_rate = failed / (completed + failed). Imports: non-mock CV imports created in the range; import_failure_rate = failed / (parsed + failed). Tailoring: v2 tasks (sessions from 2026-10-27) created in the range; tailoring_task_failure_rate = failed / (done + skipped + failed). Rates are null without a denominator. Filters: market applies to every measure (the invoice or attempt market for payments and checkout, else the account''s locked market); plan applies to payments and checkout only. Grain and currency do not apply.","unit":"ratio","shape":"kpi","breakdowns":[],"filters":["market","plan"],"kb":"new_analysis/acquisition/data_quality_health_checks.md","consent_scoped":false,"alertable":true,"measures":{"ai_runs":{"label":"AI runs","unit":"count","ignores_filters":["plan"]},"ai_failed_runs":{"label":"Failed AI runs","unit":"count","ignores_filters":["plan"]},"ai_failure_rate":{"label":"AI failure rate","unit":"ratio","description":"failed / (completed + failed)","ignores_filters":["plan"]},"failed_payments":{"label":"Failed payments","unit":"count","description":"Uncollectible, void or open > 1 day"},"payment_failure_rate":{"label":"Payment failure rate","unit":"ratio","description":"failed / due invoices"},"checkout_attempts":{"label":"Checkout attempts","unit":"count"},"checkout_abandon_rate":{"label":"Checkout abandon rate","unit":"ratio","description":"abandoned / (completed + abandoned)"},"export_failures":{"label":"Failed exports","unit":"count","description":"CV and cover-letter exports","ignores_filters":["plan"]},"export_failure_rate":{"label":"Export failure rate","unit":"ratio","description":"failed / (completed + failed)","ignores_filters":["plan"]},"import_failures":{"label":"Failed imports","unit":"count","ignores_filters":["plan"]},"import_failure_rate":{"label":"Import failure rate","unit":"ratio","description":"failed / (parsed + failed)","ignores_filters":["plan"]},"tailoring_task_failures":{"label":"Failed tailoring tasks","unit":"count","ignores_filters":["plan"]},"tailoring_task_failure_rate":{"label":"Tailoring task failure rate","unit":"ratio","description":"failed / (done + skipped + failed)","ignores_filters":["plan"]},"unpriced_ai_runs":{"label":"Unpriced AI runs","unit":"count","ignores_filters":["plan"]}}}';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table admin_app.alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120 and name = btrim(name)),
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{0,62}$'),
  measure text not null check (measure ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- Normalised by analytics_private.validate_alert_rule: {currency, include_internal, filters}.
  params jsonb not null default '{"currency":"usd","include_internal":false,"filters":{}}'::jsonb
    check (jsonb_typeof(params) = 'object' and length(params::text) <= 2000),
  "window" text not null check ("window" in ('today', '1d', '7d', '30d')),
  condition text not null check (condition in ('gt', 'lt', 'pct_change_gt', 'pct_change_lt')),
  threshold numeric not null check (threshold <> 'NaN'::numeric),
  cooldown_hours integer not null default 24 check (cooldown_hours between 1 and 720),
  enabled boolean not null default true,
  created_by text not null check (length(created_by) between 3 and 320),
  created_at timestamptz not null default now(),
  updated_by text check (length(updated_by) between 3 and 320),
  updated_at timestamptz not null default now(),
  -- Last evaluation (whether or not it fired): when, the value read, and the error when the metric call failed.
  last_evaluated_at timestamptz,
  last_value numeric,
  last_error text check (length(last_error) <= 500)
);
-- Names are unique, case-insensitively (a duplicate raises 23505 -> 409).
create unique index alert_rules_name_key on admin_app.alert_rules (lower(name));
alter table admin_app.alert_rules enable row level security;
revoke all on admin_app.alert_rules from public, anon, authenticated, service_role;

create table admin_app.alert_events (
  id bigint generated always as identity primary key,
  rule_id uuid not null references admin_app.alert_rules(id) on delete cascade,
  fired_at timestamptz not null default now(),
  window_from date not null,
  window_to date not null,
  value numeric,
  baseline numeric,
  message text not null check (length(message) <= 1000),
  acknowledged_by text check (length(acknowledged_by) between 3 and 320),
  acknowledged_at timestamptz,
  constraint alert_events_ack_check check ((acknowledged_by is null) = (acknowledged_at is null)),
  constraint alert_events_window_check check (window_from <= window_to)
);
-- Cooldown look-up (latest event of a rule) and the cascade on rule delete.
create index alert_events_rule_fired_idx on admin_app.alert_events (rule_id, fired_at desc);
create index alert_events_fired_idx on admin_app.alert_events (fired_at desc, id desc);
-- Header badge / open list.
create index alert_events_open_idx on admin_app.alert_events (fired_at desc, id desc) where acknowledged_at is null;
alter table admin_app.alert_events enable row level security;
revoke all on admin_app.alert_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Validation and windows
-- ---------------------------------------------------------------------------

-- The analytics.<metric> function with the standard signature, or null.
create function analytics_private.metric_oid(p_metric text) returns oid
language sql stable set search_path = ''
as $$
  select case when p_metric ~ '^[a-z][a-z0-9_]{0,62}$' then
    pg_catalog.to_regprocedure(format('analytics.%I(date, date, text, text, boolean, text, jsonb)', p_metric))::oid end
$$;

-- Numeric output columns of a function (bigint, integer, smallint, numeric, real, double precision).
create function analytics_private.numeric_output_columns(p_oid oid) returns text[]
language sql stable set search_path = ''
as $$
  select coalesce(array_agg(a.name order by a.ord), '{}'::text[])
  from pg_catalog.pg_proc p
  cross join lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes) with ordinality a(name, typ, mode, ord)
  where p.oid = p_oid
    and a.mode = 't'
    and a.typ in ('smallint'::regtype, 'integer'::regtype, 'bigint'::regtype, 'numeric'::regtype,
                  'real'::regtype, 'double precision'::regtype)
$$;

-- Checks a complete rule and returns its normalised params ({currency, include_internal, filters}). 22023 for:
-- a metric that is not an alertable kpi-shaped analytics function, a measure that is not one of its numeric output
-- columns, unknown params keys, a currency outside native|usd|try, a non-boolean include_internal, filter keys the
-- metric does not accept or values that are not scalars / arrays of 1-50 scalars, a window or condition outside
-- the enums, a % change on the partial `today` window, a missing or non-finite threshold, and a cooldown outside
-- 1-720 hours.
create function analytics_private.validate_alert_rule(
  p_name text, p_metric text, p_measure text, p_params jsonb, p_window text, p_condition text,
  p_threshold numeric, p_cooldown_hours integer
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_oid oid := analytics_private.metric_oid(p_metric);
  v_meta jsonb;
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_filters jsonb;
  v_key text;
  v_value jsonb;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if v_oid is null then
    raise exception 'unknown metric: %', p_metric using errcode = '22023';
  end if;
  v_meta := analytics_private.try_jsonb(pg_catalog.obj_description(v_oid, 'pg_proc'));
  if v_meta is null or v_meta ->> 'alertable' is distinct from 'true' or v_meta ->> 'shape' is distinct from 'kpi' then
    raise exception 'metric % is not alertable', p_metric using errcode = '22023';
  end if;
  if p_measure is null or not (p_measure = any (analytics_private.numeric_output_columns(v_oid))) then
    raise exception 'measure must be a numeric column of %', p_metric using errcode = '22023';
  end if;

  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'params must be an object' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(v_params) k where k not in ('currency', 'include_internal', 'filters') limit 1;
  if v_key is not null then
    raise exception 'unsupported params key: %', v_key using errcode = '22023';
  end if;
  if v_params ? 'currency' and (jsonb_typeof(v_params -> 'currency') <> 'string'
                                or v_params ->> 'currency' not in ('native', 'usd', 'try')) then
    raise exception 'currency must be native, usd or try' using errcode = '22023';
  end if;
  if v_params ? 'include_internal' and jsonb_typeof(v_params -> 'include_internal') <> 'boolean' then
    raise exception 'include_internal must be a boolean' using errcode = '22023';
  end if;
  v_filters := coalesce(v_params -> 'filters', '{}'::jsonb);
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'filters must be an object' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(v_filters) loop
    if not (v_meta -> 'filters' ? v_key) then
      raise exception 'unsupported filter for %: %', p_metric, v_key using errcode = '22023';
    end if;
    if not (jsonb_typeof(v_value) in ('string', 'number', 'boolean')
            or (jsonb_typeof(v_value) = 'array'
                and jsonb_array_length(v_value) between 1 and 50
                and not exists (select 1 from jsonb_array_elements(v_value) e
                                where jsonb_typeof(e) not in ('string', 'number', 'boolean')))) then
      raise exception 'filter % must be a scalar or an array of 1 to 50 scalars', v_key using errcode = '22023';
    end if;
  end loop;

  if p_window is null or p_window not in ('today', '1d', '7d', '30d') then
    raise exception 'window must be today, 1d, 7d or 30d' using errcode = '22023';
  end if;
  if p_condition is null or p_condition not in ('gt', 'lt', 'pct_change_gt', 'pct_change_lt') then
    raise exception 'condition must be gt, lt, pct_change_gt or pct_change_lt' using errcode = '22023';
  end if;
  -- `today` is a partial day: against a whole previous day it would read as a drop every morning.
  if p_window = 'today' and p_condition like 'pct_change%' then
    raise exception '%% change conditions need a complete window (1d, 7d or 30d)' using errcode = '22023';
  end if;
  if p_threshold is null or p_threshold = 'NaN'::numeric or p_threshold in ('Infinity'::numeric, '-Infinity'::numeric) then
    raise exception 'threshold must be a finite number' using errcode = '22023';
  end if;
  if p_cooldown_hours is null or p_cooldown_hours not between 1 and 720 then
    raise exception 'cooldown_hours must be between 1 and 720' using errcode = '22023';
  end if;

  v_params := jsonb_build_object(
    'currency', coalesce(v_params ->> 'currency', 'usd'),
    'include_internal', coalesce((v_params ->> 'include_internal')::boolean, false),
    'filters', v_filters);
  if length(v_params::text) > 2000 then
    raise exception 'params must not exceed 2000 characters' using errcode = '22023';
  end if;
  return v_params;
end $$;

-- The days a window covers at p_now (UTC) and the previous window of the same length (the pct_change baseline):
-- today = the current day so far (previous: yesterday); 1d = yesterday; 7d / 30d = the last 7 / 30 complete days.
create function analytics_private.alert_window(
  p_window text, p_now timestamptz,
  out from_day date, out to_day date, out prev_from date, out prev_to date
)
language plpgsql immutable set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'UTC')::date;
  v_days integer;
begin
  if p_window = 'today' then
    from_day := v_today; to_day := v_today;
  else
    v_days := case p_window when '1d' then 1 when '7d' then 7 when '30d' then 30 end;
    if v_days is null then
      raise exception 'unknown window: %', p_window using errcode = '22023';
    end if;
    to_day := v_today - 1;
    from_day := v_today - v_days;
  end if;
  prev_to := from_day - 1;
  prev_from := prev_to - (to_day - from_day);
end $$;

-- Reads one measure of an alertable metric for p_from..p_to. The metric is re-checked against the catalog (an
-- alertable analytics function with the standard signature, the measure one of its numeric output columns) before
-- its name is formatted into the call with %I. More than one row is an error; no row is null.
create function analytics_private.alert_value(p_metric text, p_measure text, p_params jsonb, p_from date, p_to date)
returns numeric
language plpgsql stable set search_path = ''
as $$
declare
  v_oid oid := analytics_private.metric_oid(p_metric);
  v_meta jsonb := analytics_private.try_jsonb(pg_catalog.obj_description(v_oid, 'pg_proc'));
  v_value numeric;
begin
  if v_oid is null or v_meta ->> 'alertable' is distinct from 'true' or v_meta ->> 'shape' is distinct from 'kpi' then
    raise exception 'metric % is not an alertable analytics metric', p_metric using errcode = '22023';
  end if;
  if not (p_measure = any (analytics_private.numeric_output_columns(v_oid))) then
    raise exception 'measure % is not a numeric column of %', p_measure, p_metric using errcode = '22023';
  end if;
  execute format(
    'select (m.%I)::numeric from analytics.%I(p_from => $1, p_to => $2, p_grain => ''day'', p_currency => $3, '
    'p_include_internal => $4, p_breakdown => null, p_filters => $5) m', p_measure, p_metric)
  into strict v_value
  using p_from, p_to, coalesce(p_params ->> 'currency', 'usd'),
        coalesce((p_params ->> 'include_internal')::boolean, false), coalesce(p_params -> 'filters', '{}'::jsonb);
  return v_value;
exception
  when no_data_found then
    return null;
  when too_many_rows then
    raise exception 'metric % returned more than one row', p_metric using errcode = '22023';
end $$;

-- A value for an alert message: ratio / percent measures as a percentage, others as a plain number.
create function analytics_private.alert_number(p_value numeric, p_unit text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_value is null then 'no value'
    when p_unit in ('ratio', 'percent') then trim_scale(round(p_value * 100, 1))::text || '%'
    else trim_scale(round(p_value, 2))::text
  end
$$;

create function analytics_private.alert_days(p_from date, p_to date) returns text
language sql immutable set search_path = ''
as $$
  select case when p_from = p_to then to_char(p_from, 'YYYY-MM-DD')
              else to_char(p_from, 'YYYY-MM-DD') || ' to ' || to_char(p_to, 'YYYY-MM-DD') end
$$;

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------

-- Evaluates every enabled rule: reads the measure for the rule's window and, for pct_change_*, the previous window of
-- the same length, and records last_evaluated_at / last_value / last_error. The condition holds when value > threshold
-- (gt), value < threshold (lt), or (value - baseline) / |baseline| is above / below the threshold (pct_change_gt /
-- pct_change_lt; thresholds are signed fractions, 0.5 = +50%). A null value, a null or zero baseline never holds.
-- An event is inserted when the condition holds, the rule is outside its cooldown (no event within cooldown_hours
-- before p_now) and, for the complete windows (1d / 7d / 30d), no event of the rule exists for the same days yet (an
-- unchanged window is reported once; `today` keeps growing, so it may fire again after the cooldown).
-- Each rule runs in its own subtransaction: an error or a cancellation (query_canceled, e.g. the job's
-- statement_timeout) is recorded in last_error and the other rules still run. A statement_timeout set inside a
-- function does not cap the statements it runs (verified on Postgres 17), so the time limits are: the cron command's
-- statement_timeout for the whole run, and p_budget, after which no further rule is started. Rules are taken least
-- recently evaluated first, so a run cut short by the budget never starves the same rules twice. Returns the number
-- of events fired. p_now exists for tests; pg_cron uses now().
create function analytics_private.evaluate_alerts(
  p_now timestamptz default now(), p_budget interval default interval '10 minutes'
) returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_rule record;
  w record;
  v_meta jsonb;
  v_unit text;
  v_label text;
  v_value numeric;
  v_baseline numeric;
  v_change numeric;
  v_fire boolean;
  v_message text;
  v_fired integer := 0;
  v_state text;
  v_started timestamptz := clock_timestamp();
begin
  -- Concurrent evaluations (a manual call during the hourly job) would double-fire.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('analytics_private.evaluate_alerts', 0));

  for v_rule in
    select r.*
    from admin_app.alert_rules r
    where r.enabled
    order by r.last_evaluated_at nulls first, r.created_at, r.id
  loop
    exit when clock_timestamp() - v_started > p_budget;
    select * into w from analytics_private.alert_window(v_rule."window", p_now);
    v_value := null;
    v_baseline := null;
    v_change := null;
    begin
      v_value := analytics_private.alert_value(v_rule.metric, v_rule.measure, v_rule.params, w.from_day, w.to_day);
      if v_rule.condition like 'pct_change%' then
        v_baseline := analytics_private.alert_value(v_rule.metric, v_rule.measure, v_rule.params, w.prev_from, w.prev_to);
        v_change := (v_value - v_baseline) / nullif(abs(v_baseline), 0);
      end if;
    exception when others or query_canceled then
      get stacked diagnostics v_state = returned_sqlstate;
      update admin_app.alert_rules r
      set last_evaluated_at = p_now, last_value = null, last_error = left(v_state || ': ' || sqlerrm, 500)
      where r.id = v_rule.id;
      continue;
    end;

    update admin_app.alert_rules r
    set last_evaluated_at = p_now, last_value = v_value, last_error = null
    where r.id = v_rule.id;

    v_fire := coalesce(case v_rule.condition
                         when 'gt' then v_value > v_rule.threshold
                         when 'lt' then v_value < v_rule.threshold
                         when 'pct_change_gt' then v_change > v_rule.threshold
                         when 'pct_change_lt' then v_change < v_rule.threshold
                       end, false)
      -- Cooldown.
      and not exists (select 1 from admin_app.alert_events e
                      where e.rule_id = v_rule.id and e.fired_at > p_now - make_interval(hours => v_rule.cooldown_hours))
      -- A complete window is reported once.
      and (v_rule."window" = 'today'
           or not exists (select 1 from admin_app.alert_events e
                          where e.rule_id = v_rule.id and e.window_from = w.from_day and e.window_to = w.to_day));

    if v_fire then
      v_meta := analytics_private.try_jsonb(pg_catalog.obj_description(analytics_private.metric_oid(v_rule.metric), 'pg_proc'));
      v_unit := coalesce(v_meta -> 'measures' -> v_rule.measure ->> 'unit', v_meta ->> 'unit');
      v_label := coalesce(v_meta -> 'measures' -> v_rule.measure ->> 'label', v_rule.measure);
      v_message := left(format('%s: %s is %s for %s%s, %s.',
        v_rule.name,
        v_label,
        analytics_private.alert_number(v_value, v_unit),
        analytics_private.alert_days(w.from_day, w.to_day),
        case when v_rule."window" = 'today' then ' (so far)' else '' end,
        case v_rule.condition
          when 'gt' then 'above ' || analytics_private.alert_number(v_rule.threshold, v_unit)
          when 'lt' then 'below ' || analytics_private.alert_number(v_rule.threshold, v_unit)
          else format('%s%s vs %s for %s (threshold %s%s)',
                 case when v_change > 0 then '+' else '' end,
                 analytics_private.alert_number(v_change, 'ratio'),
                 analytics_private.alert_number(v_baseline, v_unit),
                 analytics_private.alert_days(w.prev_from, w.prev_to),
                 case when v_rule.threshold > 0 then '+' else '' end,
                 analytics_private.alert_number(v_rule.threshold, 'ratio'))
        end), 1000);
      insert into admin_app.alert_events (rule_id, fired_at, window_from, window_to, value, baseline, message)
      values (v_rule.id, p_now, w.from_day, w.to_day, v_value, v_baseline, v_message);
      v_fired := v_fired + 1;
    end if;
  end loop;
  return v_fired;
end $$;

-- Schedules analytics_alerts (hourly, minute 5) where pg_cron is installed; idempotent. Returns the scheduled job
-- names, or an empty array without pg_cron (same guard as analytics_private.schedule_refresh_jobs). The command sets
-- the run's statement_timeout first: a separate statement, so it caps the evaluate_alerts() call (each rule catches
-- the cancellation and evaluate_alerts stops starting rules after its 10-minute budget).
create function analytics_private.schedule_alert_job() returns text[]
language plpgsql volatile set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    return '{}'::text[];
  end if;
  execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'analytics_alerts';
  execute 'select cron.schedule($1, $2, $3)'
    using 'analytics_alerts', '5 * * * *',
          'set statement_timeout = ''15min''; select analytics_private.evaluate_alerts()';
  return array['analytics_alerts'];
end $$;

do $$
begin
  if cardinality(analytics_private.schedule_alert_job()) = 0 then
    raise notice 'pg_cron is not installed: analytics_alerts is not scheduled';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Data freshness: scheduler health and alert evaluation
-- ---------------------------------------------------------------------------

-- analytics.data_freshness from 20261103120000_analytics_engagement.sql, unchanged except: the scheduler row now
-- requires analytics_alerts too, checks that every analytics_* job is active and that none failed in the last 24 hours
-- (cron.job_run_details), and a new alerts_evaluated row reports the hourly evaluation. Keep this copy in sync if
-- the engagement migration's body changes before release.
create or replace function analytics.data_freshness(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (item text, label text, status text, value numeric, value_text text, at timestamptz, detail jsonb)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  run record;
  fx record;
  v_prev_final boolean;
  v_n bigint;
  v_at timestamptz;
  v_jobs text[];
  v_cron boolean := exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron');
  v_missing text[];
  v_inactive text[];
  v_failed bigint := 0;
  v_failed_jobs text[];
  v_rules bigint;
  v_errors bigint;
  v_stale bigint;
  v_latest timestamptz;
  v_error_rules text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array[]::text[]);

  -- Last nightly refresh (pg_cron, 03:45 UTC).
  select r.* into run from admin_app.refresh_runs r
  where r.kind = 'nightly' and r.status in ('done', 'failed') order by r.id desc limit 1;
  item := 'nightly_refresh'; label := 'Last nightly refresh of pre-computed metrics';
  status := case when run.id is null then 'warn' when run.status = 'failed' then 'error'
                 when run.finished_at < v_now - interval '26 hours' then 'warn' else 'ok' end;
  value := round(extract(epoch from run.finished_at - run.started_at)::numeric, 3);
  value_text := coalesce(run.status, 'never ran');
  at := run.finished_at;
  detail := case when run.id is not null then jsonb_build_object('run_id', run.id, 'started_at', run.started_at,
              'duration_seconds', value, 'error', run.error, 'mvs', run.detail -> 'mvs') end;
  return next;

  -- Last on-request recompute.
  select r.* into run from admin_app.refresh_runs r
  where r.kind = 'recompute' and r.status in ('done', 'failed') order by r.id desc limit 1;
  item := 'last_recompute'; label := 'Last recompute';
  status := case when run.id is null then 'info' when run.status = 'failed' then 'error' else 'ok' end;
  value := round(extract(epoch from run.finished_at - run.started_at)::numeric, 3);
  value_text := coalesce(run.status, 'never ran');
  at := run.finished_at;
  detail := case when run.id is not null then jsonb_build_object('run_id', run.id, 'requested_at', run.requested_at,
              'started_at', run.started_at, 'duration_seconds', value, 'error', run.error) end;
  return next;

  -- Queued recompute (the queue job runs every minute).
  select count(*), min(r.requested_at) into v_n, v_at from admin_app.refresh_runs r where r.status in ('pending', 'running');
  item := 'pending_recompute'; label := 'Pending recompute requests';
  status := case when v_at < v_now - interval '10 minutes' then 'warn' else 'ok' end;
  value := v_n; value_text := case when v_n > 0 then 'queued' else 'none' end; at := v_at;
  detail := jsonb_build_object('retry_after_seconds', (select w.retry_after_seconds from analytics_private.recompute_wait() w));
  return next;

  -- When the pre-computed metrics were built.
  select s.as_of into v_at from analytics_private.refresh_snapshot s;
  item := 'precomputed_as_of'; label := 'Pre-computed metrics built at';
  status := case when v_at is null or v_at < v_now - interval '26 hours' then 'warn' else 'ok' end;
  value := round(extract(epoch from v_now - v_at)::numeric / 3600, 2); value_text := 'hours old'; at := v_at;
  detail := jsonb_build_object('metrics', jsonb_build_array('cohort_retention', 'growth_accounting'));
  return next;

  -- Scheduler (pg_cron jobs): analytics_nightly, analytics_recompute_queue and analytics_alerts must exist; every
  -- analytics_* job present (e.g. analytics_cron_history_purge) must be active and none may have failed in 24 hours.
  -- cron.job.active and cron.job_run_details are read only where they exist.
  if v_cron then
    execute 'select array_agg(j.jobname::text order by j.jobname) from cron.job j where j.jobname like ''analytics\_%'''
      into v_jobs;
    if exists (select 1 from pg_catalog.pg_attribute a
               where a.attrelid = pg_catalog.to_regclass('cron.job') and a.attname = 'active' and not a.attisdropped) then
      execute 'select array_agg(j.jobname::text order by j.jobname) from cron.job j
               where j.jobname like ''analytics\_%'' and not j.active'
        into v_inactive;
    end if;
    if (select count(*) from pg_catalog.pg_attribute a
        where a.attrelid = pg_catalog.to_regclass('cron.job_run_details') and a.attname in ('status', 'start_time')
          and not a.attisdropped) = 2 then
      execute 'select count(*), array_agg(distinct j.jobname::text) from cron.job_run_details d
               join cron.job j on j.jobid = d.jobid
               where j.jobname like ''analytics\_%'' and d.status = ''failed'' and d.start_time > $1 - interval ''24 hours'''
        into v_failed, v_failed_jobs using v_now;
    end if;
  end if;
  v_missing := array(select x from unnest(array['analytics_nightly', 'analytics_recompute_queue', 'analytics_alerts']) x
                     where not (x = any (coalesce(v_jobs, '{}'::text[]))));
  item := 'scheduler'; label := 'Scheduled jobs (pg_cron)';
  status := case when not v_cron or cardinality(v_missing) > 0 or coalesce(cardinality(v_inactive), 0) > 0 or v_failed > 0
                 then 'warn' else 'ok' end;
  value := coalesce(cardinality(v_jobs), 0);
  value_text := case when not v_cron then 'pg_cron not installed'
                     when cardinality(v_missing) > 0 then 'missing: ' || array_to_string(v_missing, ', ')
                     when coalesce(cardinality(v_inactive), 0) > 0 then 'inactive: ' || array_to_string(v_inactive, ', ')
                     when v_failed > 0 then v_failed || ' failed runs in 24 hours: ' || array_to_string(v_failed_jobs, ', ')
                     else array_to_string(v_jobs, ', ') end;
  at := null;
  detail := jsonb_build_object('jobs', to_jsonb(coalesce(v_jobs, '{}'::text[])), 'missing', to_jsonb(v_missing),
                               'inactive', to_jsonb(coalesce(v_inactive, '{}'::text[])), 'failed_runs_24h', v_failed,
                               'failed_jobs', to_jsonb(coalesce(v_failed_jobs, '{}'::text[])));
  return next;

  -- Alert evaluation (analytics_alerts, hourly): every enabled rule evaluated within 2 hours and none failing.
  select count(*), max(r.last_evaluated_at),
         count(*) filter (where r.last_error is not null),
         count(*) filter (where coalesce(r.last_evaluated_at, '-infinity'::timestamptz) < v_now - interval '2 hours'
                            and r.created_at < v_now - interval '2 hours'),
         (array_agg(r.name order by r.name) filter (where r.last_error is not null))[1:10]
  into v_rules, v_latest, v_errors, v_stale, v_error_rules
  from admin_app.alert_rules r
  where r.enabled;
  item := 'alerts_evaluated'; label := 'Alert rules evaluated';
  status := case when v_rules = 0 then 'info'
                 when v_latest is null or v_latest < v_now - interval '2 hours' or v_stale > 0 or v_errors > 0 then 'warn'
                 else 'ok' end;
  value := round(extract(epoch from v_now - v_latest)::numeric / 3600, 2);
  value_text := case when v_rules = 0 then 'no enabled rules'
                     when v_errors > 0 then v_errors || ' of ' || v_rules || ' rules failing'
                     when v_stale > 0 then v_stale || ' of ' || v_rules || ' rules not evaluated for 2 hours'
                     else 'hours since the last evaluation' end;
  at := v_latest;
  detail := jsonb_build_object('enabled_rules', v_rules, 'failing_rules', v_errors, 'stale_rules', v_stale,
                               'failing', to_jsonb(coalesce(v_error_rules, '{}'::text[])));
  return next;

  -- Latest USD->TRY month and its finality.
  select f.rate_month, f.rate, f.is_final, f.updated_at into fx from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY' order by f.rate_month desc limit 1;
  select f.is_final into v_prev_final from public.fx_rates f
  where f.base_currency = 'USD' and f.quote_currency = 'TRY' and f.rate_month = (v_month - interval '1 month')::date;
  item := 'fx_latest_month'; label := 'Latest USD/TRY rate month';
  status := case when fx.rate_month is null then 'error'
                 when fx.rate_month = v_month and coalesce(v_prev_final, false) then 'ok' else 'warn' end;
  value := fx.rate;
  value_text := case when fx.rate_month is null then 'no rates'
                     else to_char(fx.rate_month, 'YYYY-MM') || case when fx.is_final then ' final' else ' month-to-date' end end;
  at := fx.updated_at;
  detail := jsonb_build_object('rate_month', fx.rate_month, 'is_final', fx.is_final,
                               'current_month_loaded', fx.rate_month = v_month, 'previous_month_final', v_prev_final);
  return next;

  -- Catalog snapshots written by the 03:30 refresh.
  select count(*), max(c.refreshed_at) into v_n, v_at from public.billing_price_catalog c;
  item := 'billing_price_catalog'; label := 'Stripe price catalog refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'prices'; at := v_at;
  detail := jsonb_build_object('configured', (select count(*) from public.billing_price_catalog c where c.is_configured));
  return next;

  select count(*), max(c.refreshed_at) into v_n, v_at from public.billing_plan_catalog c;
  item := 'billing_plan_catalog'; label := 'Plan catalog refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'plans'; at := v_at; detail := null;
  return next;

  select count(*), max(p.refreshed_at) into v_n, v_at from public.ai_model_prices p;
  item := 'ai_model_prices'; label := 'AI model prices refreshed';
  status := case when v_n = 0 or v_at < v_now - interval '48 hours' then 'warn' else 'ok' end;
  value := v_n; value_text := 'model prefixes'; at := v_at; detail := null;
  return next;

  -- Unpriced AI runs of the last 30 days (analytics.ai_cost population): costs are lower bounds while > 0.
  select count(*) into v_n from analytics_private.run_cost rc
  where rc.started_at >= v_now - interval '30 days'
    and rc.cost_usd is null and rc.has_tokens
    and not rc.is_guest and rc.is_analysis_user
    and (p_include_internal or not rc.is_internal_user);
  item := 'unpriced_ai_runs_30d'; label := 'Unpriced AI runs (last 30 days)';
  status := case when v_n > 0 then 'warn' else 'ok' end;
  value := v_n; value_text := 'runs'; at := null;
  detail := jsonb_build_object('models', (
    select coalesce(jsonb_object_agg(x.model, x.n), '{}'::jsonb) from (
      select coalesce(rc.model_name, 'unknown') as model, count(*) as n from analytics_private.run_cost rc
      where rc.started_at >= v_now - interval '30 days' and rc.cost_usd is null and rc.has_tokens
        and not rc.is_guest and rc.is_analysis_user and (p_include_internal or not rc.is_internal_user)
      group by 1) x));
  return next;

  -- Function contract and privilege model (expected 0).
  select count(*) into v_n from analytics_private.contract_violations();
  item := 'contract_violations'; label := 'Analytics contract violations';
  status := case when v_n > 0 then 'error' else 'ok' end;
  value := v_n; value_text := 'violations'; at := null; detail := null;
  return next;
end $$;

comment on function analytics.data_freshness(date, date, text, text, boolean, text, jsonb) is
'{"title":"Data freshness","definition":"One row per freshness check, with status ok / warn / error / info. nightly_refresh: the last nightly rebuild of the pre-computed metrics (warn when none or older than 26 hours, error when it failed; value = duration in seconds). last_recompute: the last on-request rebuild. pending_recompute: queued requests (warn when one waits more than 10 minutes, i.e. the queue job is not running). precomputed_as_of: when cohort_retention and growth_accounting were built (value = hours old). scheduler: the pg_cron jobs analytics_nightly, analytics_recompute_queue and analytics_alerts must exist, every analytics_* job must be active, and none may have failed in the last 24 hours (cron.job_run_details); warn otherwise (value = analytics jobs). alerts_evaluated: the hourly alert evaluation (info without enabled rules; warn when the latest evaluation is older than 2 hours, an enabled rule older than 2 hours was not evaluated for 2 hours, or a rule has an evaluation error; value = hours since the latest evaluation). fx_latest_month: latest USD/TRY month (value = TRY per USD; ok when the current month is loaded and the previous one is final). billing_price_catalog / billing_plan_catalog / ai_model_prices: rows and last refresh by the 03:30 job (warn after 48 hours or when empty). unpriced_ai_runs_30d: AI runs of the last 30 days with tokens but no stored cost and no model price (analytics.ai_cost population; costs are lower bounds while > 0; internal accounts only when included). contract_violations: analytics_private.contract_violations() rows (error when > 0). The range, grain and currency do not apply.","unit":"count","shape":"table","breakdowns":[],"filters":[],"kb":"new_analysis/acquisition/data_quality_health_checks.md","consent_scoped":false,"alertable":false,"measures":{"value":{"label":"Value","unit":"count","description":"Per check: seconds for refresh runs, hours for the build age and since the last alert evaluation, TRY per USD for FX, otherwise a count"}}}';

-- ---------------------------------------------------------------------------
-- Rule and event API (admin_app, executable by analytics_api)
-- ---------------------------------------------------------------------------

create function admin_app.list_alert_rules() returns setof admin_app.alert_rules
language sql stable security definer set search_path = ''
as $$ select r.* from admin_app.alert_rules r order by r.created_at desc, r.id $$;

-- Creates a rule from {name, metric, measure, params?, window, condition, threshold, cooldown_hours?, enabled?}
-- (unknown keys -> 22023) and writes its alert.rule.create audit row. A duplicate name raises 23505.
create function admin_app.create_alert_rule(p_admin_email text, p_rule jsonb, p_request_id text default null)
returns setof admin_app.alert_rules
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_admin_email));
  v_key text;
  v_params jsonb;
  v_row admin_app.alert_rules;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception 'rule must be an object' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_rule) k
  where k not in ('name', 'metric', 'measure', 'params', 'window', 'condition', 'threshold', 'cooldown_hours', 'enabled')
  limit 1;
  if v_key is not null then
    raise exception 'unsupported rule field: %', v_key using errcode = '22023';
  end if;
  if (p_rule ? 'threshold' and jsonb_typeof(p_rule -> 'threshold') <> 'number')
     or (p_rule ? 'cooldown_hours' and (jsonb_typeof(p_rule -> 'cooldown_hours') <> 'number'
                                        or (p_rule ->> 'cooldown_hours')::numeric <> trunc((p_rule ->> 'cooldown_hours')::numeric)
                                        or abs((p_rule ->> 'cooldown_hours')::numeric) > 100000))
     or (p_rule ? 'enabled' and jsonb_typeof(p_rule -> 'enabled') <> 'boolean')
     or exists (select 1 from unnest(array['name', 'metric', 'measure', 'window', 'condition']) f
                where p_rule ? f and jsonb_typeof(p_rule -> f) <> 'string') then
    raise exception 'rule fields have the wrong type' using errcode = '22023';
  end if;
  v_params := analytics_private.validate_alert_rule(
    p_rule ->> 'name', p_rule ->> 'metric', p_rule ->> 'measure', p_rule -> 'params', p_rule ->> 'window',
    p_rule ->> 'condition', (p_rule ->> 'threshold')::numeric, coalesce((p_rule ->> 'cooldown_hours')::numeric::integer, 24));

  insert into admin_app.alert_rules (name, metric, measure, params, "window", condition, threshold, cooldown_hours,
                                     enabled, created_by, updated_by)
  values (btrim(p_rule ->> 'name'), p_rule ->> 'metric', p_rule ->> 'measure', v_params, p_rule ->> 'window',
          p_rule ->> 'condition', (p_rule ->> 'threshold')::numeric, coalesce((p_rule ->> 'cooldown_hours')::numeric::integer, 24),
          coalesce((p_rule ->> 'enabled')::boolean, true), v_email, v_email)
  returning * into v_row;

  perform admin_app.log_access(v_email, 'alert.rule.create', null,
    jsonb_build_object('rule_id', v_row.id, 'name', v_row.name, 'metric', v_row.metric, 'measure', v_row.measure,
                       'params', v_row.params, 'window', v_row."window", 'condition', v_row.condition,
                       'threshold', v_row.threshold, 'cooldown_hours', v_row.cooldown_hours, 'enabled', v_row.enabled),
    p_request_id);
  return next v_row;
end $$;

-- Partial update: the given fields replace the stored ones (params as a whole), the merged rule is validated again,
-- and the alert.rule.update audit row records the changed fields with their old and new values. Unknown id -> P0002.
create function admin_app.update_alert_rule(p_admin_email text, p_id uuid, p_patch jsonb, p_request_id text default null)
returns setof admin_app.alert_rules
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_admin_email));
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_params jsonb;
  v_row admin_app.alert_rules;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'patch must be a non-empty object' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_patch) k
  where k not in ('name', 'metric', 'measure', 'params', 'window', 'condition', 'threshold', 'cooldown_hours', 'enabled')
  limit 1;
  if v_key is not null then
    raise exception 'unsupported rule field: %', v_key using errcode = '22023';
  end if;
  select to_jsonb(r) into v_old from admin_app.alert_rules r where r.id = p_id for update;
  if v_old is null then
    raise exception 'alert rule not found' using errcode = 'P0002';
  end if;
  v_new := v_old || p_patch;
  if jsonb_typeof(v_new -> 'threshold') <> 'number'
     or jsonb_typeof(v_new -> 'cooldown_hours') <> 'number'
     or (v_new ->> 'cooldown_hours')::numeric <> trunc((v_new ->> 'cooldown_hours')::numeric)
     or abs((v_new ->> 'cooldown_hours')::numeric) > 100000
     or jsonb_typeof(v_new -> 'enabled') <> 'boolean'
     or exists (select 1 from unnest(array['name', 'metric', 'measure', 'window', 'condition']) f
                where jsonb_typeof(v_new -> f) is distinct from 'string') then
    raise exception 'rule fields have the wrong type' using errcode = '22023';
  end if;
  v_params := analytics_private.validate_alert_rule(
    v_new ->> 'name', v_new ->> 'metric', v_new ->> 'measure', v_new -> 'params', v_new ->> 'window',
    v_new ->> 'condition', (v_new ->> 'threshold')::numeric, (v_new ->> 'cooldown_hours')::numeric::integer);

  update admin_app.alert_rules r
  set name = btrim(v_new ->> 'name'), metric = v_new ->> 'metric', measure = v_new ->> 'measure', params = v_params,
      "window" = v_new ->> 'window', condition = v_new ->> 'condition', threshold = (v_new ->> 'threshold')::numeric,
      cooldown_hours = (v_new ->> 'cooldown_hours')::numeric::integer, enabled = (v_new ->> 'enabled')::boolean,
      updated_by = v_email, updated_at = now()
  where r.id = p_id
  returning * into v_row;

  perform admin_app.log_access(v_email, 'alert.rule.update', null,
    jsonb_build_object('rule_id', p_id, 'changes', (
      select coalesce(jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', to_jsonb(v_row) -> k)), '{}'::jsonb)
      from jsonb_object_keys(p_patch) k
      where (v_old -> k) is distinct from (to_jsonb(v_row) -> k))),
    p_request_id);
  return next v_row;
end $$;

-- Deletes a rule (its events cascade) and writes the alert.rule.delete audit row. Unknown id -> P0002.
create function admin_app.delete_alert_rule(p_admin_email text, p_id uuid, p_request_id text default null)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row admin_app.alert_rules;
  v_events bigint;
begin
  select count(*) into v_events from admin_app.alert_events e where e.rule_id = p_id;
  delete from admin_app.alert_rules r where r.id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'alert rule not found' using errcode = 'P0002';
  end if;
  perform admin_app.log_access(p_admin_email, 'alert.rule.delete', null,
    jsonb_build_object('rule_id', v_row.id, 'name', v_row.name, 'metric', v_row.metric, 'measure', v_row.measure,
                       'deleted_events', v_events),
    p_request_id);
  return v_row.id;
end $$;

-- Events newest first with their rule's name, metric, measure, condition and threshold (current values).
-- p_status = open (unacknowledged) | all; p_limit 1-200 (22023 otherwise).
create function admin_app.list_alert_events(p_status text default 'open', p_limit integer default 50)
returns table (
  id bigint, rule_id uuid, rule_name text, metric text, measure text, condition text, threshold numeric,
  fired_at timestamptz, window_from date, window_to date, value numeric, baseline numeric, message text,
  acknowledged_by text, acknowledged_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('open', 'all') then
    raise exception 'status must be open or all' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'limit must be between 1 and 200' using errcode = '22023';
  end if;
  return query
  select e.id, e.rule_id, r.name, r.metric, r.measure, r.condition, r.threshold, e.fired_at, e.window_from,
         e.window_to, e.value, e.baseline, e.message, e.acknowledged_by, e.acknowledged_at
  from admin_app.alert_events e
  join admin_app.alert_rules r on r.id = e.rule_id
  where p_status = 'all' or e.acknowledged_at is null
  order by e.fired_at desc, e.id desc
  limit p_limit;
end $$;

-- Acknowledges an event and writes the alert.event.ack audit row. Acknowledging an acknowledged event keeps the first
-- acknowledgement (audited with already_acknowledged = true). Unknown id -> P0002.
create function admin_app.ack_alert_event(p_admin_email text, p_id bigint, p_request_id text default null)
returns table (
  id bigint, rule_id uuid, rule_name text, metric text, measure text, condition text, threshold numeric,
  fired_at timestamptz, window_from date, window_to date, value numeric, baseline numeric, message text,
  acknowledged_by text, acknowledged_at timestamptz
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_admin_email));
  v_event admin_app.alert_events;
  v_already boolean;
begin
  select e.* into v_event from admin_app.alert_events e where e.id = p_id for update;
  if v_event.id is null then
    raise exception 'alert event not found' using errcode = 'P0002';
  end if;
  v_already := v_event.acknowledged_at is not null;
  -- log_access validates the email before anything is changed.
  perform admin_app.log_access(v_email, 'alert.event.ack', null,
    jsonb_build_object('event_id', v_event.id, 'rule_id', v_event.rule_id, 'already_acknowledged', v_already),
    p_request_id);
  if not v_already then
    update admin_app.alert_events e set acknowledged_by = v_email, acknowledged_at = now() where e.id = p_id;
  end if;
  return query
  select e.id, e.rule_id, r.name, r.metric, r.measure, r.condition, r.threshold, e.fired_at, e.window_from,
         e.window_to, e.value, e.baseline, e.message, e.acknowledged_by, e.acknowledged_at
  from admin_app.alert_events e
  join admin_app.alert_rules r on r.id = e.rule_id
  where e.id = p_id;
end $$;

-- Header badge and Overview banner: unacknowledged events and the newest of them (null when none).
create function admin_app.alert_summary()
returns table (open_count bigint, latest_fired_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select count(*), max(e.fired_at) from admin_app.alert_events e where e.acknowledged_at is null
$$;

-- ---------------------------------------------------------------------------
-- Audited audit-log reads (Data health page)
-- ---------------------------------------------------------------------------

-- Replaces the Phase 2 version (same clamping, plus people_function): it now refuses to run (42501) unless
-- admin_app.log_access wrote an audit.read row earlier in the current transaction, so reading the log is itself always
-- logged. The return type changes, so it is dropped and recreated (EXECUTE comes back through default privileges).
drop function admin_app.audit_recent(integer);
create function admin_app.audit_recent(p_limit integer default 100)
returns table (id bigint, at timestamptz, admin_email text, action text, target_user_id uuid, params jsonb,
               request_id text, people_function text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from admin_app.audit_log a
                 where a.xact_id = pg_current_xact_id_if_assigned() and a.action = 'audit.read') then
    raise exception 'call admin_app.log_access for audit.read in this transaction first' using errcode = '42501';
  end if;
  return query
  select a.id, a.at, a.admin_email, a.action, a.target_user_id, a.params, a.request_id, a.people_function
  from admin_app.audit_log a
  order by a.at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
