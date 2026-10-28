# CV Builder

Monorepo with three Vercel projects: `frontend/` (product SPA, jobspecificcv.com), `backend/` (Express API, region fra1) and `admin/` (internal analytics dashboard, admin.jobspecificcv.com). Database: Supabase (migrations in `backend/supabase/migrations/`).

## Admin analytics dashboard
For any work on the admin dashboard (`admin/`, `backend/src/modules/admin-analytics/`, or the `analytics_*` migrations), start with `docs/admin-analytics/README.md`, then `docs/admin-analytics/development.md`. They hold the code map, the invariants every change must keep, recipes and the deploy procedure. Keep `docs/admin-analytics/metrics-inventory.md` in sync with the SQL you change.
