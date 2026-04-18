# Database Schema Note (Phase 4A)

Source migrations:
- `supabase/migrations/20260417120000_base_extensions.sql`
- `supabase/migrations/20260417121000_phase1_tables.sql`
- `supabase/migrations/20260417133000_phase2_cv_domains.sql`
- `supabase/migrations/20260418001000_phase3_ai_revisions.sql`
- `supabase/migrations/20260418123000_phase4a_jobs_dashboard_rendering.sql` (new)

## Reused Tables (No Redesign)

Phase 4A continues using existing tables:
- `users`
- `subscriptions`
- `usage_counters`
- `cv_templates`
- `master_cvs`
- `tailored_cvs`
- `jobs`
- `files`
- `imports`
- `ai_runs`
- `ai_suggestions`
- `cv_block_revisions`

No redesign of `master_cvs.current_content` or `tailored_cvs.current_content`.

## Phase 4A Changes

## 1) Job Status Vocabulary Alignment

`jobs.status` is aligned to:
- `saved`
- `applied`
- `interview`
- `offer`
- `rejected`
- `archived`

Migration updates prior rows:
- `interviewing -> interview`
- `offered -> offer`

Constraint updated:
- `jobs_status_check`

## 2) New Table: `job_status_history`

Purpose:
- lightweight persisted history of job status transitions for tracker and dashboard activity

Columns:
- `id uuid primary key`
- `job_id uuid not null fk -> jobs.id`
- `from_status text null`
- `to_status text not null`
- `changed_at timestamptz not null`
- `changed_by_user_id uuid not null fk -> users.id`

Checks:
- `from_status` in allowed status set (or null)
- `to_status` in allowed status set

Indexes:
- `(job_id, changed_at desc)`
- `(changed_by_user_id, changed_at desc)`

Cardinality:
- one job -> many `job_status_history` rows
- one user -> many status change rows

RLS:
- enabled on `job_status_history`
- `select` policy scoped to rows whose `job_id` belongs to current user
- `insert` policy requires:
  - `changed_by_user_id` is current user
  - referenced job belongs to current user

## Migration Notes

- Phase 4A migration is additive.
- No destructive table drops.
- No changes to export/file generation tables in this phase.
- Rendering payloads are derived in application layer; no rendering table introduced.
