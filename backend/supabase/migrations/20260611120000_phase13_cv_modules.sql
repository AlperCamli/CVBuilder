-- Phase 13: job-specific CV modules infrastructure.
-- Adds module_type to CVs, imports and templates. No CHECK constraint on the values:
-- allowed module ids are validated in the app against the cv-modules registry so new
-- modules do not require a migration. All existing rows become 'standard' (current behavior).

alter table public.master_cvs
  add column if not exists module_type text not null default 'standard';

alter table public.tailored_cvs
  add column if not exists module_type text not null default 'standard';

alter table public.imports
  add column if not exists module_type text not null default 'standard';

alter table public.cv_templates
  add column if not exists module_type text not null default 'standard';
