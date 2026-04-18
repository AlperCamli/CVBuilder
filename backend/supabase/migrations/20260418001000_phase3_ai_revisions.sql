-- Phase 3 AI orchestration and block-level revision tables

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  master_cv_id uuid references public.master_cvs(id) on delete set null,
  tailored_cv_id uuid references public.tailored_cvs(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  flow_type text not null,
  provider text not null,
  model_name text not null,
  status text not null,
  input_payload jsonb not null,
  output_payload jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_runs_flow_type_check check (
    flow_type in (
      'job_analysis',
      'follow_up_questions',
      'tailored_draft',
      'block_suggest',
      'block_compare',
      'multi_option',
      'summary',
      'improve'
    )
  ),
  constraint ai_runs_status_check check (status in ('pending', 'completed', 'failed')),
  constraint ai_runs_completion_consistency_check check (
    (status = 'pending' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  tailored_cv_id uuid not null references public.tailored_cvs(id) on delete cascade,
  block_id text,
  action_type text not null,
  before_content jsonb,
  suggested_content jsonb not null,
  option_group_key text,
  status text not null default 'pending',
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_suggestions_action_type_check check (
    action_type in (
      'rewrite',
      'summarize',
      'improve',
      'ats_optimize',
      'options',
      'expand',
      'shorten'
    )
  ),
  constraint ai_suggestions_status_check check (status in ('pending', 'applied', 'rejected', 'expired')),
  constraint ai_suggestions_applied_consistency_check check (
    (status = 'applied' and applied_at is not null)
    or (status in ('pending', 'rejected', 'expired') and applied_at is null)
  )
);

create table if not exists public.cv_block_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cv_kind text not null,
  master_cv_id uuid references public.master_cvs(id) on delete set null,
  tailored_cv_id uuid references public.tailored_cvs(id) on delete set null,
  block_id text not null,
  block_type text not null,
  revision_number integer not null,
  content_snapshot jsonb not null,
  change_source text not null,
  ai_suggestion_id uuid references public.ai_suggestions(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null,
  constraint cv_block_revisions_cv_kind_check check (cv_kind in ('master', 'tailored')),
  constraint cv_block_revisions_change_source_check check (
    change_source in ('manual', 'ai', 'import', 'restore', 'system')
  ),
  constraint cv_block_revisions_revision_number_check check (revision_number > 0),
  constraint cv_block_revisions_cv_scope_check check (
    (cv_kind = 'master' and master_cv_id is not null and tailored_cv_id is null)
    or (cv_kind = 'tailored' and tailored_cv_id is not null and master_cv_id is null)
  )
);

create index if not exists ai_runs_user_started_at_idx
  on public.ai_runs (user_id, started_at desc);
create index if not exists ai_runs_tailored_cv_started_at_idx
  on public.ai_runs (tailored_cv_id, started_at desc)
  where tailored_cv_id is not null;
create index if not exists ai_runs_job_started_at_idx
  on public.ai_runs (job_id, started_at desc)
  where job_id is not null;
create index if not exists ai_runs_flow_type_status_idx
  on public.ai_runs (flow_type, status);

create index if not exists ai_suggestions_ai_run_id_idx
  on public.ai_suggestions (ai_run_id);
create index if not exists ai_suggestions_user_created_at_idx
  on public.ai_suggestions (user_id, created_at desc);
create index if not exists ai_suggestions_tailored_status_idx
  on public.ai_suggestions (tailored_cv_id, status, created_at desc);
create index if not exists ai_suggestions_option_group_idx
  on public.ai_suggestions (option_group_key)
  where option_group_key is not null;

create index if not exists cv_block_revisions_user_created_at_idx
  on public.cv_block_revisions (user_id, created_at desc);
create index if not exists cv_block_revisions_tailored_block_idx
  on public.cv_block_revisions (tailored_cv_id, block_id, revision_number desc)
  where cv_kind = 'tailored' and tailored_cv_id is not null;
create index if not exists cv_block_revisions_master_block_idx
  on public.cv_block_revisions (master_cv_id, block_id, revision_number desc)
  where cv_kind = 'master' and master_cv_id is not null;
create unique index if not exists cv_block_revisions_tailored_unique_revision_idx
  on public.cv_block_revisions (tailored_cv_id, block_id, revision_number)
  where cv_kind = 'tailored' and tailored_cv_id is not null;
create unique index if not exists cv_block_revisions_master_unique_revision_idx
  on public.cv_block_revisions (master_cv_id, block_id, revision_number)
  where cv_kind = 'master' and master_cv_id is not null;

alter table public.ai_runs enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.cv_block_revisions enable row level security;

create policy ai_runs_select_own
on public.ai_runs
for select
using (public.is_current_user(user_id));

create policy ai_runs_insert_own
on public.ai_runs
for insert
with check (public.is_current_user(user_id));

create policy ai_runs_update_own
on public.ai_runs
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy ai_suggestions_select_own
on public.ai_suggestions
for select
using (public.is_current_user(user_id));

create policy ai_suggestions_insert_own
on public.ai_suggestions
for insert
with check (public.is_current_user(user_id));

create policy ai_suggestions_update_own
on public.ai_suggestions
for update
using (public.is_current_user(user_id))
with check (public.is_current_user(user_id));

create policy cv_block_revisions_select_own
on public.cv_block_revisions
for select
using (public.is_current_user(user_id));

create policy cv_block_revisions_insert_own
on public.cv_block_revisions
for insert
with check (public.is_current_user(user_id));
