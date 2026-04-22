-- Phase 7 AI run progress stages and debug payload diagnostics

alter table public.ai_runs
  add column if not exists progress_stage text not null default 'queued',
  add column if not exists debug_payload jsonb;

update public.ai_runs
set progress_stage = case
  when status = 'completed' then 'completed'
  when status = 'failed' then 'failed'
  else coalesce(progress_stage, 'queued')
end
where progress_stage is null
   or status in ('completed', 'failed');

alter table public.ai_runs
  drop constraint if exists ai_runs_progress_stage_check;

alter table public.ai_runs
  add constraint ai_runs_progress_stage_check check (
    progress_stage in (
      'queued',
      'building_prompt',
      'calling_model',
      'parsing_output',
      'validating_output',
      'persisting_result',
      'completed',
      'failed'
    )
  );

create index if not exists ai_runs_user_status_progress_idx
  on public.ai_runs (user_id, status, progress_stage, started_at desc);
