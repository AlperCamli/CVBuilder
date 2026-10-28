# Admin Analytics — HTTP & SQL contract

Shared contract between `backend/src/modules/admin-analytics`, `admin/` and the `analytics*` SQL functions. If you change it, change all three in the same commit.

## Envelope
All JSON responses use the backend's standard envelope:
- `{ "success": true, "data": … }`
- `{ "success": false, "error": { "code", "message", "details?" } }`

Every `/admin/*` response sends `Cache-Control: no-store`.

## Endpoints (prefix `/api/v1`)

| Method & path | Auth | Response `data` |
|---|---|---|
| `GET /admin/me` | signed in | `{ email: string \| null, is_admin: boolean }` (200 for non-admins too) |
| `GET /admin/catalog` | admin | `{ metrics: CatalogEntry[] }` |
| `GET /admin/metrics/:name` | admin | `{ metric: string, rows: Row[], generated_at: ISO string }`, or CSV when `format=csv` |

`CatalogEntry = { name: string, kind: "metric" | "people", meta: MetricMeta }`

`MetricMeta` is the JSON stored in `comment on function`:
```ts
{
  title: string;
  definition: string;
  unit: "count" | "currency" | "percent" | "ratio" | "seconds" | "tokens";
  shape: "timeseries" | "breakdown" | "kpi" | "table" | "funnel" | "cohort";
  breakdowns: Dimension[];          // dimensions allowed for p_breakdown ([] = none)
  filters: Dimension[];             // keys allowed in p_filters
  kb?: string;                      // KB path, e.g. "new_analysis/monetization/revenue_monthly_by_currency.md"
  consent_scoped?: boolean;         // label "of consenting users"
  alertable?: boolean;              // single-row KPI usable in alert rules
  min_group?: number;               // small-sample warning threshold (default 5)
  drill?: boolean;                  // clicking a point opens the drill drawer (analytics_people.drill_users)
  breakdown_dimension?: Dimension;  // breakdown shape: the Dimension its `dimension` column holds (enables click-to-filter)
  plot?: string[];                  // timeseries: measures plotted as separate series (else the first measure)
  stacked?: boolean;                // timeseries with `plot`: stacked bars (signed values allowed)
  flag_column?: string;             // timeseries: boolean column that highlights points (e.g. anomalies)
  measures?: Record<string, {       // per-column labels/units when a metric returns several measures
    label: string;
    unit: Unit;                     // overrides `unit` for this column
    description?: string;
    ignores_filters?: Dimension[];  // filters the metric accepts but this column cannot apply
  }>;
}
```

`Dimension = "market" | "plan" | "locale" | "ai_flow" | "ai_model" | "ai_provider" | "template" | "onboarding_path" | "currency"`

## Metric query parameters (`GET /admin/metrics/:name`)

| Param | Format | Default | SQL arg |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | `to` − 29 days | `p_from date` |
| `to` | `YYYY-MM-DD` | today (UTC) | `p_to date` |
| `grain` | `day` \| `week` \| `month` | `day` | `p_grain text` |
| `currency` | `native` \| `usd` \| `try` | `usd` | `p_currency text` |
| `include_internal` | `true` \| `false` \| `1` \| `0` | `false` | `p_include_internal boolean` |
| `breakdown` | Dimension | none | `p_breakdown text` |
| `filters` | URL-encoded JSON object, Dimension → scalar or array of scalars (≤ 50 values) | `{}` | `p_filters jsonb` |
| `format` | `json` \| `csv` | `json` | — |

Validation:
- `from ≤ to`; span ≤ 1096 days; `name` matches `^[a-z][a-z0-9_]{0,62}$`.
- An unknown metric returns 404.
- SQLSTATE `22023` (invalid parameter, raised by the metric) → 400 `VALIDATION_ERROR`. `57014` (timeout) → 504 `ANALYTICS_TIMEOUT`. Analytics DB not configured → 503 `ANALYTICS_UNAVAILABLE`.

## SQL function contract

```sql
-- analytics.<metric>
create function analytics.<metric>(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb)
returns table (...)                 -- free shape; first column `bucket date` for timeseries
language sql | plpgsql stable security definer set search_path = ''
```

- **Ownership and grants:** functions are owned by `postgres`. EXECUTE goes to `analytics_api` through default privileges.
  - Each migration must end with `revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;`, because per-schema default privileges can't remove the built-in PUBLIC grant.
- **Comment:** `comment on function … is '<MetricMeta JSON>'`.
- **Timeseries columns:** a timeseries metric always returns `(bucket date, dimension text, <measures…>)`. `dimension` is `null` when no breakdown is requested, and holds the breakdown value otherwise.
- **Number types:** counts are `bigint`; money and ratios are `numeric`. The backend parses both to JS numbers. Dates are serialised as `YYYY-MM-DD` strings, timestamps as ISO strings.
- **Shared helpers** in `analytics_private`:
  - `assert_args(p_grain, p_currency, p_breakdown, p_filters, allowed_breakdowns text[], allowed_filters text[])` raises `22023`;
  - `buckets(p_from, p_to, p_grain) returns setof date` (week = ISO week starting Monday, UTC);
  - `resolve_range(p_from, p_to)` applies the defaults.
- **Contract check:** `analytics_private.contract_violations()` returns one row per violation (signature, volatility, security definer, search_path, comment JSON, grants). The SQL test and the Data health page expect zero rows.

## Phase 1 metric outputs (Overview)

| Function | Shape | Columns |
|---|---|---|
| `analytics.signups` | timeseries | `bucket, dimension, signups` |
| `analytics.kpi_overview` | kpi (1 row) | `signups bigint, activated_users bigint, activation_eligible bigint, activated_eligible bigint, activation_rate numeric, new_paying_customers bigint, revenue numeric, revenue_usd_native numeric, revenue_try_native numeric, mrr numeric, mrr_usd_native numeric, mrr_try_native numeric, active_subscriptions bigint, trial_starts bigint, trial_resolved bigint, trial_conversions bigint, trial_to_paid_rate numeric, ai_cost numeric, ai_runs bigint, unpriced_ai_runs bigint, revenue_fx_provisional boolean, mrr_fx_provisional boolean, ai_cost_fx_provisional boolean` |
| `analytics.revenue` | timeseries | `bucket, dimension, revenue numeric, refunded numeric, invoices bigint, fx_provisional boolean` |
| `analytics.ai_cost` | timeseries | `bucket, dimension, cost numeric, runs bigint, unpriced_runs bigint, exact_share numeric, fx_provisional boolean` |

Rules for these outputs:
- **`kpi_overview` currency fields:**
  - `revenue` and `mrr` are in the requested currency (`usd` or `try`) and are `null` when `p_currency = 'native'`.
  - The `*_native` columns are always filled.
  - `mrr` and `active_subscriptions` are snapshots at the end of the range (`p_to`).
  - `ai_cost` is USD for `native`/`usd` and TRY for `try`.
- **`revenue` with `native` currency:** `dimension` is the invoice currency (`USD`, `TRY`), and a breakdown is rejected (22023). With `usd`/`try`, the breakdowns are `market` and `plan`.
- **`ai_cost`:** breakdowns and filters are `ai_flow`, `ai_model` and `ai_provider`.
- **`measures` meta:** every metric declares `measures` for each numeric column. The UI labels, formats and builds KPI tiles from it.
  - A measure may add `ignores_filters: Dimension[]` when it can't apply a filter the metric accepts. The UI then marks that tile "not filtered by …".
- **`kpi_overview` filters:**
  - `market` applies to every measure. Signups, activation and AI cost use the user's locked market; revenue, MRR, subscriptions and trials use the invoice or subscription market.
  - `plan` applies to revenue, MRR, active subscriptions, new paying customers and trials. Signups, activation and AI cost list it in `ignores_filters`.
- **Activation:**
  - `activated_users` counts every activated signup in the range.
  - `activation_eligible` counts signups whose 7-day window has closed, and `activated_eligible` counts activated users among them; `activation_rate = activated_eligible / activation_eligible`.
  - Period comparisons use the rate, not `activated_users`.
- **Trial→paid:** `trial_to_paid_rate = trial_conversions / trial_resolved`. `trial_starts` is shown for context.
- **Active subscriptions:** subscriptions with MRR > 0 in the snapshot at `p_to`.
- **FX provisional:** a conversion is provisional when the rate's month isn't final **or** the rate comes from an earlier month (fallback). Missing rates also count as provisional.
  - `kpi_overview` reports the revenue, MRR and AI-cost flags separately, each only when that measure needed a conversion.
- **Ratios:** `ratio` and `percent` measures are both 0–1 fractions and both display as percentages.

## Phase 2: people endpoint, functions and audit log

### Endpoint
`POST /api/v1/admin/people/:name` (admin only, `Cache-Control: no-store`). There is no GET: the search text and filters travel only in the JSON body, never in URLs or access logs.

Body (`Content-Type: application/json`; unknown keys → 400; `null` counts as absent):

| Field | Format | Default | SQL arg |
|---|---|---|---|
| `user_id` | uuid | null | `p_user_id uuid` |
| `q` | string, 3–200 chars after trimming | null | `p_query text` |
| `from` / `to` | `YYYY-MM-DD`, both inclusive (whole UTC days), `from ≤ to` | null (whole history) | `p_from date`, `p_to date` |
| `filters` | JSON object (≤ 4,000 chars serialized, ≤ 20 keys `^[a-z][a-z0-9_]{0,62}$`, each a scalar or an array of ≤ 50 scalars); each function validates its own keys | `{}` | `p_filters jsonb` |
| `limit` | integer 1–200 | 50 | `p_limit integer` |
| `cursor` | opaque string, 1–200 chars | null | `p_cursor text` |
| `format` | `"json"` \| `"csv"` | `"json"` | — |

```ts
POST /api/v1/admin/people/user_timeline
{ "user_id": "…", "from": "2026-01-01", "to": "2026-01-31", "filters": { "event_type": ["ai_run"], "failures_only": true }, "limit": 50, "cursor": null, "format": "json" }
```

- **Name:** same regex as metrics; it must be a catalog entry of kind `people` (a metric name → 404, and a people name under `/metrics` → 404).
- **Response (`format: "json"`):** `{ name, rows, next_cursor: string | null, generated_at }`. `next_cursor` is the `cursor` column of the last row when `rows.length === limit`, otherwise null. The `cursor` column is removed from the rows. Functions without a `cursor` column (`user_summary`) always return `next_cursor: null`.
- **CSV (`format: "csv"`):** the same POST returns `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="<name>_<YYYY-MM-DD>.csv"`. The server pages through the function in pages of 200, at most 50,000 rows, under one `export.csv` audit row (`limit` is ignored). `X-Export-Truncated: true` when the cap was hit and more rows may exist. The `cursor` column is not exported. CSV exports are limited to 10 per minute per admin (429 `RATE_LIMITED`), on top of the admin limiters.
- **Audit and read in one transaction:** each call runs `begin` → `set local statement_timeout = '15s'` → `select admin_app.log_access(admin_email, action, target_user_id, params, request_id, q)` → `select * from analytics_people.<name>(…)` → `commit`. If the audit insert fails, no data is returned; if the read fails (e.g. 22023), the transaction and its audit row roll back.
  - `action` is `people.<name>`, or `export.csv` when `format` is `"csv"`.
  - `target_user_id` is `user_id` when given. An unknown or erased id is logged with `target_user_id = null` and `params.target_user_missing = true`.
  - `params` sent by the backend = `{ function, format, from?, to?, filters?, limit (json) | max_rows (csv), has_cursor? }`. The user lives only in `target_user_id`; a cursor is recorded only as `has_cursor: true`.
  - The raw `q` is passed to `log_access` as `p_query`, never inside `params`. The database stores only `params.query_hmac` = hex HMAC-SHA256 of `lower(trim(q))` keyed with a secret pepper that never leaves the database.
  - `request_id` is the pino-http request id (`X-Request-Id` when valid).
  - The raw `q` is never logged: the request logger records only the method (the body is redacted), and the served-call log is `{ admin, people, format, ms, rows }`.
- **The database enforces the audit:** every `analytics_people` function raises 42501 unless an audit row for that function (and, for per-user reads, that user) was written by `log_access` earlier in the same transaction.
- **Errors:** as for metrics (`22023` → 400, `57014` → 504, connection errors → 503); `42501` → 403.

### Functions (`analytics_people`, standard people signature, `shape: "table"`)

All four exclude accounts pending deletion (erased accounts no longer exist), show accounts with restricted processing as a marker only, and return metadata only: never CV, job, cover-letter, file, AI prompt or AI response content, titles, filenames or names. Comments carry `filter_keys` (every accepted `p_filters` key; `filters` lists only the Dimension ones).

| Function | Rows |
|---|---|
| `search_users` | Needs `p_query` (22023 otherwise). Exact match on a user uuid, otherwise case-insensitive match on email: prefix matches first, then contains; newest signup first within each group. Columns `user_id, email, created_at, market, plan_code, subscription_status, analytics_consent boolean, is_internal boolean, restricted boolean, cursor`. Restricted users return only `user_id` and `restricted = true`, plus `email` only when `q` is their exact full email (case-insensitive); every other column is null (they sort last in their group with a constant key, so the cursor carries nothing about them). `plan_code` / `subscription_status` come from the current provider subscription (active or trialing, else the latest; checkout placeholder rows ignored), null when none. No filters. |
| `user_summary` | Needs `p_user_id`; returns one row. `user_id, email, created_at, locale, market, is_internal, analytics_consent, ai_consent, plan_code, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, usage jsonb, entitlement_denials bigint, invoices bigint, paid_usd_native numeric, paid_try_native numeric, last_activity_at, restricted boolean`. For a restricted user, everything except `user_id` and `restricted` is null. A pending-deletion or unknown user returns zero rows. `p_from`/`p_to` narrow denials and invoices (default whole history). |
| `user_timeline` | Needs `p_user_id`. Newest first. Columns `occurred_at timestamptz, event_type text, entity text, entity_id uuid, status text, is_failure boolean, duration_ms bigint, detail jsonb, error_code text, error_message text, cursor text`. `entity` is the source table and `entity_id` its primary key. `p_filters.event_type` is a string or array of event types (unknown → 22023); `p_filters.failures_only` (boolean) keeps only `is_failure` rows. Both apply before paging, so pagination and CSV respect them. `error_message` is shown only when the stored message is one of the app's fixed messages (or the `Structured output validation failed: <path>: <issue code>; …` form); any other stored text could quote user or model content and is returned as null, with `error_code` still set. It is truncated to 300 characters. `detail.failed_stage` and `detail.target_language` appear only when code-shaped. Restricted, pending-deletion and unknown users return zero rows. |
| `drill_users` | Needs `p_filters.metric` (a drill key). Returns the users behind a metric point: `user_id, email, value numeric, detail jsonb, cursor`, ordered by the key's sort value (descending), then `user_id`. See **Drill-down**. |

**`user_summary.usage`:** `{ "<counter_key>": { "used": number, "limit": number | null } }` (null limit = unlimited) for the counter keys the entitlements use: `tailored_cv_generations`, `exports`, `ai_actions`, `storage_bytes`. `used` is this UTC month's `usage_counters` row (0 when none); `limit` is the effective plan's `billing_plan_catalog.limits` value, where the effective plan is the current subscription's plan when it is `active`/`trialing`, otherwise `free`.

**Timeline event types** (`event_type` ← source table; ✗ = `is_failure` when):

| event_type | Source | `occurred_at` | Failure |
|---|---|---|---|
| `signup` | `users` | `created_at` | — |
| `file_upload` | `files` | `created_at` | — |
| `import` | `imports` | `created_at` | `status = failed` |
| `master_cv_created` | `master_cvs` (+ `cv_languages` name) | `created_at` | — |
| `job_saved` | `jobs` | `created_at` | — |
| `job_status_changed` | `job_status_history` (user's own jobs) | `changed_at` | — |
| `tailored_cv_created` | `tailored_cvs` (+ `cv_languages` name) | `created_at` | `ai_generation_status = failed` |
| `cv_block_revision` | `cv_block_revisions` | `created_at` | — |
| `ai_run` | `ai_runs` | `started_at` | `status = failed` (`error_code` = debug reason code) |
| `ai_suggestion_created` | `ai_suggestions` | `created_at` | — |
| `ai_suggestion_applied` | `ai_suggestions` | `applied_at` | — |
| `cv_export` | `exports` | `created_at` | `status = failed` |
| `cover_letter_created` | `cover_letters` (+ `cv_languages` name) | `created_at` | — |
| `cover_letter_export` | `cover_letter_exports` | `created_at` | `status = failed` |
| `tailoring_session` | `tailoring_sessions` | `created_at` | stored `error_message` |
| `tailoring_task` | `tailoring_session_tasks` | `created_at` | `status = failed` |
| `checkout_attempt` | `checkout_attempts` | `created_at` | outcome expired / canceled / failed / rejected_* |
| `subscription_created` | `subscriptions` | `created_at` | — |
| `subscription_event` | `subscription_events` | `occurred_at` | `event_type = past_due` |
| `invoice` | `billing_invoices` | `paid_at`, else `created_at` | `status` void / uncollectible |
| `entitlement_denial` | `entitlement_denials` | `day` 00:00 UTC | always (`error_code` = reason) |

`cv_languages` has no user or time columns; CV languages appear as `language` / `language_name` on CV and cover-letter events and as `target_language` on `cv_translate` runs. Amounts in `detail` are major units.

**Cursor:** opaque keyset text. For the timeline it is `occurred_at|event_type|entity_id` (microsecond UTC time); for searches and lists it is `sort_key|user_id`. A malformed cursor raises 22023.

### Drill-down
- **Metrics:** a metric that supports drill-down has `"drill": true` in its meta (Phase 2: `signups`, `ai_cost`; Phase 3 AI: `ai_reliability`, `ai_wasted_spend`).
- **Keys:** `drill_users` dispatches `p_filters.metric = '<key>'` (`^[a-z][a-z0-9_]{0,40}$`) to `analytics_private.drill_<key>`, resolved with `to_regprocedure` (unknown → 22023). Supported keys: `admin_app.drill_keys()` → `(key, description, meta)`, also published as `drill_metrics` in `drill_users`' catalog meta. Each key's meta has `description`, `metric` (the `analytics.<metric>` it drills, or null), `filters`, `value`, `unit`, `order`, `detail`.

  | Key | Drills | Key filters | `value` |
  |---|---|---|---|
  | `signups` | `signups` | `locale`, `market` | 1 per account (newest first) |
  | `ai_cost_users` | `ai_cost` | `ai_flow`, `ai_model`, `ai_provider` | AI cost USD (highest first) |
  | `ai_failures` | — (generic; no metric links to it) | `ai_flow`, `ai_model`, `ai_provider` | failed runs (most first) |
  | `ai_failures_by_flow` | `ai_reliability` | `ai_flow`, `ai_model`, `ai_provider`, `market` | failed runs (most first) |
  | `ai_wasted_spend` | `ai_wasted_spend` | `ai_flow`, `ai_model`, `ai_provider`, `market` | wasted AI cost USD (highest first) |
- **Common filters** (handled by `drill_users`): `metric`; `include_internal` (boolean, default false, as in metrics); `day` (`YYYY-MM-DD`, overrides `p_from`/`p_to`). Otherwise the range is `p_from..p_to` with the metric defaults (last 30 days, ≤ 3 years). A clicked bucket is passed as `p_from`/`p_to` (or `day`) and its breakdown value as the matching key filter.
- **Convention for a new key** (no change to `drill_users`):
  - `create function analytics_private.drill_<key>(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text) returns table (user_id uuid, value numeric, detail jsonb, sort_key text) language … stable set search_path = ''`.
  - `p_from`/`p_to` are the resolved range (never null). `p_filters` arrives without `metric`, `include_internal` and `day`; the function rejects other unknown keys with 22023.
  - It returns every user behind the point, one row per user, unpaged: `drill_users` then drops accounts pending deletion or restricted (`analysis_users`) and internal accounts unless `include_internal`, orders by `sort_key::numeric desc, user_id`, builds the cursor and applies the limit. `p_limit`/`p_cursor` are informational.
  - `sort_key` is a decimal number as text; `detail` is metadata only.
  - Comment it with the key meta JSON, run `select analytics_private.refresh_drill_metrics();` to republish `drill_metrics`, and merge `"drill": true` into the metric's comment.

### Audit log
`admin_app.audit_log(id bigint identity, at timestamptz default now(), admin_email text, action text, target_user_id uuid references public.users(id) on delete set null, params jsonb, request_id text, people_function text, xact_id xid8)`, indexed on `at desc`, `target_user_id` and `xact_id`.
- **Append-only:** a trigger rejects every UPDATE, DELETE and TRUNCATE (even by the owner), except the FK's `on delete set null`, which may only null `target_user_id` once the user row is gone. Account erasure deletes `public.users`, so the reference is nulled and the record kept.
- **Writes:** `admin_app.log_access(p_admin_email, p_action, p_target_user_id, p_params, p_request_id, p_query text default null) returns bigint` (SECURITY DEFINER, executable by `analytics_api` only).
  - Stores the email trimmed and lowercased, `people_function` (`<name>` for `people.<name>`, `params.function` for `export.csv`; it must be an existing `analytics_people` function) and `xact_id = pg_current_xact_id()`.
  - With `p_query`, adds `params.query_hmac = encode(extensions.hmac(lower(trim(p_query)), pepper, 'sha256'), 'hex')`. The pepper is a random 32-byte value in `admin_app.audit_pepper` (one row, created by the migration, no grants); the raw text is never stored.
  - Raises 22023 for: a malformed email; an action not matching `<area>.<name>` (`^[a-z][a-z0-9_]{0,40}(\.[a-z][a-z0-9_]{0,40}){1,3}$`) or naming an unknown people function; params that are not an object, exceed 8,192 characters or carry `q`, `query`, `p_query`, `query_hmac` or `query_sha256`; `p_query` over 1,000 characters; a request id over 128 characters or outside `[-A-Za-z0-9_.:]`.
- **Enforcement:** `analytics_private.assert_audited(function, user_id)` runs first in every `analytics_people` function and raises 42501 unless the current transaction (`pg_current_xact_id_if_assigned()`) holds a row for that function and, when `user_id` is given, for that user (or for no user when the id does not exist).
- **Reads** (Phase 5 Data health page): `admin_app.audit_recent(p_limit integer default 100)` → newest first, clamped to 1–500.

## Phase 3 AI metric outputs (AI cost & reliability)

Every AI metric reads the `analytics.ai_cost` population through `analytics_private.ai_run_scope` (`run_cost`: exact `cost_usd` from 2026-10-27, otherwise tokens re-priced with `ai_model_prices`; non-mock, non-guest runs; accounts pending deletion or restricted excluded; internal accounts only with `include_internal`). Cost is USD for `native` and `usd`; `try` converts each run at its month's rate from `analytics_private.fx_months`, and `fx_provisional` follows the Phase 1 rule (a needed missing rate makes the value null). `market` is the account's locked market (`unknown` without one).

| Function | Shape (unit) | Columns | Breakdowns / filters | Display keys |
|---|---|---|---|---|
| `ai_reliability` | timeseries (ratio) | `bucket, dimension, failure_rate, runs, completed_runs, failed_runs, pending_runs, model_failure_rate, model_failed_runs, p50_duration_seconds, p95_duration_seconds, avg_tokens_per_run` | ai_flow, ai_model, ai_provider / + market | `plot ["failure_rate"]`, `drill` (key `ai_failures_by_flow`) |
| `ai_wasted_spend` | timeseries (ratio) | `bucket, dimension, wasted_share, wasted_cost, total_cost, failed_runs_cost, expired_cards_cost, rejected_cards_cost, unfinished_sessions_cost, failed_import_improve_cost, skills_pool_escalation_cost, wasted_tokens_share, runs, failed_runs, unpriced_runs, fx_provisional` | ai_flow, ai_model, ai_provider / + market | `plot ["wasted_share","wasted_tokens_share"]`, `drill` (key `ai_wasted_spend`) |
| `ai_cost_anomalies` | timeseries (currency) | `bucket, dimension, cost, runs, tokens, unpriced_runs, terminal_runs, model_failed_runs, model_failure_rate, cost_baseline, cost_upper_band, cost_z, tokens_baseline, tokens_upper_band, tokens_z, baseline_buckets, cost_spike, token_spike, jump_from_flat_baseline, failure_spike, is_anomaly, fx_provisional` | ai_flow, ai_model, ai_provider / + market | `flag_column "is_anomaly"` |
| `ai_tokens_by_model` | timeseries (tokens) | `bucket, dimension, total_tokens, input_tokens, cached_input_tokens, output_tokens, runs, runs_without_tokens, completed_runs, failed_runs, cost, unpriced_runs, fx_provisional` | ai_model, ai_provider, ai_flow / + market | `plot ["input_tokens","output_tokens"]`, `stacked` |
| `ai_cost_concentration` | breakdown (ratio) | `dimension` (`top 10%` … `90-100%`), `cost_share, cumulative_cost_share, cost, users, runs, tokens, token_share, unpriced_runs, gini_cost, gini_tokens, fx_provisional` | none / ai_flow, ai_model, ai_provider, market | `min_group 2` |
| `ai_cost_per_outcome` | breakdown (currency) | `dimension` (outcome), `cost_per_outcome, outcomes, users, attributed_cost, attributed_cost_exact, attributed_cost_estimated, attributed_runs, unpriced_runs, tokens_per_outcome, fully_loaded_cost_per_outcome, fx_provisional` | none / ai_model, ai_provider, market | `min_group 5`; `outcomes`, `users` ignore ai_model / ai_provider |
| `ai_cost_by_plan` | breakdown (currency) | `dimension` (plan segment), `ai_cost, users, paying_users, ai_active_users, runs, unpriced_runs, cost_per_user, cost_per_paying_user, revenue, revenue_usd_native, revenue_try_native, ai_cost_share_of_revenue, gross_margin, exact_share, fx_provisional` | none / plan (matches the segment), market | `min_group 5`; no `breakdown_dimension` (segments are not plan codes) |

Rules:
- **Timeseries** are gap-filled per bucket (and per breakdown value). Breakdown shapes ignore `p_grain` and reject `p_breakdown`.
- **`ai_reliability`:** `failure_rate = failed / (completed + failed)` (pending runs excluded); `model_failure_rate` also drops privacy / claim failures and watchdog timeouts without usage. Durations are of completed runs.
- **`ai_wasted_spend`:** a run is fully wasted when it failed, belongs to a failed `import_improve` orchestration, to a tailoring session unfinished 7 days after creation, or is a `skills_pool` escalation; otherwise the share of its expired or rejected v2 cards. `wasted_cost` counts each run once; the category columns overlap. `wasted_share` and `wasted_tokens_share` are computed in USD and tokens.
- **`ai_cost_anomalies`:** the baseline is the 7 previous buckets of the requested grain (current bucket excluded). Flags: z > 3 on cost or tokens, a flat token baseline followed by more than twice its mean, and model failure rate > 20% with ≥ 5 terminal runs; `is_anomaly` is any flag. `cost_z` / `tokens_z` use unit `count` (standard deviations, not fractions).
- **`ai_cost_concentration`:** deciles by USD cost (`ntile(10)`). A decile with fewer than `min_group` (2) users shows only `users`; its shares, cost, runs, tokens and unpriced runs are null. No per-user rows.
- **`ai_cost_by_plan`:** `revenue` and `gross_margin` are null for `native` (see the `*_native` columns); `ai_cost_share_of_revenue` is computed in USD.
- **Drill keys** (`analytics_private.drill_<key>`, see **Drill-down**): `ai_failures_by_flow` (value = failed runs; detail `failed_runs, runs, failure_rate, last_failed_at, flows, models, failure_classes`, class counts only) and `ai_wasted_spend` (value = wasted USD; detail `wasted_cost_usd, total_cost_usd, wasted_share, wasted_tokens_share, wasted_runs, failed_runs, runs, unpriced_runs, flows`). Both accept `ai_flow`, `ai_model`, `ai_provider` and `market`.

## Phase 3 Monetization metric outputs

All functions use the standard metric signature (`20261102120000_analytics_monetization.sql`). Common rules:
- **Population:** billing facts (invoices, checkout attempts, events) keep erased accounts (`user_id` null) and accounts pending deletion or restricted; metrics built on subscription rows (`trial_to_paid`, `subscription_churn`, `cancellation_reasons`) use `analysis_users`. Internal accounts only with `include_internal`.
- **Money:** the requested currency column (`usd` / `try`, converted at the fact month's rate from `analytics_private.fx_months`, the shared monthly FX helper) plus `*_usd_native` / `*_try_native`. In `native` mode the converted column is null, except `mrr_movement`, which splits by invoice currency like `revenue` (`dimension` = `USD` / `TRY`; a breakdown raises 22023). `fx_provisional` follows the Phase 1 rule; a needed missing rate makes the value null.
- **Market** falls back to `unknown`. Ratios are 0–1. The primary measure is the first measure column listed below.
- **MRR snapshot** (`mrr_movement`, `plan_mix`) is the `kpi_overview` one, so `plan_mix` subscriptions add up to `active_subscriptions` and `mrr_movement` ending MRR equals `kpi_overview.mrr` at the same instant.

| Function | Shape (unit) | Columns | Breakdowns / filters | Display keys |
|---|---|---|---|---|
| `mrr_movement` | timeseries (currency) | `bucket, dimension, new, expansion, contraction, churn, reactivation, fx_effect, starting_mrr, ending_mrr, starting_customers, new_customers, reactivated_customers, churned_customers, ending_customers, fx_provisional` | market, plan / market, plan, currency | `plot ["new","expansion","contraction","churn","reactivation"]`, `stacked` (contraction and churn are negative; `starting_mrr + movements + fx_effect = ending_mrr`). Day grain is limited to 366 days (22023). |
| `trial_to_paid` | timeseries by trial-start cohort (ratio) | `bucket, dimension, trial_to_paid, trial_starts, converted, failed_first_charge, trial_canceled, superseded, in_trial, unresolved, resolved, failed_charge_rate` | market, plan / market, plan | `plot` = the six outcome counts, `stacked`, `drill` (key `trial_conversions`) |
| `checkout_funnel` | funnel (count) | `step_order, step, dimension, users, conversion_from_prev, conversion_from_start, dropped, pending`; steps `attempts`, `session_created`, `completed`, `paid_within_7d` (`users` counts checkout attempts) | market, plan / market, plan | `drill` (key `checkout_funnel`, filter `step`) |
| `subscriber_ltv` | breakdown (currency) | `dimension, ltv, customers, ltv_usd_native, ltv_try_native, median_ltv, revenue, revenue_usd_native, revenue_try_native, still_paying, censored_share, avg_paid_invoices, avg_observed_months, erased_customers, fx_provisional` | plan (default), market, currency / plan, market, currency | `breakdown_dimension "plan"` (p_breakdown switches it) |
| `plan_mix` | breakdown (count) | `dimension, subscriptions, share, mrr, mrr_usd_native, mrr_try_native, switched_in, switched_out, fx_provisional` (snapshot at the end of `p_to`) | plan / market, plan, currency | `breakdown_dimension "plan"` |
| `subscription_churn` | timeseries (count) | `bucket, dimension, paid_churn, paid_voluntary, paid_involuntary, paid_other_or_unknown, ended_never_paid, replaced_excluded, cancel_scheduled_open, lost_to_erasure, lost_mrr, lost_mrr_usd_native, lost_mrr_try_native, involuntary_share, fx_provisional` | market, plan / market, plan | `plot ["paid_voluntary","paid_involuntary","paid_other_or_unknown"]`, `stacked`, `drill` (key `churned_subscribers`) |
| `payment_issues` | timeseries (count) | `bucket, dimension, failed_invoices, invoices_due, failure_rate, paid_late_invoices, failed_amount, failed_amount_usd_native, failed_amount_try_native, past_due_episodes, recovered_episodes, lost_episodes, refunded_invoices, refunded, refunded_usd_native, refunded_try_native, refund_rate, discounted_invoices, discount, discount_usd_native, discount_try_native, effective_discount_rate, fx_provisional` | market, plan / market, plan, currency | `plot ["failed_invoices","refunded_invoices","discounted_invoices"]` |
| `cancellation_reasons` | breakdown (count) | `dimension, cancellations, share, reason_group_share, paid_cancellations, trial_or_unpaid_cancellations, reason_group, cancellation_reason, cancellation_feedback` (`dimension` = `group / reason / feedback`) | none (22023) / market, plan | — |
| `paywall_denials` | timeseries (count) | `bucket, dimension, user_days, users, hits, hits_consenting, hits_anonymous, anonymous_share` | market, plan / market, plan | `consent_scoped`, `drill` (key `paywall_denials`) |

Grain does not apply to `checkout_funnel`, `subscriber_ltv`, `plan_mix` and `cancellation_reasons`; currency does not apply to `trial_to_paid`, `checkout_funnel`, `cancellation_reasons` and `paywall_denials`.

**Drill keys** (convention under Phase 2 "Drill-down"; one row per user, privacy and `include_internal` applied by `drill_users`):

| Key | Drills | Key filters | `value` (order) |
|---|---|---|---|
| `trial_conversions` | `trial_to_paid` | `market`, `plan`, `outcome` (converted, failed_first_charge, trial_canceled, superseded, in_trial, unresolved) | trials started in range (newest trial first) |
| `checkout_funnel` | `checkout_funnel` | `market`, `plan`, `step` (attempts by default, session_created, completed, paid_within_7d, abandoned, rejected) | matching attempts (latest attempt first) |
| `checkout_abandoned` | — (generic: `checkout_funnel` with `step = abandoned`) | `market`, `plan` | abandoned attempts (latest first) |
| `churned_subscribers` | `subscription_churn` | `market`, `plan`, `reason_group` | churned paid subscriptions (latest end first) |
| `paywall_denials` | `paywall_denials` | `market`, `plan` | denial hits of consenting users (most first) |

## Phase 5: alerts, recompute and data health

### Alertable metrics
Rules can only target metrics whose meta has `alertable: true`. These are `kpi`-shaped, one row per window.
- `analytics.kpi_overview` (exists).
- New `analytics.kpi_health` (kpi), with columns:
  - `ai_runs bigint, ai_failed_runs bigint, ai_failure_rate numeric`
  - `failed_payments bigint, payment_failure_rate numeric`
  - `checkout_attempts bigint, checkout_abandon_rate numeric`
  - `export_failures bigint, export_failure_rate numeric`
  - `import_failures bigint, import_failure_rate numeric`
  - `tailoring_task_failures bigint, tailoring_task_failure_rate numeric`
  - `unpriced_ai_runs bigint`

  It takes standard parameters, and its filters are `market` and `plan` where they apply.

### Tables (`admin_app`, no grants; access only through definer functions executable by `analytics_api`)
- **`alert_rules`:**
  - Identity and target: `id uuid pk, name text, metric text, measure text, params jsonb` (`currency`, `include_internal`, `filters`).
  - Window and condition: `window text` (`today`, `1d`, `7d` or `30d`), `condition text` (`gt`, `lt`, `pct_change_gt` or `pct_change_lt`), `threshold numeric`.
  - Behaviour and bookkeeping: `cooldown_hours int default 24, enabled bool default true, created_by text, created_at, updated_at`.
- **`alert_events`:** `id bigint identity, rule_id uuid (on delete cascade), fired_at, window_from date, window_to date, value numeric, baseline numeric, message text, acknowledged_by text, acknowledged_at`.
- **Windows (UTC):**
  - `today` is the current day so far.
  - `1d` is yesterday.
  - `7d` and `30d` are the last N complete days.
- **Baseline:** `pct_change_*` conditions compare the window with the previous window of the same length.

### Evaluation
- `analytics_private.evaluate_alerts()` runs hourly through `pg_cron`. For each enabled rule outside its cooldown, it:
  1. calls `analytics.<metric>` for the window;
  2. reads `measure`;
  3. compares it with the threshold;
  4. inserts an `alert_events` row with a human-readable `message`.
- **Validation:** rules are checked at write time. The metric must be alertable, the measure must be a numeric column, and the params must be valid.
- **Null values:** a null value never fires.

### Endpoints (admin only, `no-store`; writes are audited with actions `alert.rule.create|update|delete`, `alert.event.ack` and `recompute`)
| Method & path | Does |
|---|---|
| `GET /admin/alerts/rules` | List rules |
| `POST /admin/alerts/rules` | Create (body = rule fields) → rule |
| `PATCH /admin/alerts/rules/:id` | Partial update → rule |
| `DELETE /admin/alerts/rules/:id` | 204 |
| `GET /admin/alerts/events?status=open\|all&limit=50` | Newest first, with `rule_name` and `metric` |
| `POST /admin/alerts/events/:id/ack` | Acknowledge → event |
| `GET /admin/alerts/summary` | `{ open_count, latest_fired_at }` (header badge and Overview banner) |
| `POST /admin/recompute` | `admin_app.request_recompute()` → 202 `{status:'queued', run_id}`, or 429 `{status:'throttled', retry_after_seconds}` |
| `GET /admin/recompute/status` | `admin_app.recompute_status()` → the latest run (status, requested_at, started_at, finished_at, error) |

The **Data health page** uses `analytics.data_freshness` (table) plus `admin_app.audit_recent(50)`, exposed as `GET /admin/audit/recent?limit=50`. It's admin only and audited as `audit.read`.
