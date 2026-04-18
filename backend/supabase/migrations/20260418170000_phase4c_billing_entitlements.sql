-- Phase 4C: billing + entitlements + usage counter atomic increment support

create index if not exists subscriptions_provider_customer_id_idx
  on public.subscriptions (provider, provider_customer_id)
  where provider_customer_id is not null;

create index if not exists subscriptions_provider_subscription_id_idx
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

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
begin
  v_period_month := date_trunc('month', coalesce(p_period_month, now()::date))::date;

  insert into public.usage_counters (
    user_id,
    period_month,
    tailored_cv_generations_count,
    exports_count,
    ai_actions_count,
    storage_bytes_used,
    updated_at
  )
  values (
    p_user_id,
    v_period_month,
    greatest(p_tailored_cv_generations_increment, 0),
    greatest(p_exports_increment, 0),
    greatest(p_ai_actions_increment, 0),
    greatest(p_storage_bytes_delta, 0),
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
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.increment_usage_counters(uuid, date, integer, integer, integer, bigint)
  to service_role;
