-- Phase 6A: allow exports for master CVs in addition to tailored CVs.

alter table public.exports
  add column if not exists master_cv_id uuid references public.master_cvs(id) on delete cascade;

alter table public.exports
  alter column tailored_cv_id drop not null;

alter table public.exports
  drop constraint if exists exports_target_scope_check;

alter table public.exports
  add constraint exports_target_scope_check check (
    (tailored_cv_id is not null and master_cv_id is null)
    or (tailored_cv_id is null and master_cv_id is not null)
  );

create index if not exists exports_master_cv_id_created_at_idx
  on public.exports (master_cv_id, created_at desc)
  where master_cv_id is not null;
