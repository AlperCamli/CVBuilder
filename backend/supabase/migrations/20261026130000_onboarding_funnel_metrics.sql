-- Onboarding funnel totals by path. Starts and completed signups are anonymous monthly
-- counts with no answers, identifiers or device storage, so they are kept for every
-- visitor; answer breakdowns (questions, referral, signup cohort) still need analytics consent.
begin;

alter table public.onboarding_monthly_stats drop constraint if exists onboarding_monthly_stats_metric_check;
alter table public.onboarding_monthly_stats add constraint onboarding_monthly_stats_metric_check
  check (metric in ('upload','questions','signup','referral','started','completed'));
alter table public.onboarding_monthly_stats add constraint onboarding_monthly_stats_funnel_path_check
  check (metric not in ('started','completed') or option in ('upload','manual_create'));

-- Marks that an account's new-CV signup was counted, so a replayed handoff counts once.
alter table public.users add column onboarding_metrics_counted_at timestamptz;

create function public.bump_onboarding_metric(p_metric text,p_option text) returns void
language sql security definer set search_path=public as $$
  insert into public.onboarding_monthly_stats(month,metric,option,count)
    values(date_trunc('month',now() at time zone 'UTC')::date,p_metric,p_option,1)
  on conflict(month,metric,option) do update set count=onboarding_monthly_stats.count+1;
$$;

-- Upload path: a guest row is created when a visitor picks a file and claimed after signup.
create function public.count_guest_onboarding_funnel() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform public.bump_onboarding_metric('started','upload');
  elsif old.claimed_user_id is null and new.claimed_user_id is not null then
    perform public.bump_onboarding_metric('completed','upload');
  end if;
  return null;
end $$;
create trigger count_guest_onboarding_funnel after insert or update of claimed_user_id on public.guest_imports
  for each row execute function public.count_guest_onboarding_funnel();

-- New-CV path: counted once per account when its answers are first saved after signup.
-- Answer breakdowns follow the same consent rule as count_guest_metrics.
create function public.count_manual_onboarding_signup(p_user uuid,p_answers jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare consented boolean;
begin
  update public.users set onboarding_metrics_counted_at=now()
    where id=p_user and onboarding_metrics_counted_at is null and deletion_requested_at is null
    returning analytics and processing_restricted_at is null into consented;
  if not found then return false; end if;
  perform public.bump_onboarding_metric('completed','manual_create');
  if consented then
    perform public.bump_onboarding_metric('signup','total');
    if coalesce(p_answers,'{}'::jsonb)<>'{}'::jsonb then perform public.bump_onboarding_metric('questions','total'); end if;
    if p_answers->>'source' in ('search','social','friend','community','article','other') then
      perform public.bump_onboarding_metric('referral',p_answers->>'source');
    end if;
  end if;
  return true;
end $$;

-- Procedures are backend-only; default PUBLIC execute must also be revoked.
do $$ declare f text; begin
  foreach f in array array['bump_onboarding_metric(text,text)','count_guest_onboarding_funnel()','count_manual_onboarding_signup(uuid,jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon, authenticated';
    execute 'grant execute on function public.'||f||' to service_role';
  end loop;
end $$;

commit;
