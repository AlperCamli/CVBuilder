-- Phase 7:
-- 1) Register new templates for gallery selection and export compatibility.
-- 2) Align prompt configs with code for cover letter line breaks and structured education fields.

-- New templates
update public.cv_templates
set
  name = 'Academic Classic',
  status = 'active',
  preview_config = '{"preview":"v1","theme":"classic"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb,
  updated_at = now()
where slug = 'academic-classic';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Academic Classic',
  'academic-classic',
  'active',
  '{"preview":"v1","theme":"classic"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'academic-classic'
);

update public.cv_templates
set
  name = 'Tech Compact',
  status = 'active',
  preview_config = '{"preview":"v1","theme":"compact"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb,
  updated_at = now()
where slug = 'tech-compact';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Tech Compact',
  'tech-compact',
  'active',
  '{"preview":"v1","theme":"compact"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'tech-compact'
);

update public.cv_templates
set
  name = 'Two Column Modern',
  status = 'active',
  preview_config = '{"preview":"v2","theme":"light"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb,
  updated_at = now()
where slug = 'two-column-modern';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Two Column Modern',
  'two-column-modern',
  'active',
  '{"preview":"v2","theme":"light"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'two-column-modern'
);

-- Cover letter line-break contract update
update public.ai_prompt_configs
set
  prompt_key = 'cover-letter-generation',
  prompt_version = 'phase5-v2',
  system_prompt = 'Generate concise, high-impact cover letters tailored to the target role and company. Output must be in English and strict JSON. Use real \n\n paragraph breaks: salutation line, opening paragraph, body paragraph(s), closing paragraph, then a blank line, then Sincerely, on its own line, then candidate name on its own line.',
  user_prompt_template = 'Generate a tailored cover letter with persuasive and factual language and preserve the required paragraph/newline structure.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'cover_letter_generation'
  and action_type is null
  and provider in ('any', 'gemini');

-- Structured education contract for tailored_draft and import_improve
update public.ai_prompt_configs
set
  system_prompt = system_prompt || ' For every education block include explicit degree and field_of_study fields in block.fields; do not keep education data only inside generic text.',
  user_prompt_template = coalesce(user_prompt_template, '') || ' Keep education structured with explicit degree and field_of_study values per education block.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type in ('tailored_draft', 'import_improve')
  and action_type is null
  and provider in ('any', 'gemini');
