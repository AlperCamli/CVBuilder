# Database Schema Note (Phase 4C)

Source migrations:
- `supabase/migrations/20260417120000_base_extensions.sql`
- `supabase/migrations/20260417121000_phase1_tables.sql`
- `supabase/migrations/20260417133000_phase2_cv_domains.sql`
- `supabase/migrations/20260418001000_phase3_ai_revisions.sql`
- `supabase/migrations/20260418123000_phase4a_jobs_dashboard_rendering.sql`
- `supabase/migrations/20260418150000_phase4b_exports.sql`
- `supabase/migrations/20260418170000_phase4c_billing_entitlements.sql` (new)

## Reused Tables for Phase 4C

Phase 4C monetization and gating reuses existing tables as primary persistence:
- `users`
- `subscriptions`
- `usage_counters`
- `master_cvs`
- `tailored_cvs`
- `jobs`
- `files`
- `imports`
- `ai_runs`
- `ai_suggestions`
- `cv_block_revisions`
- `cv_templates`
- `exports`

No new table is introduced in Phase 4C.

## `subscriptions` (reused)

Purpose:
- persist Stripe-linked subscription state
- support current plan resolution and webhook synchronization

Key attributes:
- `id uuid primary key`
- `user_id uuid not null fk -> users.id`
- `provider text not null`
- `provider_customer_id text null`
- `provider_subscription_id text null`
- `plan_code text not null`
- `status text not null`
- `current_period_start timestamptz null`
- `current_period_end timestamptz null`
- `cancel_at_period_end boolean not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Cardinality:
- one user -> many historical subscription rows
- at most one active/trialing row per user (existing partial unique index)

Phase 4C index additions:
- `subscriptions_provider_customer_id_idx` on `(provider, provider_customer_id)` when non-null
- `subscriptions_provider_subscription_id_idx` on `(provider, provider_subscription_id)` when non-null

## `usage_counters` (reused)

Purpose:
- monthly counters for freemium-gated actions

Key attributes:
- `id uuid primary key`
- `user_id uuid not null fk -> users.id`
- `period_month date not null` (month-aligned)
- `tailored_cv_generations_count integer not null default 0`
- `exports_count integer not null default 0`
- `ai_actions_count integer not null default 0`
- `storage_bytes_used bigint not null default 0`
- `updated_at timestamptz not null`

Cardinality:
- one user -> many monthly usage rows (`user_id`, `period_month` unique)

## New DB Function in Phase 4C

`public.increment_usage_counters(...)`

Purpose:
- atomically upsert and increment monthly usage counters
- avoid race-prone read-modify-write patterns in application code

Signature:
- `p_user_id uuid`
- `p_period_month date`
- `p_tailored_cv_generations_increment integer default 0`
- `p_exports_increment integer default 0`
- `p_ai_actions_increment integer default 0`
- `p_storage_bytes_delta bigint default 0`

Behavior:
- normalizes `period_month` to month start
- creates monthly row if missing
- increments counters on conflict
- keeps counters non-negative with `greatest(..., 0)`
- returns updated `usage_counters` row

## Migration Notes (Phase 4C)

- migration is additive
- no table drops
- no destructive data migration
- no new RLS policy surface required
- schema remains compatible with future observability/security hardening phases
