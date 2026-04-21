-- Phase 6: cover letter domain + exports

create table if not exists public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  tailored_cv_id uuid references public.tailored_cvs(id) on delete set null,
  title text not null,
  content text not null default '',
  status text not null default 'draft',
  last_exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cover_letters_status_check check (status in ('draft', 'ready', 'archived')),
  constraint cover_letters_job_id_key unique (job_id)
);

alter table if exists public.jobs
  add column if not exists cover_letter_id uuid;

do $$
begin
  alter table public.jobs
    add constraint jobs_cover_letter_id_fkey
    foreign key (cover_letter_id)
    references public.cover_letters(id)
    on delete set null;
exception
  when duplicate_object then
    null;
end $$;

create index if not exists cover_letters_user_id_updated_at_idx
  on public.cover_letters (user_id, updated_at desc);
create index if not exists cover_letters_tailored_cv_id_idx
  on public.cover_letters (tailored_cv_id);
create unique index if not exists jobs_unique_cover_letter_idx
  on public.jobs (cover_letter_id)
  where cover_letter_id is not null;

create trigger cover_letters_set_updated_at
before update on public.cover_letters
for each row
execute function public.set_updated_at();

alter table public.cover_letters enable row level security;

create policy cover_letters_select_own
on public.cover_letters
for select
using (public.is_current_user(user_id));

create policy cover_letters_insert_own
on public.cover_letters
for insert
with check (public.is_current_user(user_id));

create policy cover_letters_update_own
on public.cover_letters
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create table if not exists public.cover_letter_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cover_letter_id uuid not null references public.cover_letters(id) on delete cascade,
  file_id uuid references public.files(id) on delete restrict,
  format text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint cover_letter_exports_format_check check (format in ('pdf', 'docx')),
  constraint cover_letter_exports_status_check check (status in ('processing', 'completed', 'failed')),
  constraint cover_letter_exports_lifecycle_check check (
    (status = 'processing' and file_id is null and completed_at is null and error_message is null)
    or (status = 'completed' and file_id is not null and completed_at is not null and error_message is null)
    or (status = 'failed' and file_id is null and completed_at is null and error_message is not null)
  )
);

create index if not exists cover_letter_exports_user_id_created_at_idx
  on public.cover_letter_exports (user_id, created_at desc);
create index if not exists cover_letter_exports_cover_letter_id_created_at_idx
  on public.cover_letter_exports (cover_letter_id, created_at desc);
create index if not exists cover_letter_exports_status_created_at_idx
  on public.cover_letter_exports (status, created_at desc);

alter table public.cover_letter_exports enable row level security;

create policy cover_letter_exports_select_own
on public.cover_letter_exports
for select
using (public.is_current_user(user_id));

create policy cover_letter_exports_insert_own
on public.cover_letter_exports
for insert
with check (public.is_current_user(user_id));

create policy cover_letter_exports_update_own
on public.cover_letter_exports
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));
