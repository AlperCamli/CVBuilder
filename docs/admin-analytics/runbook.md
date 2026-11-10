# Admin Analytics — Runbook

Operational tasks for `admin.jobspecificcv.com`. Design: [architecture.md](architecture.md); contracts: [api-contract.md](api-contract.md); metrics: [metrics-inventory.md](metrics-inventory.md).

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
5. **Optional drill-down:** add `analytics_private.drill_<key>(p_from, p_to, p_filters, p_limit, p_cursor)`, set `"drill": true` on the metric, and call `analytics_private.refresh_drill_metrics()` at the end of the migration (full recipe: development.md §6).

## Refreshes, recompute and scheduled jobs
- **Jobs:** `pg_cron` runs inside the database:

  | Job | Schedule (UTC) | Command |
  |---|---|---|
  | `analytics_nightly` | 03:45 | `analytics_private.refresh_all('nightly')`: rebuilds the materialized views |
  | `analytics_recompute_queue` | every minute | `analytics_private.process_recompute_queue()` |
  | `analytics_alerts` | hourly at :05 | `analytics_private.evaluate_alerts()` |
  | `analytics_cron_history_purge` | 04:20 | deletes `cron.job_run_details` rows of `analytics_*` jobs older than 7 days |

- **Inspect jobs:** `select jobname, schedule, active from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 20;` (SQL editor).
- **Recompute button:** queues a run and is throttled to once every 5 minutes, enforced in the database. Status is shown on **Data health**.
- **Manual rebuild:** `select analytics_private.refresh_all('manual');` in the SQL editor. Failures are recorded in `admin_app.refresh_runs.error`; nothing is raised.
- **Before the analytics jobs:** the 03:30 Vercel cron `/api/v1/billing/analytics/refresh` refreshes FX rates, the price and plan catalogs, `ai_model_prices` and internal-account flags first.

## AI model prices
AI cost is exact from 2026-10-27, when `ai_runs.cost_usd` starts being filled. Older runs are re-priced from tokens using `public.ai_model_prices`, which the 03:30 refresh fills from the backend env `AI_MODEL_PRICING_JSON` (the current value is in `backend/.env.example`):
```json
{"gpt-6-luna":{"input":0.10,"cached_input":0.01,"cache_write":0.125,"output":0.50},"gpt-5.6-luna":{"input":0.20,"cached_input":0.02,"cache_write":0.25,"output":1.20}}
```
- Prices are USD per 1M tokens. Keys are model-name prefixes; the longest match wins. `cached_input` is the cache-read rate and `cache_write` the prompt-cache write rate (OpenAI GPT-5.6 and later, Anthropic); both default to `input`.
- Models without a price count as **unpriced runs**, so AI cost is a lower bound. Data health lists unpriced runs per model, and the backend logs `AI_MODEL_PRICE_MISSING` at startup when the active provider's light or heavy model has no price.
- After syncing the prices the refresh calls `public.backfill_ai_run_cost_estimates()`: runs with tokens but no `cost_usd` whose model is now priced get the re-priced cost stored, flagged `ai_runs.cost_usd_estimated` (never counted as exact). Runs of accounts pending deletion or restricted are skipped and stay re-priced at read time. Run it by hand after a price change with `select public.backfill_ai_run_cost_estimates();` (service role).
- An empty `AI_MODEL_PRICING_JSON` never wipes stored prices; the refresh reports a failure instead.
- There is no price history: a changed price re-prices every run without a stored cost. Runs with a stored `cost_usd` keep the price of when they ran.

## AI usage ledger (`public.ai_usage_events`)
- **What it is:** one append-only row per provider HTTP attempt (retries, timeouts, errors, refusals, model fallbacks), written by the backend's providers (`source = app`), scripts (`script`, e.g. `scripts/compare-cv-review.ts`) and test runs (`test`), with `environment = APP_ENV`. No prompts or payloads. `ai_run_id` / `user_id` are set null when the run or account is deleted, so the cost survives guest cleanup and erasure.
- **Where it shows:** AI cost page → "AI spend (all provider attempts)" (`analytics.ai_spend`); Data health → "AI usage ledger health". Compare `ai_spend` with all segments to the provider bill.
- **Scripts write to whatever `SUPABASE_URL` points at.** `backend/.env.local` points at production, so a local script run lands in the production ledger as segment `script` (environment `development`); the local backend's own app attempts are tagged `environment = development`.
- **A sink failure never breaks an AI call:** each attempt waits at most 2 s for its insert and logs `AI_USAGE_EVENT_NOT_RECORDED` on failure. Data health's `ai_runs_without_attempts` shows runs whose attempts went missing.
- **Before the ledger** (the first production app attempt), `ai_spend` falls back to the surviving `ai_runs`; deleted guest runs, retries and script calls before then are not recoverable.

## Privacy cleanup alerts
Added after the 2026-11-10 incident (three account deletions failed every night from 2026-11-04, guest uploads paused after 30 hours, and nobody noticed for five and a half days). Migration `20261113140000_privacy_cleanup_alert.sql` adds the alertable metric `analytics.privacy_cleanup_health` and seeds two enabled rules on it. The hourly `analytics_alerts` job (:05 UTC) checks them against the current state of the daily cleanup: the Vercel cron `/api/v1/guest-imports/cleanup` at 03:00 UTC, which runs `PrivacyService.runCleanup()`.

| Rule | Fires when | Cooldown | Severity |
|---|---|---|---|
| **Privacy cleanup unhealthy** | `cleanup_unhealthy > 0`, i.e. any of: the last run reported failures (`privacy_cleanup_health.failures > 0`); the last run did not finish (`last_attempt_at` is newer than `last_success_at` and more than 15 minutes old); no successful run for more than 24 hours; no run attempted for more than 26 hours (the cron is not firing). With no success ever, the age counts from `initialized_at`. | 24 h | normal |
| **Account deletion overdue** | `deletions_overdue > 0`: an account-deletion job (`privacy_jobs.kind = 'deletion'`, status `pending` or `working`) was created more than 24 hours ago. Erasure is a legal obligation. | 12 h | **High** (red "High severity" pill; the message starts with `[High severity]`) |

**Where the owner sees it:** the bell in the header shows the count of open alerts on every page, Overview shows the "N open alerts" banner, and **Alerts** lists each event with the full message. The rules appear under Alerts → Rules, where they can be edited or disabled. Nothing is sent outside the dashboard (v1 is in-app only), so the owner has to open the dashboard to see an alert.

**When it fires:**
- A failed 03:00 run is caught by the next hourly check (on Vercel Hobby the cron can start anywhere between 03:00 and 03:59, so by 05:05 UTC at the latest).
- A cron that stops firing is caught 26 to 27 hours after the last attempt, before the 30-hour upload pause.
- An overdue deletion is caught within an hour of its 24th hour.
- **Acknowledging does not silence it.** While the condition still holds, the rule fires again after its cooldown (every 24 h, or every 12 h for deletions). It stops once the cause is fixed.

**The message:** what is wrong, the last run and last success (UTC, hours ago), whether uploads are paused or how soon they will be, then the overdue deletions: count, oldest age, steps, highest attempt count and next retry. It ends with the guest-upload backlog and where to look. It never contains user, auth or job ids, emails, file paths or manifests. Example:
`[High severity] Account deletion overdue: Account deletions pending over 24 h is 3, above 0. Cleanup unhealthy: the last run reported 3 failures; no successful run for 150.0 h. Last run 2026-11-10 03:00 UTC (2.0 h ago); last success 2026-11-04 03:00 UTC (150.0 h ago). Guest uploads are paused (503) until a run succeeds. 3 account deletions pending over 24 h, oldest 150.0 h; steps: database 3; attempts up to 6; next retry 2026-11-11 03:00 UTC. …`

**What to do:**
1. **Find the stuck step** (Supabase SQL editor, read-only). Select only these columns: `manifest` holds the user's storage paths.
   ```sql
   select * from public.privacy_cleanup_health;
   select kind, status, step, attempts, retry_at, lease_until, created_at,
          round(extract(epoch from now() - created_at) / 3600, 1) as age_hours,
          manifest ->> 'billing_cursor' as billing_cursor, manifest ->> 'storage_cursor' as storage_cursor,
          manifest ->> 'database_cursor' as database_cursor
   from public.privacy_jobs where status <> 'complete' order by created_at;
   ```
   The steps run in this order (`privacy.service.ts`, `erase`):
   - `start`/`inventory`: list the user's storage objects;
   - `billing`: cancel Stripe subscriptions;
   - `storage`: remove the objects;
   - `database`: delete rows table by table. `database_cursor` is the index of the next table in the `tables` list there; `0` = `cover_letter_exports`;
   - `auth`: delete the Supabase auth user;
   - `upload_guard`: wait 2 h 5 min, then remove late uploads;
   - complete.
2. **Find the last error.** `privacy_jobs` has no error column, and the job's error is not logged either: `PRIVACY_JOB_RETRY` carries only the job kind. Vercel Hobby keeps runtime logs for about an hour. The step tells you which part fails. To see a failure live:
   - open Vercel → `cv-builder-backend` → Logs and search `PRIVACY_` (`PRIVACY_JOB_RETRY`, `PRIVACY_CLEANUP_FAILURE`, `PRIVACY_CLEANUP_FAILED`, `PRIVACY_CLEANUP_OVERDUE`) and `Request failed`;
   - then do step 3.
3. **Re-run the cleanup:** Vercel → `cv-builder-backend` → Settings → Cron Jobs → `/api/v1/guest-imports/cleanup` → Run.
   - A job is only retried once its `retry_at` has passed; until then the run skips it. The backoff is at most about 17 hours, so every failing job is due again by the next nightly run. Setting `retry_at = now()` on a job makes it due at once, but that is a production write: make it deliberately.
   - A clean run sets `last_success_at` and `failures = 0`. The cleanup rule stops firing at the next hourly check, and the 503 upload pause lifts at once.
   - Then fix the cause, deploy, and run it again.
4. **Close it:** acknowledge the events on Alerts once the deletions show `status = 'complete'` and the cleanup row is healthy.

**Known benign cases:**
- **A late Hobby cron.** It can start any time in the scheduled hour. If today's run starts more than about 5 minutes later in the hour than yesterday's, the 03:05 check sees just over 24 hours since the last success, and "Privacy cleanup unhealthy" fires with `no successful run for 24.1 h` and `failures = 0`. It clears at the next check after the run. If this keeps happening, raise the 24-hour constant in `analytics.privacy_cleanup_health` to 25 with a new migration; 25 still fires before the 30-hour pause.
- **A deletion requested between about 00:55 and 03:00 UTC.** Its `upload_guard` wait ends after that night's run, so it completes at the next night's run, 25 to 26 hours after the request. "Account deletion overdue" fires once, with step `upload_guard` and no failures. That is the designed wait, not a failure.

## Free trial on Monthly (from 2026-11-05)
The 3-day free trial moved from the Weekly to the Monthly plan. No migration was needed: the metrics, `trial_outcomes` and `public.trial_reminder_queue` read each subscription's own plan, price and interval (era note in [metrics-inventory.md](metrics-inventory.md#data-eras)). After the backend deploy:
1. **Plan catalog.** `public.billing_plan_catalog` is a nightly snapshot of the code's plan list, so until the next 03:30 UTC refresh it still says `weekly` has the trial. No metric reads `trial_supported`, so waiting is harmless; to flip it at once, run the cron from Vercel (`cv-builder-backend` → Settings → Cron Jobs → `/api/v1/billing/analytics/refresh` → Run). Check: `select plan_code, trial_supported, trial_days from public.billing_plan_catalog order by plan_code;` shows `monthly` true / 3 and `weekly` false / 0.
2. **First monthly trial.** Once one exists, check that it was detected and that nothing trialing lacks `trial_start` (the trial rule needs it for any plan with Stripe detail):
   ```sql
   select plan_code, outcome_group, count(*) from analytics_private.trial_outcomes where t_start >= '2026-11-05' group by 1, 2;
   select count(*) from public.subscriptions where status = 'trialing' and trial_start is null;  -- 0
   select plan_code, billing_interval, unit_amount, price_display, category from public.trial_reminder_queue order by sort_order;  -- no emails or names
   ```
3. **Legacy weekly trials** started before the switch keep converting to Weekly; they all end within 3 days. Their rows show `plan_code = weekly` everywhere, which is correct.

## Rotate the `analytics_api` password
1. Generate a new password: `openssl rand -hex 32`.
2. In the SQL editor: `alter role analytics_api with password '<new>';`
3. Update `ANALYTICS_DATABASE_URL` in `cv-builder-backend` (Production) to `postgresql://analytics_api.brgzizrnwsqnvjtvfbbs:<new>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`, then redeploy.

In the gap between steps 2 and 3, the dashboard returns `503 ANALYTICS_UNAVAILABLE`. The product is unaffected.

## Troubleshooting

| Symptom | Likely cause / check |
|---|---|
| Writes and user lookups fail with 403 `FORBIDDEN` ("Origin not allowed") while charts work | The admin origin is missing from `CORS_ALLOWED_ORIGINS` on `cv-builder-backend`. It must include `https://admin.jobspecificcv.com`; add it, then redeploy the backend. |
| Cards show "Analytics unavailable" (503) | `ANALYTICS_DATABASE_URL` missing or wrong, wrong password, or pooler issue. Check backend runtime logs for `Request failed` lines with `area: "admin"`; they carry the route, error name, code and message, never the connection string. |
| 504 on a chart | A query hit the 15 s role timeout. Narrow the range or use a coarser grain (day grain is capped at 366 days for MRR movement). |
| "No access" for an admin | Not signed in with Google, email not in `ADMIN_EMAILS`, or the backend wasn't redeployed after the change. |
| Numbers differ from a KB query | Check the function comment's `definition` and the KB file's "Dashboard definition" note. The dashboard uses UTC, excludes internal, restricted and pending-deletion accounts, and uses `analysis_users`. |
| Contract violations > 0 on Data health | A migration forgot the final `revoke … from public` or a grant leaked. Run `select * from analytics_private.contract_violations();`. |
| Precomputed metrics stale | Check `analytics_nightly` in `cron.job_run_details` and `admin_app.refresh_runs`; trigger Recompute. |
| "Privacy cleanup unhealthy" or "Account deletion overdue" alert | Follow [Privacy cleanup alerts](#privacy-cleanup-alerts): find the stuck step in `public.privacy_jobs`, watch the logs, re-run the cron from Vercel → `cv-builder-backend` → Settings → Cron Jobs. |

## Privacy guarantees (keep them when changing code)
- User-level reads go only through `analytics_people.*`. Each read requires an audit row written in the same transaction (`admin_app.log_access`); the database refuses the read without it.
- The timeline and summary carry metadata only, never CV, job, cover-letter, AI or file content. Error text passes only through the `analytics_private.safe_error_message` allow-list.
- Search text is never stored or logged. Only a peppered HMAC is kept, and the pepper never leaves the database.
- The audit log is append-only; erasing a user nulls `target_user_id`.
