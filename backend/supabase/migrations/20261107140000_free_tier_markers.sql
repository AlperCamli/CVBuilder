-- Free tier: accounts without an active or trialing subscription get one AI tailoring
-- session and one "Improve with AI" run. The backend sets each marker with a conditional
-- update (... where marker is null) when the free use starts, so concurrent requests cannot
-- claim it twice. Deleting the CV never clears it, and trialing/Pro accounts never set it.
-- Privacy: both markers are columns on users, so the data download (select *) includes them
-- and account erasure removes them with the row. Browser roles have no write grants on
-- users, so an account cannot reset its own marker.
begin;

alter table public.users
  add column free_tailoring_used_at timestamptz,
  add column free_improve_used_at timestamptz;

-- The session that used the free tailoring. Its later AI steps (analysis, task runs,
-- refine) stay available without a subscription; every other session is gated.
alter table public.tailoring_sessions add column free_tier boolean not null default false;

-- Backfill: earlier tailoring (v2 sessions, tailored CVs, tailoring AI runs) or an earlier
-- import improvement counts as the free use, dated by its earliest record. Accounts pending
-- deletion are skipped (their row is frozen and the app refuses them anyway).
update public.users u set free_tailoring_used_at = t.first_at
from (
  select user_id, min(created_at) as first_at from (
    select user_id, created_at from public.tailoring_sessions
    union all select user_id, created_at from public.tailored_cvs
    union all select user_id, started_at from public.ai_runs
      where flow_type in ('job_analysis','follow_up_questions','tailored_draft','tailoring_analysis','tailoring_block','tailoring_skills','tailoring_structure')
  ) used group by user_id
) t
where t.user_id = u.id and u.free_tailoring_used_at is null and u.deletion_requested_at is null;

update public.users u set free_improve_used_at = r.first_at
from (select user_id, min(started_at) as first_at from public.ai_runs where flow_type = 'import_improve' group by user_id) r
where r.user_id = u.id and u.free_improve_used_at is null and u.deletion_requested_at is null;

comment on column public.users.free_tailoring_used_at is 'When the one free AI tailoring session (no active/trialing subscription) was started; never cleared.';
comment on column public.users.free_improve_used_at is 'When the one free Improve with AI run (no active/trialing subscription) was started; never cleared.';
comment on column public.tailoring_sessions.free_tier is 'True for the session started as the free tailoring; its AI steps need no subscription.';

commit;
