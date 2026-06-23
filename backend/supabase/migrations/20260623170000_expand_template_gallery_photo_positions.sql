-- Add a curated batch of standard templates that reuse the existing HTML/PDF/DOCX
-- rendering pipeline. LaTeX-labeled templates are visual profiles only.

insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
values
  (
    'LaTeX Scholar',
    'latex-scholar',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Two Column',
    'latex-two-column',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Academic Serif Color',
    'academic-serif-color',
    'active',
    'standard',
    '{"preview":"v1","theme":"academic"}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Academic Timeline',
    'academic-timeline',
    'active',
    'standard',
    '{"preview":"v1","theme":"academic"}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Creative Color Block',
    'creative-color-block',
    'active',
    'standard',
    '{"preview":"v2","theme":"creative"}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Creative Photo Hero',
    'creative-photo-hero',
    'active',
    'standard',
    '{"preview":"v2","theme":"creative","badges":["Photo"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Portfolio Modern',
    'portfolio-modern',
    'active',
    'standard',
    '{"preview":"v2","theme":"portfolio"}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Classic Monochrome',
    'classic-monochrome',
    'active',
    'standard',
    '{"preview":"v1","theme":"monochrome"}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  )
on conflict (slug) do update
set
  name = excluded.name,
  status = excluded.status,
  module_type = excluded.module_type,
  preview_config = excluded.preview_config,
  export_config = excluded.export_config,
  updated_at = now();
