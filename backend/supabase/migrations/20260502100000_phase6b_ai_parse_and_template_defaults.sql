-- Phase 6B:
-- 1) Ensure all intended template slugs are present/active for UI visibility.
-- 2) Harden cv_parse AI prompt rows for profile phase3-v1 across runtime providers.

-- Template visibility: upsert active template rows by slug.
update public.cv_templates
set
  name = 'Modern Clean',
  status = 'active',
  preview_config = '{"preview":"v1"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb,
  updated_at = now()
where slug = 'modern-clean';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Modern Clean',
  'modern-clean',
  'active',
  '{"preview":"v1"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'modern-clean'
);

update public.cv_templates
set
  name = 'Minimal Professional',
  status = 'active',
  preview_config = '{"preview":"v1"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb,
  updated_at = now()
where slug = 'minimal-professional';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Minimal Professional',
  'minimal-professional',
  'active',
  '{"preview":"v1"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'minimal-professional'
);

update public.cv_templates
set
  name = 'Executive Timeline',
  status = 'active',
  preview_config = '{"preview":"v1","theme":"dark"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb,
  updated_at = now()
where slug = 'executive-timeline';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Executive Timeline',
  'executive-timeline',
  'active',
  '{"preview":"v1","theme":"dark"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'executive-timeline'
);

update public.cv_templates
set
  name = 'Creative Portfolio',
  status = 'active',
  preview_config = '{"preview":"v2","theme":"light"}'::jsonb,
  export_config = '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb,
  updated_at = now()
where slug = 'creative-portfolio';

insert into public.cv_templates (name, slug, status, preview_config, export_config)
select
  'Creative Portfolio',
  'creative-portfolio',
  'active',
  '{"preview":"v2","theme":"light"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":false}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'creative-portfolio'
);

-- AI prompt config hardening for cv_parse.
-- Normalize model_name to null so runtime uses provider default resolution.
update public.ai_prompt_configs
set
  prompt_key = 'cv-parse',
  prompt_version = 'phase5-v1',
  system_prompt = 'Parse unstructured raw CV text into a strictly structured JSON CV content format.',
  user_prompt_template = 'Parse the raw CV text and return canonical cv_content JSON.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'cv_parse'
  and action_type is null
  and provider in ('any', 'gemini');

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
  'Parse the raw CV text and return canonical cv_content JSON.',
  true
where not exists (
  select 1
  from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'cv_parse'
    and action_type is null
    and provider = 'any'
);

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
  'gemini',
  null,
  'cv-parse',
  'phase5-v1',
  'Parse unstructured raw CV text into a strictly structured JSON CV content format.',
  'Parse the raw CV text and return canonical cv_content JSON.',
  true
where not exists (
  select 1
  from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'cv_parse'
    and action_type is null
    and provider = 'gemini'
);
