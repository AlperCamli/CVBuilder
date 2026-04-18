-- Phase 4A: job tracker history support + status vocabulary alignment

-- Align statuses with frozen product vocabulary.
update public.jobs
set status = 'interview'
where status = 'interviewing';

update public.jobs
set status = 'offer'
where status = 'offered';

do $$
begin
  alter table public.jobs
    drop constraint if exists jobs_status_check;
exception
  when undefined_table then
    null;
end $$;

alter table if exists public.jobs
  add constraint jobs_status_check
  check (status in ('saved', 'applied', 'interview', 'offer', 'rejected', 'archived'));

create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by_user_id uuid not null references public.users(id) on delete restrict,
  constraint job_status_history_from_status_check check (
    from_status in ('saved', 'applied', 'interview', 'offer', 'rejected', 'archived')
    or from_status is null
  ),
  constraint job_status_history_to_status_check check (
    to_status in ('saved', 'applied', 'interview', 'offer', 'rejected', 'archived')
  )
);

create index if not exists job_status_history_job_id_changed_at_idx
  on public.job_status_history (job_id, changed_at desc);

create index if not exists job_status_history_changed_by_user_id_idx
  on public.job_status_history (changed_by_user_id, changed_at desc);

alter table public.job_status_history enable row level security;

create policy job_status_history_select_own
on public.job_status_history
for select
using (
  exists (
    select 1
    from public.jobs j
    where j.id = job_status_history.job_id
      and public.is_current_user(j.user_id)
  )
);

create policy job_status_history_insert_own
on public.job_status_history
for insert
with check (
  public.is_current_user(changed_by_user_id)
  and exists (
    select 1
    from public.jobs j
    where j.id = job_status_history.job_id
      and public.is_current_user(j.user_id)
  )
);
