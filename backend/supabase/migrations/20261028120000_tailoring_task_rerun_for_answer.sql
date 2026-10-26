-- Tailoring v2: a task re-queued because a question it uses was answered (or re-answered)
-- after it ran. Additive and idempotent; existing rows default to false.
alter table public.tailoring_session_tasks
  add column if not exists rerun_for_answer boolean not null default false;
