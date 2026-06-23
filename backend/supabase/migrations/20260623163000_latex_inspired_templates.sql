-- Add LaTeX-inspired templates that render through the existing preview/PDF/DOCX
-- pipeline. These are visual profiles only; no TeX or LaTeX compilation is involved.

insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
values
  (
    'Academic Serif',
    'latex-academic-serif',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'Research CV',
    'latex-research-cv',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
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
