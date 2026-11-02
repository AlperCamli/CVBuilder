-- Anonymous visitor funnel counters and their admin metrics (20261107120000_funnel_daily_stats.sql).
begin;

create function pg_temp.t(p anyelement) returns text language sql immutable as $$ select coalesce(p::text, '-') $$;

do $$
declare
  violations text;
  got text;
  today date := (now() at time zone 'UTC')::date;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- Counter: backend-only, one row per key and day, '' for absent detail / utm_source.
  delete from public.funnel_daily_stats;
  delete from public.onboarding_monthly_stats;
  set local role service_role;
  perform public.bump_funnel_event('landing_view', null, 'en', 'mobile', null);
  perform public.bump_funnel_event('landing_view', null, 'en', 'mobile', null);
  perform public.bump_funnel_event('cta_click', 'hero', 'tr', 'desktop', 'instagram');
  if (select count from public.funnel_daily_stats where day = today and event = 'landing_view' and detail = '' and utm_source = '') <> 2
    or (select count(*) from public.funnel_daily_stats) <> 2 then
    raise exception 'counter did not aggregate per key';
  end if;
  begin
    perform public.bump_funnel_event('landing_view', null, 'de', 'mobile', null);
    raise exception 'unknown locale accepted';
  exception when check_violation then null; end;
  begin
    perform public.bump_funnel_event('landing_view', 'Not A Slug', 'en', 'mobile', null);
    raise exception 'free-text detail accepted';
  exception when check_violation then null; end;
  begin
    perform public.bump_funnel_event('landing_view', null, 'en', 'tablet', null);
    raise exception 'unknown device accepted';
  exception when check_violation then null; end;
  reset role;

  if has_function_privilege('anon', 'public.bump_funnel_event(text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.bump_funnel_event(text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('analytics_api', 'public.bump_funnel_event(text,text,text,text,text)', 'EXECUTE')
    or has_table_privilege('anon', 'public.funnel_daily_stats', 'select, insert, update, delete')
    or has_table_privilege('authenticated', 'public.funnel_daily_stats', 'select, insert, update, delete')
    or has_table_privilege('analytics_api', 'public.funnel_daily_stats', 'select') then
    raise exception 'funnel counters reachable outside the backend';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.funnel_daily_stats'::regclass)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'funnel_daily_stats') then
    raise exception 'funnel_daily_stats must have RLS on and no policies';
  end if;

  -- Metric fixtures: Nov 10-11 2026, two locales, two devices, one campaign; Nov 12 is outside the range.
  delete from public.funnel_daily_stats;
  insert into public.funnel_daily_stats(day, event, detail, locale, device, utm_source, count) values
    ('2026-11-10', 'landing_view', '', 'en', 'mobile', '', 60),
    ('2026-11-10', 'landing_view', '', 'tr', 'desktop', 'instagram', 40),
    ('2026-11-11', 'pricing_view', '', 'en', 'desktop', '', 7),
    ('2026-11-10', 'cta_click', 'hero', 'en', 'mobile', '', 20),
    ('2026-11-11', 'cta_click', 'header', 'tr', 'desktop', 'instagram', 10),
    ('2026-11-11', 'cta_click', 'pricing_trial', 'en', 'desktop', '', 10),
    ('2026-11-11', 'onboarding_upload_view', '', 'en', 'mobile', '', 30),
    ('2026-11-11', 'onboarding_upload_started', '', 'en', 'mobile', '', 15),
    ('2026-11-11', 'onboarding_manual_create', '', 'tr', 'desktop', '', 5),
    ('2026-11-11', 'onboarding_signup_view', '', 'en', 'mobile', '', 16),
    ('2026-11-11', 'signup_completed', 'google', 'en', 'mobile', '', 6),
    ('2026-11-11', 'signup_completed', 'email', 'tr', 'desktop', '', 2),
    ('2026-11-11', 'score_view', '', 'en', 'mobile', '', 8),
    ('2026-11-11', 'checkout_view', 'trial', 'en', 'mobile', '', 5),
    ('2026-11-11', 'checkout_redirect', 'trial', 'en', 'mobile', '', 4),
    ('2026-11-11', 'checkout_success', 'trial', 'en', 'mobile', '', 1),
    ('2026-11-12', 'landing_view', '', 'en', 'mobile', '', 999);

  select string_agg(step_order || ':' || step || '=' || users || '/' || pg_temp.t(conversion_from_prev) || '/' || pg_temp.t(conversion_from_start), ' ' order by step_order)
    into got from analytics.visitor_funnel('2026-11-10', '2026-11-11');
  if got <> '1:landing_view=100/-/1.0000 2:cta_click=40/0.4000/0.4000 3:onboarding_view=30/0.7500/0.3000 '
            '4:onboarding_started=20/0.6667/0.2000 5:signup_view=16/0.8000/0.1600 6:signup_completed=8/0.5000/0.0800 '
            '7:score_view=8/1.0000/0.0800 8:checkout_view=5/0.6250/0.0500 9:checkout_redirect=4/0.8000/0.0400 '
            '10:checkout_success=1/0.2500/0.0100' then
    raise exception 'visitor_funnel totals wrong: %', got;
  end if;

  select string_agg(dimension || ':' || step || '=' || users, ' ' order by dimension collate "C", step_order)
    into got from analytics.visitor_funnel('2026-11-10', '2026-11-11', p_breakdown => 'utm_source')
    where step_order <= 2;
  if got <> '(none):landing_view=60 (none):cta_click=30 instagram:landing_view=40 instagram:cta_click=10' then
    raise exception 'visitor_funnel utm breakdown wrong: %', got;
  end if;

  select string_agg(step || '=' || users, ' ' order by step_order)
    into got from analytics.visitor_funnel('2026-11-10', '2026-11-11', p_filters => '{"device":"desktop","locale":["tr"]}')
    where step_order in (1, 4, 6);
  if got <> 'landing_view=40 onboarding_started=5 signup_completed=2' then
    raise exception 'visitor_funnel filters wrong: %', got;
  end if;
  if (select sum(users) from analytics.visitor_funnel('2026-11-10', '2026-11-11', p_filters => '{"utm_source":"(none)"}') where step_order = 1) <> 60 then
    raise exception 'visitor_funnel (none) utm filter wrong';
  end if;

  begin
    perform * from analytics.visitor_funnel('2026-11-10', '2026-11-11', p_breakdown => 'market');
    raise exception 'unsupported breakdown accepted';
  exception when sqlstate '22023' then null; end;

  select string_agg(bucket || '=' || landing_views || '/' || pricing_views || '/' || cta_clicks || '/' || onboarding_starts || '/'
                    || signups || '/' || checkout_redirects || '/' || checkout_successes, ' ' order by bucket)
    into got from analytics.visitor_trend('2026-11-10', '2026-11-12');
  if got <> '2026-11-10=100/0/20/0/0/0/0 2026-11-11=0/7/20/20/8/4/1 2026-11-12=999/0/0/0/0/0/0' then
    raise exception 'visitor_trend wrong: %', got;
  end if;
  if (select sum(landing_views) from analytics.visitor_trend('2026-11-10', '2026-11-12', 'month')) <> 1099 then
    raise exception 'visitor_trend monthly grain wrong';
  end if;

  select string_agg(dimension || '=' || events || '/' || share_of_event, ' ' order by event collate "C", events desc, detail collate "C")
    into got from analytics.visitor_event_details('2026-11-10', '2026-11-11');
  if got <> 'checkout_redirect: trial=4/1.0000 checkout_success: trial=1/1.0000 checkout_view: trial=5/1.0000 '
            'cta_click: hero=20/0.5000 cta_click: header=10/0.2500 cta_click: pricing_trial=10/0.2500 '
            'signup_completed: google=6/0.7500 signup_completed: email=2/0.2500' then
    raise exception 'visitor_event_details wrong: %', got;
  end if;

  -- Pre-signup onboarding: whole months touched by the range; referral cells under five are hidden.
  insert into public.onboarding_monthly_stats(month, metric, option, count) values
    ('2026-10-01', 'started', 'upload', 10), ('2026-10-01', 'completed', 'upload', 4),
    ('2026-11-01', 'started', 'upload', 30), ('2026-11-01', 'completed', 'upload', 12),
    ('2026-11-01', 'started', 'manual_create', 8), ('2026-11-01', 'completed', 'manual_create', 2),
    ('2026-12-01', 'started', 'upload', 500),
    ('2026-11-01', 'referral', 'social', 6), ('2026-10-01', 'referral', 'friend', 3), ('2026-11-01', 'referral', 'search', 4),
    ('2026-11-01', 'referral', 'friend', 2);
  select string_agg(dimension || ':' || step || '=' || users || '/' || pg_temp.t(conversion_from_prev) || '@' || first_month || '..' || last_month, ' ' order by dimension desc, step_order)
    into got from analytics.pre_signup_onboarding('2026-10-20', '2026-11-11');
  if got <> 'upload:started=40/-@2026-10-01..2026-11-01 upload:signed_up=16/0.4000@2026-10-01..2026-11-01 '
            'manual_create:started=8/-@2026-10-01..2026-11-01 manual_create:signed_up=2/0.2500@2026-10-01..2026-11-01' then
    raise exception 'pre_signup_onboarding wrong: %', got;
  end if;
  if (select count(*) from analytics.pre_signup_onboarding('2026-11-01', '2026-11-11', p_filters => '{"onboarding_path":"manual_create"}')
      where dimension <> 'manual_create') <> 0 then
    raise exception 'pre_signup_onboarding path filter wrong';
  end if;
  select string_agg(dimension || '=' || signups || '/' || share, ' ' order by signups desc, dimension collate "C")
    into got from analytics.onboarding_referrals('2026-10-20', '2026-11-11');
  if got <> 'social=6/0.5455 friend=5/0.4545' then
    raise exception 'onboarding_referrals wrong: %', got;
  end if;

  -- Catalog meta: every numeric column has a measure; shapes and dimensions as documented.
  select string_agg(p.proname || '.' || x.name, ', ') into got
  from pg_proc p
  join pg_namespace s on s.oid = p.pronamespace
  cross join lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes) x(name, typ, mode)
  where s.nspname = 'analytics'
    and p.proname in ('visitor_funnel', 'visitor_trend', 'visitor_event_details', 'pre_signup_onboarding', 'onboarding_referrals')
    and x.mode = 't' and x.typ in ('numeric'::regtype, 'bigint'::regtype)
    and not (analytics_private.try_jsonb(obj_description(p.oid, 'pg_proc')) -> 'measures' ? x.name);
  if got is not null then raise exception 'numeric columns without measures: %', got; end if;
  if (select meta -> 'breakdowns' = '["locale","device","utm_source"]'::jsonb and meta ->> 'shape' = 'funnel'
      from admin_app.metric_catalog() where name = 'visitor_funnel') is not true
     or (select meta ->> 'consent_scoped' = 'true' from admin_app.metric_catalog() where name = 'onboarding_referrals') is not true
     or (select meta ->> 'breakdown_dimension' = 'onboarding_path' from admin_app.metric_catalog() where name = 'pre_signup_onboarding') is not true then
    raise exception 'visitor funnel catalog meta wrong';
  end if;
end $$;

rollback;
select 'Visitor funnel counters, privileges and admin metrics passed' as verification;
