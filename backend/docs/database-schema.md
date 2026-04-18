# Database Schema Note (Phase 3)

Source of truth migrations:
- `supabase/migrations/20260417120000_base_extensions.sql`
- `supabase/migrations/20260417121000_phase1_tables.sql`
- `supabase/migrations/20260417133000_phase2_cv_domains.sql`
- `supabase/migrations/20260418001000_phase3_ai_revisions.sql`

## Existing Core Tables (Phase 1 + Phase 2)

- `users`
- `subscriptions`
- `usage_counters`
- `cv_templates`
- `master_cvs`
- `tailored_cvs`
- `jobs`
- `files`
- `imports`

## New Phase 3 Tables

## `ai_runs`

Purpose:
- tracks each AI workflow execution (analysis, question generation, draft generation, block flows)

Columns:
- `id uuid pk`
- `user_id uuid not null fk -> users.id`
- `master_cv_id uuid null fk -> master_cvs.id`
- `tailored_cv_id uuid null fk -> tailored_cvs.id`
- `job_id uuid null fk -> jobs.id`
- `flow_type text not null`
  - `job_analysis`, `follow_up_questions`, `tailored_draft`, `block_suggest`, `block_compare`, `multi_option`, `summary`, `improve`
- `provider text not null`
- `model_name text not null`
- `status text not null`
  - `pending`, `completed`, `failed`
- `input_payload jsonb not null`
- `output_payload jsonb null`
- `error_message text null`
- `started_at timestamptz not null`
- `completed_at timestamptz null`

Key constraints:
- status check
- flow_type check
- completion consistency check (`pending` cannot have `completed_at`; completed/failed must have it)

Cardinality:
- one user -> many ai_runs
- one tailored_cv -> many ai_runs
- one job -> many ai_runs

## `ai_suggestions`

Purpose:
- stores actionable AI block suggestions before user apply/reject

Columns:
- `id uuid pk`
- `ai_run_id uuid not null fk -> ai_runs.id`
- `user_id uuid not null fk -> users.id`
- `tailored_cv_id uuid not null fk -> tailored_cvs.id`
- `block_id text null`
- `action_type text not null`
  - `rewrite`, `summarize`, `improve`, `ats_optimize`, `options`, `expand`, `shorten`
- `before_content jsonb null`
- `suggested_content jsonb not null`
- `option_group_key text null`
- `status text not null`
  - `pending`, `applied`, `rejected`, `expired`
- `applied_at timestamptz null`
- `created_at timestamptz not null`

Key constraints:
- action_type check
- status check
- applied consistency check (`applied` requires `applied_at`)

Cardinality:
- one ai_run -> many ai_suggestions
- one tailored_cv -> many ai_suggestions
- one suggestion may map to zero/one resulting revision

## `cv_block_revisions`

Purpose:
- block-level immutable revision history for accepted changes

Columns:
- `id uuid pk`
- `user_id uuid not null fk -> users.id`
- `cv_kind text not null` (`master` | `tailored`)
- `master_cv_id uuid null fk -> master_cvs.id`
- `tailored_cv_id uuid null fk -> tailored_cvs.id`
- `block_id text not null`
- `block_type text not null`
- `revision_number integer not null`
- `content_snapshot jsonb not null`
- `change_source text not null`
  - `manual`, `ai`, `import`, `restore`, `system`
- `ai_suggestion_id uuid null fk -> ai_suggestions.id`
- `created_at timestamptz not null`
- `created_by_user_id uuid null fk -> users.id`

Key constraints:
- `cv_kind` check
- `change_source` check
- `revision_number > 0`
- scope consistency check:
  - master revision => `master_cv_id` set and `tailored_cv_id` null
  - tailored revision => `tailored_cv_id` set and `master_cv_id` null

Cardinality:
- one tailored_cv -> many block revisions
- one block (`tailored_cv_id + block_id`) -> many revisions
- one ai_suggestion -> zero/one linked revision

## Index and Uniqueness Notes

Phase 3 adds:
- run timeline indexes by user/tailored/job
- suggestion indexes by tailored/status/option group
- revision timeline/block indexes
- per-block unique revision number indexes for tailored and master scopes

## RLS Notes

RLS enabled on:
- `ai_runs`
- `ai_suggestions`
- `cv_block_revisions`

Policies enforce own-row access via `public.is_current_user(user_id)`.

Backend currently uses service-role client and still performs explicit ownership checks in services.

## Migration Notes

- Migration is additive and non-destructive.
- No event-sourcing or full-CV rollback mechanism introduced.
- Schema is future-compatible with:
  - export pipelines (via stable tailored snapshots + revisions)
  - billing/metering (via ai run/suggestion history)
  - localization and observability extensions
