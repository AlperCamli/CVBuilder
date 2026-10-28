# Admin Analytics — Runbook

Operational tasks for `admin.jobspecificcv.com`. Design: [architecture.md](architecture.md); contracts: [api-contract.md](api-contract.md); metrics: [metrics-plan.md](metrics-plan.md).

## Where things live

| Part | Location | Deploys |
|---|---|---|
| Admin app | `admin/` → Vercel project `cv-builder-admin` | Push to `main` that touches `admin/` |
| Admin API | `backend/src/modules/admin-analytics/` → Vercel project `cv-builder-backend` (region `fra1`) | Push to `main` that touches `backend/` (migrations and tests don't trigger a build) |
| Metric SQL | `backend/supabase/migrations/2026103*–2026110*_analytics_*.sql` | `cd backend && npx supabase db push --linked` **before** pushing code |
| SQL tests | `backend/tests/sql/analytics-*.sql` | `cd backend && npm run test:privacy-sql` (temporary local Postgres) |
| Definitions | KB `cv-data-model-kb/CV_data_tool`; each ported file has a `Dashboard function:` line | — |

**Deploy order:** migration → backend → admin app.

**CI:** `.github/workflows/ci.yml` runs only the jobs for the folders a push changed.

## Give someone access
1. Add their Google email to `ADMIN_EMAILS` in the `cv-builder-backend` Vercel project (Production), comma-separated.
2. Redeploy the backend (Vercel → Deployments → Redeploy) so the new value is loaded.
3. They sign in at https://admin.jobspecificcv.com **with Google**. Password sessions are never admins, even with an allow-listed email.
4. The nightly refresh (03:30 UTC) flags their product account as internal, case-insensitively, so it is excluded from metrics.

**To remove access:** delete the email and redeploy. Their existing sessions lose access on the next request.

## Add a metric
1. **Write the SQL.** Add a migration with an `analytics.<name>` function that follows the "SQL function contract" in api-contract.md:
   - standard signature, `stable security definer set search_path = ''`;
   - a MetricMeta JSON comment with `measures` for every numeric column;
   - end the migration with `revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;`.
2. **Test it.** Add `backend/tests/sql/analytics-<area>.sql` with fixtures, register it in `backend/scripts/verify-privacy-sql.sh`, and run `npm run test:privacy-sql`. The contract check fails the run if the signature, grants or comment are wrong.
3. **Document it.** Add a `Dashboard function:` line to the KB file it ports, plus a "Dashboard definition" note if it deviates.
4. **Ship it.** Push the migration, then list the metric name on a page in `admin/src/app/pages.ts`. Until the migration is applied, the card shows "Not available yet". No backend change is needed.
5. **Optional drill-down:** add `analytics_private.drill_<key>(p_from, p_to, p_filters, p_limit, p_cursor)`, set `"drill": true` on the metric, and call `analytics_private.refresh_drill_metrics()` at the end of the migration.

## Refreshes, recompute and scheduled jobs
- **Jobs:** `pg_cron` runs inside the database:

  | Job | Schedule (UTC) | Command |
  |---|---|---|
  | `analytics_nightly` | 03:45 | `analytics_private.refresh_all('nightly')`: rebuilds the materialized views |
  | `analytics_recompute_queue` | every minute | `analytics_private.process_recompute_queue()` |
  | `analytics_alerts` | hourly at :05 | `analytics_private.evaluate_alerts()` |

- **Inspect jobs:** `select jobname, schedule, active from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 20;` (SQL editor).
- **Recompute button:** queues a run and is throttled to once every 5 minutes, enforced in the database. Status is shown on **Data health**.
- **Manual rebuild:** `select analytics_private.refresh_all('manual');` in the SQL editor. Failures are recorded in `admin_app.refresh_runs.error`; nothing is raised.
- **Before the analytics jobs:** the 03:30 Vercel cron `/api/v1/billing/analytics/refresh` refreshes FX rates, the price and plan catalogs, `ai_model_prices` and internal-account flags first.

## AI model prices
AI cost is exact from 2026-10-27, when `ai_runs.cost_usd` starts being filled. Older runs are re-priced from tokens using `public.ai_model_prices`, which the 03:30 refresh fills from the backend env `AI_MODEL_PRICING_JSON`:
```json
{"gpt-6-luna":{"input":0.10,"cached_input":0.01,"output":0.50},"gpt-5.6-luna":{"input":…,"output":…}}
```
- Prices are USD per 1M tokens. Keys are model-name prefixes; the longest match wins.
- Models without a price count as **unpriced runs**, so AI cost is a lower bound. Data health lists unpriced runs per model.
- An empty `AI_MODEL_PRICING_JSON` never wipes stored prices; the refresh reports a failure instead.

## Rotate the `analytics_api` password
1. Generate a new password: `openssl rand -hex 32`.
2. In the SQL editor: `alter role analytics_api with password '<new>';`
3. Update `ANALYTICS_DATABASE_URL` in `cv-builder-backend` (Production) to `postgresql://analytics_api.brgzizrnwsqnvjtvfbbs:<new>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`, then redeploy.

In the gap between steps 2 and 3, the dashboard returns `503 ANALYTICS_UNAVAILABLE`. The product is unaffected.

## Troubleshooting

| Symptom | Likely cause / check |
|---|---|
| Writes and user lookups fail with 403 `FORBIDDEN` ("Origin not allowed") while charts work | The admin origin is missing from `CORS_ALLOWED_ORIGINS` on `cv-builder-backend`. It must include `https://admin.jobspecificcv.com`; add it, then redeploy the backend. |
| Cards show "Analytics unavailable" (503) | `ANALYTICS_DATABASE_URL` missing or wrong, wrong password, or pooler issue. Check backend runtime logs for `admin-analytics` entries; they log the error code without the connection string. |
| 504 on a chart | A query hit the 15 s role timeout. Narrow the range or use a coarser grain (day grain is capped at 366 days for MRR movement). |
| "No access" for an admin | Not signed in with Google, email not in `ADMIN_EMAILS`, or the backend wasn't redeployed after the change. |
| Numbers differ from a KB query | Check the function comment's `definition` and the KB file's "Dashboard definition" note. The dashboard uses UTC, excludes internal, restricted and pending-deletion accounts, and uses `analysis_users`. |
| Contract violations > 0 on Data health | A migration forgot the final `revoke … from public` or a grant leaked. Run `select * from analytics_private.contract_violations();`. |
| Precomputed metrics stale | Check `analytics_nightly` in `cron.job_run_details` and `admin_app.refresh_runs`; trigger Recompute. |

## Privacy guarantees (keep them when changing code)
- User-level reads go only through `analytics_people.*`. Each read requires an audit row written in the same transaction (`admin_app.log_access`); the database refuses the read without it.
- The timeline and summary carry metadata only, never CV, job, cover-letter, AI or file content. Error text passes only through the `analytics_private.safe_error_message` allow-list.
- Search text is never stored or logged. Only a peppered HMAC is kept, and the pepper never leaves the database.
- The audit log is append-only; erasing a user nulls `target_user_id`.
