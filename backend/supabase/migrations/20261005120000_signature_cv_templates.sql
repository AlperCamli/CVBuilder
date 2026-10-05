-- Distinct compositions using the existing CV data, presentation and export pipeline.
insert into public.cv_templates (name, slug, status, module_type, preview_config, export_config)
values
  ('Studio', 'studio-banner', 'active', 'standard',
   '{"preview":"v3","theme":"signature","badges":["New","Signature"]}'::jsonb,
   '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb),
  ('Editorial', 'editorial-index', 'active', 'standard',
   '{"preview":"v3","theme":"signature","badges":["New","Signature"]}'::jsonb,
   '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb),
  ('Horizon', 'horizon-rail', 'active', 'standard',
   '{"preview":"v3","theme":"signature","badges":["New","Signature"]}'::jsonb,
   '{"pdf":{"enabled":true},"docx":{"enabled":true}}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  status = excluded.status,
  module_type = excluded.module_type,
  preview_config = excluded.preview_config,
  export_config = excluded.export_config,
  updated_at = now();
