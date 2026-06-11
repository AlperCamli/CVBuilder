-- Phase 13: medical_uk template gallery seed. These rows are only visible through the
-- module-filtered template list (module_type = 'medical_uk'); the standard gallery is
-- unchanged. Layout/style tokens live in rendering-presentation.ts under the same slugs.

insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
select
  'Medical Classic',
  'medical-classic',
  'active',
  'medical_uk',
  '{"preview":"v1","theme":"classic"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'medical-classic'
);

insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
select
  'Medical Professional',
  'medical-professional',
  'active',
  'medical_uk',
  '{"preview":"v1","theme":"professional"}'::jsonb,
  '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
where not exists (
  select 1 from public.cv_templates where slug = 'medical-professional'
);
