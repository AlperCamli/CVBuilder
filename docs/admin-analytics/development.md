# Admin Analytics — Developer guide

Read this before changing the admin analytics dashboard. It covers where the code lives, the rules every change must keep, how to make common changes, what bit us while building it, and how to ship. Background: [architecture.md](architecture.md) (why it is built this way) and [api-contract.md](api-contract.md) (exact interfaces).

## 1. System in one paragraph
- **Admin app:** `admin/` is a Vite + React SPA served at `admin.jobspecificcv.com` (Vercel project `cv-builder-admin`). It calls `/api/v1/admin/*`, which its `vercel.json` rewrites to the existing Express backend (`backend/`, Vercel project `cv-builder-backend`, region `fra1`).
- **Backend:** checks the caller is an admin (Google session + `ADMIN_EMAILS`), validates a fixed parameter contract, and calls Postgres functions over a direct pooled connection as the execute-only role `analytics_api`.
- **Database:** every number is a `SECURITY DEFINER` SQL function in the schema `analytics` (aggregates) or `analytics_people` (user-level, audited). Shared logic lives in `analytics_private`; the app's own tables live in `admin_app`. All of them are created by migrations in `backend/supabase/migrations/`.
- **Scheduled work:** `pg_cron` handles nightly materialized-view refresh, the Recompute queue and hourly alert evaluation.
- **Definitions:** they come from the KB (`/Users/alpercamli/Desktop/cv-data-model-kb/CV_data_tool`).

## 2. Code map

### Database (`backend/supabase/migrations/`)
| Migration | Contains |
|---|---|
| `20261030120000_analytics_foundation.sql` | The four schemas; the `analytics_api` role (15 s timeout); helpers `assert_args`, `resolve_range`, `buckets`, `bucket`, `utc_start`, `filter_match`, `try_jsonb`; view `analysis_users`; `admin_app.metric_catalog()`; first `contract_violations()`; `analytics.signups` |
| `20261030130000_analytics_hardening.sql` | Wider `contract_violations()` (role memberships, definer functions elsewhere, column and sequence grants); `public.mark_internal_users` (case-insensitive); revokes `is_current_user` from PUBLIC |
| `20261031120000_analytics_overview.sql` | `public.ai_model_prices`; views `internal_users`, `invoice_revenue` (FX variants), `run_cost` (AI pricing); `filter_values`; `kpi_overview`, `revenue`, `ai_cost` |
| `20261101120000_analytics_people.sql` | `admin_app.audit_log` (append-only), `audit_pepper`, `log_access`, `audit_recent`, `assert_audited`; people helpers and `safe_error_message`; `search_users`, `user_summary`, `user_timeline`, `drill_users` (dispatch by convention), `drill_keys()`, `refresh_drill_metrics()`; merges `"drill": true` into the `signups` and `ai_cost` comments |
| `20261102120000_analytics_monetization.sql` | `fx_months` (the shared FX helper); views `mrr_invoices`, `trial_outcomes`, `subscription_endings`; Monetization metrics and drills; index `billing_invoices(subscription_id, paid_at)` |
| `20261102130000_analytics_ai.sql` | `ai_run_scope`, `ai_run_waste`; AI metrics and drills |
| `20261103120000_analytics_engagement.sql` | `admin_app.refresh_runs`; `refresh_all`, `process_recompute_queue`, `expire_stale_runs`, `request_recompute`, `recompute_status`, `schedule_refresh_jobs`; materialized views `engagement_user_periods`, `engagement_growth`, `refresh_snapshot`; `feature_events`; Engagement metrics; `data_freshness` (first version) |
| `20261103130000_analytics_tailoring_acquisition.sql` | `user_onboarding_paths`, `tailoring_v2_sessions*`, `signup_activation`, `try_timestamptz`; Tailoring and Acquisition metrics and drills |
| `20261104120000_analytics_alerts.sql` | `kpi_health`; `admin_app.alert_rules` / `alert_events` and their definer functions; `evaluate_alerts`, `schedule_alert_job`; `data_freshness` (current version); `audit_recent` with `people_function` (now refuses with 42501 unless the transaction holds an `audit.read` row) |

**Tests:** `backend/tests/sql/analytics-*.sql`, run by `backend/scripts/verify-privacy-sql.sh`. That script creates a temporary local Postgres, stubs the Supabase roles and schemas, applies **all** migrations, then runs the test files it lists explicitly (a new file must be added to the list). Every test runs after the latest migration, so a later migration that changes a function can break an earlier phase's test.

### Backend (`backend/src/`)
| File | Role |
|---|---|
| `modules/admin-analytics/admin-analytics.routes.ts` | Every `/admin/*` route and its middleware order: IP limiter → identity → `requireAdmin` → per-admin limiters (+ CSV and recompute limiters) |
| `modules/admin-analytics/admin-identity.ts` | Token check without product side effects, plus the Google check (`amr` + identity) |
| `modules/admin-analytics/admin-analytics.contract.ts` | zod schemas for metric and people params; Dimension enum; `MetricMeta` type |
| `modules/admin-analytics/admin-alerts.contract.ts` | zod schemas for alert rules, events, recompute and audit |
| `modules/admin-analytics/admin-analytics.controller.ts` | Request parsing, response shapes (`{ metric, rows, generated_at }`, CSV headers, `{ rules }`, 202/429 recompute), served-call logs |
| `modules/admin-analytics/admin-analytics.service.ts` | Catalog cache (60 s), error mapping (22023→400, 42501→403, P0002→404, 23505→409, 57014→504, connection→503; 42883 → 404 if the function left the catalog, else 500), CSV paging, people auditing |
| `modules/admin-analytics/admin-analytics.repository.ts` | All SQL calls (`postgres` driver): read-only transactions for metrics, audited read-write transactions for people and writes |
| `modules/admin-analytics/admin-analytics.csv.ts` | RFC 4180 CSV with BOM and formula-injection guard |
| `shared/db/analytics-db.ts`, `shared/db/supabase-root-ca.ts` | Pooled connection (`prepare: false`), type parsers (bigint and numeric → number, date → string), pinned TLS CA |
| `shared/middleware/require-admin.ts` | `isAdminEmail` / `isAdminIdentity` (also used by tailoring) |
| `shared/middleware/rate-limit.ts` | Admin IP, per-admin, CSV and recompute limiters; the global limiter skips `/admin/` |
| `shared/middleware/error-handler.ts`, `shared/errors/app-error.ts` | One log line per error; 5xx lines carry route, error name and SQLSTATE (admin routes add the message) |
| `app/create-app.ts` | CORS allow-list (`FRONTEND_APP_URL` + `CORS_ALLOWED_ORIGINS`, plus localhost:5173/3000 in development; others get 403) |
| `app/register-routes.ts`, `app/build-services.ts` | Mount the admin router (outside the product-access/consent guards) with its limiters; build the service and repository |
| `modules/monetization/monetization-refresh.service.ts` | 03:30 Vercel cron: FX, price and plan catalogs, `ai_model_prices`, `mark_internal_users` |

**Tests:** `backend/tests/admin-analytics.integration.test.ts` (supertest with a fake repository), `tests/monetization-tracking.unit.test.ts`.

### Admin app (`admin/src/`)
| Path | Role |
|---|---|
| `app/App.tsx`, `app/Layout.tsx`, `app/FilterBar.tsx`, `app/AuthGate.tsx` | Routes, shell (sidebar, filter bar, alert badge), sign-in / no-access gate (PKCE, local sign-out) |
| `app/nav.ts`, `app/pages.ts` | Sidebar entries. **`pages.ts` declares every metrics page as sections of metric names.** |
| `lib/api.ts` | Fetch + envelope parsing, catalog schema (`MetricMeta`), `useMetric`, metric CSV download |
| `lib/filters.ts` | URL ↔ filter state (range presets, grain, currency, include_internal, breakdown, filters); the `DIMENSIONS` list |
| `lib/shapes.ts` | Primary measure (row column order), measure keys, shape helpers |
| `lib/kpi.ts` | Current vs previous window (complete days only when the range ends today) |
| `lib/drill.ts` | Click → filter or drill drawer; resolves drill keys from `drill_metrics` |
| `lib/people.ts` | `POST /admin/people/:name` (never cached, search text never in URLs) |
| `lib/people.ts` → `PEOPLE_FUNCTIONS` | The people functions the UI may call |
| `lib/{alerts,recompute,audit,health,anomalies,eras,format}.ts` | Phase 5 APIs, era markers, formatting by unit and currency (`format.ts` also holds `DIMENSION_LABELS`) |
| `components/MetricChartCard.tsx` | Renders any metric by `meta.shape`: timeseries (`components/TimeSeriesChart.tsx`), breakdown, funnel, cohort, table or kpi (`components/charts/*`); `pages.ts` card options in `components/metricExtras.tsx` |
| `components/{KpiTile,ChartCard,DrillDrawer,RecomputeControl,AlertBadge,AlertsBanner}.tsx`, `components/alerts/RuleForm.tsx`, `components/people/*` | Feature components |
| `pages/{Overview,MetricsPage,Users,UserProfile,Alerts,DataHealth}.tsx` | Pages. `MetricsPage` renders any `pages.ts` entry. |

**Tests:** colocated `*.test.ts(x)` (vitest + Testing Library); `admin/README.md` covers local dev.

## 3. Local development
- **Admin app:**
  1. `cd admin && npm ci && npm run dev` serves http://localhost:5174 and proxies `/api` to `http://localhost:4000`.
  2. Env: `admin/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable key).
  3. Google sign-in on localhost needs `http://localhost:5174/**` in Supabase Auth → Redirect URLs.
- **Backend:** `cd backend && npm run dev` (port 4000). It needs:
  - `ADMIN_EMAILS` including your Google email;
  - `ANALYTICS_DATABASE_URL`: preferably a local Postgres built from the migrations. A localhost URL skips TLS. Point at production only for read-only debugging; the role is execute-only.
  - `CORS_ALLOWED_ORIGINS` including `http://localhost:5174`. The browser sends `Origin: http://localhost:5174` on POST/PATCH/DELETE even through the Vite proxy, and development mode only auto-allows `:5173` and `:3000`, so without it user lookups, drill-downs, alerts and Recompute get 403 while charts work.
- **Local database:** copy `backend/scripts/verify-privacy-sql.sh` to a scratch directory, remove the test files at the end and the cleanup trap, and run it with `PRIVACY_TEST_PG_PORT=<free port>`. That gives a Postgres with every migration applied. Then `alter role analytics_api password '…'` and seed fixtures.
- **Typecheck dependency:** backend typecheck and tests import `frontend/src`, so run `cd frontend && npm ci --ignore-scripts` once.

## 4. Tests and checks (run all before shipping)
```bash
cd backend && npm run typecheck && npm test           # ~1000 tests
cd backend && npm run test:privacy-sql                 # all SQL suites incl. analytics-*.sql (needs initdb/pg_ctl/psql 17 on PATH)
cd admin && npm test && npm run build                  # build = tsc + vite
```
- **CI:** `.github/workflows/ci.yml` runs the admin (`admin/**`), backend (`backend/**`, `frontend/**`) and sql (`backend/supabase/**`, `backend/tests/sql/**`, `backend/scripts/**`) jobs; a change to the workflow file, or a manual `workflow_dispatch`, runs all three. It runs on pushes to `main` and on PRs.
- **Known flake:** a supertest test in `admin-analytics.integration.test.ts` can fail roughly 1 in 20 under full-suite load (socket reuse). Re-run before investigating.
- **Production contract check:** `select * from analytics_private.contract_violations();` must return 0 rows. It is also shown on the Data health page.

## 5. Invariants: never break these
1. **Function contract.** Every `analytics.*` function has the standard signature `(p_from date, p_to date, p_grain text, p_currency text, p_include_internal boolean, p_breakdown text, p_filters jsonb)`. Every `analytics_people.*` function has `(p_user_id uuid, p_query text, p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)`. Both are `stable security definer set search_path = ''`, fully schema-qualified, with no overloads.
2. **Metric meta.** Each metric carries a `comment on function` with MetricMeta JSON: `title`, `definition`, `unit`, `shape`, `breakdowns`, `filters`, `kb`, and **`measures` for every numeric column**. Display keys (`plot`, `stacked`, `flag_column`, `breakdown_dimension`, `drill`, `precomputed`, `alertable`, `min_group`, `ignores_filters`) are listed in api-contract.md.
3. **Revoke at the end.** Every analytics migration ends with `revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;`. Per-schema default privileges cannot remove PUBLIC; the contract check catches it if you forget.
4. **`analytics_api` stays execute-only.** No table grants, no role memberships, no BYPASSRLS. Helpers and materialized views live in `analytics_private`, which it cannot use.
5. **Argument validation.** Validate with `analytics_private.assert_args` (or equivalent) and raise SQLSTATE `22023` for bad arguments, which the API returns as 400. Use `resolve_range` for the default and maximum range.
6. **Population:**
   - Users come from `analytics_private.analysis_users`, which excludes pending deletion and restricted processing.
   - Internal accounts are excluded unless `p_include_internal`.
   - Erased users' invoices (`user_id` null) still count as revenue.
   - Everything is bucketed in UTC.
7. **Money:**
   - Three currency variants: `native` (split USD/TRY), `usd`, `try`.
   - Monthly FX comes from `analytics_private.fx_months`. A rate is provisional if it's missing, not final, or borrowed from an earlier month; a missing rate gives null plus provisional.
   - AI cost is USD; `try` converts it.
   - Prices come from tables (`billing_price_catalog`, `ai_model_prices`), never literals.
8. **Consent:** metrics built on `user_activity_days`, per-user `entitlement_denials` or onboarding answers are `consent_scoped: true`.
9. **People privacy:**
   - Only metadata: no CV, job, cover-letter, AI prompt/response, file name or free text.
   - Error text only through `safe_error_message`.
   - Every `analytics_people` function calls `analytics_private.assert_audited(...)` first.
   - The backend writes `admin_app.log_access(...)` in the same transaction.
   - Search text is never stored or logged; the database stores an HMAC.
10. **Applied migrations are immutable.** Change things with a **new** migration (`create or replace`). If a function's return type changes, `drop function` and recreate it; default privileges re-grant `analytics_api`, and you must repeat the final revoke. A dropped function loses its comment, and `comment on function` replaces the whole MetricMeta: carry over `"drill": true` (and anything else) when you re-comment a metric, and re-run `refresh_drill_metrics()` after re-commenting `drill_users`.
11. **KB traceability.** Each ported query's KB file gets a `Dashboard function: \`analytics.<name>\`` line; a deviating definition gets a "Dashboard definition" note.

## 6. Recipes

### Add a metric
1. **Read the definition.** Read the KB source plus `new_analysis/README.md` (standard filters, eras, cost and revenue rules).
2. **Write it.** New migration `2026MMDDHHMMSS_analytics_<topic>.sql`. Copy the closest existing metric of the same shape (inventory → migration). Reuse the shared views (`invoice_revenue`, `run_cost`, `mrr_invoices`, `feature_events`) and set-returning helpers (`ai_run_scope`, `tailoring_v2_sessions`, `signup_activation`, `fx_months`) in `analytics_private` instead of re-deriving. End with the final revoke (invariant 3).
3. **Test it.** Add `backend/tests/sql/analytics-<topic>.sql` (fixtures + exact asserts + `contract_violations()` = 0; wrap it in `begin; … rollback;` like the others) and add a `-f` line for it at the end of `backend/scripts/verify-privacy-sql.sh`, which does not glob.
4. **Check performance.** Run `EXPLAIN (ANALYZE)` on bulk fixtures. The role timeout is 15 s; keep 1-year calls under about 3 s.
5. **Show it.** Add `{ name, title, shape }` to a section in `admin/src/app/pages.ts`. The card renders from the catalog, and shows "Not available yet" until the migration is applied (the backend caches the catalog for 60 s). Currency metrics usually need a card option: `native: "split"` when `native` returns one row per invoice currency in `dimension` and rejects breakdowns (like `revenue`), `native: "usd"` for USD-by-nature amounts (AI cost), and `badges: fxBadges` when there is an `fx_provisional` column. Then update the per-page metric counts in `admin/src/app/nav.test.ts` (and the "Not available yet" counts in `pages/MetricsPage.test.tsx` for Monetization) and run `cd admin && npm test`.
6. **Document it.** Add the KB `Dashboard function:` line, and update [metrics-inventory.md](metrics-inventory.md).

### Add a drill-down for a metric
1. **Write the function:** `analytics_private.drill_<key>(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text) returns table(user_id uuid, value numeric, detail jsonb, sort_key text) language … stable set search_path = ''` (the contract check requires the empty search_path in `analytics_private` too). Validate keys with `analytics_private.assert_filter_keys(p_filters, array[…])` and read them with `filter_values`. Return one row per user, unpaged; `drill_users` applies privacy, `include_internal`, ordering and paging (full convention: api-contract.md "Drill-down"). `detail` holds metadata only.
2. **Comment it** with JSON: `metric` (the `analytics.<metric>` it drills; the UI resolves the key through it), `filters` (the UI reads it to decide whether to send `grain`), `description`, plus `value`, `unit`, `order`, `detail` by convention.
3. **Publish it.** Merge `"drill": true` into the metric's comment, then end the migration with `select analytics_private.refresh_drill_metrics();` and the final revoke. The engagement SQL test fails if a metric has `drill: true` but no key names it.
4. **Accept the UI's filter keys.** The drawer always sends `p_from`/`p_to` (the clicked bucket's days clamped to the page range, or the page range for breakdowns, funnels and cohorts), never `day` or `include_internal`, plus every page filter the metric accepts (`meta.filters`), so the key must accept all of those. On top:
   - funnels send `step` (and the funnel's `dimension` value under the breakdown dimension);
   - cohorts send `cohort` and `period`, plus `grain` when the key's `filters` lists it;
   - breakdowns send the bar's value under `breakdown_dimension`, or under `dimension` when there is none;
   - timeseries send the clicked series' value under the page breakdown, if any.
5. **Test it** in the SQL test: call `admin_app.log_access(…, 'people.drill_users', …)` first in the same transaction, then `analytics_people.drill_users(p_filters => '{"metric":"<key>", …}')`.

### Add a user-level (people) function
Use the people signature. Call `analytics_private.assert_audited('<fn>', p_user_id)` first, keep to metadata only (error text via `safe_error_message`), add keyset `cursor`, and add a MetricMeta comment with shape `table` and `filter_keys`. The endpoint `POST /admin/people/:name` serves it with no backend change. In the admin app, add the name to `PEOPLE_FUNCTIONS` in `lib/people.ts`, then add a page or component.

### Make a metric alertable
Shape `kpi` (one row) and `"alertable": true`. Rules reference one numeric column. Thresholds are stored in the column's unit; ratios as 0–1; `pct_change_*` as signed fractions.

### Add a precomputed (materialized-view) metric
1. Create the MV in `analytics_private` with a **plain unique index**, so `REFRESH … CONCURRENTLY` works.
2. Have the function read the MV and re-apply the privacy and internal filters on every call.
3. Set `"precomputed": true`.

`refresh_all` discovers MVs in `analytics_private` automatically.

### Add a filter or breakdown dimension
1. **Backend:** add it to the `Dimension` enum in `admin-analytics.contract.ts`.
2. **Admin app:** add it to `DIMENSIONS` in `admin/src/lib/filters.ts` (unknown dimensions are silently dropped from catalog meta) and a label in `DIMENSION_LABELS` in `lib/format.ts`.
3. **Docs:** add it to api-contract.md.
4. **SQL:** list it in each metric's `breakdowns`/`filters`, and handle it via `filter_values`.

### Add an admin page
Add a `pages.ts` entry for a metrics page, or a component in `pages/` plus a route in `App.tsx` and an entry in `nav.ts`.

### Add a backend endpoint
1. Add it to `admin-analytics.routes.ts` with the existing middleware chain, plus a controller method; add service and repository methods (and the `AdminAnalyticsRepository` interface entry, which the integration test's fake repository implements).
2. Validate input with zod in a contract file.
3. Add SQL access through a `SECURITY DEFINER` function in `admin_app`, executable by `analytics_api` and audited in the same transaction for writes.
4. Add integration tests.

### Grant someone access
Follow [runbook.md](runbook.md): add their email to `ADMIN_EMAILS`, then redeploy the backend.

## 7. Lessons learned (each of these bit us)
1. **`set statement_timeout` inside a function doesn't limit the statement that called it.** Limits live on the role (`analytics_api` has 15 s), or in the cron job command (`set statement_timeout = '10min'; select …`).
2. **`alter default privileges in schema X revoke … from public` does nothing.** Hence the explicit final revoke in every migration, plus the contract check.
3. **`exception when others` doesn't catch `query_canceled` (57014).** Use `when others or query_canceled` wherever a failure must be recorded.
4. **jsonb reorders object keys** (shortest first). Never rely on key order in `meta.measures`; the UI takes the primary measure from the row's column order.
5. **The `/api` rewrite still sends `Origin`.** Browsers send `Origin` on same-origin POST/PATCH/DELETE (not GET), and Vercel's rewrite forwards it. The admin origin must be in the backend's `CORS_ALLOWED_ORIGINS`. Missing it made every POST fail while GET charts worked.
6. **`supabase db push` applies every pending local migration.** Never push while unfinished migrations are in the working tree; see the deploy procedure.
7. **Vercel Hobby logs:** runtime logs are kept for about 1 hour, and pino `level: 50` lines show up as "info". Search logs by text (`INTERNAL_ERROR`, a route) rather than by level.
8. **CI and the backend typecheck need frontend dependencies** (shared code is imported from `frontend/src`).
9. **`REFRESH MATERIALIZED VIEW CONCURRENTLY` needs a plain unique index, and holds ACCESS SHARE locks on the source tables** until commit. `refresh_all` sets `lock_timeout = 5s`, so deploy-time DDL never queues behind it.
10. **Refresh state:** the run state `running` is never visible to other sessions (the refresh is one transaction). Pollers see `pending`, then `done` or `failed`.
11. **Supabase specifics:**
    - The analytics schemas are *not* exposed to the Data API. Don't add them to `[api].schemas`.
    - pgcrypto lives in schema `extensions`.
    - The pooler user format is `analytics_api.<project_ref>` on port 6543.
12. **Admin identity:** password sessions are never admins (only Google: `amr` oauth + Google identity), even with an allow-listed email. `ADMIN_EMAILS` changes need a backend redeploy.
13. **npm lockfiles:** npm 10 can crash building a fresh `admin` lockfile ("edgesOut"). Generate it with `npx npm@11 install`; `npm ci` with npm 10 is fine.

## 8. Shipping
Deploy order is always **migration → backend → admin**. A push to `main` auto-deploys each Vercel project whose folder changed: backend ignores `supabase/` and `tests/`, frontend and admin ignore everything outside their folder. CI (GitHub Actions) does not gate deploys, so run the checks first.

1. Commit only finished work, and verify on a clean checkout:
   ```bash
   git worktree add /tmp/deploy-wt HEAD && cp -R backend/supabase/.temp /tmp/deploy-wt/backend/supabase/
   (cd /tmp/deploy-wt/frontend && npm ci --ignore-scripts) && (cd /tmp/deploy-wt/backend && npm ci && npm run typecheck && npm test && npm run test:privacy-sql)
   (cd /tmp/deploy-wt/admin && npm ci && npm test && npm run build)
   ```
2. Push migrations from that worktree: `cd /tmp/deploy-wt/backend && npx supabase db push --linked --dry-run`, review the list, then run it again with `--yes`.
3. Check production (Supabase SQL editor or MCP, read-only): `select * from analytics_private.contract_violations();` returns 0 rows, and the new function appears in `admin_app.metric_catalog()`.
4. Push code: `git push origin <sha>:main` (fast-forward). Remove the worktree.
5. Verify: the admin site loads the new cards, there are no `INTERNAL_ERROR` lines in backend logs, and `/api/v1/ready` is 200. If you changed precomputed objects, run `select analytics_private.refresh_all('manual');`.

## 9. Current state and backlog
**Status:** v1 (Phases 0–5) is live since 2026-10-28.

**Open items:**
- Prices for `gpt-5.6-luna` and the Gemini models are missing from `AI_MODEL_PRICING_JSON`, so their AI cost is a lower bound.
- Bumping the privacy `NOTICE_VERSION` for the "Staff access" section is the owner's decision.
- GitHub Actions use Node 20-based action versions (deprecation warning); bump `actions/checkout` and `dorny/paths-filter` when convenient.

**v2 scope** (agreed with the product owner):
- Instagram and TikTok analytics with a creator role (creators connect accounts and see only their own stats).
- Email delivery for alerts, and scheduled email reports (needs an email provider).

**Known small gaps:**
- The drill drawer never forwards the page's `include_internal`, so drill lists always exclude admin accounts. The drill filters `outcome` (trial_conversions) and `reason_group` (churned_subscribers) are supported in SQL but not sent by the UI.
- The backend `MetricMeta` TypeScript interface (`admin-analytics.contract.ts`) lists only the core keys; display keys pass through untyped.

**Ideas not built:**
- Server error and crash log in the user timeline.
- `pg_trgm` index for email "contains" search.
- Shared zod contract package between `backend/` and `admin/`.
- Dimensions `task_kind`, `card_kind`, `language`, `onboarding_goal|career|education` for click-filtering mixed-driver breakdowns.
- Read replica for analytics if load ever matters (change `ANALYTICS_DATABASE_URL` only).

## 10. Keeping these docs true
When you change the dashboard, update in the same commit:
- [metrics-inventory.md](metrics-inventory.md) for any metric, people function or drill key;
- [api-contract.md](api-contract.md) for interface changes;
- [runbook.md](runbook.md) for operational changes;
- this file for new conventions or lessons;
- the KB file of any ported query.
