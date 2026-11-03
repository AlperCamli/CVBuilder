-- Promotional email campaigns (docs/promotions/README.md, contract: docs/promotions/spec.md).
-- - A promotion is data: promotions/<slug>/campaign.json, written to these tables by
--   backend/scripts/promotions/setup-campaign.ts. Extending a window is a config change plus a re-run.
-- - promotion_recipients holds each recipient's cohort and personal link token; the webhook marks redemptions.
-- - marketing_email_preferences holds the unsubscribe token and opt-out. The first opted_out_at is kept.
-- - public.promotion_email_queue is a read-only view for the external email agent (docs/promotions/promotion-email-queue.md).
--   The app sends nothing itself; the agent de-duplicates its own sends by (promotion_slug, user_id).
-- Every table is backend-only (service_role); RLS is on with no browser policies. Account deletion removes the
-- recipient and preference rows through their user foreign keys.
begin;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null,
  percent_off integer not null check (percent_off between 1 and 100),
  -- Purchase plan codes the coupon applies to.
  plan_codes text[] not null check (cardinality(plan_codes) > 0 and plan_codes <@ array['weekly','monthly','annual']),
  duration text not null check (duration in ('once','repeating','forever')),
  duration_in_months integer check (duration_in_months > 0),
  replaces_trial boolean not null default true,
  stripe_coupon_id text not null,
  site_url text not null check (site_url ~ '^https?://[^/?#]+$'),
  utm jsonb not null default '{}' check (jsonb_typeof(utm) = 'object'),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint promotions_repeating_months_check check ((duration = 'repeating') = (duration_in_months is not null))
);

create table public.promotion_cohorts (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9_-]{1,32}$'),
  label text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint promotion_cohorts_window_check check (ends_at > starts_at),
  constraint promotion_cohorts_key unique (promotion_id, key)
);

create table public.promotion_recipients (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  cohort_id uuid not null references public.promotion_cohorts(id) on delete cascade,
  -- The ?promo= link token.
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  assigned_at timestamptz not null default now(),
  -- First time the offer was resolved through the link; open_count counts every resolution.
  first_opened_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0),
  -- Set from the checkout.session.completed webhook for a discounted checkout.
  redeemed_at timestamptz,
  redeemed_checkout_session_id text,
  primary key (promotion_id, user_id)
);
create index promotion_recipients_user_idx on public.promotion_recipients(user_id);
create index promotion_recipients_cohort_idx on public.promotion_recipients(cohort_id);

create table public.marketing_email_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger marketing_email_preferences_set_updated_at
before update on public.marketing_email_preferences
for each row execute function public.set_updated_at();

-- Which promotion a checkout used; the promotion row outlives erased accounts' anonymised attempts.
alter table public.checkout_attempts add column promotion_id uuid references public.promotions(id) on delete set null;
create index checkout_attempts_promotion_idx on public.checkout_attempts(promotion_id) where promotion_id is not null;

do $$ declare t text; begin
  foreach t in array array['promotions','promotion_cohorts','promotion_recipients','marketing_email_preferences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- One row per recipient of an unarchived promotion who is still eligible when the query runs. Ended cohorts stay
-- (hours_until_end turns negative); the agent never sends after ends_at. A recipient without a preferences row has
-- no unsubscribe link and is left out.
create view public.promotion_email_queue with (security_invoker = true) as
select p.slug as promotion_slug,
       c.key as cohort_key,
       c.label as cohort_label,
       c.starts_at as send_at,
       c.ends_at,
       round((extract(epoch from (c.ends_at - now())) / 3600)::numeric, 1) as hours_until_end,
       r.user_id,
       u.email,
       u.locale,
       (regexp_match(u.full_name, '^\s*(\S+)'))[1] as first_name,
       rtrim(p.site_url, '/') || case when u.locale = 'tr' then '/tr' else '' end
         || '/pricing?promo=' || r.token
         || coalesce('&utm_source=' || (p.utm ->> 'source'), '')
         || coalesce('&utm_medium=' || (p.utm ->> 'medium'), '')
         || coalesce('&utm_campaign=' || (p.utm ->> 'campaign'), '')
         || '&utm_content=' || c.key as offer_url,
       rtrim(p.site_url, '/') || case when u.locale = 'tr' then '/tr' else '' end
         || '/unsubscribe?t=' || m.unsubscribe_token as unsubscribe_url,
       row_number() over (order by c.starts_at, p.slug, c.key, u.locale, r.user_id) as sort_order
from public.promotion_recipients r
join public.promotions p on p.id = r.promotion_id
join public.promotion_cohorts c on c.id = r.cohort_id
join public.users u on u.id = r.user_id
join public.marketing_email_preferences m on m.user_id = r.user_id
where p.archived_at is null
  and r.redeemed_at is null
  and m.opted_out_at is null
  and not u.is_internal
  and u.deletion_requested_at is null
  and u.processing_restricted_at is null
  and not exists (
    select 1 from public.subscriptions s
    where s.user_id = r.user_id and s.plan_code <> 'free' and s.status in ('active', 'trialing', 'past_due')
  )
order by sort_order;

comment on view public.promotion_email_queue is
  'Promotion email queue for the external email agent (docs/promotions/promotion-email-queue.md). service_role only.';

revoke all on public.promotion_email_queue from public, anon, authenticated, service_role;
grant select on public.promotion_email_queue to service_role;

commit;
