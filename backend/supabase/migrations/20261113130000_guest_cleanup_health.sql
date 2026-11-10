-- Guest uploads pause on the guest sweep alone, so a failing account deletion no longer blocks onboarding.
-- last_success_at, failures, backlog and oldest_expired_at keep their whole-run meaning for monitoring.
alter table public.privacy_cleanup_health add column if not exists guest_cleanup_success_at timestamptz;
comment on column public.privacy_cleanup_health.guest_cleanup_success_at is
  'Last cleanup run whose guest sweep left no due guest_imports row and had no failed deletion. Guest uploads pause when it is over 30 hours old; NULL falls back to last_success_at.';
-- Backfill from evidence only: a run that ended with no guest backlog had nothing left to delete, so it counts
-- from its start; otherwise the last whole-run success. The backend records a real sweep within 30 hours.
update public.privacy_cleanup_health
   set guest_cleanup_success_at = greatest(last_success_at, case when backlog = 0 then last_attempt_at end)
 where guest_cleanup_success_at is null;
