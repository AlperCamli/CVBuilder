-- Migration: add_new_flow_types
-- Adds cv_parse and cover_letter_generation flow types to the ai_runs and ai_prompt_configs
-- check constraints, and seeds default fallback prompt config rows so the system works
-- in production without requiring manual database seeding.

-- 1. Expand ai_runs flow_type constraint
alter table public.ai_runs
  drop constraint if exists ai_runs_flow_type_check;

alter table public.ai_runs
  add constraint ai_runs_flow_type_check
  check (
    flow_type in (
      'job_analysis',
      'follow_up_questions',
      'tailored_draft',
      'block_suggest',
      'block_compare',
      'multi_option',
      'import_improve',
      'summary',
      'improve',
      'cv_parse',
      'cover_letter_generation'
    )
  );

-- 2. Expand ai_prompt_configs flow_type constraint
alter table public.ai_prompt_configs
  drop constraint if exists ai_prompt_configs_flow_type_check;

alter table public.ai_prompt_configs
  add constraint ai_prompt_configs_flow_type_check
  check (
    flow_type in (
      'job_analysis',
      'follow_up_questions',
      'tailored_draft',
      'block_suggest',
      'block_compare',
      'multi_option',
      'import_improve',
      'summary',
      'improve',
      'cv_parse',
      'cover_letter_generation'
    )
  );

-- 3. Seed default prompt config for cv_parse (profile: phase3-v1, provider: any)
insert into public.ai_prompt_configs (
  profile,
  flow_type,
  action_type,
  provider,
  model_name,
  prompt_key,
  prompt_version,
  system_prompt,
  user_prompt_template,
  is_active
)
select
  'phase3-v1',
  'cv_parse',
  null,
  'any',
  null,
  'cv-parse',
  'phase5-v1',
  'Parse unstructured raw CV text into a strictly structured JSON CV content format.',
  null,
  true
where not exists (
  select 1 from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'cv_parse'
    and action_type is null
    and provider = 'any'
    and is_active = true
);

-- 4. Seed default prompt config for cover_letter_generation (profile: phase3-v1, provider: any)
insert into public.ai_prompt_configs (
  profile,
  flow_type,
  action_type,
  provider,
  model_name,
  prompt_key,
  prompt_version,
  system_prompt,
  user_prompt_template,
  is_active
)
select
  'phase3-v1',
  'cover_letter_generation',
  null,
  'any',
  null,
  'cover-letter-generation',
  'phase5-v1',
  'Generate a concise, highly impactful cover letter that emphasizes candidate strengths and makes recruiters want to meet them.',
  null,
  true
where not exists (
  select 1 from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'cover_letter_generation'
    and action_type is null
    and provider = 'any'
    and is_active = true
);
