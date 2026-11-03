# CV Builder

Monorepo with three Vercel projects: `frontend/` (product SPA, jobspecificcv.com), `backend/` (Express API, region fra1) and `admin/` (internal analytics dashboard, admin.jobspecificcv.com). Database: Supabase (migrations in `backend/supabase/migrations/`).

## Admin analytics dashboard
For any work on the admin dashboard (`admin/`, `backend/src/modules/admin-analytics/`, or the `analytics_*` migrations), start with `docs/admin-analytics/README.md`, then `docs/admin-analytics/development.md`. They hold the code map, the invariants every change must keep, recipes and the deploy procedure. Keep `docs/admin-analytics/metrics-inventory.md` in sync with the SQL you change.

## Promotions (promotional email offers)
For any work on promotions (`promotions/`, `backend/scripts/promotions/`, `backend/src/modules/promotions/`, `backend/src/modules/marketing/`, or the `promotions` migration), start with `docs/promotions/README.md`. It explains the flow end to end and how to run a new campaign, extend a window or archive one; `docs/promotions/spec.md` is the shared contract.
