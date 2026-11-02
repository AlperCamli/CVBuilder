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

-- The session that used the free tailoring. Its AI steps (analysis, task runs, refine) stay available
-- without a subscription until it is finished; every other session is gated. free_ai_refinements counts
-- the extra AI rewrites asked for on it (Refine with AI, Regenerate, a changed answer that rewrites
-- suggestions); the backend caps them with a compare-and-set update. Trial and Pro never count.
alter table public.tailoring_sessions
  add column free_tier boolean not null default false,
  add column free_ai_refinements integer not null default 0 check (free_ai_refinements >= 0);

-- Backfill: an earlier successful tailoring or a completed import improvement counts as the free use,
-- dated by its earliest record. A tailoring is successful when a v2 session has an analysis, a tailored
-- CV finished its AI generation, or a v1 draft / v2 analysis run completed; manual copies and failed
-- runs leave the free tailoring available. Accounts pending deletion are skipped (their row is frozen
-- and the app refuses them anyway). Idempotent: only empty markers are set. Backend only.
create function public.backfill_free_tier_markers() returns void
language sql volatile set search_path = ''
as $$
  update public.users u set free_tailoring_used_at = t.first_at
  from (
    select user_id, min(created_at) as first_at from (
      select user_id, created_at from public.tailoring_sessions where analysis is not null
      union all select user_id, created_at from public.tailored_cvs where ai_generation_status = 'completed'
      union all select user_id, started_at from public.ai_runs
        where status = 'completed' and flow_type in ('tailored_draft', 'tailoring_analysis')
    ) used group by user_id
  ) t
  where t.user_id = u.id and u.free_tailoring_used_at is null and u.deletion_requested_at is null;

  update public.users u set free_improve_used_at = r.first_at
  from (select user_id, min(started_at) as first_at from public.ai_runs where flow_type = 'import_improve' and status = 'completed' group by user_id) r
  where r.user_id = u.id and u.free_improve_used_at is null and u.deletion_requested_at is null;
$$;
revoke all on function public.backfill_free_tier_markers() from public, anon, authenticated;
grant execute on function public.backfill_free_tier_markers() to service_role;

select public.backfill_free_tier_markers();

comment on column public.users.free_tailoring_used_at is 'When the one free AI tailoring session (no active/trialing subscription) was started; never cleared.';
comment on column public.users.free_improve_used_at is 'When the one free Improve with AI run (no active/trialing subscription) was started; never cleared.';
comment on column public.tailoring_sessions.free_tier is 'True for the session started as the free tailoring; its AI steps need no subscription until it is finished.';
comment on column public.tailoring_sessions.free_ai_refinements is 'Extra AI rewrites (refine, regenerate, changed answers) used on the free session without a trial or Pro; capped by the backend.';

commit;
