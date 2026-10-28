# Admin Analytics — Architecture (v1)

Requirements: [requirements.md](requirements.md).

## 1. Overview

```
admin.jobspecificcv.com                backend (existing Vercel project)           Supabase Postgres (single DB)
(new Vercel project, root: admin/)
┌──────────────────────────┐ /api/*   ┌──────────────────────────────────┐ .rpc() ┌───────────────────────────────────┐
│ React + Recharts         │ rewrite  │ authMiddleware → requireAdmin    │──────▶ │ analytics         metric functions │
│ TanStack Query (5 min)   │────────▶ │ /admin/metrics/:name   (generic) │        │ analytics_people  user-level fns   │
│ filters in URL           │  Bearer  │ /admin/people/:name    (audited) │        │ analytics_private views, MVs, alert│
│ Supabase Auth (Google)   │◀──────── │ /admin/alerts, /admin/recompute  │        │                   evaluation       │
└──────────────────────────┘   JSON   └──────────────────────────────────┘        │ admin_app         app-owned tables │
                                                                                   │ pg_cron: nightly MV refresh,       │
                                                                                   │   hourly alerts, recompute queue   │
                                                                                   └───────────────────────────────────┘
```

**Principles**
- **Logic lives in SQL.** Every metric is a versioned Postgres function created by a migration. The KB markdown remains the human-readable spec.
- **The backend is a thin, generic gateway.** It authenticates, authorizes, validates the fixed parameter contract, audits, and returns JSON or CSV. It contains no per-metric code.
- **Database work is scheduled inside the database.** `pg_cron` handles refreshes, alerts and the recompute queue, so nothing depends on Vercel cron frequency limits or cold starts.
- **Parts deploy independently** (see §8).

## 2. Repository layout

The layout as planned; the files that actually exist are in the code map, [development.md](development.md) §2.

```
CV_Builder/
├── admin/                                  NEW — Vercel project "cv-builder-admin", root dir = admin
│   ├── vercel.json                         /api rewrite → backend, SPA fallback, X-Robots-Tag noindex
│   └── src/
│       ├── app/            router, AuthGate (signed out / no access / admin), layout, header alert badge
│       ├── lib/api.ts      typed fetch with Bearer token; TanStack Query hooks (useMetric, usePeople)
│       ├── lib/filters.ts  zod-parsed URL search params ↔ global filter state
│       ├── metrics/        presentation registry: metric → chart type, axes, formatters
│       ├── components/     ChartCard (info, export, data-as-of, refresh), KpiTile, TimeSeries,
│       │                   BreakdownBar, Funnel, CohortHeatmap, DataTable, Timeline, BreakdownPicker
│       └── pages/          overview, monetization, ai, engagement, tailoring, acquisition,
│                           data-health, users (search, profile+timeline), alerts
├── backend/
│   ├── src/modules/admin-analytics/        NEW — routes, controller, service, repository,
│   │                                       contract.ts (zod), csv.ts, audit.ts
│   ├── src/shared/middleware/require-admin.ts   NEW — extracted from TailoringService.isAdmin
│   ├── supabase/migrations/2026110x…_analytics_*.sql
│   └── tests/sql/analytics-*.sql           NEW — run by scripts/verify-privacy-sql.sh (npm run test:privacy-sql)
└── docs/admin-analytics/
```

The KB (`cv-data-model-kb/CV_data_tool`) gets a `Dashboard function:` line in each ported query file. The new schemas get KB pages generated with the `db-kb-writer` skill.

## 3. Database layer

### 3.1 Schemas

| Schema | Contents | Who can call it |
|---|---|---|
| `analytics` | Aggregate metric functions only (no user identifiers in output) | `analytics_api` (EXECUTE) |
| `analytics_people` | User-level functions: search, summary, timeline, drill-down lists | `analytics_api` (EXECUTE) |
| `admin_app` | App-owned tables (alert rules/events, audit log, refresh runs) plus the functions that read and write them | `analytics_api` (EXECUTE on functions only) |
| `analytics_private` | Shared views, materialized views, alert evaluator, helpers | owner only |

- None of these schemas are exposed to the Data API (see §3.8).
- `anon`, `authenticated`, `service_role` and `PUBLIC` get no `USAGE` or `EXECUTE`. Postgres grants function `EXECUTE` to `PUBLIC` by default and per-schema default privileges can't remove that, so the foundation migration's default privileges only grant `analytics_api`, every analytics migration ends with an explicit `revoke … from public`, and the contract check (`analytics_private.contract_violations()`) asserts the result.
- The schema an endpoint calls *is* its allowlist. Helpers that must never be called directly stay in `analytics_private`.

### 3.2 Shared definitions (`analytics_private`), defined once

| View | Replaces the copy-pasted CTEs in `new_analysis/` |
|---|---|
| `internal_users` | `users.is_internal` + admin emails (kept in sync by the existing 03:30 refresh) |
| `analysis_users` | users minus internal, minus pending deletion / restricted processing |
| `invoice_revenue` | `billing_invoices` in native, USD and TRY columns via monthly `fx_rates` |
| `run_cost` | `ai_runs` cost, recomputed from `ai_model_prices` where `cost_usd` is null |
| `ai_model_prices` (table) | Filled by the existing 03:30 refresh from `AI_MODEL_PRICING_JSON` (no hard-coded prices) |

### 3.3 Function contracts

Every function in a schema has the same signature, with defaults, so the backend needs one validator per schema.

```sql
-- analytics.<metric>
(p_from date, p_to date, p_grain text,              -- 'day' | 'week' | 'month'
 p_currency text,                                   -- 'native' | 'usd' | 'try'
 p_include_internal boolean,
 p_breakdown text,                                  -- null or one of the allowed dimensions
 p_filters jsonb)                                   -- drill-down, e.g. {"market":"TR","ai_flow":"tailoring"}
returns table (...)                                 -- small result: time series / breakdown / KPI row
language sql stable set search_path = ''

-- analytics_people.<fn>
(p_user_id uuid, p_query text, p_from date, p_to date, p_filters jsonb,
 p_limit int, p_cursor text)                        -- keyset pagination, p_limit ≤ 200
```

- A function ignores parameters it doesn't use.
- It raises `22023` (invalid parameter) for an unsupported breakdown or filter, and the backend maps that to HTTP 400.
- **Metadata lives next to the code** in `comment on function`, as JSON: `{title, definition, unit, breakdowns[], kb, consent_scoped, min_group}`. `admin_app.metric_catalog()` returns this for all functions. The UI renders tooltips and breakdown pickers from it, so a new metric needs no backend change.
- **Contract test:** the SQL test fails if any `analytics` / `analytics_people` function has a non-standard signature, is not `STABLE`, lacks a valid JSON comment, or is executable by anon/authenticated.

### 3.4 Functions in v1

The original plan; what shipped (35 metrics, no `data_quality_checks`) is in [metrics-inventory.md](metrics-inventory.md).

- **analytics**
  - `kpi_overview` (current vs. previous period for all Overview tiles), `signups`, `activation_funnel`
  - `revenue`, `mrr_movement`, `trial_to_paid`, `checkout_funnel`, `subscriber_ltv`
  - `ai_cost`, `ai_cost_per_outcome`, `ai_reliability`, `ai_wasted_spend`, `ai_cost_anomalies`
  - `stickiness`, `cohort_retention`, `growth_accounting`
  - `tailoring_funnel`, `tailoring_task_reliability`, `tailoring_card_acceptance`
  - `onboarding_segments`, `import_quality`, `data_freshness`, `data_quality_checks`
- **analytics_people:** `search_users`, `user_summary`, `user_timeline` (the KB query, extended per FR4), `drill_users` (the users behind a metric point, keyed by `p_filters.metric` + dimension values).

Each is ported from its `new_analysis/` or `queries/` file, keeping the KB conventions (currency variants, internal exclusion, UTC).

### 3.5 Pre-computed metrics and scheduling (`pg_cron`)

- **Materialized views** in `analytics_private` (`engagement_user_periods`, `engagement_growth`, `refresh_snapshot`) back `cohort_retention` and `growth_accounting`; `subscriber_ltv` and `mrr_movement` run live. Each MV has a unique index so `refresh materialized view concurrently` never blocks reads. All other metrics run live; the data is small. Indexes are added only when `EXPLAIN` shows the need.
- **`pg_cron` jobs:**

  | Job | Schedule | Does |
  |---|---|---|
  | `analytics_nightly` | 03:45 UTC | Refresh all MVs (after the 03:30 Vercel refresh updates FX, prices and internal flags) |
  | `analytics_recompute_queue` | every minute | If `admin_app.refresh_runs` has a pending request, refresh MVs and mark it done |
  | `analytics_alerts` | hourly at :05 | `analytics_private.evaluate_alerts()` |
  | `analytics_cron_history_purge` | 04:20 UTC | Keep 7 days of `cron.job_run_details` for the `analytics_*` jobs |

- **Recompute button:** `admin_app.request_recompute(admin_email)` inserts a pending run. It is rejected if a run finished or was requested within 5 minutes; this check lives in the database, so it holds across serverless instances. The UI polls `GET /admin/recompute/status` until the run completes, so the HTTP request never waits on the refresh.

### 3.6 Alerts

- `admin_app.alert_rules`: `name`, `metric`, `measure`, `params jsonb`, `condition` (`gt`/`lt`/`pct_change_gt`/`pct_change_lt`), `threshold`, `"window"`, `cooldown_hours`, `enabled`, `created_by` (full columns: api-contract.md "Phase 5").
- `admin_app.alert_events`: `rule_id`, `fired_at`, `window_from/to`, `value`, `baseline`, `message`, `acknowledged_by/at`.
- **Evaluation:** `evaluate_alerts()` checks the metric name against `pg_proc` in schema `analytics` before calling it dynamically (`format('%I', …)`), then compares the result and respects the cooldown. Only KPI-shaped metrics (a single row) can be alerted on, and the rule editor offers only those.

### 3.7 Audit log

- **`admin_app.audit_log`** stores: `at`, `admin_email`, `action` (`people.<function>` e.g. `people.search_users`, `export.csv`, `alert.rule.*`, `alert.event.ack`, `recompute.request`, `audit.read`), `people_function`, `xact_id`, `target_user_id`, `params jsonb`, `request_id`.
- It is append-only: there are no update/delete grants, and a trigger rejects changes.
- It must be added to the privacy erasure flow so `target_user_id` is nulled when a user is erased.

### 3.8 Connection, query timeout and isolation (decided in Phase 0)
- **The timeout must come from the role.** Phase 0 confirmed in Postgres 17 that a function-level `set statement_timeout` does **not** cap the calling statement: a function containing `pg_sleep(3)` with a 1 s setting ran for the full 3 s. A role-level setting did cancel it.
- **The project uses the new asymmetric JWT signing keys,** so minting a custom-role token for the Data API isn't practical.
- **Decision:** the backend connects **directly to Postgres** as a dedicated login role, `analytics_api`.
  - It uses the Supavisor transaction pooler, port 6543, with user `analytics_api.<project_ref>`.
  - The connection string is kept in the backend env var `ANALYTICS_DATABASE_URL`, using the `postgres` npm driver with `prepare: false`.
- **What `analytics_api` can do:**
  - It has `statement_timeout = 15s` and `idle_in_transaction_session_timeout = 30s` on the role. Each call also sets `set local statement_timeout` as a second safeguard.
  - It holds **only** `USAGE` on `analytics`, `analytics_people` and `admin_app`, and `EXECUTE` on their functions.
  - It has no table privileges and no `BYPASSRLS`.
  - Dashboard functions are `SECURITY DEFINER` with `set search_path = ''`, owned by the table owner `postgres`, so they read across RLS while the role itself can't.
- **None of the analytics schemas are exposed to the Data API (PostgREST).** That removes the risk of a browser token calling them, and PostgREST's `max_rows` cap doesn't apply.
- **Metric calls** run in a `read only` transaction.
- **People calls** write their audit row and read their data in the same transaction. If the audit insert fails, no data is returned.
- **TLS:** the connection verifies the pooler certificate against Supabase's root CA (Supabase Root 2021 CA), which is pinned in code.
- **Contract check:** `contract_violations()` also flags anything that would let `analytics_api` reach beyond its schemas:
  - role memberships or elevated role attributes;
  - definer functions elsewhere that it can execute;
  - table, column or sequence grants in any schema it can use.
- **Region:** the backend's Vercel functions run in `fra1` (Frankfurt), the same region as the database (`eu-central-1`).
- **Escape hatch:** if analytics load ever affects the product, point `ANALYTICS_DATABASE_URL` at a Supabase read replica. No code change.

### 3.9 Row limits
- Metric functions return small, aggregated results.
- People functions paginate with a keyset cursor, at most 200 rows per page.
- CSV export pages through on the server, capped at 50,000 rows.

## 4. Backend module (`admin-analytics`)

**Access control.** Mounted at `/api/v1/admin`:
- **Order:** an IP rate limiter runs first, then an identity-only auth step, then `requireAdmin`.
- **Identity-only auth:** the token is verified with Supabase, but no `public.users` row is created and no activity is recorded. Signing in to the admin app therefore never creates a product account or changes product metrics.
- **Admin rule:** the live auth email (not the stored `public.users.email`) must be in `ADMIN_EMAILS`, **and** the session must have been established with Google (`amr` method `oauth` plus a Google identity). This blocks password sign-ups that use an admin's address.
- **Shared check:** `isAdminEmail` is shared with `TailoringService.isAdmin`.
- **Guards:** the router does not sit behind the product-access/consent guard, so an admin's own consent state can't block it.

| Method & path | Does | Notes |
|---|---|---|
| `GET /admin/me` | `{ email, is_admin }` | Drives the AuthGate |
| `GET /admin/catalog` | `metric_catalog()` | Titles, definitions, breakdowns, alertable flag |
| `GET /admin/metrics/:name` | Calls `analytics.<name>` with the contract params | `name` matches `^[a-z][a-z0-9_]{0,62}$`; unknown → 404; `?format=csv` |
| `POST /admin/people/:name` | Calls `analytics_people.<name>` (JSON body) | Every call audited, enforced in the database; `Cache-Control: no-store`; `format: "csv"` audited as export, 10/min per admin |
| `POST /admin/recompute` | `request_recompute()` | 202, or 429 when throttled |
| `GET/POST/PATCH/DELETE /admin/alerts/rules` | CRUD | Rules validated against the catalog; audited |
| `GET /admin/alerts/events`, `POST …/:id/ack` | List and acknowledge | |

- **Validation:** one zod schema per contract.
  - `from ≤ to`; range at most 3 years.
  - `breakdown` from a fixed enum.
  - `filters` keys from a fixed enum with scalar values.
- **Rate limit:** the existing `express-rate-limit` per-admin limiter, as a guard against runaway clients only.
- **Errors:**

  | Postgres error | HTTP |
  |---|---|
  | `22023` | 400 |
  | missing function | 404 |
  | `57014` (timeout) | 504 |

- **Logging:** pino logs `{admin, metric, ms, rows}` for every call.
- **No server-side cache.** Metric results are small, there are only a few admins, and TanStack Query caches in the browser.

## 5. Admin app (`admin/`)

- **Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui + react-router, the same as `frontend/`. It also uses Recharts (already used in `frontend/`), TanStack Query and `@supabase/supabase-js`.
- **Auth:**
  - Supabase Google OAuth on the admin origin, which has its own session storage.
  - `AuthGate` calls `/admin/me` and renders sign-in, no access, or the app.
  - The UI never decides access by itself; the backend enforces it on every call.
- **Data fetching:** `useMetric(name, filters)` → query key `[name, filters]`.
  - `staleTime` is 5 minutes.
  - Refresh invalidates the page's queries.
  - Recompute calls the endpoint, then polls `GET /admin/recompute/status` every 5 s while a run is open.
- **State:** filters, breakdown and click-to-filter drill-downs live in URL search params, parsed with zod; the users drawer and people search terms stay in component state. There is no global store.
- **Interactivity:**
  - Recharts `Tooltip`, `Legend` (click to toggle a series), `Brush` (zoom), and `onClick` to drill.
  - A drill-down either adds to `filters` in the URL or opens the `drill_users` drawer → user profile.
- **CSV:** the export button requests `?format=csv` with the current filters, so exports always come from the server. People CSVs (`POST … format: "csv"`) are audited as `export.csv`; metric CSVs (aggregates) are not.
- **Hosting:** `vercel.json` rewrites `/api/:path*` to the backend (same origin for the browser, but browsers still send `Origin: https://admin.jobspecificcv.com` on POST/PATCH/DELETE and the rewrite forwards it, so the admin origin is listed in the backend's `CORS_ALLOWED_ORIGINS`; unlisted origins get a 403), adds an SPA fallback and sets `X-Robots-Tag: noindex, nofollow` on all paths.

## 6. Security and privacy summary

| Threat | Mitigation |
|---|---|
| Non-admin calls admin API | `requireAdmin` on every route; 403 |
| Customer token calls analytics functions directly through the Supabase API | Schemas not exposed to the Data API, and no grants to `anon` / `authenticated` / `service_role`; contract check asserts it |
| Calling arbitrary database functions through the generic endpoint | Name regex + catalog lookup; `analytics_api` can execute only functions in its three schemas; helpers live in `analytics_private` |
| Leaked `ANALYTICS_DATABASE_URL` | The role can only execute dashboard functions (no tables, no writes beyond the audit and alert functions), has a 15 s timeout and a connection limit; rotate with `alter role analytics_api password …` |
| Admin browsing user data without a trace | All `analytics_people` calls and exports go to the append-only audit log |
| Exposing content | People functions return metadata only; reviewed in the PR checklist |
| Erased / restricted users | Excluded or masked in `analysis_users`; audit log nulled on erasure |
| Search engines indexing admin pages | `noindex` header |
| Heavy query degrading the product | Role timeout (§3.8), MVs, read replica escape hatch |

## 7. Testing

| Layer | Tooling | Covers |
|---|---|---|
| SQL | `tests/sql/analytics-*.sql`, run by `npm run test:privacy-sql` (temp Postgres with all migrations) | Contract and grants test; seeded fixtures assert the results of each metric (currency variants, internal exclusion, privacy masking); audit log is append-only |
| Backend | vitest + supertest | 401/403/400/404/504 mapping, parameter validation, audit writes, CSV, throttle |
| Admin app | vitest + Testing Library | URL ↔ filter round-trip, AuthGate states, drill-down URL changes |
| Parity | One-off, per ported metric | Dashboard function and KB query return the same rows on a production snapshot |

**CI:** a GitHub Actions workflow with path filters. `admin/**` runs the admin tests and build; `backend/**` or `frontend/**` runs the backend typecheck and tests; `backend/supabase/**`, `backend/tests/sql/**` or `backend/scripts/**` runs the SQL test.

## 8. Deployment

| Change | Migration | Backend | Admin | Customer frontend |
|---|---|---|---|---|
| New/changed chart or page | – | – | ✅ | – |
| New metric | ✅ | – | ✅ | – |
| Metric SQL fix | ✅ | – | – | – |
| Auth / contract change (rare) | maybe | ✅ | maybe | – |

- **Build skipping:** each Vercel project's Ignored Build Step is `git diff --quiet HEAD^ HEAD -- ./<dir>`.
- **Deploy order:** migration → backend → admin.
- **One-time setup:**
  - Vercel project `cv-builder-admin` (root `admin/`) with domain `admin.jobspecificcv.com`.
  - Admin app env vars: Supabase URL and anon key only.
  - Supabase Auth redirect URL `https://admin.jobspecificcv.com/**`.
  - Set the `analytics_api` password and add `ANALYTICS_DATABASE_URL` to the backend project.
  - `pg_cron` is enabled by the foundation migration.

## 9. Delivery plan (completed)

All phases shipped to production on 2026-10-28; each went through independent reviews before deploy. Phase 0's "expose schemas" spike was replaced by the direct `analytics_api` connection (§3.8). The current state, backlog and deploy procedure are in [development.md](development.md); what shipped is in [metrics-inventory.md](metrics-inventory.md).

| Phase | Scope | Done when |
|---|---|---|
| 0. Spikes (≈1–2 days) | Expose schemas, `pg_cron`, dedicated-role timeout (§3.8), Vercel project + domain + auth redirect | A hello-world metric renders on `admin.jobspecificcv.com` for an admin, and 403 for a non-admin |
| 1. Foundation | Schemas, shared views, `ai_model_prices`, contract test, `requireAdmin`, `/me`, `/catalog`, `/metrics`, app shell (AuthGate, filters, ChartCard, KpiTile), Overview, CI | Overview KPIs match the KB numbers |
| 2. User lookup | Extended `user_timeline`, `search_users`, `user_summary`, `/people`, audit log + erasure hook, Users pages | Timeline matches the KB query plus the new sources; every view is audited |
| 3. Monetization + AI cost | Ported metrics with breakdowns, drill-down, `drill_users`, CSV | Parity checks pass |
| 4. Engagement, Tailoring, Acquisition | MVs, nightly + recompute jobs, Recompute button, cohort heatmap | Recompute completes within a minute; nightly job runs |
| 5. Alerts + Data health | Alert tables, evaluator job, rule editor, badge, banner, anomaly markers, Data health page | A seeded rule fires and is acknowledged in the UI |

## 10. Open items
1. ~~Timeline scope vs. consent~~ **Decided (2026-10-28):** the timeline is available for every signed-up, non-restricted user, for support purposes. The profile shows a consent badge, and the privacy notice must say that staff can view account activity.
2. **Shared TypeScript contract between `backend/` and `admin/`:** v1 duplicates the small zod schemas (separate Vercel root directories); a shared package is on the backlog in development.md §9.
3. **Later decisions** (CORS for the admin origin, Google-only admins, database-enforced auditing, the search-text HMAC and others) are recorded in the relevant sections above and in development.md §7 (lessons learned).
