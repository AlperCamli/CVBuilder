-- Promotion tables and email queue for the external email agent (20261110120000_promotions.sql).
begin;

create function pg_temp.mk_user(p_email text, p_locale text default 'en', p_name text default null) returns uuid
language sql as $$
  insert into public.users(auth_user_id, email, full_name, locale) values (gen_random_uuid(), p_email, p_name, p_locale) returning id
$$;

create function pg_temp.mk_sub(p_user uuid, p_status text, p_plan text default 'monthly') returns void
language sql as $$
  insert into public.subscriptions(user_id, provider, provider_subscription_id, plan_code, status)
  values (p_user, 'stripe', 'sub_' || gen_random_uuid(), p_plan, p_status)
$$;

create function pg_temp.enrol(p_promo uuid, p_cohort uuid, p_user uuid) returns void
language sql as $$
  insert into public.promotion_recipients(promotion_id, user_id, cohort_id) values (p_promo, p_user, p_cohort);
  insert into public.marketing_email_preferences(user_id) values (p_user) on conflict do nothing;
$$;

do $$
declare
  promo uuid; archived uuid; cohort_a uuid; cohort_b uuid; cohort_old uuid;
  en_a uuid; tr_a uuid; en_b uuid; tr_b uuid; lapsed uuid; free_active uuid; incomplete uuid;
  paying uuid; trialing uuid; past_due uuid; internal uuid; deleting uuid; restricted uuid;
  opted_out uuid; redeemed uuid; no_prefs uuid; in_archived uuid;
  got text; r record; first_opt_out timestamptz; attempt uuid;
begin
  insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, utm)
  values ('flash-test', 'Flash test', 50, array['monthly'], 'once', 'coupon_test', 'https://example.invalid',
          '{"source":"email","medium":"promo","campaign":"flash-test"}')
  returning id into promo;
  insert into public.promotion_cohorts(promotion_id, key, label, starts_at, ends_at)
  values (promo, 'A', '10:00 Istanbul', now() - interval '1 hour', now() + interval '23 hours') returning id into cohort_a;
  insert into public.promotion_cohorts(promotion_id, key, label, starts_at, ends_at)
  values (promo, 'B', null, now() + interval '7 hours', now() + interval '31 hours') returning id into cohort_b;
  insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url, archived_at)
  values ('old-test', 'Old test', 20, array['annual'], 'once', 'coupon_old', 'https://example.invalid', now())
  returning id into archived;
  insert into public.promotion_cohorts(promotion_id, key, starts_at, ends_at)
  values (archived, 'A', now() - interval '3 days', now() - interval '2 days') returning id into cohort_old;

  -- Queued: never subscribed, lapsed, free plan rows and an incomplete checkout's subscription.
  en_a := pg_temp.mk_user('promo-en-a@example.invalid', 'en', '  mehmet Ali Veli');
  tr_a := pg_temp.mk_user('promo-tr-a@example.invalid', 'tr', 'Ayse');
  en_b := pg_temp.mk_user('promo-en-b@example.invalid', 'en');
  tr_b := pg_temp.mk_user('promo-tr-b@example.invalid', 'tr', '   ');
  lapsed := pg_temp.mk_user('promo-lapsed@example.invalid');
  perform pg_temp.mk_sub(lapsed, 'canceled');
  free_active := pg_temp.mk_user('promo-free@example.invalid');
  perform pg_temp.mk_sub(free_active, 'active', 'free');
  incomplete := pg_temp.mk_user('promo-incomplete@example.invalid');
  perform pg_temp.mk_sub(incomplete, 'incomplete');
  perform pg_temp.enrol(promo, cohort_a, en_a);
  perform pg_temp.enrol(promo, cohort_a, tr_a);
  perform pg_temp.enrol(promo, cohort_b, en_b);
  perform pg_temp.enrol(promo, cohort_b, tr_b);
  perform pg_temp.enrol(promo, cohort_a, lapsed);
  perform pg_temp.enrol(promo, cohort_a, free_active);
  perform pg_temp.enrol(promo, cohort_b, incomplete);

  -- Not queued: paying (active, trialing, past_due), internal, pending deletion, restricted, opted out, redeemed,
  -- no preferences row (no unsubscribe link), and a recipient of an archived promotion.
  paying := pg_temp.mk_user('promo-paying@example.invalid');
  perform pg_temp.mk_sub(paying, 'active');
  trialing := pg_temp.mk_user('promo-trialing@example.invalid');
  perform pg_temp.mk_sub(trialing, 'trialing', 'weekly');
  past_due := pg_temp.mk_user('promo-past-due@example.invalid');
  perform pg_temp.mk_sub(past_due, 'past_due', 'annual');
  internal := pg_temp.mk_user('promo-internal@example.invalid');
  update public.users set is_internal = true where id = internal;
  deleting := pg_temp.mk_user('promo-deleting@example.invalid');
  restricted := pg_temp.mk_user('promo-restricted@example.invalid');
  opted_out := pg_temp.mk_user('promo-opted-out@example.invalid');
  redeemed := pg_temp.mk_user('promo-redeemed@example.invalid');
  in_archived := pg_temp.mk_user('promo-archived@example.invalid');
  foreach got in array array[paying, trialing, past_due, internal, deleting, restricted, opted_out, redeemed]::text[] loop
    perform pg_temp.enrol(promo, cohort_a, got::uuid);
  end loop;
  perform pg_temp.enrol(archived, cohort_old, in_archived);
  no_prefs := pg_temp.mk_user('promo-no-prefs@example.invalid');
  insert into public.promotion_recipients(promotion_id, user_id, cohort_id) values (promo, no_prefs, cohort_a);
  update public.users set deletion_requested_at = now() where id = deleting;
  update public.users set processing_restricted_at = now() where id = restricted;
  update public.marketing_email_preferences set opted_out_at = now() where user_id = opted_out;
  update public.promotion_recipients set redeemed_at = now(), redeemed_checkout_session_id = 'cs_test' where user_id = redeemed;

  -- Ordered by cohort (send time), then locale.
  select string_agg(split_part(email, '@', 1) || ':' || cohort_key || ':' || locale || ':' || sort_order, ' ' order by sort_order) into got
  from public.promotion_email_queue where email like 'promo-%';
  if got not like 'promo-%:A:en:1 promo-%:A:en:2 promo-%:A:en:3 promo-tr-a:A:tr:4 promo-%:B:en:5 promo-%:B:en:6 promo-tr-b:B:tr:7'
    or got not like '%promo-en-a:A:%' or got not like '%promo-lapsed:A:%' or got not like '%promo-free:A:%'
    or got not like '%promo-en-b:B:%' or got not like '%promo-incomplete:B:%' then
    raise exception 'queue rows or order wrong: %', got;
  end if;
  if (select string_agg(email, ' ') from public.promotion_email_queue) <> (select string_agg(email, ' ' order by sort_order) from public.promotion_email_queue) then
    raise exception 'view is not ordered by sort_order';
  end if;

  select * into r from public.promotion_email_queue where user_id = en_a;
  if r.promotion_slug <> 'flash-test' or r.cohort_label <> '10:00 Istanbul' or r.first_name <> 'mehmet'
    or r.send_at <> (select starts_at from public.promotion_cohorts where id = cohort_a)
    or r.ends_at <> (select ends_at from public.promotion_cohorts where id = cohort_a)
    or r.hours_until_end not between 22.9 and 23.0
    or r.offer_url <> 'https://example.invalid/pricing?promo=' || (select token from public.promotion_recipients where user_id = en_a)
                      || '&utm_source=email&utm_medium=promo&utm_campaign=flash-test&utm_content=A'
    or r.unsubscribe_url <> 'https://example.invalid/unsubscribe?t=' || (select unsubscribe_token from public.marketing_email_preferences where user_id = en_a) then
    raise exception 'en row wrong: %', row_to_json(r);
  end if;
  select * into r from public.promotion_email_queue where user_id = tr_a;
  if r.first_name <> 'Ayse' or r.offer_url not like 'https://example.invalid/tr/pricing?promo=%&utm_content=A'
    or r.unsubscribe_url not like 'https://example.invalid/tr/unsubscribe?t=%' then
    raise exception 'tr row wrong: %', row_to_json(r);
  end if;
  if (select first_name from public.promotion_email_queue where user_id = en_b) is not null
    or (select first_name from public.promotion_email_queue where user_id = tr_b) is not null
    or (select cohort_label from public.promotion_email_queue where user_id = en_b) is not null then
    raise exception 'empty names or labels must be null';
  end if;

  -- Tokens: hex link and unsubscribe tokens; one recipient row per promotion and account; window and plan checks.
  if exists (select 1 from public.promotion_recipients where token !~ '^[0-9a-f]{36}$')
    or exists (select 1 from public.marketing_email_preferences where unsubscribe_token !~ '^[0-9a-f]{48}$') then
    raise exception 'token format wrong';
  end if;
  begin
    perform pg_temp.enrol(promo, cohort_b, en_a);
    raise exception 'duplicate recipient accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.promotion_cohorts(promotion_id, key, starts_at, ends_at) values (promo, 'C', now(), now());
    raise exception 'empty window accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url)
    values ('bad-plan', 'Bad', 50, array['lifetime'], 'once', 'c', 'https://example.invalid');
    raise exception 'unknown plan code accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.promotions(slug, name, percent_off, plan_codes, duration, stripe_coupon_id, site_url)
    values ('bad-repeat', 'Bad', 50, array['monthly'], 'repeating', 'c', 'https://example.invalid');
    raise exception 'repeating without duration_in_months accepted';
  exception when check_violation then null;
  end;

  -- The first opt-out time is kept when the update coalesces, and updated_at moves.
  select opted_out_at into first_opt_out from public.marketing_email_preferences where user_id = opted_out;
  update public.marketing_email_preferences set opted_out_at = coalesce(opted_out_at, now() + interval '1 hour') where user_id = opted_out;
  if (select opted_out_at from public.marketing_email_preferences where user_id = opted_out) <> first_opt_out then
    raise exception 'first opt-out time changed';
  end if;

  -- Backend only: RLS on every table, no browser or analytics access, service_role reads and writes.
  if exists (select 1 from pg_class where oid in ('public.promotions'::regclass, 'public.promotion_cohorts'::regclass,
      'public.promotion_recipients'::regclass, 'public.marketing_email_preferences'::regclass) and not relrowsecurity)
    or exists (select 1 from pg_policies where tablename in ('promotions','promotion_cohorts','promotion_recipients','marketing_email_preferences')) then
    raise exception 'promotion tables must have RLS on and no policies';
  end if;
  foreach got in array array['public.promotions','public.promotion_cohorts','public.promotion_recipients','public.marketing_email_preferences'] loop
    if has_table_privilege('anon', got, 'select, insert, update, delete')
      or has_table_privilege('authenticated', got, 'select, insert, update, delete')
      or has_table_privilege('analytics_api', got, 'select')
      or not has_table_privilege('service_role', got, 'select, insert, update, delete') then
      raise exception '% privileges wrong', got;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.promotion_email_queue', 'select')
    or has_table_privilege('authenticated', 'public.promotion_email_queue', 'select')
    or has_table_privilege('analytics_api', 'public.promotion_email_queue', 'select')
    or has_table_privilege('service_role', 'public.promotion_email_queue', 'insert, update, delete')
    or not has_table_privilege('service_role', 'public.promotion_email_queue', 'select') then
    raise exception 'promotion_email_queue privileges wrong';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.promotion_email_queue'::regclass and 'security_invoker=true' = any (reloptions)) then
    raise exception 'promotion_email_queue must be security_invoker';
  end if;
  set local role service_role;
  if (select count(*) from public.promotion_email_queue where email like 'promo-%') <> 7 then
    raise exception 'service_role cannot read the queue';
  end if;
  reset role;

  -- Deleting an account removes its recipient and preference rows; deleting a promotion keeps checkout attempts.
  delete from public.users where id = en_a;
  if exists (select 1 from public.promotion_recipients where user_id = en_a)
    or exists (select 1 from public.marketing_email_preferences where user_id = en_a) then
    raise exception 'account deletion left promotion rows';
  end if;
  insert into public.checkout_attempts(user_id, plan_code, trial_requested, outcome, promotion_id)
  values (tr_a, 'monthly', false, 'open', archived) returning id into attempt;
  delete from public.promotions where id = archived;
  if exists (select 1 from public.promotion_recipients where promotion_id = archived)
    or exists (select 1 from public.promotion_cohorts where promotion_id = archived)
    or (select promotion_id from public.checkout_attempts where id = attempt) is not null then
    raise exception 'promotion deletion did not cascade or clear checkout_attempts.promotion_id';
  end if;
end $$;

rollback;
select 'Promotion email queue rows, order, exclusions, constraints, privileges and erasure passed' as verification;
