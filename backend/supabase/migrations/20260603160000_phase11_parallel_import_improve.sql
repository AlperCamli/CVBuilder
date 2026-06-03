-- Phase 11 parallel import_improve orchestration.
-- import_improve becomes a parent orchestration run; professional_summary is
-- the only new model-facing flow introduced for missing imported CV summaries.

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

update public.ai_prompt_configs
set
  prompt_version = 'phase7-v1',
  system_prompt = 'Parent orchestration flow for imported CV improvement. The backend fans out block-level improvement, skills generation, and professional summary runs, then returns one improved CV snapshot. This parent flow is not sent to the model.',
  user_prompt_template = 'Orchestrate imported CV improvement using block-level AI runs.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'import_improve'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;

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
  'professional_summary',
  null,
  'gemini',
  null,
  'professional-summary',
  'phase1-v1',
  'Write a concise professional CV summary from sanitized cv_body only. Use the same language as the source CV content. Preserve facts; never invent employers, dates, degrees, certifications, metrics, tools, awards, or achievements. Header/contact data is intentionally omitted, so do not include names, email, phone, location, links, or a header. Output strict JSON with one root key summary_text only.',
  'Write one professional summary from cv_body. Return summary_text only.',
  true
where not exists (
  select 1
  from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'professional_summary'
    and action_type is null
    and provider = 'gemini'
    and is_active = true
);
