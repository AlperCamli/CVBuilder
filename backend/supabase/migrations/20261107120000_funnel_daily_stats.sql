-- Anonymous visitor funnel: daily event counters written by POST /api/v1/funnel-events, plus the admin metrics that
-- read them (visitor_funnel, visitor_trend, visitor_event_details) and the pre-signup onboarding totals of
-- public.onboarding_monthly_stats (pre_signup_onboarding, onboarding_referrals).
-- Like bump_onboarding_metric (20261026130000_onboarding_funnel_metrics.sql), a counter is an anonymous daily total:
-- no identifiers, IP, user agent, cookies, device storage or free text (event, detail and utm_source come from backend
-- allowlists: a detail outside its event's list is dropped and an unknown utm_source is stored as 'other'), so it is
-- kept for every visitor without analytics consent. GA4 stays opt-in.
begin;

create table public.funnel_daily_stats (
  day date not null,
  event text not null check (event ~ '^[a-z][a-z0-9_]{0,39}$'),
  detail text not null default '' check (detail ~ '^([a-z][a-z0-9_]{0,31})?$'),
  locale text not null check (locale in ('en', 'tr')),
  device text not null check (device in ('mobile', 'desktop')),
  utm_source text not null default '' check (utm_source ~ '^([a-z0-9][a-z0-9_.-]{0,39})?$'),
  count bigint not null default 0 check (count >= 0),
  primary key (day, event, detail, locale, device, utm_source)
);
alter table public.funnel_daily_stats enable row level security;
revoke all on public.funnel_daily_stats from public, anon, authenticated;
grant all on public.funnel_daily_stats to service_role;

-- The event, detail and utm_source allowlists live in the backend (funnel-events.contract.ts, mirroring
-- frontend/src/app/integration/funnel-events.ts), so extending them needs no migration; the checks above only bound
-- the shape.
create function public.bump_funnel_event(p_event text, p_detail text, p_locale text, p_device text, p_utm_source text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.funnel_daily_stats(day, event, detail, locale, device, utm_source, count)
    values ((now() at time zone 'UTC')::date, p_event, coalesce(p_detail, ''), p_locale, p_device, coalesce(p_utm_source, ''), 1)
  on conflict (day, event, detail, locale, device, utm_source)
    do update set count = public.funnel_daily_stats.count + 1;
$$;
revoke all on function public.bump_funnel_event(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bump_funnel_event(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Shared: funnel rows in range with the dimension values the metrics filter and break down by
-- ---------------------------------------------------------------------------

create function analytics_private.funnel_rows(p_from date, p_to date, p_filters jsonb)
returns table (day date, event text, detail text, locale text, device text, utm_source text, n bigint)
language sql stable set search_path = ''
as $$
  select s.day, s.event, s.detail, s.locale, s.device, coalesce(nullif(s.utm_source, ''), '(none)'), s.count
  from public.funnel_daily_stats s
  where s.day between p_from and p_to
    and (analytics_private.filter_values(p_filters, 'locale') is null or s.locale = any (analytics_private.filter_values(p_filters, 'locale')))
    and (analytics_private.filter_values(p_filters, 'device') is null or s.device = any (analytics_private.filter_values(p_filters, 'device')))
    and (analytics_private.filter_values(p_filters, 'utm_source') is null
         or coalesce(nullif(s.utm_source, ''), '(none)') = any (analytics_private.filter_values(p_filters, 'utm_source')))
$$;

-- ---------------------------------------------------------------------------
-- analytics.visitor_funnel
-- ---------------------------------------------------------------------------

create function analytics.visitor_funnel(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  step_order integer, step text, dimension text, users bigint, conversion_from_prev numeric, conversion_from_start numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['locale', 'device', 'utm_source'], array['locale', 'device', 'utm_source']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with steps(step_order, step, events) as (values
    (1, 'landing_view', array['landing_view']),
    (2, 'cta_click', array['cta_click']),
    (3, 'onboarding_view', array['onboarding_upload_view']),
    (4, 'onboarding_started', array['onboarding_upload_started', 'onboarding_manual_create']),
    (5, 'signup_view', array['onboarding_signup_view']),
    (6, 'signup_completed', array['signup_completed']),
    (7, 'score_view', array['score_view']),
    (8, 'checkout_view', array['checkout_view']),
    (9, 'checkout_redirect', array['checkout_redirect']),
    (10, 'checkout_success', array['checkout_success'])
  ),
  f as (
    select case p_breakdown when 'locale' then x.locale when 'device' then x.device when 'utm_source' then x.utm_source end as dim,
           x.event, x.n
    from analytics_private.funnel_rows(r.from_day, r.to_day, p_filters) x
  ),
  dims as (
    select distinct f.dim from f
    union
    select null where p_breakdown is null
  ),
  counted as (
    select d.dim, s.step_order, s.step, coalesce(sum(f.n), 0)::bigint as n
    from dims d
    cross join steps s
    left join f on f.dim is not distinct from d.dim and f.event = any (s.events)
    group by d.dim, s.step_order, s.step
  )
  select c.step_order, c.step, c.dim, c.n,
         case when c.step_order = 1 then null
              else round(c.n::numeric / nullif(lag(c.n) over (partition by c.dim order by c.step_order), 0), 4) end,
         round(c.n::numeric / nullif(first_value(c.n) over (partition by c.dim order by c.step_order), 0), 4)
  from counted c
  order by c.dim nulls first, c.step_order;
end $$;

comment on function analytics.visitor_funnel(date, date, text, text, boolean, text, jsonb) is
'{"title":"Visitor funnel","definition":"Anonymous first-party event counts per funnel step for the range (UTC days), from public.funnel_daily_stats (recorded from 2026-11-07 for every visitor, consent or not: no identifiers, so these are events, not unique people; a reload or a second visit counts again). Steps: landing_view (landing page views, / and /tr); cta_click (start buttons on landing and pricing, every placement); onboarding_view (the /onboarding upload screen); onboarding_started (a CV upload started or the new-CV path chosen); signup_view (the signup step of the onboarding); signup_completed (email or Google account created); score_view (CV score screen); checkout_view (in-app checkout screen); checkout_redirect (sent to Stripe Checkout); checkout_success (returned from a completed Stripe Checkout). Visitors can enter mid-funnel (a direct link to /onboarding or /signin), so a step can exceed the previous one and conversion_from_prev can be above 100%. conversion_from_start = step / landing views. Internal accounts cannot be told apart (no identifiers), so include_internal does not apply. Locale = the page language (/tr or the document language); device = mobile below 768 px viewport width, else desktop; utm_source = the utm_source of the landing URL ((none) without one; sources outside the backend allowlist count as other), kept for the rest of the page session but lost on a full reload or the Google sign-in redirect. Bots are dropped by user agent; per-IP rate limited. Grain and currency do not apply.","unit":"count","shape":"funnel","breakdowns":["locale","device","utm_source"],"filters":["locale","device","utm_source"],"consent_scoped":false,"alertable":false,"min_group":20,"measures":{"users":{"label":"Events","unit":"count","description":"Events counted for the step (not unique visitors)"},"conversion_from_prev":{"label":"Step conversion","unit":"ratio","description":"Events of this step / events of the previous step"},"conversion_from_start":{"label":"Conversion from landing","unit":"ratio"}}}';

-- ---------------------------------------------------------------------------
-- analytics.visitor_trend
-- ---------------------------------------------------------------------------

create function analytics.visitor_trend(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, landing_views bigint, pricing_views bigint, cta_clicks bigint, onboarding_starts bigint,
  signups bigint, checkout_redirects bigint, checkout_successes bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['locale', 'device', 'utm_source']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with f as (
    select analytics_private.bucket(analytics_private.utc_start(x.day), p_grain) as b, x.event, x.n
    from analytics_private.funnel_rows(r.from_day, r.to_day, p_filters) x
  )
  select k.b, null::text,
         coalesce(sum(f.n) filter (where f.event = 'landing_view'), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event = 'pricing_view'), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event = 'cta_click'), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event in ('onboarding_upload_started', 'onboarding_manual_create')), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event = 'signup_completed'), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event = 'checkout_redirect'), 0)::bigint,
         coalesce(sum(f.n) filter (where f.event = 'checkout_success'), 0)::bigint
  from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
  left join f on f.b = k.b
  group by k.b
  order by k.b;
end $$;

comment on function analytics.visitor_trend(date, date, text, text, boolean, text, jsonb) is
'{"title":"Visitor trend","definition":"Anonymous first-party event counts per period (UTC) from public.funnel_daily_stats (from 2026-11-07, every visitor, events not unique people). landing_views = landing page views; pricing_views = pricing page views; cta_clicks = start buttons on landing and pricing; onboarding_starts = CV upload started or new-CV path chosen; signups = accounts created (email or Google); checkout_redirects = sent to Stripe Checkout; checkout_successes = returned from a completed checkout. Same population, locale, device and utm_source rules as analytics.visitor_funnel; include_internal and currency do not apply.","unit":"count","shape":"timeseries","breakdowns":[],"filters":["locale","device","utm_source"],"consent_scoped":false,"alertable":false,"min_group":20,"plot":["landing_views","onboarding_starts","signups","checkout_redirects"],"measures":{"landing_views":{"label":"Landing views","unit":"count"},"pricing_views":{"label":"Pricing views","unit":"count"},"cta_clicks":{"label":"Start clicks","unit":"count"},"onboarding_starts":{"label":"Onboarding starts","unit":"count"},"signups":{"label":"Signups","unit":"count"},"checkout_redirects":{"label":"Sent to Stripe","unit":"count"},"checkout_successes":{"label":"Checkouts completed","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.visitor_event_details
-- ---------------------------------------------------------------------------

create function analytics.visitor_event_details(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (dimension text, events bigint, share_of_event numeric, event text, detail text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['locale', 'device', 'utm_source']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with g as (
    select x.event, x.detail, sum(x.n)::bigint as n
    from analytics_private.funnel_rows(r.from_day, r.to_day, p_filters) x
    where x.detail <> ''
    group by x.event, x.detail
  )
  select g.event || ': ' || g.detail, g.n,
         round(g.n::numeric / nullif(sum(g.n) over (partition by g.event), 0), 4),
         g.event, g.detail
  from g
  order by g.event, g.n desc, g.detail;
end $$;

comment on function analytics.visitor_event_details(date, date, text, text, boolean, text, jsonb) is
'{"title":"Funnel event details","definition":"Anonymous first-party events of the range (UTC) that carry a detail, from public.funnel_daily_stats (from 2026-11-07, every visitor, events not unique people), one row per event and detail: cta_click by placement (header, hero, final, mascot, pricing_trial, pricing_pro, template, demo_export), signup_completed by method (google, email), onboarding_question_view by question, onboarding_score_preview (scored, unscored), score_action, paywall_shown by surface, checkout_view / checkout_redirect / checkout_success by plan (trial, pro). share_of_event = the row / all detailed events of the same event. Same locale, device and utm_source rules as analytics.visitor_funnel; include_internal, grain and currency do not apply.","unit":"count","shape":"breakdown","breakdowns":[],"filters":["locale","device","utm_source"],"consent_scoped":false,"alertable":false,"min_group":20,"measures":{"events":{"label":"Events","unit":"count"},"share_of_event":{"label":"Share of event","unit":"ratio","description":"Of the same event''s detailed events"},"dimension":{"label":"Event: detail","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.pre_signup_onboarding (public.onboarding_monthly_stats, monthly)
-- ---------------------------------------------------------------------------

create function analytics.pre_signup_onboarding(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  step_order integer, step text, dimension text, users bigint, conversion_from_prev numeric, conversion_from_start numeric,
  first_month date, last_month date
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_first date;
  v_last date;
  v_paths text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['onboarding_path']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_first := date_trunc('month', r.from_day)::date;
  v_last := date_trunc('month', r.to_day)::date;
  v_paths := analytics_private.filter_values(p_filters, 'onboarding_path');

  return query
  with paths(path) as (values ('upload'), ('manual_create')),
  agg as (
    select s.option as path,
           coalesce(sum(s.count) filter (where s.metric = 'started'), 0)::bigint as started,
           coalesce(sum(s.count) filter (where s.metric = 'completed'), 0)::bigint as completed
    from public.onboarding_monthly_stats s
    where s.month between v_first and v_last and s.metric in ('started', 'completed')
    group by s.option
  )
  select v.step_order, v.step, p.path, v.n,
         case when v.step_order = 1 then null else round(v.n::numeric / nullif(coalesce(a.started, 0), 0), 4) end,
         round(v.n::numeric / nullif(coalesce(a.started, 0), 0), 4),
         v_first, v_last
  from paths p
  left join agg a on a.path = p.path
  cross join lateral (values (1, 'started', coalesce(a.started, 0)), (2, 'signed_up', coalesce(a.completed, 0))) v(step_order, step, n)
  where v_paths is null or p.path = any (v_paths)
  order by p.path desc, v.step_order;
end $$;

comment on function analytics.pre_signup_onboarding(date, date, text, text, boolean, text, jsonb) is
'{"title":"Pre-signup onboarding","definition":"Anonymous monthly onboarding totals from public.onboarding_monthly_stats, counted for every visitor (no identifiers; counted from 2026-10-26). The table is monthly, so the whole calendar months touched by the range are reported (first_month..last_month, UTC). One funnel per path: upload (started = a visitor picked a CV file on /onboarding, a guest upload row; signed_up = that upload claimed by a new account) and manual_create (started = the new-CV path chosen; signed_up = a new account saved its onboarding answers, once per account). Internal accounts cannot be told apart, so include_internal does not apply. Grain and currency do not apply.","unit":"count","shape":"funnel","breakdowns":[],"filters":["onboarding_path"],"breakdown_dimension":"onboarding_path","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"users":{"label":"Visitors","unit":"count","description":"Anonymous starts or signups in the months covered"},"conversion_from_prev":{"label":"Step conversion","unit":"ratio"},"conversion_from_start":{"label":"Conversion from start","unit":"ratio"}}}';

-- ---------------------------------------------------------------------------
-- analytics.onboarding_referrals (consent-scoped answers of onboarding_monthly_stats)
-- ---------------------------------------------------------------------------

create function analytics.onboarding_referrals(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (dimension text, signups bigint, share numeric, first_month date, last_month date)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_first date;
  v_last date;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters, array[]::text[], array[]::text[]);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_first := date_trunc('month', r.from_day)::date;
  v_last := date_trunc('month', r.to_day)::date;

  return query
  with agg as (
    select s.option, sum(s.count)::bigint as n
    from public.onboarding_monthly_stats s
    where s.month between v_first and v_last and s.metric = 'referral'
    group by s.option
  ),
  -- Like public.onboarding_stats_report, answer cells under five submissions are never reported.
  shown as (select a.* from agg a where a.n >= 5)
  select s.option, s.n, round(s.n::numeric / nullif(sum(s.n) over (), 0), 4), v_first, v_last
  from shown s
  order by s.n desc, s.option;
end $$;

comment on function analytics.onboarding_referrals(date, date, text, text, boolean, text, jsonb) is
'{"title":"Referral sources","definition":"How new accounts heard about us (the onboarding source answer: search, social, friend, community, article, other), from the monthly totals of public.onboarding_monthly_stats for signups with analytics consent (upload path: the guest upload consented; new-CV path: the account consented). The table is monthly, so the whole calendar months touched by the range are reported (first_month..last_month, UTC). Sources with fewer than five answers in those months are not shown, so share is over the shown sources. Internal accounts cannot be told apart, so include_internal does not apply. Grain and currency do not apply.","unit":"count","shape":"breakdown","breakdowns":[],"filters":[],"consent_scoped":true,"alertable":false,"min_group":5,"measures":{"signups":{"label":"Consenting signups","unit":"count"},"share":{"label":"Share","unit":"ratio","description":"Of the sources shown"}}}';

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;

commit;
