-- Entry onboarding marker: set once an account has been through the landing onboarding
-- (claimed a guest upload or saved the new-CV setup) or owns a CV. Accounts without it are
-- sent to /onboarding by the app shell, so a signup through /signin or a deep link cannot
-- skip the planned flow. Unlike onboarding_metrics_counted_at (analytics, best effort),
-- this column gates navigation and is written in the same request as the handoff.
begin;

alter table public.users add column entry_onboarding_completed_at timestamptz;

-- Backfilled rows carry the migration time, not the real completion time. Accounts with no
-- CV, upload or answers stay null and see the onboarding on their next visit.
update public.users u set entry_onboarding_completed_at = now()
where u.onboarding_metrics_counted_at is not null
   or u.onboarding_answers <> '{}'::jsonb
   or exists (select 1 from public.master_cvs m where m.user_id = u.id)
   or exists (select 1 from public.imports i where i.user_id = u.id)
   or exists (select 1 from public.guest_imports g where g.claimed_user_id = u.id);

-- The trigger argument names the column holding the account id on the firing table.
create function public.mark_entry_onboarding_completed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.users set entry_onboarding_completed_at = now()
    where id = (to_jsonb(new) ->> tg_argv[0])::uuid and entry_onboarding_completed_at is null;
  return null;
end $$;

-- Upload path: the claim is the handoff. Owning a CV also counts, whatever created it.
create trigger mark_entry_onboarding_on_claim after update of claimed_user_id on public.guest_imports
  for each row when (old.claimed_user_id is null and new.claimed_user_id is not null)
  execute function public.mark_entry_onboarding_completed('claimed_user_id');
create trigger mark_entry_onboarding_on_master_cv after insert on public.master_cvs
  for each row execute function public.mark_entry_onboarding_completed('user_id');

revoke all on function public.mark_entry_onboarding_completed() from public, anon, authenticated;
grant execute on function public.mark_entry_onboarding_completed() to service_role;

commit;
