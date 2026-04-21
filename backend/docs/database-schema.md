# Database Schema Note (Phase 5)

Source migrations:
- `supabase/migrations/20260417120000_base_extensions.sql`
- `supabase/migrations/20260417121000_phase1_tables.sql`
- `supabase/migrations/20260417133000_phase2_cv_domains.sql`
- `supabase/migrations/20260418001000_phase3_ai_revisions.sql`
- `supabase/migrations/20260418123000_phase4a_jobs_dashboard_rendering.sql`
- `supabase/migrations/20260418150000_phase4b_exports.sql`
- `supabase/migrations/20260418170000_phase4c_billing_entitlements.sql`
- `supabase/migrations/20260421130000_phase5_ai_gemini_prompts.sql` (new in Phase 5)

## Phase 5 Overview

Phase 5 adds:
- Gemini-ready AI flow persistence support (`import_improve` flow type in `ai_runs`)
- master/tailored dual scope support for `ai_suggestions`
- SQL-managed, versioned prompt configuration in new `ai_prompt_configs`
- history-read indexes for fast block-version navigation

## `ai_runs` (updated)

Purpose:
- persist lifecycle of each AI run (input, output, status, provider/model, linkage)

Phase 5 change:
- `ai_runs_flow_type_check` now includes:
  - `import_improve`

Allowed values now:
- `job_analysis`
- `follow_up_questions`
- `tailored_draft`
- `block_suggest`
- `block_compare`
- `multi_option`
- `import_improve`
- `summary`
- `improve`

## `ai_suggestions` (updated)

Purpose:
- persist suggestion candidates and decision status (`pending|applied|rejected|expired`)

Phase 5 changes:
- added column:
  - `master_cv_id uuid null references master_cvs(id) on delete cascade`
- `tailored_cv_id` changed from `not null` to nullable
- added scope constraint:
  - exactly one of `master_cv_id` or `tailored_cv_id` must be non-null

New/updated index support:
- `ai_suggestions_master_status_idx`
  - `(master_cv_id, status, created_at desc)` where `master_cv_id is not null`
- `ai_suggestions_tailored_block_status_idx`
  - `(tailored_cv_id, block_id, status, created_at desc)` where tailored/block are non-null
- `ai_suggestions_master_block_status_idx`
  - `(master_cv_id, block_id, status, created_at desc)` where master/block are non-null

These indexes support:
- fast AI history reads for master and tailored CVs
- fast block-level committed version chain reads (`status='applied'`)

## `ai_prompt_configs` (new table)

Purpose:
- SQL-managed prompt configuration by profile + flow + optional action + provider
- enables fast prompt iteration without code deployment

Columns:
- `id uuid primary key default gen_random_uuid()`
- `profile text not null`
- `flow_type text not null`
- `action_type text null`
- `provider text not null default 'gemini'`
- `model_name text null`
- `prompt_key text not null`
- `prompt_version text not null`
- `system_prompt text not null`
- `user_prompt_template text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- `ai_prompt_configs_flow_type_check`
  - validates flow type against persisted AI flow enum set
- `ai_prompt_configs_action_type_check`
  - nullable or one of:
    - `rewrite`, `summarize`, `improve`, `ats_optimize`, `options`, `expand`, `shorten`

Indexes:
- unique active selector:
  - `ai_prompt_configs_active_unique_idx`
  - `(profile, flow_type, coalesce(action_type, ''), provider)` where `is_active = true`
- lookup index:
  - `ai_prompt_configs_profile_lookup_idx`
  - `(profile, is_active, flow_type, action_type, provider)`

Trigger:
- `set_ai_prompt_configs_updated_at`
  - uses shared `public.set_updated_at()` for `updated_at` maintenance

RLS:
- enabled (`alter table ... enable row level security`)
- backend service-role access remains the primary runtime path

## Seed Data (Phase 5)

`supabase/seed.sql` now seeds active profile rows for `phase3-v1` with Gemini defaults for:
- `job_analysis`
- `follow_up_questions`
- `tailored_draft`
- `import_improve`
- `block_suggest` (action variants)
- `multi_option` (`options`)
- `block_compare`

All seeded system prompts enforce English output.
