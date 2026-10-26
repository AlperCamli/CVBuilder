-- Tailoring v2: in-editor, session-based CV tailoring (backend/docs/tailoring-v2-design.md).
-- A session owns the match analysis, the user's answers and the parallel generation tasks.
-- Suggestions stay in ai_suggestions; every model call stays in ai_runs and is linked to
-- its session for token and cost reporting.

create table if not exists public.tailoring_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Null once the tailored CV is deleted: the session is detached, archived and scrubbed
  -- (tailoring_session_detach below) but kept with its ai_runs for cost reporting.
  tailored_cv_id uuid references public.tailored_cvs(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  status text not null default 'draft',
  job_snapshot jsonb not null default '{}',
  analysis jsonb,
  analysis_run_id uuid references public.ai_runs(id) on delete set null,
  requirement_decisions jsonb not null default '{}',
  answers jsonb not null default '{}',
  questions_completed boolean not null default false,
  base_snapshot jsonb not null,
  error_message text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tailoring_sessions_status_check check (
    status in ('draft', 'analyzing', 'answering', 'generating', 'reviewing', 'ready', 'archived')
  )
);

-- One live session per tailored CV; re-tailoring archives the previous one. Detached
-- sessions (tailored_cv_id null) are always archived, so they never collide here.
create unique index if not exists tailoring_sessions_active_cv_idx
  on public.tailoring_sessions (tailored_cv_id)
  where status <> 'archived';
create index if not exists tailoring_sessions_user_created_idx
  on public.tailoring_sessions (user_id, created_at desc);

create table if not exists public.tailoring_session_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tailoring_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  block_id text,
  section_id text,
  status text not null default 'waiting',
  depends_on_question_ids text[] not null default '{}',
  brief jsonb not null default '{}',
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  attempts integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tailoring_session_tasks_kind_check check (kind in ('block', 'summary', 'skills', 'structure')),
  constraint tailoring_session_tasks_status_check check (
    status in ('waiting', 'ready', 'running', 'done', 'failed', 'skipped')
  )
);

create index if not exists tailoring_session_tasks_session_idx
  on public.tailoring_session_tasks (session_id, created_at);

drop trigger if exists set_tailoring_sessions_updated_at on public.tailoring_sessions;
create trigger set_tailoring_sessions_updated_at
before update on public.tailoring_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_tailoring_session_tasks_updated_at on public.tailoring_session_tasks;
create trigger set_tailoring_session_tasks_updated_at
before update on public.tailoring_session_tasks
for each row execute function public.set_updated_at();

alter table public.tailoring_sessions enable row level security;
alter table public.tailoring_session_tasks enable row level security;

create policy tailoring_sessions_select_own
on public.tailoring_sessions
for select
using (public.is_current_user(user_id));

create policy tailoring_session_tasks_select_own
on public.tailoring_session_tasks
for select
using (public.is_current_user(user_id));

revoke insert, update, delete, truncate, references, trigger on public.tailoring_sessions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.tailoring_session_tasks from anon, authenticated;
grant all on public.tailoring_sessions to service_role;
grant all on public.tailoring_session_tasks to service_role;

create trigger privacy_subject_write before insert or update on public.tailoring_sessions
for each row execute function public.reject_deleted_subject_write();
create trigger privacy_subject_write before insert or update on public.tailoring_session_tasks
for each row execute function public.reject_deleted_subject_write();

-- Deleting a tailored CV detaches its sessions instead of deleting them, so their AI cost
-- data survives: the app soft-deletes CVs (is_deleted), a hard delete sets tailored_cv_id
-- null through the FK. A detached session is archived and loses every piece of CV content
-- (snapshot, answers, analysis, cards, task briefs); only the job title/company, status,
-- timestamps and the ai_runs linkage remain. Account erasure deletes sessions before
-- tailored_cvs, so neither trigger ever writes rows of a subject being erased.
create or replace function public.tailoring_session_detach() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tailored_cv_id is null and old.tailored_cv_id is not null then
    new.status := 'archived';
    new.job_snapshot := jsonb_build_object(
      'job_title', coalesce(old.job_snapshot->>'job_title', ''),
      'company_name', coalesce(old.job_snapshot->>'company_name', '')
    );
    new.analysis := null;
    new.requirement_decisions := '{}';
    new.answers := '{}';
    new.base_snapshot := '{}';
    new.error_message := null;
    delete from public.ai_suggestions where tailoring_session_id = old.id;
    delete from public.tailoring_session_tasks where session_id = old.id;
  end if;
  return new;
end; $$;

drop trigger if exists tailoring_session_detach on public.tailoring_sessions;
create trigger tailoring_session_detach
before update of tailored_cv_id on public.tailoring_sessions
for each row execute function public.tailoring_session_detach();

create or replace function public.tailoring_detach_deleted_cv() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_deleted and not old.is_deleted then
    update public.tailoring_sessions set tailored_cv_id = null where tailored_cv_id = new.id;
  end if;
  return null;
end; $$;

drop trigger if exists tailoring_detach_deleted_cv on public.tailored_cvs;
create trigger tailoring_detach_deleted_cv
after update of is_deleted on public.tailored_cvs
for each row execute function public.tailoring_detach_deleted_cv();

-- Answers and requirement decisions are merged atomically so quick consecutive
-- answers from the panel never overwrite each other.
create or replace function public.tailoring_merge_session_json(
  p_session_id uuid,
  p_user_id uuid,
  p_column text,
  p_patch jsonb
) returns public.tailoring_sessions
language plpgsql security definer set search_path = public as $$
declare result public.tailoring_sessions;
begin
  if p_column = 'answers' then
    update public.tailoring_sessions set answers = answers || p_patch
      where id = p_session_id and user_id = p_user_id returning * into result;
  elsif p_column = 'requirement_decisions' then
    update public.tailoring_sessions set requirement_decisions = requirement_decisions || p_patch
      where id = p_session_id and user_id = p_user_id returning * into result;
  else
    raise exception 'unsupported_column';
  end if;
  return result;
end; $$;
revoke all on function public.tailoring_merge_session_json(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tailoring_merge_session_json(uuid, uuid, text, jsonb) to service_role;

-- AI runs: session linkage and the token detail needed to price a run.
-- Sessions outlive their CV (see tailoring_session_detach) and are hard-deleted only by
-- account erasure, so their runs go with them there (cascade, not set null: erasure
-- rejects updates to a deleting subject's rows). Like legacy runs (tailored_cv_id/job_id
-- set null), a run keeps its input/output payloads when the CV is deleted.
alter table public.ai_runs
  add column if not exists tailoring_session_id uuid references public.tailoring_sessions(id) on delete cascade,
  add column if not exists parent_run_id uuid references public.ai_runs(id) on delete set null,
  add column if not exists cached_input_tokens integer,
  add column if not exists reasoning_tokens integer,
  add column if not exists cost_usd numeric(12, 6);

create index if not exists ai_runs_tailoring_session_idx
  on public.ai_runs (tailoring_session_id, started_at)
  where tailoring_session_id is not null;

alter table public.ai_runs drop constraint if exists ai_runs_flow_type_check;
alter table public.ai_runs add constraint ai_runs_flow_type_check check (flow_type in
 ('block_compare','multi_option','job_analysis','follow_up_questions','tailored_draft','block_suggest','skills_pool','import_improve','professional_summary','summary','improve','cv_parse','cover_letter_generation','cv_translate','tailoring_analysis','tailoring_block','tailoring_skills','tailoring_structure'));

-- Suggestions: tailoring cards with a kind, a reason and the requirements they address.
alter table public.ai_suggestions
  add column if not exists tailoring_session_id uuid references public.tailoring_sessions(id) on delete cascade,
  add column if not exists tailoring_task_id uuid references public.tailoring_session_tasks(id) on delete set null,
  add column if not exists kind text,
  add column if not exists rationale text,
  add column if not exists requirement_ids text[] not null default '{}',
  add column if not exists meta jsonb not null default '{}';

create index if not exists ai_suggestions_tailoring_session_idx
  on public.ai_suggestions (tailoring_session_id, created_at)
  where tailoring_session_id is not null;

alter table public.ai_suggestions drop constraint if exists ai_suggestions_action_type_check;
alter table public.ai_suggestions add constraint ai_suggestions_action_type_check check (
  action_type in ('rewrite', 'summarize', 'improve', 'ats_optimize', 'options', 'expand', 'shorten', 'tailor')
);

-- Per-user product preferences (e.g. tailoring auto-apply).
alter table public.users add column if not exists preferences jsonb not null default '{}';

notify pgrst, 'reload schema';
