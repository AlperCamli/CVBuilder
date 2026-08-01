-- Phase 14: dedicated skills_pool AI flow.
-- The skills suggestion pool previously rode on block_suggest, so the generic
-- block-improvement user_prompt_template ("Return one improved suggested_block only...")
-- overrode the pool contract and the model kept echoing skills the CV already has.
-- skills_pool gets its own flow_type with DB-managed prompts.

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
      'skills_pool',
      'block_compare',
      'multi_option',
      'import_improve',
      'professional_summary',
      'summary',
      'improve',
      'cv_parse',
      'cover_letter_generation'
    )
  );

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
      'skills_pool',
      'block_compare',
      'multi_option',
      'import_improve',
      'professional_summary',
      'summary',
      'improve',
      'cv_parse',
      'cover_letter_generation'
    )
  );

-- Seed skills_pool prompt rows for every (profile, provider) pair that already has an
-- active block_suggest row, so all deployed profiles/providers keep boot-guard coverage.
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
select distinct
  src.profile,
  'skills_pool',
  null,
  src.provider,
  null,
  'skills-pool',
  'phase14-v1',
  'Generate a pool of NEW skill suggestions for one CV skills block. Every returned skill must be absent from existing_skills and current_pool in skills_pool_context (case-insensitive). Ground each suggestion in the work experience and education context: adjacent tools, frameworks, methodologies, certifications, languages, and soft skills the CV plausibly supports. Keep each skill atomic (max 6 words, no sentences, no explanations). Return strict JSON with one root key suggested_block only, whose fields.skills is a string array with at most 20 entries. Do not include rationale, labels, markdown, or prose.',
  'Suggest new skills for this CV using skills_pool_context (work experience and education). Never repeat anything in existing_skills or current_pool - every returned skill must be new. Explore adjacent tools, frameworks, methodologies, certifications, languages, and soft skills the experience plausibly supports. Return only valid structured suggested_block with fields.skills as a string array (max 20).',
  true
from public.ai_prompt_configs src
where src.flow_type = 'block_suggest'
  and src.is_active = true
  and not exists (
    select 1
    from public.ai_prompt_configs existing
    where existing.profile = src.profile
      and existing.flow_type = 'skills_pool'
      and existing.provider = src.provider
      and existing.is_active = true
  );
