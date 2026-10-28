begin;
set local client_min_messages = warning;
do $$
declare
  violations text;
  a uuid; b uuid; c uuid; i uuid; rst uuid; d uuid;
  m_a uuid; m_b uuid; tc_a uuid; j_b uuid; fl uuid;
  run_id bigint; q_id bigint; f_id bigint;
  res jsonb;
  got text;
  n bigint;
  rec record;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- Materialized views are private: no API role can read them, and only the functions reach them.
  if exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
             cross join (values ('anon'), ('authenticated'), ('service_role'), ('analytics_api')) r(role)
             where s.nspname = 'analytics_private' and c.relkind = 'm'
               and has_table_privilege(r.role, c.oid, 'select')) then
    raise exception 'a materialized view is readable by an API role';
  end if;
  if (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'analytics_private' and c.relname in ('engagement_user_periods', 'engagement_growth', 'refresh_snapshot')
        and c.relkind = 'm'
        and exists (select 1 from pg_index x where x.indrelid = c.oid and x.indisunique)) <> 3 then
    raise exception 'engagement materialized views missing or without a unique index';
  end if;

  -- pg_cron is absent in the test database: nothing is scheduled and the migration still applied.
  if analytics_private.schedule_refresh_jobs() <> '{}'::text[] then raise exception 'scheduled jobs without pg_cron'; end if;

  -- With no run ever recorded, a recompute is allowed at once (no 300-second throttle before the first nightly).
  delete from admin_app.refresh_runs;
  select * into rec from analytics_private.recompute_wait();
  if rec.open_run_id is not null or rec.retry_after_seconds <> 0 then raise exception 'zero-run wait wrong: %', row_to_json(rec); end if;
  res := admin_app.request_recompute('first@example.invalid');
  if res ->> 'status' <> 'queued' then raise exception 'first recompute throttled: %', res; end if;
  if analytics_private.process_recompute_queue() <> (res ->> 'run_id')::bigint then raise exception 'first recompute not picked'; end if;
  if (select status from admin_app.refresh_runs where id = (res ->> 'run_id')::bigint) <> 'done' then
    raise exception 'first recompute not processed';
  end if;
  -- lock_timeout is only raised inside the refresh.
  if current_setting('lock_timeout') <> '0' then raise exception 'refresh_all leaked lock_timeout: %', current_setting('lock_timeout'); end if;

  -- ---------------------------------------------------------------------------
  -- Fixtures: feature events in January / February 2026 (ISO weeks start 2026-01-05, -12, -19, -26, 02-02, -09).
  -- A (TR, tr): import + master CV week 1; tailored CV + pdf export + failed docx export week 2; AI run week 4 and
  --             week 6 (February).
  -- B (GLOBAL, en): master CV week 1; cover letter week 2; AI run week 3; a mock run week 4 (never counted).
  -- C (no market): signs up 2026-01-12; AI run that day plus a failed pre-signup guest run claimed later (01-10,
  --             clamped to signup).
  -- I (internal): AI runs weeks 1 and 2. R (restricted): AI run week 1.
  -- ---------------------------------------------------------------------------
  insert into public.users(auth_user_id,email,locale,created_at,analytics) values(gen_random_uuid(),'eng-a@example.invalid','tr','2026-01-05T09:00:00Z',true) returning id into a;
  insert into public.billing_markets(user_id,market) values(a,'TR');
  insert into public.users(auth_user_id,email,locale,created_at,analytics) values(gen_random_uuid(),'eng-b@example.invalid','en','2026-01-07T09:00:00Z',true) returning id into b;
  insert into public.billing_markets(user_id,market) values(b,'GLOBAL');
  insert into public.users(auth_user_id,email,locale,created_at) values(gen_random_uuid(),'eng-c@example.invalid','en','2026-01-12T09:00:00Z') returning id into c;
  insert into public.users(auth_user_id,email,locale,created_at,is_internal,analytics) values(gen_random_uuid(),'eng-admin@example.invalid','en','2026-01-05T09:00:00Z',true,true) returning id into i;
  insert into public.users(auth_user_id,email,locale,created_at) values(gen_random_uuid(),'eng-restricted@example.invalid','en','2026-01-05T09:00:00Z') returning id into rst;

  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'source_upload','imports','users/'||a||'/imports/cv.pdf','cv.pdf','application/pdf',10) returning id into fl;
  insert into public.imports(user_id,source_file_id,status,created_at) values(a,fl,'converted','2026-01-05T10:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a,'CV','en','{"language":"en"}','scratch','2026-01-06T10:00:00Z') returning id into m_a;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(a,m_a,'T','en','{}','2026-01-13T10:00:00Z') returning id into tc_a;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(a,'export_pdf','exports','users/'||a||'/tailored-cvs/'||tc_a||'/exports/1.pdf','1.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,file_id,format,status,created_at,completed_at) values(a,tc_a,fl,'pdf','completed','2026-01-13T11:00:00Z','2026-01-13T11:00:05Z');
  insert into public.exports(user_id,tailored_cv_id,format,status,error_message,created_at) values(a,tc_a,'docx','failed','render failed','2026-01-14T11:00:00Z');
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at) values
    (a,'block_suggest','openai','gpt-6-luna','completed','{}','2026-01-27T10:00:00Z','2026-01-27T10:00:05Z'),
    (a,'block_suggest','openai','gpt-6-luna','completed','{}','2026-02-10T10:00:00Z','2026-02-10T10:00:05Z'),
    (b,'block_suggest','openai','gpt-6-luna','completed','{}','2026-01-21T10:00:00Z','2026-01-21T10:00:05Z'),
    (b,'block_suggest','mock','gpt-6-luna','completed','{}','2026-01-28T10:00:00Z','2026-01-28T10:00:05Z'),
    (c,'cv_parse','openai','gpt-6-luna','completed','{}','2026-01-12T10:00:00Z','2026-01-12T10:00:05Z'),
    (i,'block_suggest','openai','gpt-6-luna','completed','{}','2026-01-05T10:00:00Z','2026-01-05T10:00:05Z'),
    (i,'block_suggest','openai','gpt-6-luna','completed','{}','2026-01-12T10:00:00Z','2026-01-12T10:00:05Z'),
    (rst,'block_suggest','openai','gpt-6-luna','completed','{}','2026-01-05T10:00:00Z','2026-01-05T10:00:05Z');
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at)
    values(c,'cv_parse','openai','gpt-6-luna','failed','{}','Structured output validation failed','2026-01-10T10:00:00Z','2026-01-10T10:00:05Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(b,'CV','en','{"language":"en"}','scratch','2026-01-07T10:00:00Z') returning id into m_b;
  insert into public.jobs(user_id,company_name,job_title,job_description,created_at) values(b,'Co','Role','Desc','2026-01-14T09:00:00Z') returning id into j_b;
  insert into public.cover_letters(user_id,job_id,title,created_at) values(b,j_b,'CL','2026-01-14T10:00:00Z');
  update public.users set processing_restricted_at = now() where id = rst;

  -- ---------------------------------------------------------------------------
  -- Pre-computed metrics read the materialized views: stale until refresh_all runs.
  -- ---------------------------------------------------------------------------
  if (select coalesce(sum(new_users), 0) from analytics.growth_accounting('2026-01-05', '2026-02-22', 'week')) <> 0 then
    raise exception 'growth_accounting read live data before the refresh';
  end if;
  run_id := analytics_private.refresh_all('manual');
  select * into rec from admin_app.refresh_runs where id = run_id;
  if rec.status <> 'done' or rec.kind <> 'manual' or rec.started_at is null or rec.finished_at < rec.started_at or rec.error is not null
     or not (rec.detail -> 'mvs' @> '[{"name":"engagement_user_periods","concurrently":true},{"name":"engagement_growth","concurrently":true},{"name":"refresh_snapshot","concurrently":true}]'::jsonb) then
    raise exception 'refresh_all run wrong: %', row_to_json(rec);
  end if;
  -- Dependencies first: engagement_growth reads engagement_user_periods.
  select string_agg(e ->> 'name', ',' order by o) into got from jsonb_array_elements(rec.detail -> 'mvs') with ordinality x(e, o)
  where e ->> 'name' in ('engagement_user_periods', 'engagement_growth');
  if got <> 'engagement_user_periods,engagement_growth' then raise exception 'refresh order wrong: %', got; end if;
  if (select count(*) from analytics_private.engagement_user_periods where user_id = rst) <> 0 then
    raise exception 'restricted account in the materialized view';
  end if;

  -- ---------------------------------------------------------------------------
  -- active_users (live)
  -- ---------------------------------------------------------------------------
  select string_agg(bucket || '=' || active_users || '/' || ai_active_users || '/' || exporting_users || '/' || tailoring_users || '/' || events, ',' order by bucket) into got
  from analytics.active_users('2026-01-05', '2026-01-25', 'week');
  if got <> '2026-01-05=2/0/0/0/3,2026-01-12=3/1/1/1/6,2026-01-19=1/1/0/0/1' then raise exception 'weekly active_users wrong: %', got; end if;
  select string_agg(bucket || '=' || active_users, ',' order by bucket) into got from analytics.active_users('2026-01-11', '2026-01-14');
  if got <> '2026-01-11=0,2026-01-12=1,2026-01-13=1,2026-01-14=2' then raise exception 'daily active_users (clamp) wrong: %', got; end if;
  select string_agg(bucket || '=' || active_users, ',' order by bucket) into got from analytics.active_users('2026-01-01', '2026-02-28', 'month', p_include_internal => true);
  if got <> '2026-01-01=4,2026-02-01=1' then raise exception 'monthly active_users with internal wrong: %', got; end if;
  select string_agg(dimension || '=' || active_users, ',' order by dimension) into got
  from analytics.active_users('2026-01-01', '2026-01-31', 'month', p_breakdown => 'market');
  if got <> 'GLOBAL=1,TR=1,unknown=1' then raise exception 'active_users market breakdown wrong: %', got; end if;
  if (select active_users from analytics.active_users('2026-01-01', '2026-01-31', 'month', p_filters => '{"locale":"tr"}')) <> 1 then
    raise exception 'active_users locale filter wrong';
  end if;
  begin perform analytics.active_users(p_breakdown => 'plan'); raise exception 'active_users accepted plan';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- growth_accounting (materialized view): states and identities
  -- ---------------------------------------------------------------------------
  select string_agg(bucket || '=' || new_users || '/' || retained_users || '/' || resurrected_users || '/' || churned_users || '/' || active_users
                    || '/' || coalesce(quick_ratio::text, '-'), ',' order by bucket) into got
  from analytics.growth_accounting('2026-01-05', '2026-02-22', 'week');
  if got <> '2026-01-05=2/0/0/0/2/-,2026-01-12=1/2/0/0/3/-,2026-01-19=0/1/0/-2/1/0.0000,2026-01-26=0/0/1/-1/1/1.0000,'
            '2026-02-02=0/0/0/-1/0/0.0000,2026-02-09=0/0/1/0/1/-,2026-02-16=0/0/0/-1/0/0.0000' then
    raise exception 'weekly growth_accounting wrong: %', got;
  end if;
  -- Previous period active = retained + churned (churned is negative), and net_change is the change in active users.
  if exists (
    select 1 from (
      select g.*, lag(g.active_users) over (order by g.bucket) as prev_active
      from analytics.growth_accounting('2025-12-01', '2026-10-31', 'week') g
    ) x
    where x.prev_active is not null and not x.is_partial_period
      and (x.prev_active <> x.retained_users - x.churned_users or x.net_change <> x.active_users - x.prev_active)) then
    raise exception 'growth accounting identities broken';
  end if;
  if exists (
    select 1 from (
      select g.*, lag(g.active_users) over (partition by g.dimension order by g.bucket) as prev_active
      from analytics.growth_accounting('2025-12-01', '2026-09-30', 'month', p_include_internal => true, p_breakdown => 'market') g
    ) x
    where x.prev_active is not null and x.prev_active <> x.retained_users - x.churned_users) then
    raise exception 'monthly growth accounting identity broken';
  end if;
  select string_agg(bucket || '=' || new_users || '/' || retained_users || '/' || churned_users || '/' || coalesce(retention_rate::text, '-'), ',' order by bucket) into got
  from analytics.growth_accounting('2026-01-01', '2026-03-31', 'month');
  if got <> '2026-01-01=3/0/0/-,2026-02-01=0/1/-2/0.3333,2026-03-01=0/0/-1/0.0000' then raise exception 'monthly growth_accounting wrong: %', got; end if;
  select string_agg(bucket || '=' || new_users || '/' || retained_users || '/' || churned_users, ',' order by bucket) into got
  from analytics.growth_accounting('2026-01-05', '2026-01-25', 'week', p_include_internal => true);
  if got <> '2026-01-05=3/0/0,2026-01-12=1/3/0,2026-01-19=0/1/-3' then raise exception 'growth_accounting with internal wrong: %', got; end if;
  select string_agg(dimension || '=' || new_users, ',' order by dimension) into got
  from analytics.growth_accounting('2026-01-05', '2026-01-11', 'week', p_breakdown => 'market');
  if got <> 'GLOBAL=1,TR=1' then raise exception 'growth_accounting market breakdown wrong: %', got; end if;
  -- The bucket holding the snapshot is partial; later buckets have no data yet (null, not zero).
  select string_agg(bucket || '=' || coalesce(active_users::text, 'null') || '/' || is_partial_period, ',' order by bucket) into got
  from analytics.growth_accounting(date_trunc('month', now() at time zone 'UTC')::date - 1, (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date, 'month');
  if got <> (date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date || '=0/false,'
            || date_trunc('month', now() at time zone 'UTC')::date || '=0/true,'
            || (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date || '=null/false' then
    raise exception 'growth_accounting partial / future buckets wrong: %', got;
  end if;
  -- Flags set after the refresh apply immediately: the views are re-filtered by every call.
  update public.users set is_internal = true where id = b;
  if (select new_users from analytics.growth_accounting('2026-01-05', '2026-01-11', 'week')) <> 1 then raise exception 'internal flag not applied to the view'; end if;
  update public.users set is_internal = false where id = b;

  -- ---------------------------------------------------------------------------
  -- cohort_retention (materialized view)
  -- ---------------------------------------------------------------------------
  select string_agg(cohort || ':' || period || '=' || active || '/' || cohort_size || '/' || rate, ',' order by cohort, period) into got
  from analytics.cohort_retention('2026-01-05', '2026-01-18', 'week') where period <= 5;
  if got <> '2026-01-05:0=2/2/1.0000,2026-01-05:1=2/2/1.0000,2026-01-05:2=1/2/0.5000,2026-01-05:3=1/2/0.5000,2026-01-05:4=0/2/0.0000,2026-01-05:5=1/2/0.5000,'
            '2026-01-12:0=1/1/1.0000,2026-01-12:1=0/1/0.0000,2026-01-12:2=0/1/0.0000,2026-01-12:3=0/1/0.0000,2026-01-12:4=0/1/0.0000,2026-01-12:5=0/1/0.0000' then
    raise exception 'weekly cohort triangle wrong: %', got;
  end if;
  if (select count(*) from analytics.cohort_retention('2026-01-05', '2026-01-18', 'week')) <> 26 then raise exception 'weekly grid is not periods 0..12'; end if;
  select string_agg(period || '=' || active || '/' || cohort_size, ',' order by period) into got
  from analytics.cohort_retention('2026-01-01', '2026-01-31', 'month') where period <= 2;
  if got <> '0=3/3,1=1/3,2=0/3' then raise exception 'monthly cohort wrong: %', got; end if;
  if (select max(period) from analytics.cohort_retention('2026-01-01', '2026-01-31', 'month')) <> 9 then
    raise exception 'monthly cohort grid must stop at the snapshot month';
  end if;
  if (select cohort_size from analytics.cohort_retention('2026-01-01', '2026-01-31', 'month', p_include_internal => true) where period = 0) <> 4
     or (select cohort_size from analytics.cohort_retention('2026-01-01', '2026-01-31', 'month', p_filters => '{"market":"unknown"}') where period = 0) <> 1 then
    raise exception 'cohort internal / market filter wrong';
  end if;
  if (select bool_or(is_partial_period) from analytics.cohort_retention('2026-01-01', '2026-01-31', 'month')) is not true then
    raise exception 'cohort partial period not flagged';
  end if;
  begin perform analytics.cohort_retention(p_breakdown => 'market'); raise exception 'cohort_retention accepted a breakdown';
  exception when invalid_parameter_value then null; end;
  -- Cohorts are whole periods: a range starting mid-week still holds the whole 2026-01-05 week (A on 01-05, B on 01-07).
  select string_agg(cohort || ':' || cohort_size || '/' || active, ',' order by cohort) into got
  from analytics.cohort_retention('2026-01-07', '2026-01-07', 'week') where period = 0;
  if got <> '2026-01-05:2/2' then raise exception 'cohort cut at the range edge: %', got; end if;
  select string_agg(cohort || ':' || cohort_size, ',' order by cohort) into got
  from analytics.cohort_retention('2026-01-31', '2026-01-31', 'month') where period = 0;
  if got <> '2026-01-01:3' then raise exception 'monthly cohort cut at the range edge: %', got; end if;

  -- ---------------------------------------------------------------------------
  -- feature_adoption (live)
  -- ---------------------------------------------------------------------------
  select string_agg(dimension || '=' || users || '/' || coalesce(share_of_active::text, '-') || '/' || events || '/' || coalesce(success_rate::text, '-'), ',') into got
  from analytics.feature_adoption('2026-01-01', '2026-01-31');
  if got <> 'ai_actions=3/1.0000/4/0.7500,master_cv=2/0.6667/2/-,cover_letter=1/0.3333/1/-,cv_export_docx=1/0.3333/1/0.0000,'
            'cv_export_pdf=1/0.3333/1/1.0000,cv_import=1/0.3333/1/-,tailored_cv=1/0.3333/1/-,cover_letter_export=0/0.0000/0/-,'
            'job_tracking=0/0.0000/0/-,tailoring_v2_finished=0/0.0000/0/-,tailoring_v2_started=0/0.0000/0/-' then
    raise exception 'feature_adoption wrong: %', got;
  end if;
  if (select max(active_users) from analytics.feature_adoption('2026-01-01', '2026-01-31', p_filters => '{"market":["TR","GLOBAL"]}')) <> 2 then
    raise exception 'feature_adoption market filter wrong';
  end if;

  -- ---------------------------------------------------------------------------
  -- stickiness (live, consent-scoped). Coverage start moved to 2026-03-01 for the fixture (rolled back).
  -- A active 03-01..03-07; B 03-07; C (no consent) and I (internal) also 03-07.
  -- ---------------------------------------------------------------------------
  create or replace function analytics_private.activity_days_start() returns date
  language sql immutable set search_path = '' as $f$ select date '2026-03-01' $f$;
  insert into public.user_activity_days(user_id, activity_date)
  select a, g::date from generate_series('2026-03-01'::date, '2026-03-07'::date, interval '1 day') g;
  insert into public.user_activity_days(user_id, activity_date) values (b, '2026-03-07'), (c, '2026-03-07'), (i, '2026-03-07');
  select string_agg(bucket || '=' || coalesce(dau::text, 'null') || '/' || coalesce(wau::text, 'null') || '/' || coalesce(mau::text, 'null')
                    || '/' || coalesce(stickiness::text, 'null') || '/' || partial, ',' order by bucket) into got
  from analytics.stickiness('2026-02-28', '2026-03-08');
  if got <> '2026-02-28=null/null/null/null/true,2026-03-01=1.00/1.00/1.00/1.0000/true,2026-03-02=1.00/1.00/1.00/1.0000/true,'
            '2026-03-03=1.00/1.00/1.00/1.0000/true,2026-03-04=1.00/1.00/1.00/1.0000/true,2026-03-05=1.00/1.00/1.00/1.0000/true,'
            '2026-03-06=1.00/1.00/1.00/1.0000/true,2026-03-07=2.00/2.00/2.00/1.0000/true,2026-03-08=0.00/2.00/2.00/0.0000/true' then
    raise exception 'daily stickiness wrong: %', got;
  end if;
  select bucket || '=' || dau || '/' || wau || '/' || mau || '/' || stickiness || '/' || active_users into got
  from analytics.stickiness('2026-03-02', '2026-03-08', 'week');
  if got <> '2026-03-02=1.00/1.29/1.29/0.7778/2' then raise exception 'weekly stickiness wrong: %', got; end if;
  if (select dau from analytics.stickiness('2026-03-07', '2026-03-07', p_include_internal => true)) <> 3 then
    raise exception 'stickiness include_internal wrong';
  end if;
  select string_agg(dimension || '=' || dau, ',' order by dimension) into got from analytics.stickiness('2026-03-07', '2026-03-07', p_breakdown => 'market');
  if got <> 'GLOBAL=1.00,TR=1.00' then raise exception 'stickiness market breakdown wrong: %', got; end if;
  -- Withdrawing consent deletes the user's activity days; non-consenting rows never count.
  update public.users set analytics = false where id = a;
  if (select dau from analytics.stickiness('2026-03-07', '2026-03-07')) <> 1 then raise exception 'stickiness consent scoping wrong'; end if;
  update public.users set analytics = true where id = a;
  if (select meta -> 'consent_scoped' = 'true'::jsonb and meta ->> 'flag_column' = 'partial' from admin_app.metric_catalog() where name = 'stickiness') is not true then
    raise exception 'stickiness meta wrong';
  end if;

  -- ---------------------------------------------------------------------------
  -- Drill-downs
  -- ---------------------------------------------------------------------------
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}'::jsonb, null);
  select string_agg(email || '=' || value || '/' || (detail ->> 'churned_period') || '/' || (detail ->> 'last_active_period'), ',') into got
  from analytics_people.drill_users(p_from => '2026-01-19', p_to => '2026-01-25', p_filters => '{"metric":"churned_users","grain":"week"}');
  if got <> 'eng-a@example.invalid=3/2026-01-19/2026-01-12,eng-c@example.invalid=2/2026-01-19/2026-01-12' then raise exception 'drill churned_users wrong: %', got; end if;
  -- Without grain, a range inside one ISO week is a week.
  select string_agg(email, ',') into got
  from analytics_people.drill_users(p_from => '2026-01-19', p_to => '2026-01-25', p_filters => '{"metric":"churned_users","market":"unknown"}');
  if got <> 'eng-c@example.invalid' then raise exception 'drill churned_users market / inferred grain wrong: %', got; end if;
  select string_agg(email, ',') into got
  from analytics_people.drill_users(p_from => '2026-01-19', p_to => '2026-01-25', p_filters => '{"metric":"churned_users","grain":"week","include_internal":true}');
  if got <> 'eng-a@example.invalid,eng-c@example.invalid,eng-admin@example.invalid' then raise exception 'drill churned_users internal wrong: %', got; end if;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"churned_users","grain":"year"}'); raise exception 'drill accepted grain year';
  exception when invalid_parameter_value then null; end;
  select string_agg(email || '=' || value || '/' || (detail ->> 'calendar_period'), ',') into got
  from analytics_people.drill_users(p_filters => '{"metric":"cohort_active_users","cohort":"2026-01-05","period":2,"grain":"week"}');
  if got <> 'eng-b@example.invalid=1/2026-01-19' then raise exception 'drill cohort_active_users wrong: %', got; end if;
  select string_agg(email, ',' order by email) into got
  from analytics_people.drill_users(p_filters => '{"metric":"cohort_active_users","cohort":"2026-01-01","period":"0"}');
  if got <> 'eng-a@example.invalid,eng-b@example.invalid,eng-c@example.invalid' then raise exception 'drill cohort month inference wrong: %', got; end if;
  -- Every cohort cell matches its drill-down (same cohort definition, whatever range the page used).
  for rec in select * from analytics.cohort_retention('2026-01-07', '2026-01-13', 'week') where period <= 5 loop
    select count(*) into n from analytics_people.drill_users(
      p_filters => jsonb_build_object('metric', 'cohort_active_users', 'cohort', rec.cohort, 'period', rec.period, 'grain', 'week'));
    if n <> rec.active then raise exception 'cohort cell %/% = % but drill lists %', rec.cohort, rec.period, rec.active, n; end if;
  end loop;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"cohort_active_users","cohort":"2026-01-05"}'); raise exception 'drill accepted a missing period';
  exception when invalid_parameter_value then null; end;
  begin perform analytics_people.drill_users(p_filters => '{"metric":"cohort_active_users","cohort":"2026-01-06","period":0,"grain":"week"}'); raise exception 'drill accepted a mid-week cohort';
  exception when invalid_parameter_value then null; end;
  -- Ties on the sort key are ordered by user_id (random here), so compare by email after the first row.
  select string_agg(email || '=' || value, ',' order by value desc, email) into got
  from analytics_people.drill_users(p_from => '2026-01-01', p_to => '2026-01-31', p_filters => '{"metric":"feature_users","dimension":"ai_actions"}');
  if got <> 'eng-c@example.invalid=2,eng-a@example.invalid=1,eng-b@example.invalid=1' then raise exception 'drill feature_users wrong: %', got; end if;
  if (select count(*) from admin_app.drill_keys() where meta ->> 'metric' in ('growth_accounting', 'cohort_retention', 'feature_adoption')) <> 3
     or not (select meta -> 'drill_metrics' ? 'churned_users' from admin_app.metric_catalog() where name = 'drill_users') then
    raise exception 'engagement drill keys not published';
  end if;
  if exists (select 1 from admin_app.metric_catalog() mc where mc.kind = 'metric' and mc.meta -> 'drill' = 'true'::jsonb
             and not exists (select 1 from admin_app.drill_keys() dk where dk.meta ->> 'metric' = mc.name)) then
    raise exception 'drill = true without a drill key';
  end if;

  -- Catalog meta: plot / stacked for growth accounting, and a measure for every numeric column.
  if (select meta -> 'plot' = '["new_users","retained_users","resurrected_users","churned_users"]'::jsonb and meta -> 'stacked' = 'true'::jsonb
      from admin_app.metric_catalog() where name = 'growth_accounting') is not true
     or (select meta ->> 'shape' = 'cohort' from admin_app.metric_catalog() where name = 'cohort_retention') is not true
     or (select meta ->> 'shape' = 'breakdown' from admin_app.metric_catalog() where name = 'feature_adoption') is not true
     or (select meta ->> 'shape' = 'table' from admin_app.metric_catalog() where name = 'data_freshness') is not true then
    raise exception 'engagement catalog meta wrong';
  end if;
  select string_agg(p.proname || '.' || x.name, ', ') into got
  from pg_proc p
  join pg_namespace s on s.oid = p.pronamespace
  cross join lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes) x(name, typ, mode)
  where s.nspname = 'analytics'
    and p.proname in ('active_users', 'stickiness', 'cohort_retention', 'growth_accounting', 'feature_adoption', 'data_freshness')
    and x.mode = 't' and x.typ in ('numeric'::regtype, 'bigint'::regtype)
    and not (analytics_private.try_jsonb(obj_description(p.oid, 'pg_proc')) -> 'measures' ? x.name);
  if got is not null then raise exception 'numeric columns without measures: %', got; end if;

  -- ---------------------------------------------------------------------------
  -- Recompute queue and throttle
  -- ---------------------------------------------------------------------------
  -- The manual run above finished moments ago: throttled, nothing queued.
  res := admin_app.request_recompute('Admin@Example.invalid ');
  if res ->> 'status' <> 'throttled' or res -> 'run_id' <> 'null'::jsonb or (res ->> 'retry_after_seconds')::int not between 1 and 300 then
    raise exception 'recompute not throttled after a finished run: %', res;
  end if;
  update admin_app.refresh_runs set requested_at = requested_at - interval '10 minutes', started_at = started_at - interval '10 minutes',
    finished_at = finished_at - interval '10 minutes';
  res := admin_app.request_recompute('Admin@Example.invalid ');
  if res ->> 'status' <> 'queued' or (res ->> 'retry_after_seconds')::int <> 0 then raise exception 'recompute not queued: %', res; end if;
  q_id := (res ->> 'run_id')::bigint;
  if (select requested_by || '/' || status || '/' || kind from admin_app.refresh_runs where id = q_id) <> 'admin@example.invalid/pending/recompute' then
    raise exception 'queued run wrong';
  end if;
  if (select count(*) from admin_app.audit_log where action = 'recompute.request' and admin_email = 'admin@example.invalid') <> 2
     or not exists (select 1 from admin_app.audit_log where action = 'recompute.request' and params ->> 'status' = 'queued' and (params ->> 'run_id')::bigint = q_id) then
    raise exception 'recompute requests not audited';
  end if;
  -- A pending run throttles further requests and names that run.
  res := admin_app.request_recompute('admin@example.invalid');
  if res ->> 'status' <> 'throttled' or (res ->> 'run_id')::bigint <> q_id or (res ->> 'retry_after_seconds')::int < 60 then
    raise exception 'pending run did not throttle: %', res;
  end if;
  begin perform admin_app.request_recompute('nobody'); raise exception 'request_recompute accepted a malformed email';
  exception when invalid_parameter_value then null; end;
  begin
    insert into admin_app.refresh_runs(kind, requested_by) values ('recompute', 'x@example.invalid');
    raise exception 'a second pending run was accepted';
  exception when unique_violation then null; end;
  select * into rec from admin_app.recompute_status();
  if rec.run_id <> q_id or rec.status <> 'pending' or rec.open_run_id <> q_id then raise exception 'recompute_status wrong: %', row_to_json(rec); end if;
  if (select status || '/' || value from analytics.data_freshness() where item = 'pending_recompute') <> 'ok/1' then
    raise exception 'data_freshness pending wrong';
  end if;

  -- The queue processor runs the pending request: pending -> running -> done, and nothing is left afterwards.
  if analytics_private.process_recompute_queue() <> q_id then raise exception 'queue did not pick the pending run'; end if;
  select * into rec from admin_app.refresh_runs where id = q_id;
  if rec.status <> 'done' or rec.started_at is null or rec.finished_at is null or rec.error is not null
     or jsonb_array_length(rec.detail -> 'mvs') < 3 then
    raise exception 'processed run wrong: %', row_to_json(rec);
  end if;
  if analytics_private.process_recompute_queue() is not null then raise exception 'empty queue processed something'; end if;
  if (select status || '/' || value_text from analytics.data_freshness() where item = 'last_recompute') <> 'ok/done' then
    raise exception 'data_freshness last_recompute wrong';
  end if;

  -- A failing refresh is recorded on the run (not raised) and rolls every view back together.
  update admin_app.refresh_runs set requested_at = requested_at - interval '10 minutes', started_at = started_at - interval '10 minutes',
    finished_at = finished_at - interval '10 minutes';
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'eng-d@example.invalid','2026-01-19T09:00:00Z') returning id into d;
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at) values(d,'cv_parse','openai','gpt-6-luna','pending','{}','2026-01-20T10:00:00Z');
  create function analytics_private.zz_engagement_test_boom() returns integer language plpgsql set search_path = '' as $f$
  begin
    if current_setting('engagement_test.boom', true) = 'on' then raise exception 'engagement test boom'; end if;
    if current_setting('engagement_test.boom', true) = 'cancel' then raise exception 'canceling statement' using errcode = 'query_canceled'; end if;
    return 1;
  end $f$;
  create materialized view analytics_private.zz_engagement_test_boom_mv as select analytics_private.zz_engagement_test_boom() as id;
  create unique index on analytics_private.zz_engagement_test_boom_mv (id);
  perform set_config('engagement_test.boom', 'on', true);
  res := admin_app.request_recompute('admin@example.invalid');
  f_id := (res ->> 'run_id')::bigint;
  if analytics_private.process_recompute_queue() <> f_id then raise exception 'failing run not processed'; end if;
  select * into rec from admin_app.refresh_runs where id = f_id;
  if rec.status <> 'failed' or rec.error not like 'P0001: engagement test boom%' or rec.finished_at is null
     or rec.detail ->> 'failed_mv' <> 'zz_engagement_test_boom_mv' then
    raise exception 'failed run not recorded: %', row_to_json(rec);
  end if;
  if (select new_users from analytics.growth_accounting('2026-01-19', '2026-01-25', 'week')) <> 0 then
    raise exception 'a failed refresh changed a view';
  end if;
  if (select status from analytics.data_freshness() where item = 'last_recompute') <> 'error'
     or (select status from admin_app.recompute_status()) <> 'failed' then
    raise exception 'failed run not surfaced';
  end if;
  -- A cancel (statement_timeout, pg_cancel_backend) is recorded too instead of aborting the transaction.
  update admin_app.refresh_runs set requested_at = requested_at - interval '10 minutes', started_at = started_at - interval '10 minutes',
    finished_at = finished_at - interval '10 minutes';
  perform set_config('engagement_test.boom', 'cancel', true);
  res := admin_app.request_recompute('admin@example.invalid');
  f_id := (res ->> 'run_id')::bigint;
  if analytics_private.process_recompute_queue() <> f_id then raise exception 'cancelled run not processed'; end if;
  select * into rec from admin_app.refresh_runs where id = f_id;
  if rec.status <> 'failed' or rec.error not like '57014: %' or rec.detail ->> 'failed_mv' <> 'zz_engagement_test_boom_mv' then
    raise exception 'cancelled run not recorded: %', row_to_json(rec);
  end if;
  if current_setting('lock_timeout') <> '0' then raise exception 'failed refresh leaked lock_timeout'; end if;
  perform set_config('engagement_test.boom', 'off', true);
  drop materialized view analytics_private.zz_engagement_test_boom_mv;
  drop function analytics_private.zz_engagement_test_boom();
  -- The nightly path records its own run; the new account appears after it.
  run_id := analytics_private.refresh_all('nightly');
  if (select status || '/' || requested_by from admin_app.refresh_runs where id = run_id) <> 'done/pg_cron' then raise exception 'nightly run wrong'; end if;
  if (select new_users from analytics.growth_accounting('2026-01-19', '2026-01-25', 'week')) <> 1 then raise exception 'refresh did not pick up new data'; end if;
  if (select status from analytics.data_freshness() where item = 'nightly_refresh') <> 'ok' then raise exception 'data_freshness nightly wrong'; end if;
  begin perform analytics_private.refresh_all('weekly'); raise exception 'refresh_all accepted an unknown kind';
  exception when invalid_parameter_value then null; end;

  -- The queue processor expires stale runs before picking one, so a request whose attempts keep dying stops looping.
  update admin_app.refresh_runs set requested_at = requested_at - interval '1 hour', started_at = started_at - interval '1 hour',
    finished_at = finished_at - interval '1 hour';
  insert into admin_app.refresh_runs(kind, requested_by, requested_at) values ('recompute', 'admin@example.invalid', clock_timestamp() - interval '31 minutes') returning id into run_id;
  insert into admin_app.refresh_runs(kind, requested_by, requested_at, started_at, status) values ('manual', 'x', clock_timestamp() - interval '50 minutes', clock_timestamp() - interval '40 minutes', 'running') returning id into q_id;
  if analytics_private.process_recompute_queue() is not null then raise exception 'queue ran a stale request'; end if;
  if (select string_agg(status || '/' || (finished_at < clock_timestamp())::text || '/' || left(error, 20), ',' order by id) from admin_app.refresh_runs where id in (run_id, q_id))
     <> 'failed/true/not processed within,failed/true/did not finish withi' then
    raise exception 'stale runs not expired by the queue: %', (select string_agg(status || '/' || coalesce(error, ''), ',') from admin_app.refresh_runs where id in (run_id, q_id));
  end if;

  -- A request nobody processed for 30 minutes (no queue job) fails at its deadline instead of blocking the button.
  update admin_app.refresh_runs set requested_at = requested_at - interval '1 hour', started_at = started_at - interval '1 hour',
    finished_at = finished_at - interval '1 hour';
  insert into admin_app.refresh_runs(kind, requested_by, requested_at) values ('recompute', 'admin@example.invalid', clock_timestamp() - interval '40 minutes') returning id into run_id;
  res := admin_app.request_recompute('admin@example.invalid');
  if res ->> 'status' <> 'queued'
     or (select status from admin_app.refresh_runs where id = run_id) <> 'failed'
     or (select error from admin_app.refresh_runs where id = run_id) not like 'not processed within 30 minutes%' then
    raise exception 'stale pending run not failed: %', res;
  end if;

  -- ---------------------------------------------------------------------------
  -- Data freshness
  -- ---------------------------------------------------------------------------
  insert into public.fx_rates(rate_month,base_currency,quote_currency,rate,sample_days,source,is_final) values
    ((date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date,'USD','TRY',40,20,'test',true),
    (date_trunc('month', now() at time zone 'UTC')::date,'USD','TRY',41,10,'test',false);
  insert into public.ai_model_prices(model_prefix,input_usd,output_usd) values ('gpt-6',1,2);
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens) values
    (b,'cv_parse','gemini','gemini-3-flash','completed','{}',now() - interval '2 days',now() - interval '2 days',10,10,20),
    (i,'cv_parse','gemini','gemini-3-flash','completed','{}',now() - interval '2 days',now() - interval '2 days',10,10,20),
    (b,'cv_parse','openai','gpt-6-luna','completed','{}',now() - interval '2 days',now() - interval '2 days',10,10,20);
  select string_agg(item || '=' || status || '/' || coalesce(value::text, '-'), ',' order by item) into got
  from analytics.data_freshness() where item in ('fx_latest_month', 'ai_model_prices', 'unpriced_ai_runs_30d', 'contract_violations', 'scheduler');
  if got <> 'ai_model_prices=ok/1,contract_violations=ok/0,fx_latest_month=ok/41.00000000,scheduler=warn/0,unpriced_ai_runs_30d=warn/1' then
    raise exception 'data_freshness wrong: %', got;
  end if;
  if (select value from analytics.data_freshness(p_include_internal => true) where item = 'unpriced_ai_runs_30d') <> 2 then
    raise exception 'data_freshness unpriced include_internal wrong';
  end if;
  begin perform analytics.data_freshness(p_breakdown => 'market'); raise exception 'data_freshness accepted a breakdown';
  exception when invalid_parameter_value then null; end;

  -- ---------------------------------------------------------------------------
  -- pg_cron present (a stand-in cron schema): both jobs scheduled, idempotently.
  -- ---------------------------------------------------------------------------
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $f$
    insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $f$;
  create function cron.unschedule(p_job bigint) returns boolean language sql as $f$
    delete from cron.job where jobid = p_job returning true $f$;
  -- Without run details (old pg_cron) there is nothing to purge.
  if analytics_private.schedule_refresh_jobs() <> array['analytics_nightly', 'analytics_recompute_queue'] then raise exception 'jobs not scheduled'; end if;
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, end_time timestamptz);
  insert into cron.job(jobname, schedule, command) values ('other_job', '* * * * *', 'select 1');
  if analytics_private.schedule_refresh_jobs() <> array['analytics_nightly', 'analytics_recompute_queue', 'analytics_cron_history_purge'] then
    raise exception 'purge job not scheduled';
  end if;
  perform analytics_private.schedule_refresh_jobs();
  select string_agg(jobname || '|' || schedule || '|' || command, E'\n' order by jobname) into got from cron.job where jobname like 'analytics%';
  if got <> 'analytics_cron_history_purge|20 4 * * *|delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname like ''analytics\_%'' and d.end_time < now() - interval ''7 days'''
            || E'\n' || 'analytics_nightly|45 3 * * *|set statement_timeout = ''10min''; select analytics_private.refresh_all(''nightly'')'
            || E'\n' || 'analytics_recompute_queue|* * * * *|set statement_timeout = ''10min''; select analytics_private.process_recompute_queue()' then
    raise exception 'cron jobs wrong: %', got;
  end if;
  -- The purge keeps 7 days of analytics job history and never touches other jobs.
  insert into cron.job_run_details(jobid, end_time)
  select j.jobid, now() - x.age from cron.job j cross join (values (interval '8 days'), (interval '1 day')) x(age)
  where j.jobname in ('analytics_recompute_queue', 'other_job');
  execute (select command from cron.job where jobname = 'analytics_cron_history_purge');
  select string_agg(j.jobname || '=' || (now() - d.end_time)::text, ',' order by j.jobname, d.end_time) into got
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid;
  if got <> 'analytics_recompute_queue=1 day,other_job=8 days,other_job=1 day' then raise exception 'purge wrong: %', got; end if;
  perform analytics_private.schedule_alert_job();  -- data_freshness (20261104120000) also requires analytics_alerts
  if (select status from analytics.data_freshness() where item = 'scheduler') <> 'ok' then raise exception 'data_freshness scheduler wrong'; end if;
  drop schema cron cascade;

  -- ---------------------------------------------------------------------------
  -- Access: analytics_api calls the metrics and the queue functions, never the views or the refresh.
  -- ---------------------------------------------------------------------------
  update admin_app.refresh_runs set requested_at = requested_at - interval '1 hour', started_at = started_at - interval '1 hour',
    finished_at = finished_at - interval '1 hour';
  update admin_app.refresh_runs set status = 'failed', finished_at = requested_at, error = 'test' where status = 'pending';
  set local role analytics_api;
  if (select sum(new_users) from analytics.growth_accounting('2026-01-05', '2026-01-11', 'week')) <> 2 then raise exception 'analytics_api cannot read growth_accounting'; end if;
  if (select count(*) from analytics.data_freshness()) < 10 then raise exception 'analytics_api cannot read data_freshness'; end if;
  if (admin_app.request_recompute('admin@example.invalid') ->> 'status') <> 'queued' then raise exception 'analytics_api cannot request a recompute'; end if;
  if (select status from admin_app.recompute_status()) <> 'pending' then raise exception 'analytics_api cannot poll'; end if;
  begin perform 1 from analytics_private.engagement_growth; raise exception 'analytics_api read a materialized view';
  exception when insufficient_privilege then null; end;
  begin perform analytics_private.refresh_all(); raise exception 'analytics_api ran refresh_all';
  exception when insufficient_privilege then null; end;
  begin perform 1 from admin_app.refresh_runs; raise exception 'analytics_api read refresh_runs';
  exception when insufficient_privilege then null; end;
  reset role;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics engagement metrics, materialized views and recompute queue passed' as verification;
rollback;
