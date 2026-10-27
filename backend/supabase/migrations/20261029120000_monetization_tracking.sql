-- Monetization tracking for analysis. Every table and column here only records billing
-- facts; nothing in the application reads them to grant or deny access.
-- Erased accounts keep their billing history anonymised: user_id and provider ids are
-- cleared by archive_billing_history, amounts, plans and dates remain.
begin;

-- Accounts excluded from analysis (test/admin). Admin emails are synced by the daily refresh.
alter table public.users add column is_internal boolean not null default false;

-- Descriptive Stripe fields; access is still decided by status and current_period_end only.
alter table public.subscriptions
  add column trial_start timestamptz,
  add column trial_end timestamptz,
  add column canceled_at timestamptz,
  add column ended_at timestamptz,
  add column cancellation_reason text,
  add column cancellation_feedback text,
  add column unit_amount bigint,
  add column currency text,
  add column billing_interval text check (billing_interval in ('day','week','month','year','one_time')),
  add column market text check (market in ('TR','GLOBAL')),
  add column last_provider_event_id text,
  add column last_provider_event_at timestamptz;

-- subscription_id is deliberately not a foreign key: erasure deletes the subscription row,
-- and the bare uuid keeps an anonymised account's history grouped.
create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null check (event_type in ('created','trial_started','trial_converted','trial_canceled','activated','renewed',
    'plan_changed','cancel_scheduled','cancel_unscheduled','past_due','canceled','superseded','reactivated','status_changed')),
  from_status text,
  to_status text,
  from_plan_code text,
  to_plan_code text,
  stripe_event_id text,
  source text not null check (source in ('stripe','app','backfill','account_deletion')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  -- One Stripe event can produce several changes (e.g. plan_changed and cancel_scheduled).
  constraint subscription_events_stripe_event_key unique (stripe_event_id, event_type)
);
create index subscription_events_subscription_idx on public.subscription_events(subscription_id, occurred_at);
create index subscription_events_user_idx on public.subscription_events(user_id);
create index subscription_events_type_idx on public.subscription_events(event_type, occurred_at);

-- One row per Stripe invoice (or legacy one-time purchase), refreshed from Stripe on every event.
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  subscription_id uuid,
  provider text not null default 'stripe',
  provider_invoice_id text unique,
  provider_subscription_id text,
  status text not null check (status in ('draft','open','paid','void','uncollectible','refunded','partially_refunded')),
  currency text not null,
  amount_subtotal bigint not null default 0,
  amount_discount bigint not null default 0,
  amount_tax bigint not null default 0,
  amount_total bigint not null default 0,
  amount_paid bigint not null default 0,
  amount_refunded bigint not null default 0,
  billing_reason text,
  plan_code text,
  market text check (market in ('TR','GLOBAL')),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  -- Invoice creation time at Stripe, not insert time.
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index billing_invoices_user_idx on public.billing_invoices(user_id);
create index billing_invoices_subscription_idx on public.billing_invoices(subscription_id);
create index billing_invoices_provider_subscription_idx on public.billing_invoices(provider_subscription_id) where provider_subscription_id is not null;
create index billing_invoices_paid_at_idx on public.billing_invoices(paid_at);

-- Every createCheckoutSession call, including the ones rejected before reaching Stripe.
create table public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  plan_code text not null,
  market text check (market in ('TR','GLOBAL')),
  currency text,
  amount bigint,
  trial_requested boolean not null,
  trial_applied boolean not null default false,
  checkout_session_id text unique,
  outcome text not null check (outcome in ('open','completed','expired','canceled','rejected_pending','rejected_active','rejected_pricing_changed','failed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index checkout_attempts_created_idx on public.checkout_attempts(created_at);
create index checkout_attempts_user_idx on public.checkout_attempts(user_id);

-- Daily paywall hits. user_id is kept only with analytics consent; otherwise the hit is
-- counted in an anonymous row (user_id null) so totals stay complete.
create table public.entitlement_denials (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  user_id uuid references public.users(id) on delete cascade,
  plan_code text not null,
  action text not null,
  surface text not null default '',
  reason text not null check (reason in ('no_subscription','subscription_inactive','trial_expired','free_limit')),
  count integer not null default 1 check (count > 0),
  constraint entitlement_denials_key unique nulls not distinct (day, user_id, plan_code, action, surface, reason)
);
create index entitlement_denials_user_idx on public.entitlement_denials(user_id) where user_id is not null;

-- One row per consenting user per active day (DAU/WAU/MAU without a sessions table).
create table public.user_activity_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  activity_date date not null,
  constraint user_activity_days_key unique (user_id, activity_date)
);
create index user_activity_days_date_idx on public.user_activity_days(activity_date);

-- Monthly average USD->TRY from ECB reference rates; the current month is month-to-date.
create table public.fx_rates (
  rate_month date not null check (rate_month = date_trunc('month', rate_month)::date),
  base_currency text not null,
  quote_currency text not null,
  rate numeric(18,8) not null check (rate > 0),
  sample_days integer not null check (sample_days > 0),
  source text not null,
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (rate_month, base_currency, quote_currency)
);

-- Stripe prices configured through env (current and historical), with their real amounts.
create table public.billing_price_catalog (
  provider_price_id text primary key,
  plan_code text not null,
  market text check (market in ('TR','GLOBAL')),
  currency text,
  unit_amount bigint,
  billing_interval text,
  interval_count integer,
  product_id text,
  stripe_active boolean,
  is_configured boolean not null,
  first_seen_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now()
);

-- Plan limits and features as defined in code (plan-definitions.ts) at refresh time.
create table public.billing_plan_catalog (
  plan_code text primary key,
  name text not null,
  limits jsonb not null,
  features jsonb not null,
  checkout_allowed boolean not null,
  trial_supported boolean not null,
  trial_days integer not null,
  legacy boolean not null default false,
  refreshed_at timestamptz not null default now()
);

-- Fixed size of the 2026-10-24 trial release cohort; grants disappear as accounts are erased.
create table public.trial_transition_cohorts (
  cohort text primary key,
  granted_at timestamptz not null,
  cohort_size integer not null,
  erased_count integer not null default 0,
  erased_redeemed_count integer not null default 0,
  snapshot_at timestamptz not null default now()
);
-- Accounts erased between the grant and this migration are not included.
insert into public.trial_transition_cohorts(cohort, granted_at, cohort_size)
select 'release_2026_10_24', min(granted_at), count(*) from public.trial_transition_grants
having count(*) > 0;

-- Anonymous subscription counts by state at erasure time.
create table public.subscription_erasure_stats (
  month date not null,
  plan_code text not null,
  status text not null,
  count integer not null check (count > 0),
  primary key (month, plan_code, status)
);

alter table public.usage_counters
  add column plan_code text,
  add column subscription_id uuid;

do $$ declare t text; begin
  foreach t in array array['subscription_events','billing_invoices','checkout_attempts','entitlement_denials','user_activity_days',
    'fx_rates','billing_price_catalog','billing_plan_catalog','trial_transition_cohorts','subscription_erasure_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Copies the locked billing market onto paid subscriptions and invoices.
create function public.stamp_billing_market() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.market is null and new.user_id is not null then
    select market into new.market from public.billing_markets where user_id = new.user_id;
  end if;
  return new;
end $$;
create trigger stamp_subscription_market before insert or update on public.subscriptions
  for each row when (new.market is null and new.provider_subscription_id is not null)
  execute function public.stamp_billing_market();
create trigger stamp_invoice_market before insert or update on public.billing_invoices
  for each row when (new.market is null)
  execute function public.stamp_billing_market();

-- Derives the subscription history from row changes, so webhook syncs, superseding and
-- legacy purchases are all covered without touching the billing code paths.
-- Never blocks the subscription write: failures are reported as warnings.
create function public.record_subscription_events() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  from_stripe boolean;
  event_id text;
  event_at timestamptz;
  event_source text;
  status_event text;
begin
  if new.provider_subscription_id is null then return null; end if;
  begin
    from_stripe := new.last_provider_event_id is not null
      and (tg_op = 'INSERT' or new.last_provider_event_id is distinct from old.last_provider_event_id);
    event_id := case when from_stripe then new.last_provider_event_id end;
    event_at := case when from_stripe then coalesce(new.last_provider_event_at, now()) else now() end;
    event_source := case when from_stripe then 'stripe' else 'app' end;

    if tg_op = 'INSERT' then
      -- An invoice can arrive before its subscription row exists.
      update public.billing_invoices set subscription_id = new.id
        where provider_subscription_id = new.provider_subscription_id and subscription_id is null;
      insert into public.subscription_events(subscription_id,user_id,event_type,to_status,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,'created',new.status,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
      if new.status in ('trialing','active') then
        insert into public.subscription_events(subscription_id,user_id,event_type,to_status,to_plan_code,stripe_event_id,source,occurred_at)
          values(new.id,new.user_id,case new.status when 'trialing' then 'trial_started' else 'activated' end,new.status,new.plan_code,event_id,event_source,event_at)
          on conflict on constraint subscription_events_stripe_event_key do nothing;
      end if;
      return null;
    end if;

    if new.plan_code is distinct from old.plan_code then
      insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,'plan_changed',old.status,new.status,old.plan_code,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
    end if;

    if new.status is distinct from old.status then
      status_event := case
        when old.status = 'trialing' and new.status = 'active' then 'trial_converted'
        when old.status in ('active','trialing') and new.status = 'inactive' then 'superseded'
        when old.status = 'trialing' and new.status in ('canceled','incomplete_expired') then 'trial_canceled'
        when new.status = 'canceled' then 'canceled'
        when new.status in ('past_due','unpaid') then 'past_due'
        when new.status = 'active' and old.status in ('past_due','unpaid','canceled','inactive','paused') then 'reactivated'
        when new.status = 'active' then 'activated'
        when new.status = 'trialing' then 'trial_started'
        else 'status_changed' end;
      insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,status_event,old.status,new.status,old.plan_code,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
    elsif new.status = 'active' and new.current_period_start > old.current_period_start then
      insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,'renewed',old.status,new.status,old.plan_code,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
    end if;

    if new.cancel_at_period_end and not old.cancel_at_period_end then
      insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,'cancel_scheduled',old.status,new.status,old.plan_code,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
    elsif old.cancel_at_period_end and not new.cancel_at_period_end and new.status in ('active','trialing') then
      insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,stripe_event_id,source,occurred_at)
        values(new.id,new.user_id,'cancel_unscheduled',old.status,new.status,old.plan_code,new.plan_code,event_id,event_source,event_at)
        on conflict on constraint subscription_events_stripe_event_key do nothing;
    end if;
  exception when others then
    raise warning 'subscription event not recorded: %', sqlerrm;
  end;
  return null;
end $$;
create trigger record_subscription_events after insert or update on public.subscriptions
  for each row execute function public.record_subscription_events();

-- Existing subscriptions start their history with one snapshot row at creation time.
insert into public.subscription_events(subscription_id,user_id,event_type,to_status,to_plan_code,source,occurred_at)
select id,user_id,'created',status,plan_code,'backfill',created_at from public.subscriptions
where provider_subscription_id is not null;
-- Subjects being erased or restricted reject subscription writes; their rows are left as is.
update public.subscriptions s set market = b.market from public.billing_markets b, public.users u
where b.user_id = s.user_id and u.id = s.user_id and s.provider_subscription_id is not null and s.market is null
  and u.deletion_requested_at is null and u.processing_restricted_at is null;

-- Same signature as before; additionally stamps the plan the usage happened on.
-- With a mid-month plan change the row keeps the latest plan.
create or replace function public.increment_usage_counters(
  p_user_id uuid,
  p_period_month date,
  p_tailored_cv_generations_increment integer default 0,
  p_exports_increment integer default 0,
  p_ai_actions_increment integer default 0,
  p_storage_bytes_delta bigint default 0
)
returns public.usage_counters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_month date;
  v_row public.usage_counters;
  v_plan_code text := 'free';
  v_subscription_id uuid;
begin
  v_period_month := date_trunc('month', coalesce(p_period_month, now()::date))::date;

  select id, plan_code into v_subscription_id, v_plan_code from public.subscriptions
  where user_id = p_user_id and status in ('active', 'trialing')
  order by current_period_end desc nulls last limit 1;
  v_plan_code := coalesce(v_plan_code, 'free');

  insert into public.usage_counters (
    user_id,
    period_month,
    tailored_cv_generations_count,
    exports_count,
    ai_actions_count,
    storage_bytes_used,
    plan_code,
    subscription_id,
    updated_at
  )
  values (
    p_user_id,
    v_period_month,
    greatest(p_tailored_cv_generations_increment, 0),
    greatest(p_exports_increment, 0),
    greatest(p_ai_actions_increment, 0),
    greatest(p_storage_bytes_delta, 0),
    v_plan_code,
    v_subscription_id,
    now()
  )
  on conflict (user_id, period_month)
  do update
  set
    tailored_cv_generations_count = greatest(
      public.usage_counters.tailored_cv_generations_count + p_tailored_cv_generations_increment,
      0
    ),
    exports_count = greatest(public.usage_counters.exports_count + p_exports_increment, 0),
    ai_actions_count = greatest(public.usage_counters.ai_actions_count + p_ai_actions_increment, 0),
    storage_bytes_used = greatest(public.usage_counters.storage_bytes_used + p_storage_bytes_delta, 0),
    plan_code = v_plan_code,
    subscription_id = v_subscription_id,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create function public.record_entitlement_denial(p_user uuid,p_plan text,p_action text,p_surface text,p_reason text)
returns void language sql security definer set search_path=public as $$
  insert into public.entitlement_denials(day,user_id,plan_code,action,surface,reason)
  select (now() at time zone 'UTC')::date, case when u.analytics then u.id end, p_plan, p_action, coalesce(p_surface,''), p_reason
  from public.users u where u.id = p_user and not u.is_internal and u.deletion_requested_at is null and u.processing_restricted_at is null
  on conflict on constraint entitlement_denials_key do update set count = public.entitlement_denials.count + 1;
$$;

create function public.record_user_activity(p_user uuid) returns void
language sql security definer set search_path=public as $$
  insert into public.user_activity_days(user_id, activity_date)
  select id, (now() at time zone 'UTC')::date from public.users
  where id = p_user and analytics and deletion_requested_at is null and processing_restricted_at is null
  on conflict do nothing;
$$;

-- Moves a user's denial counts into the anonymous rows (consent withdrawn or erasure).
create function public.anonymize_entitlement_denials(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.entitlement_denials(day,user_id,plan_code,action,surface,reason,count)
  select day,null,plan_code,action,surface,reason,count from public.entitlement_denials where user_id = p_user
  on conflict on constraint entitlement_denials_key do update set count = public.entitlement_denials.count + excluded.count;
  delete from public.entitlement_denials where user_id = p_user;
end $$;

-- Withdrawing analytics consent removes the per-user activity and denial attribution.
create function public.forget_user_analytics() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.analytics and not new.analytics then
    delete from public.user_activity_days where user_id = new.id;
    perform public.anonymize_entitlement_denials(new.id);
  end if;
  return null;
end $$;
create trigger forget_user_analytics after update of analytics on public.users
  for each row execute function public.forget_user_analytics();

-- Called by the erasure worker before the subscription rows are deleted. Idempotent:
-- a resumed job finds no subscriptions or grants left and changes nothing.
create function public.archive_billing_history(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  perform 1 from public.users where id = p_user for update;

  -- Stripe's cancellation webhooks are ignored for erased accounts, so record the end here.
  insert into public.subscription_events(subscription_id,user_id,event_type,from_status,to_status,from_plan_code,to_plan_code,source,occurred_at)
  select id,null,'canceled',status,'canceled',plan_code,plan_code,'account_deletion',now() from public.subscriptions
  where user_id = p_user and provider_subscription_id is not null
    and status in ('active','trialing','past_due','unpaid','paused','incomplete');

  insert into public.subscription_erasure_stats(month,plan_code,status,count)
  select v_month,plan_code,status,count(*) from public.subscriptions
  where user_id = p_user and provider_subscription_id is not null group by plan_code,status
  on conflict (month,plan_code,status) do update set count = public.subscription_erasure_stats.count + excluded.count;

  update public.trial_transition_cohorts c set erased_count = c.erased_count + 1,
    erased_redeemed_count = c.erased_redeemed_count + (g.redeemed_at is not null)::int
  from public.trial_transition_grants g where g.user_id = p_user and c.cohort = 'release_2026_10_24';
  delete from public.trial_transition_grants where user_id = p_user;

  update public.subscription_events set user_id = null, stripe_event_id = null where user_id = p_user;
  update public.billing_invoices set user_id = null, provider_invoice_id = null, provider_subscription_id = null where user_id = p_user;
  update public.checkout_attempts set user_id = null, checkout_session_id = null where user_id = p_user;
  perform public.anonymize_entitlement_denials(p_user);
  delete from public.user_activity_days where user_id = p_user;
  delete from public.subscriptions where user_id = p_user;
end $$;

do $$ declare f text; begin
  foreach f in array array['stamp_billing_market()','record_subscription_events()','record_entitlement_denial(uuid,text,text,text,text)',
    'record_user_activity(uuid)','anonymize_entitlement_denials(uuid)','forget_user_analytics()','archive_billing_history(uuid)'] loop
    execute 'revoke all on function public.'||f||' from public, anon, authenticated';
    execute 'grant execute on function public.'||f||' to service_role';
  end loop;
end $$;
revoke all on function public.increment_usage_counters(uuid, date, integer, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.increment_usage_counters(uuid, date, integer, integer, integer, bigint) to service_role;

notify pgrst, 'reload schema';
commit;
