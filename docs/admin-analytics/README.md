# Admin Analytics — Start here

Internal analytics dashboard for the CV Builder team at **https://admin.jobspecificcv.com**. Admins sign in with Google. It reads the production Supabase database directly; there is no data warehouse. v1 has been live since 2026-10-28.

## Read in this order
| # | Document | Use it for |
|---|---|---|
| 1 | [development.md](development.md) | **Making any change.** Code map, local setup, tests, invariants, recipes (add a metric, drill-down, people function, alert, page), lessons learned, deploy procedure, backlog |
| 2 | [metrics-inventory.md](metrics-inventory.md) | What is deployed: every metric and people function, its columns, filters and flags, its admin page, and the drill keys |
| 3 | [api-contract.md](api-contract.md) | Exact interfaces: HTTP endpoints, SQL function contract, MetricMeta keys, row shapes, currency/FX rules, people/audit rules, alerts and recompute |
| 4 | [architecture.md](architecture.md) | Why it is built this way: schemas, `analytics_api` role, security model, scheduling, caching, threat table |
| 5 | [requirements.md](requirements.md) | What the app must and must not do (v1 scope, out-of-scope list, non-functional targets) |
| 6 | [runbook.md](runbook.md) | Operations: add admins, Recompute, model prices, password rotation, troubleshooting |
| – | [metrics-plan.md](metrics-plan.md) | Historical: the original phase plan and KB sources. Use the inventory for what actually shipped |

Also useful:
- **`admin/README.md`:** admin app local dev and UI conventions.
- **KB:** `/Users/alpercamli/Desktop/cv-data-model-kb/CV_data_tool`. The source of every metric definition; ported queries carry a `Dashboard function:` line, and the new tables are documented under `tables/ai_model_prices.md` and `admin_app/`.

## Facts at a glance
- **Parts:**
  - `admin/` (Vite/React, Vercel project `cv-builder-admin`)
  - `backend/src/modules/admin-analytics/` (Express, Vercel project `cv-builder-backend`, region `fra1`)
  - SQL in `backend/supabase/migrations/2026103*–2026110*_analytics_*.sql`
- **Database:** Supabase project `brgzizrnwsqnvjtvfbbs` (eu-central-1). The backend connects as the execute-only role `analytics_api` via `ANALYTICS_DATABASE_URL` (pooler, port 6543, 15 s statement timeout).
- **Schemas:**
  - `analytics`: 35 metric functions.
  - `analytics_people`: user lookups, audited in the same transaction.
  - `analytics_private`: helpers and materialized views.
  - `admin_app`: audit log, alert rules and events, refresh runs, catalog.
- **Scheduled jobs (`pg_cron`, UTC):**

  | Job | Schedule |
  |---|---|
  | `analytics_nightly` | 03:45 (materialized-view refresh) |
  | `analytics_recompute_queue` | every minute |
  | `analytics_alerts` | hourly at :05 |
  | `analytics_cron_history_purge` | 04:20 |

  Before these, the Vercel cron `/api/v1/billing/analytics/refresh` at 03:30 refreshes FX, the catalogs, AI model prices and internal-account flags.
- **Access:**
  - Admin = Google session + email in `ADMIN_EMAILS` (backend env).
  - The admin origin must be listed in `CORS_ALLOWED_ORIGINS`.
- **Checks:**
  - `cd backend && npm run typecheck && npm test && npm run test:privacy-sql`
  - `cd admin && npm test && npm run build`
  - CI: `.github/workflows/ci.yml`
  - Production invariant: `select * from analytics_private.contract_violations();` returns 0 rows.
