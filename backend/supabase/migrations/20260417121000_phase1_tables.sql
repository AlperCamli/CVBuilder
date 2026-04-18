-- Phase 1 schema foundation tables

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  email text not null,
  full_name text,
  locale text not null default 'en',
  default_cv_language text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_locale_check check (locale in ('en', 'tr'))
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  provider_customer_id text,
  provider_subscription_id text,
  plan_code text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period_month date not null,
  tailored_cv_generations_count integer not null default 0,
  exports_count integer not null default 0,
  ai_actions_count integer not null default 0,
  storage_bytes_used bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint usage_counters_user_id_period_month_key unique (user_id, period_month),
  constraint usage_counters_period_month_check
    check (period_month = date_trunc('month', period_month)::date),
  constraint usage_counters_tailored_cv_generations_count_check
    check (tailored_cv_generations_count >= 0),
  constraint usage_counters_exports_count_check check (exports_count >= 0),
  constraint usage_counters_ai_actions_count_check check (ai_actions_count >= 0),
  constraint usage_counters_storage_bytes_used_check check (storage_bytes_used >= 0)
);

create table if not exists public.cv_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null,
  preview_config jsonb,
  export_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_current_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.auth_user_id = auth.uid()
  );
$$;

grant execute on function public.is_current_user(uuid) to authenticated;

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create unique index if not exists subscriptions_one_active_per_user_idx
  on public.subscriptions (user_id)
  where status in ('active', 'trialing');

create index if not exists usage_counters_user_id_idx on public.usage_counters (user_id);
create index if not exists usage_counters_period_month_idx on public.usage_counters (period_month);
create index if not exists cv_templates_status_idx on public.cv_templates (status);

create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row
execute function public.set_updated_at();

create trigger usage_counters_set_updated_at
before update on public.usage_counters
for each row
execute function public.set_updated_at();

create trigger cv_templates_set_updated_at
before update on public.cv_templates
for each row
execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.cv_templates enable row level security;

create policy users_select_own
on public.users
for select
using (auth.uid() = auth_user_id);

create policy users_insert_own
on public.users
for insert
with check (auth.uid() = auth_user_id);

create policy users_update_own
on public.users
for update
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

create policy subscriptions_select_own
on public.subscriptions
for select
using (public.is_current_user(user_id));

create policy usage_counters_select_own
on public.usage_counters
for select
using (public.is_current_user(user_id));

create policy cv_templates_select_authenticated
on public.cv_templates
for select
using (auth.role() = 'authenticated');
