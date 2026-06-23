-- Add the font-matched LaTeX-labeled standard templates.

insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
values
  (
    'LaTeX Modern Brief',
    'latex-modern-brief',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Editorial Sidebar',
    'latex-editorial-sidebar',
    'active',
    'standard',
    '{"preview":"v2","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Photo Statement',
    'latex-photo-statement',
    'active',
    'standard',
    '{"preview":"v2","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Grant Timeline',
    'latex-grant-timeline',
    'active',
    'standard',
    '{"preview":"v1","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Technical Grid',
    'latex-technical-grid',
    'active',
    'standard',
    '{"preview":"v2","theme":"latex","badges":["LaTeX"]}'::jsonb,
    '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb
  ),
  (
    'LaTeX Two Tone Creative',
    'latex-two-tone-creative',
    'active',
    'standard',
    '{"preview":"v2","theme":"latex","badges":["LaTeX"]}'::jsonb,
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
