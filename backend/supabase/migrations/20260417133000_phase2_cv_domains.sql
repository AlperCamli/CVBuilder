-- Phase 2 CV domain tables (master CVs, imports, tailored CVs, jobs, files)

create table if not exists public.master_cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  language text not null,
  template_id uuid references public.cv_templates(id) on delete set null,
  current_content jsonb not null,
  summary_text text,
  source_type text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_cvs_source_type_check check (source_type in ('scratch', 'import'))
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  file_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint files_file_type_check check (
    file_type in (
      'source_upload',
      'parsed_artifact',
      'export_pdf',
      'export_docx',
      'avatar',
      'other'
    )
  ),
  constraint files_size_bytes_check check (size_bytes >= 0)
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_file_id uuid not null references public.files(id) on delete restrict,
  target_master_cv_id uuid references public.master_cvs(id) on delete set null,
  status text not null,
  parser_name text,
  raw_extracted_text text,
  parsed_content jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint imports_status_check check (
    status in ('uploaded', 'parsing', 'parsed', 'reviewed', 'converted', 'failed')
  )
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tailored_cv_id uuid,
  company_name text not null,
  job_title text not null,
  job_description text not null,
  job_posting_url text,
  location_text text,
  status text not null default 'saved',
  notes text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_status_check check (
    status in ('saved', 'applied', 'interviewing', 'offered', 'rejected', 'archived')
  )
);

create table if not exists public.tailored_cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  master_cv_id uuid not null references public.master_cvs(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  title text not null,
  language text not null,
  template_id uuid references public.cv_templates(id) on delete set null,
  current_content jsonb not null,
  status text not null default 'draft',
  ai_generation_status text,
  last_exported_at timestamptz,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tailored_cvs_status_check check (status in ('draft', 'ready', 'exported', 'archived'))
);

-- Add the reverse FK after both tables exist.
do $$
begin
  alter table public.jobs
    add constraint jobs_tailored_cv_id_fkey
    foreign key (tailored_cv_id)
    references public.tailored_cvs(id)
    on delete set null;
exception
  when duplicate_object then
    null;
end $$;

create index if not exists master_cvs_user_id_is_deleted_idx
  on public.master_cvs (user_id, is_deleted);
create index if not exists master_cvs_template_id_idx
  on public.master_cvs (template_id);
create index if not exists master_cvs_updated_at_idx
  on public.master_cvs (updated_at desc);

create index if not exists files_user_id_is_deleted_idx
  on public.files (user_id, is_deleted);
create index if not exists files_file_type_idx
  on public.files (file_type);
create unique index if not exists files_bucket_path_unique_idx
  on public.files (storage_bucket, storage_path)
  where is_deleted = false;

create index if not exists imports_user_id_status_idx
  on public.imports (user_id, status);
create index if not exists imports_source_file_id_idx
  on public.imports (source_file_id);
create index if not exists imports_target_master_cv_id_idx
  on public.imports (target_master_cv_id);

create index if not exists tailored_cvs_user_id_is_deleted_idx
  on public.tailored_cvs (user_id, is_deleted);
create index if not exists tailored_cvs_master_cv_id_idx
  on public.tailored_cvs (master_cv_id);
create index if not exists tailored_cvs_status_idx
  on public.tailored_cvs (status);
create index if not exists tailored_cvs_job_id_idx
  on public.tailored_cvs (job_id);
create unique index if not exists tailored_cvs_unique_job_active_idx
  on public.tailored_cvs (job_id)
  where job_id is not null and is_deleted = false;

create index if not exists jobs_user_id_idx
  on public.jobs (user_id);
create index if not exists jobs_status_idx
  on public.jobs (status);
create index if not exists jobs_tailored_cv_id_idx
  on public.jobs (tailored_cv_id);
create index if not exists jobs_company_name_idx
  on public.jobs (company_name);
create unique index if not exists jobs_unique_tailored_cv_idx
  on public.jobs (tailored_cv_id)
  where tailored_cv_id is not null;

create trigger master_cvs_set_updated_at
before update on public.master_cvs
for each row
execute function public.set_updated_at();

create trigger imports_set_updated_at
before update on public.imports
for each row
execute function public.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row
execute function public.set_updated_at();

create trigger tailored_cvs_set_updated_at
before update on public.tailored_cvs
for each row
execute function public.set_updated_at();

alter table public.master_cvs enable row level security;
alter table public.files enable row level security;
alter table public.imports enable row level security;
alter table public.jobs enable row level security;
alter table public.tailored_cvs enable row level security;

create policy master_cvs_select_own
on public.master_cvs
for select
using (public.is_current_user(user_id));

create policy master_cvs_insert_own
on public.master_cvs
for insert
with check (public.is_current_user(user_id));

create policy master_cvs_update_own
on public.master_cvs
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy files_select_own
on public.files
for select
using (public.is_current_user(user_id));

create policy files_insert_own
on public.files
for insert
with check (public.is_current_user(user_id));

create policy files_update_own
on public.files
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy imports_select_own
on public.imports
for select
using (public.is_current_user(user_id));

create policy imports_insert_own
on public.imports
for insert
with check (public.is_current_user(user_id));

create policy imports_update_own
on public.imports
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy jobs_select_own
on public.jobs
for select
using (public.is_current_user(user_id));

create policy jobs_insert_own
on public.jobs
for insert
with check (public.is_current_user(user_id));

create policy jobs_update_own
on public.jobs
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy tailored_cvs_select_own
on public.tailored_cvs
for select
using (public.is_current_user(user_id));

create policy tailored_cvs_insert_own
on public.tailored_cvs
for insert
with check (public.is_current_user(user_id));

create policy tailored_cvs_update_own
on public.tailored_cvs
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));
