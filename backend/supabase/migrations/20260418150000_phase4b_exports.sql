-- Phase 4B: export records for tailored CV PDF/DOCX outputs

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tailored_cv_id uuid not null references public.tailored_cvs(id) on delete cascade,
  file_id uuid references public.files(id) on delete restrict,
  format text not null,
  status text not null,
  template_id uuid references public.cv_templates(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint exports_format_check check (format in ('pdf', 'docx')),
  constraint exports_status_check check (status in ('processing', 'completed', 'failed')),
  constraint exports_lifecycle_check check (
    (status = 'processing' and file_id is null and completed_at is null and error_message is null)
    or (status = 'completed' and file_id is not null and completed_at is not null and error_message is null)
    or (status = 'failed' and file_id is null and completed_at is null and error_message is not null)
  )
);

create index if not exists exports_user_id_created_at_idx
  on public.exports (user_id, created_at desc);
create index if not exists exports_tailored_cv_id_created_at_idx
  on public.exports (tailored_cv_id, created_at desc);
create index if not exists exports_status_created_at_idx
  on public.exports (status, created_at desc);

alter table public.exports enable row level security;

create policy exports_select_own
on public.exports
for select
using (public.is_current_user(user_id));

create policy exports_insert_own
on public.exports
for insert
with check (public.is_current_user(user_id));

create policy exports_update_own
on public.exports
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));
