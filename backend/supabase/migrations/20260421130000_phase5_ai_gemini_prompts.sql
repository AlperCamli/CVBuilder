-- Phase 5: Gemini provider readiness, prompt configs, and AI suggestion scope expansion

alter table public.ai_runs
  drop constraint if exists ai_runs_flow_type_check;

alter table public.ai_runs
  add constraint ai_runs_flow_type_check
  check (
    flow_type in (
      'job_analysis',
      'follow_up_questions',
      'tailored_draft',
      'block_suggest',
      'block_compare',
      'multi_option',
      'import_improve',
      'summary',
      'improve'
    )
  );

alter table public.ai_suggestions
  add column if not exists master_cv_id uuid references public.master_cvs(id) on delete cascade;

alter table public.ai_suggestions
  alter column tailored_cv_id drop not null;

alter table public.ai_suggestions
  drop constraint if exists ai_suggestions_target_scope_check;

alter table public.ai_suggestions
  add constraint ai_suggestions_target_scope_check
  check (
    (tailored_cv_id is not null and master_cv_id is null)
    or (tailored_cv_id is null and master_cv_id is not null)
  );

create index if not exists ai_suggestions_master_status_idx
  on public.ai_suggestions (master_cv_id, status, created_at desc)
  where master_cv_id is not null;

create index if not exists ai_suggestions_tailored_block_status_idx
  on public.ai_suggestions (tailored_cv_id, block_id, status, created_at desc)
  where tailored_cv_id is not null and block_id is not null;

create index if not exists ai_suggestions_master_block_status_idx
  on public.ai_suggestions (master_cv_id, block_id, status, created_at desc)
  where master_cv_id is not null and block_id is not null;

create table if not exists public.ai_prompt_configs (
  id uuid primary key default gen_random_uuid(),
  profile text not null,
  flow_type text not null,
  action_type text null,
  provider text not null default 'gemini',
  model_name text null,
  prompt_key text not null,
  prompt_version text not null,
  system_prompt text not null,
  user_prompt_template text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_prompt_configs_flow_type_check check (
    flow_type in (
      'job_analysis',
      'follow_up_questions',
      'tailored_draft',
      'block_suggest',
      'block_compare',
      'multi_option',
      'import_improve',
      'summary',
      'improve'
    )
  ),
  constraint ai_prompt_configs_action_type_check check (
    action_type is null
    or action_type in (
      'rewrite',
      'summarize',
      'improve',
      'ats_optimize',
      'options',
      'expand',
      'shorten'
    )
  )
);

create unique index if not exists ai_prompt_configs_active_unique_idx
  on public.ai_prompt_configs (profile, flow_type, coalesce(action_type, ''), provider)
  where is_active = true;

create index if not exists ai_prompt_configs_profile_lookup_idx
  on public.ai_prompt_configs (profile, is_active, flow_type, action_type, provider);

drop trigger if exists set_ai_prompt_configs_updated_at on public.ai_prompt_configs;
create trigger set_ai_prompt_configs_updated_at
before update on public.ai_prompt_configs
for each row execute function public.set_updated_at();

alter table public.ai_prompt_configs enable row level security;
