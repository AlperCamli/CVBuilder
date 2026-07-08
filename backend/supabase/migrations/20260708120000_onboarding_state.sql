-- Guided onboarding progress, decoupled from the legacy onboarding_completed
-- paywall flag. Shape:
--   {
--     "steps": { "<step_id>": "<ISO completion timestamp>", ... },
--     "skipped_at": "<ISO>",   -- present => tour permanently dismissed
--     "completed_at": "<ISO>"  -- present => tour finished
--   }
-- The empty-object default means every user starts the onboarding fresh.
alter table public.users
  add column if not exists onboarding_state jsonb not null default '{}'::jsonb;
