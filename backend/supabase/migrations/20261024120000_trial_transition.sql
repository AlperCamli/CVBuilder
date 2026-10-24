-- One-time release cohort. Accounts created after this migration get normal trial rules.
begin;
create table public.trial_transition_grants (
  user_id uuid primary key references public.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  redeemed_at timestamptz,
  provider_subscription_id text
);
alter table public.trial_transition_grants enable row level security;
-- Only the backend service role can read or redeem grants.
revoke all on public.trial_transition_grants from anon, authenticated;
grant select, insert, update, delete on public.trial_transition_grants to service_role;
insert into public.trial_transition_grants (user_id)
select id from public.users;
commit;
