insert into public.cv_templates (name, slug, status, preview_config, export_config)
values
  (
    'Modern Clean',
    'modern-clean',
    'active',
    '{"preview": "v1"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Minimal Professional',
    'minimal-professional',
    'active',
    '{"preview": "v1"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  )
on conflict (slug) do update
set
  name = excluded.name,
  status = excluded.status,
  preview_config = excluded.preview_config,
  export_config = excluded.export_config,
  updated_at = now();
