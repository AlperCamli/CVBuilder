-- Admin analytics Phase 5: kpi_health, alert rules / events / evaluation and audited audit-log reads
-- (20261104120000_analytics_alerts.sql).
begin;
do $$
declare
  violations text;
  now_ts constant timestamptz := '2026-11-15T10:00:00Z';
  a uuid; b uuid; internal uuid;
  f_src uuid; m uuid; j uuid; tc uuid; sess uuid; cl uuid;
  k record; rec record; w record;
  rule_rate uuid; rule_pct uuid; rule_pct_lt uuid; rule_null uuid; rule_today uuid; rule_off uuid; rule_lt uuid;
  rule_internal uuid; rule_broken uuid; rule_dedupe uuid;
  ev bigint;
  n bigint; fired integer; d jsonb; t text;
  bad jsonb;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- -------------------------------------------------------------------------
  -- Windows (UTC)
  -- -------------------------------------------------------------------------
  select * into w from analytics_private.alert_window('today', '2026-11-15T23:59:59Z');
  if (w.from_day, w.to_day, w.prev_from, w.prev_to) is distinct from ('2026-11-15'::date, '2026-11-15'::date, '2026-11-14'::date, '2026-11-14'::date) then
    raise exception 'today window: %', row_to_json(w); end if;
  -- 00:30 at UTC+3 is still the previous UTC day.
  select * into w from analytics_private.alert_window('1d', '2026-11-16T00:30:00+03:00');
  if (w.from_day, w.to_day, w.prev_from, w.prev_to) is distinct from ('2026-11-14'::date, '2026-11-14'::date, '2026-11-13'::date, '2026-11-13'::date) then
    raise exception '1d window: %', row_to_json(w); end if;
  select * into w from analytics_private.alert_window('7d', now_ts);
  if (w.from_day, w.to_day, w.prev_from, w.prev_to) is distinct from ('2026-11-08'::date, '2026-11-14'::date, '2026-11-01'::date, '2026-11-07'::date) then
    raise exception '7d window: %', row_to_json(w); end if;
  select * into w from analytics_private.alert_window('30d', now_ts);
  if (w.from_day, w.to_day, w.prev_from, w.prev_to) is distinct from ('2026-10-16'::date, '2026-11-14'::date, '2026-09-16'::date, '2026-10-15'::date) then
    raise exception '30d window: %', row_to_json(w); end if;

  -- -------------------------------------------------------------------------
  -- Fixtures (UTC). AI runs of A: today 1 failed; 11-14 2 completed + 1 failed; 11-08..11-13 3 completed;
  -- 11-01..11-07 2 completed; B: 1 pending on 11-14. Internal: 1 failed on 11-14 (excluded unless included). B is in market GLOBAL.
  -- -------------------------------------------------------------------------
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'alerts-a@example.invalid','2026-10-01T09:00:00Z') returning id into a;
  insert into public.billing_markets(user_id,market) values(a,'TR');
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'alerts-b@example.invalid','2026-10-01T09:00:00Z') returning id into b;
  insert into public.billing_markets(user_id,market) values(b,'GLOBAL');
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'alerts-admin@example.invalid','2026-10-01T09:00:00Z',true) returning id into internal;

  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,cost_usd,total_tokens) values
    (a,'block_suggest','openai','gpt-6','failed','{}','2026-11-15T08:00:00Z','2026-11-15T08:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-14T08:00:00Z','2026-11-14T08:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-14T09:00:00Z','2026-11-14T09:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','failed','{}','2026-11-14T10:00:00Z','2026-11-14T10:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-09T08:00:00Z','2026-11-09T08:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-11T08:00:00Z','2026-11-11T08:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-13T23:59:59Z','2026-11-14T00:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-02T08:00:00Z','2026-11-02T08:00:01Z',0.01,10),
    (a,'block_suggest','openai','gpt-6','completed','{}','2026-11-07T23:59:59Z','2026-11-08T00:00:01Z',0.01,10),
    (internal,'block_suggest','openai','gpt-6','failed','{}','2026-11-14T11:00:00Z','2026-11-14T11:00:01Z',0.01,10),
    -- Mock runs never count; a run with tokens but no cost and no price is unpriced.
    (a,'block_suggest','mock','mock','failed','{}','2026-11-14T12:00:00Z','2026-11-14T12:00:01Z',null,10);
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,cost_usd,total_tokens,input_tokens)
    values(b,'block_suggest','openai','no-price-model','pending','{}','2026-11-14T13:00:00Z',null,null,100,100);

  -- Payments on 11-14: one paid, one uncollectible (market TR, plan monthly); one void for plan weekly.
  insert into public.billing_invoices(user_id,provider_invoice_id,status,currency,amount_total,amount_paid,billing_reason,plan_code,market,paid_at,created_at) values
    (a,'in_alerts_1','paid','try',32000,32000,'subscription_cycle','monthly','TR','2026-11-14T12:00:00Z','2026-11-14T11:59:00Z'),
    (a,'in_alerts_2','uncollectible','try',32000,0,'subscription_cycle','monthly','TR',null,'2026-11-14T12:00:00Z'),
    (b,'in_alerts_3','void','usd',1000,0,'subscription_cycle','weekly','GLOBAL',null,'2026-11-14T12:00:00Z');

  -- Checkout on 11-14: completed, expired, rejected (rejected stays out of the abandon rate).
  insert into public.checkout_attempts(user_id,plan_code,market,currency,amount,trial_requested,trial_applied,checkout_session_id,outcome,created_at,resolved_at) values
    (a,'monthly','TR','try',32000,false,false,'cs_alerts_1','completed','2026-11-14T10:00:00Z','2026-11-14T10:05:00Z'),
    (a,'monthly','TR','try',32000,false,false,'cs_alerts_2','expired','2026-11-14T11:00:00Z','2026-11-14T12:00:00Z'),
    (a,'monthly','TR','try',32000,false,false,null,'rejected_active','2026-11-14T13:00:00Z','2026-11-14T13:00:00Z');

  -- Imports on 11-14: one failed, one parsed.
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at)
    values(a,'source_upload','imports','users/'||a||'/cv.pdf','cv.pdf','application/pdf',2048,'2026-11-14T09:00:00Z') returning id into f_src;
  insert into public.imports(user_id,source_file_id,status,parser_name,error_message,created_at) values
    (a,f_src,'failed','pdf','Import parsing failed','2026-11-14T09:01:00Z'),
    (a,f_src,'parsed','pdf',null,'2026-11-14T09:02:00Z');

  -- Exports on 11-14: CV export completed + failed, cover-letter export failed.
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at)
    values(a,'CV','en','{"language":"en"}','import','2026-11-14T09:10:00Z') returning id into m;
  insert into public.exports(user_id,master_cv_id,format,status,error_message,created_at) values
    (a,m,'docx','failed','Export generation failed','2026-11-14T09:20:00Z');
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,created_at)
    values(a,'export_pdf','exports','users/'||a||'/master-cvs/'||m||'/exports/x.pdf','x.pdf','application/pdf',99,'2026-11-14T09:21:00Z') returning id into f_src;
  insert into public.exports(user_id,master_cv_id,file_id,format,status,created_at,completed_at) values
    (a,m,f_src,'pdf','completed','2026-11-14T09:21:00Z','2026-11-14T09:21:03Z');
  insert into public.jobs(user_id,company_name,job_title,job_description,created_at)
    values(a,'Co','Role','Description','2026-11-14T09:30:00Z') returning id into j;
  insert into public.tailored_cvs(user_id,master_cv_id,job_id,title,language,current_content,created_at)
    values(a,m,j,'Tailored','en','{}','2026-11-14T09:31:00Z') returning id into tc;
  insert into public.cover_letters(user_id,job_id,tailored_cv_id,title,content,language,created_at)
    values(a,j,tc,'Letter','Body','en','2026-11-14T09:32:00Z') returning id into cl;
  insert into public.cover_letter_exports(user_id,cover_letter_id,format,status,error_message,created_at)
    values(a,cl,'pdf','failed','Failed to generate cover letter export','2026-11-14T09:33:00Z');

  -- Tailoring v2 tasks on 11-14: one failed, one done, one still running (not terminal).
  insert into public.tailoring_sessions(user_id,tailored_cv_id,job_id,status,job_snapshot,base_snapshot,created_at)
    values(a,tc,j,'generating','{}','{}','2026-11-14T09:40:00Z') returning id into sess;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,block_id,status,brief,error_message,created_at,started_at,completed_at) values
    (sess,a,'block','b1','failed','{}','The AI could not prepare this suggestion. Try again.','2026-11-14T09:41:00Z','2026-11-14T09:41:00Z','2026-11-14T09:41:05Z'),
    (sess,a,'block','b2','done','{}',null,'2026-11-14T09:41:00Z','2026-11-14T09:41:00Z','2026-11-14T09:41:05Z'),
    (sess,a,'block','b3','running','{}',null,'2026-11-14T09:41:00Z','2026-11-14T09:41:00Z',null);

  -- -------------------------------------------------------------------------
  -- analytics.kpi_health
  -- -------------------------------------------------------------------------
  select * into k from analytics.kpi_health('2026-11-14', '2026-11-14');
  if (k.ai_runs, k.ai_failed_runs, k.ai_failure_rate, k.unpriced_ai_runs) is distinct from (4::bigint, 1::bigint, 0.3333::numeric, 1::bigint) then
    raise exception 'kpi_health AI: %', row_to_json(k); end if;
  if (k.failed_payments, k.payment_failure_rate) is distinct from (2::bigint, 0.6667::numeric) then
    raise exception 'kpi_health payments: %', row_to_json(k); end if;
  if (k.checkout_attempts, k.checkout_abandon_rate) is distinct from (3::bigint, 0.5::numeric) then
    raise exception 'kpi_health checkout: %', row_to_json(k); end if;
  if (k.export_failures, k.export_failure_rate) is distinct from (2::bigint, 0.6667::numeric) then
    raise exception 'kpi_health exports: %', row_to_json(k); end if;
  if (k.import_failures, k.import_failure_rate) is distinct from (1::bigint, 0.5::numeric) then
    raise exception 'kpi_health imports: %', row_to_json(k); end if;
  if (k.tailoring_task_failures, k.tailoring_task_failure_rate) is distinct from (1::bigint, 0.5::numeric) then
    raise exception 'kpi_health tailoring: %', row_to_json(k); end if;
  -- Internal accounts only when included.
  select * into k from analytics.kpi_health('2026-11-14', '2026-11-14', p_include_internal => true);
  if (k.ai_runs, k.ai_failed_runs) is distinct from (5::bigint, 2::bigint) then raise exception 'kpi_health include_internal: %', row_to_json(k); end if;
  -- market filters every measure; plan only payments and checkout.
  select * into k from analytics.kpi_health('2026-11-14', '2026-11-14', p_filters => '{"market":"GLOBAL"}');
  if (k.ai_runs, k.ai_failure_rate, k.unpriced_ai_runs, k.failed_payments, k.checkout_attempts, k.export_failures, k.import_failures, k.tailoring_task_failures)
     is distinct from (1::bigint, null::numeric, 1::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint) then
    raise exception 'kpi_health market filter: %', row_to_json(k); end if;
  select * into k from analytics.kpi_health('2026-11-14', '2026-11-14', p_filters => '{"plan":["monthly"]}');
  if (k.ai_runs, k.failed_payments, k.payment_failure_rate, k.checkout_attempts) is distinct from (4::bigint, 1::bigint, 0.5::numeric, 3::bigint) then
    raise exception 'kpi_health plan filter: %', row_to_json(k); end if;
  -- An empty range has counts of 0 and null rates.
  select * into k from analytics.kpi_health('2020-01-01', '2020-01-01');
  if k.ai_runs <> 0 or k.ai_failure_rate is not null or k.payment_failure_rate is not null then raise exception 'kpi_health empty: %', row_to_json(k); end if;
  begin perform analytics.kpi_health(p_filters => '{"locale":"en"}'); raise exception 'kpi_health accepted locale';
  exception when sqlstate '22023' then null; end;
  begin perform analytics.kpi_health(p_breakdown => 'market'); raise exception 'kpi_health accepted a breakdown';
  exception when sqlstate '22023' then null; end;
  if not exists (select 1 from admin_app.metric_catalog() c where c.name = 'kpi_health' and c.meta ->> 'alertable' = 'true' and c.meta ->> 'shape' = 'kpi') then
    raise exception 'kpi_health not in the catalog as alertable'; end if;

  -- -------------------------------------------------------------------------
  -- Rule validation (22023), create / update / delete
  -- -------------------------------------------------------------------------
  foreach bad in array array[
    '{"name":"x","metric":"signups","measure":"signups","window":"1d","condition":"gt","threshold":1}',           -- not alertable
    '{"name":"x","metric":"nope","measure":"signups","window":"1d","condition":"gt","threshold":1}',              -- unknown metric
    '{"name":"x","metric":"Bad-Name","measure":"signups","window":"1d","condition":"gt","threshold":1}',          -- malformed metric
    '{"name":"x","metric":"kpi_overview","measure":"revenue_fx_provisional","window":"1d","condition":"gt","threshold":1}', -- boolean column
    '{"name":"x","metric":"kpi_overview","measure":"nope","window":"1d","condition":"gt","threshold":1}',         -- unknown measure
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"2d","condition":"gt","threshold":1}',         -- window
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gte","threshold":1}',        -- condition
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"today","condition":"pct_change_gt","threshold":1}', -- % change on today
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt"}',                     -- no threshold
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":"1"}',     -- threshold as text
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"cooldown_hours":0}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"cooldown_hours":721}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"cooldown_hours":1.5}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"enabled":"yes"}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"currency":"eur"}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"include_internal":"true"}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"filters":{"locale":"en"}}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"filters":{"market":{"a":1}}}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"filters":{"market":[]}}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":{"grain":"week"}}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"params":[]}',
    '{"name":"  ","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1}',
    '{"metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1}',
    '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1,"id":"00000000-0000-0000-0000-000000000000"}'
  ]::jsonb[] loop
    begin
      perform admin_app.create_alert_rule('admin@example.invalid', bad, null);
      raise exception 'invalid rule accepted: %', bad;
    exception when sqlstate '22023' then null; end;
  end loop;
  if exists (select 1 from admin_app.alert_rules) then raise exception 'a rejected rule was stored'; end if;
  begin perform admin_app.create_alert_rule('not-an-email', '{"name":"x","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1}', null);
    raise exception 'malformed admin email accepted';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from admin_app.alert_rules) then raise exception 'a rule without a valid audit row was stored'; end if;

  select r.id into rule_rate from admin_app.create_alert_rule(' Admin@Example.invalid ',
    '{"name":" AI failure rate ","metric":"kpi_health","measure":"ai_failure_rate","window":"1d","condition":"gt","threshold":0.3}', 'req-create_1') r;
  select * into rec from admin_app.alert_rules where id = rule_rate;
  if rec.name <> 'AI failure rate' or rec.created_by <> 'admin@example.invalid' or rec.cooldown_hours <> 24 or not rec.enabled
     or rec.params <> '{"currency":"usd","include_internal":false,"filters":{}}'::jsonb then
    raise exception 'create defaults/normalisation: %', row_to_json(rec); end if;
  select * into rec from admin_app.audit_log where action = 'alert.rule.create' order by id desc limit 1;
  if rec.admin_email <> 'admin@example.invalid' or rec.request_id <> 'req-create_1' or rec.people_function is not null
     or rec.target_user_id is not null or (rec.params ->> 'rule_id')::uuid <> rule_rate or rec.params ->> 'metric' <> 'kpi_health' then
    raise exception 'create audit row: %', row_to_json(rec); end if;
  -- Names are unique, case-insensitively.
  begin perform admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"ai FAILURE rate","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":1}', null);
    raise exception 'duplicate name accepted';
  exception when unique_violation then null; end;

  select r.id into rule_pct from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"AI runs up","metric":"kpi_health","measure":"ai_runs","window":"7d","condition":"pct_change_gt","threshold":1.0}', null) r;
  select r.id into rule_pct_lt from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"AI runs down","metric":"kpi_health","measure":"ai_runs","window":"7d","condition":"pct_change_lt","threshold":-0.5}', null) r;
  select r.id into rule_null from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"GLOBAL failure rate today","metric":"kpi_health","measure":"ai_failure_rate","window":"today","condition":"gt","threshold":0,"params":{"filters":{"market":"GLOBAL"}}}', null) r;
  select r.id into rule_today from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"AI runs today","metric":"kpi_health","measure":"ai_runs","window":"today","condition":"gt","threshold":0,"cooldown_hours":1}', null) r;
  select r.id into rule_off from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Disabled","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":0,"enabled":false}', null) r;
  select r.id into rule_lt from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Few runs","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"lt","threshold":5}', null) r;
  select r.id into rule_internal from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Runs incl. internal","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":4.5,"params":{"include_internal":true,"currency":"try"}}', null) r;
  select r.id into rule_dedupe from admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Any runs yesterday","metric":"kpi_health","measure":"ai_runs","window":"1d","condition":"gt","threshold":0,"cooldown_hours":1}', null) r;
  -- Signups yesterday on the Overview KPIs (no signups -> 0, below the threshold: no event).
  perform admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Signup burst","metric":"kpi_overview","measure":"signups","window":"1d","condition":"gt","threshold":100,"params":{"filters":{"market":["TR","GLOBAL"]}}}', null);

  -- Partial update: merged, revalidated, audited with the changed fields only.
  perform admin_app.update_alert_rule('admin@example.invalid', rule_rate, '{"threshold":0.25,"cooldown_hours":48}', 'req-update');
  select * into rec from admin_app.alert_rules where id = rule_rate;
  if rec.threshold <> 0.25 or rec.cooldown_hours <> 48 or rec."window" <> '1d' or rec.updated_by <> 'admin@example.invalid' then
    raise exception 'update did not merge: %', row_to_json(rec); end if;
  select params into d from admin_app.audit_log where action = 'alert.rule.update' order by id desc limit 1;
  if d -> 'changes' <> '{"threshold":{"from":0.3,"to":0.25},"cooldown_hours":{"from":24,"to":48}}'::jsonb then
    raise exception 'update audit: %', d; end if;
  begin perform admin_app.update_alert_rule('admin@example.invalid', rule_rate, '{"window":"today","condition":"pct_change_lt"}', null);
    raise exception 'update produced an invalid rule';
  exception when sqlstate '22023' then null; end;
  begin perform admin_app.update_alert_rule('admin@example.invalid', rule_rate, '{}', null); raise exception 'empty patch accepted';
  exception when sqlstate '22023' then null; end;
  begin perform admin_app.update_alert_rule('admin@example.invalid', rule_rate, '{"created_by":"x@y.z"}', null); raise exception 'created_by patched';
  exception when sqlstate '22023' then null; end;
  begin perform admin_app.update_alert_rule('admin@example.invalid', gen_random_uuid(), '{"enabled":false}', null); raise exception 'unknown rule updated';
  exception when sqlstate 'P0002' then null; end;
  begin perform admin_app.delete_alert_rule('admin@example.invalid', gen_random_uuid(), null); raise exception 'unknown rule deleted';
  exception when sqlstate 'P0002' then null; end;

  -- A rule whose metric stops being alertable later is recorded as an evaluation error, not fired.
  insert into admin_app.alert_rules(name,metric,measure,"window",condition,threshold,created_by)
    values('Broken','signups','signups','1d','gt',0,'admin@example.invalid') returning id into rule_broken;

  -- -------------------------------------------------------------------------
  -- Evaluation at 2026-11-15 10:00 UTC
  -- -------------------------------------------------------------------------
  fired := analytics_private.evaluate_alerts(now_ts);
  -- rate (0.3333 > 0.25), pct (7 vs 2 = +250% > +100%), today (1 > 0), lt (4 < 5), internal (5 > 4.5), dedupe (4 > 0).
  if fired <> 6 then raise exception 'expected 6 events, got % (%)', fired,
    (select jsonb_agg(jsonb_build_object('rule', r.name, 'value', r.last_value, 'error', r.last_error)) from admin_app.alert_rules r); end if;
  select * into rec from admin_app.alert_events where rule_id = rule_rate;
  if rec.value <> 0.3333 or rec.baseline is not null or rec.window_from <> '2026-11-14' or rec.window_to <> '2026-11-14' or rec.fired_at <> now_ts
     or rec.message <> 'AI failure rate: AI failure rate is 33.3% for 2026-11-14, above 25%.' then
    raise exception 'rate event: %', row_to_json(rec); end if;
  select * into rec from admin_app.alert_events where rule_id = rule_pct;
  if rec.value <> 7 or rec.baseline <> 2 or rec.window_from <> '2026-11-08' or rec.window_to <> '2026-11-14'
     or rec.message <> 'AI runs up: AI runs is 7 for 2026-11-08 to 2026-11-14, +250% vs 2 for 2026-11-01 to 2026-11-07 (threshold +100%).' then
    raise exception 'pct event: %', row_to_json(rec); end if;
  if exists (select 1 from admin_app.alert_events where rule_id in (rule_pct_lt, rule_null, rule_off, rule_broken)) then
    raise exception 'a rule fired that should not have'; end if;
  select * into rec from admin_app.alert_events where rule_id = rule_today;
  if rec.value <> 1 or rec.window_from <> '2026-11-15' or rec.message not like '%for 2026-11-15 (so far), above 0.' then
    raise exception 'today event: %', row_to_json(rec); end if;
  if (select value from admin_app.alert_events where rule_id = rule_lt) <> 4 then raise exception 'lt event'; end if;
  if (select value from admin_app.alert_events where rule_id = rule_internal) <> 5 then raise exception 'include_internal event'; end if;
  -- Null value never fires, but the evaluation is recorded; the disabled rule is not evaluated.
  select * into rec from admin_app.alert_rules where id = rule_null;
  if rec.last_evaluated_at <> now_ts or rec.last_value is not null or rec.last_error is not null then raise exception 'null rule: %', row_to_json(rec); end if;
  if (select last_evaluated_at from admin_app.alert_rules where id = rule_off) is not null then raise exception 'disabled rule evaluated'; end if;
  if (select last_value from admin_app.alert_rules where id = rule_pct_lt) <> 7 then raise exception 'pct_lt not evaluated'; end if;
  select * into rec from admin_app.alert_rules where id = rule_broken;
  if rec.last_error not like '22023: %not an alertable%' or rec.last_evaluated_at <> now_ts then raise exception 'broken rule: %', row_to_json(rec); end if;

  -- Cooldown: 30 minutes later nothing fires again (the 1-hour rules are still cooling down); 2 hours later only the
  -- 1-hour `today` rule fires again (today still has 1 run); the 24/48-hour rules stay quiet, and so does the 1-hour 1d
  -- rule: its window (2026-11-14) is unchanged.
  if analytics_private.evaluate_alerts(now_ts + interval '30 minutes') <> 0 then raise exception 'cooldown ignored'; end if;
  if analytics_private.evaluate_alerts(now_ts + interval '2 hours') <> 1 then raise exception 'cooldown did not expire'; end if;
  if (select count(*) from admin_app.alert_events where rule_id = rule_today) <> 2 then raise exception 'today rule did not refire'; end if;
  -- A complete window is reported once: the 1-hour-cooldown 1d rule did not fire again for 2026-11-14.
  if (select count(*) from admin_app.alert_events where rule_id = rule_dedupe) <> 1 then raise exception 'complete window re-fired'; end if;
  -- Checks whose side effects are undone (the sub-block ends in an error that rolls it back).
  begin
    -- The next day's window is new, so the rule fires again.
    perform analytics_private.evaluate_alerts('2026-11-16T10:00:00Z');
    if (select count(*) from admin_app.alert_events where rule_id = rule_dedupe) <> 2
       or not exists (select 1 from admin_app.alert_events where rule_id = rule_dedupe and window_from = '2026-11-15' and value = 1) then
      raise exception 'next window did not fire: %', (select jsonb_agg(row_to_json(e)) from admin_app.alert_events e where e.rule_id = rule_dedupe);
    end if;
    -- A cancelled metric call (statement_timeout of the cron command) is recorded and the other rules still run.
    create function analytics.test_cancelled_kpi(
      p_from date default null, p_to date default null, p_grain text default 'day', p_currency text default 'usd',
      p_include_internal boolean default false, p_breakdown text default null, p_filters jsonb default '{}'::jsonb)
    returns table (n bigint) language plpgsql stable security definer set search_path = '' as $f$
    begin raise exception 'canceling statement due to statement timeout' using errcode = 'query_canceled'; end $f$;
    comment on function analytics.test_cancelled_kpi(date, date, text, text, boolean, text, jsonb) is
      '{"title":"t","definition":"t","unit":"count","shape":"kpi","breakdowns":[],"filters":[],"alertable":true}';
    insert into admin_app.alert_rules(name,metric,measure,"window",condition,threshold,created_by,last_evaluated_at)
      values('Cancelled','test_cancelled_kpi','n','1d','gt',0,'admin@example.invalid','-infinity');
    perform analytics_private.evaluate_alerts('2026-11-17T10:00:00Z');
    if (select last_error from admin_app.alert_rules where name = 'Cancelled') not like '57014: %'
       or (select last_evaluated_at from admin_app.alert_rules where id = rule_dedupe) <> '2026-11-17T10:00:00Z' then
      raise exception 'cancellation not isolated: %', (select jsonb_agg(jsonb_build_object('n', r.name, 'e', r.last_error, 'at', r.last_evaluated_at)) from admin_app.alert_rules r);
    end if;
    -- Once the time budget is spent no further rule starts.
    if analytics_private.evaluate_alerts('2026-11-18T10:00:00Z', interval '0') <> 0
       or exists (select 1 from admin_app.alert_rules where last_evaluated_at = '2026-11-18T10:00:00Z') then
      raise exception 'budget ignored';
    end if;
    raise exception 'undo';
  exception when raise_exception then
    if sqlerrm <> 'undo' then raise; end if;
  end;
  -- A pct_change rule with a zero baseline never fires.
  update admin_app.alert_rules set threshold = -100 where id = rule_pct_lt;
  if analytics_private.evaluate_alerts('2026-11-02T10:00:00Z') <> 0 then
    raise exception 'fired on a zero baseline: %', (select jsonb_agg(row_to_json(e)) from admin_app.alert_events e where e.fired_at = '2026-11-02T10:00:00Z');
  end if;

  -- -------------------------------------------------------------------------
  -- Events, acknowledgement, summary
  -- -------------------------------------------------------------------------
  select count(*) into n from admin_app.list_alert_events('open', 50);
  if n <> 7 then raise exception 'open events: %', n; end if;
  select * into rec from admin_app.alert_summary();
  if rec.open_count <> 7 or rec.latest_fired_at <> now_ts + interval '2 hours' then raise exception 'summary: %', row_to_json(rec); end if;
  select e.* into rec from admin_app.list_alert_events('all', 1) e;
  if rec.rule_name <> 'AI runs today' or rec.metric <> 'kpi_health' or rec.measure <> 'ai_runs' or rec.condition <> 'gt' or rec.threshold <> 0 then
    raise exception 'event listing: %', row_to_json(rec); end if;
  ev := rec.id;
  select * into rec from admin_app.ack_alert_event('Second@Example.invalid', ev, 'req-ack');
  if rec.acknowledged_by <> 'second@example.invalid' or rec.acknowledged_at is null or rec.rule_name <> 'AI runs today' then
    raise exception 'ack: %', row_to_json(rec); end if;
  -- A second acknowledgement keeps the first one and is audited as such.
  select * into rec from admin_app.ack_alert_event('admin@example.invalid', ev, null);
  if rec.acknowledged_by <> 'second@example.invalid' then raise exception 'second ack overwrote the first'; end if;
  if (select count(*) from admin_app.audit_log where action = 'alert.event.ack' and (params ->> 'event_id')::bigint = ev) <> 2
     or not exists (select 1 from admin_app.audit_log where action = 'alert.event.ack' and request_id = 'req-ack' and params ->> 'already_acknowledged' = 'false')
     or not exists (select 1 from admin_app.audit_log where action = 'alert.event.ack' and params ->> 'already_acknowledged' = 'true') then
    raise exception 'ack audit rows'; end if;
  if (select open_count from admin_app.alert_summary()) <> 6 then raise exception 'summary after ack'; end if;
  if (select count(*) from admin_app.list_alert_events('open', 50)) <> 6 or (select count(*) from admin_app.list_alert_events('all', 50)) <> 7 then
    raise exception 'open/all after ack'; end if;
  begin perform admin_app.ack_alert_event('admin@example.invalid', -1, null); raise exception 'unknown event acknowledged';
  exception when sqlstate 'P0002' then null; end;
  begin perform admin_app.list_alert_events('closed', 50); raise exception 'bad status accepted';
  exception when sqlstate '22023' then null; end;
  begin perform admin_app.list_alert_events('all', 201); raise exception 'limit 201 accepted';
  exception when sqlstate '22023' then null; end;

  -- Delete cascades the rule's events and is audited.
  perform admin_app.delete_alert_rule('admin@example.invalid', rule_today, 'req-delete');
  if exists (select 1 from admin_app.alert_events where rule_id = rule_today) or exists (select 1 from admin_app.alert_rules where id = rule_today) then
    raise exception 'delete did not cascade'; end if;
  if not exists (select 1 from admin_app.audit_log where action = 'alert.rule.delete' and request_id = 'req-delete'
                 and (params ->> 'rule_id')::uuid = rule_today and (params ->> 'deleted_events')::int = 2) then
    raise exception 'delete audit row'; end if;

  -- -------------------------------------------------------------------------
  -- Audited audit-log reads
  -- -------------------------------------------------------------------------
  begin perform admin_app.audit_recent(10); raise exception 'audit_recent ran without an audit.read row';
  exception when insufficient_privilege then null; end;
  perform admin_app.log_access('admin@example.invalid', 'audit.read', null, '{"limit":3}', 'req-audit');
  select count(*) into n from admin_app.audit_recent(3);
  if n <> 3 then raise exception 'audit_recent limit: %', n; end if;
  select r.action into t from admin_app.audit_recent(1) r;
  if t <> 'audit.read' then raise exception 'audit_recent not newest first: %', t; end if;
  if (select r.people_function from admin_app.audit_recent(500) r where r.action = 'alert.rule.create' limit 1) is not null
     or not exists (select 1 from admin_app.audit_recent(500) r where r.action = 'audit.read' and r.request_id = 'req-audit') then
    raise exception 'audit_recent columns'; end if;
  if (select people_function from admin_app.audit_log where action = 'audit.read' order by id desc limit 1) is not null then
    raise exception 'audit.read got a people_function'; end if;
  -- People auditing stays strict: an unknown people function is still rejected.
  begin perform admin_app.log_access('admin@example.invalid', 'people.nope', null, '{}', null); raise exception 'unknown people function accepted';
  exception when sqlstate '22023' then null; end;

  -- -------------------------------------------------------------------------
  -- data_freshness: alert evaluation and scheduler health
  -- -------------------------------------------------------------------------
  update admin_app.alert_rules set last_evaluated_at = now() - interval '10 minutes', last_error = null where enabled;
  update admin_app.alert_rules set last_error = '22023: broken' where id = rule_broken;
  select * into rec from analytics.data_freshness() where item = 'alerts_evaluated';
  if rec.status <> 'warn' or rec.value_text not like '1 of % rules failing' or rec.detail -> 'failing' <> '["Broken"]'::jsonb then
    raise exception 'alerts_evaluated with an error: %', row_to_json(rec); end if;
  update admin_app.alert_rules set last_error = null where id = rule_broken;
  select * into rec from analytics.data_freshness() where item = 'alerts_evaluated';
  if rec.status <> 'ok' or rec.value <> 0.17 or rec.at <> now() - interval '10 minutes' then raise exception 'alerts_evaluated ok: %', row_to_json(rec); end if;
  -- One rule left behind (created over 2 hours ago, not evaluated for 2 hours) warns even though others are fresh.
  update admin_app.alert_rules set created_at = now() - interval '1 day', last_evaluated_at = now() - interval '3 hours' where id = rule_null;
  if (select status || '|' || value_text from analytics.data_freshness() where item = 'alerts_evaluated') <> 'warn|1 of 9 rules not evaluated for 2 hours' then
    raise exception 'stale rule: %', (select row_to_json(f) from analytics.data_freshness() f where f.item = 'alerts_evaluated'); end if;
  -- The job stopped: every evaluation older than 2 hours.
  update admin_app.alert_rules set last_evaluated_at = now() - interval '3 hours' where enabled;
  if (select status from analytics.data_freshness() where item = 'alerts_evaluated') <> 'warn' then raise exception 'stopped evaluation not flagged'; end if;
  -- A new rule not evaluated yet does not warn on its own; no enabled rule at all is info.
  update admin_app.alert_rules set last_evaluated_at = now() - interval '5 minutes' where enabled and id <> rule_rate;
  update admin_app.alert_rules set created_at = now(), last_evaluated_at = null where id = rule_rate;
  if (select status from analytics.data_freshness() where item = 'alerts_evaluated') <> 'ok' then raise exception 'new rule flagged'; end if;
  update admin_app.alert_rules set enabled = false where enabled;
  if (select status || '|' || value_text from analytics.data_freshness() where item = 'alerts_evaluated') <> 'info|no enabled rules' then
    raise exception 'no rules not info'; end if;

  -- Without pg_cron the scheduler warns.
  if (select status || '|' || value_text from analytics.data_freshness() where item = 'scheduler') <> 'warn|pg_cron not installed' then
    raise exception 'scheduler without pg_cron'; end if;
  -- A stand-in pg_cron (cron.job with active, cron.job_run_details with status / start_time).
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $f$
    insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $f$;
  create function cron.unschedule(p_job bigint) returns boolean language sql as $f$
    delete from cron.job where jobid = p_job returning true $f$;
  perform analytics_private.schedule_refresh_jobs();
  select * into rec from analytics.data_freshness() where item = 'scheduler';
  if rec.status <> 'warn' or rec.value_text <> 'missing: analytics_alerts' then raise exception 'missing alerts job: %', row_to_json(rec); end if;
  if analytics_private.schedule_alert_job() <> array['analytics_alerts'] then raise exception 'alert job not scheduled'; end if;
  perform analytics_private.schedule_alert_job();
  if (select count(*) || '|' || min(schedule) || '|' || min(command) from cron.job where jobname = 'analytics_alerts')
     <> '1|5 * * * *|set statement_timeout = ''15min''; select analytics_private.evaluate_alerts()' then
    raise exception 'alert job wrong: %', (select jsonb_agg(row_to_json(j)) from cron.job j where j.jobname = 'analytics_alerts'); end if;
  if (select status from analytics.data_freshness() where item = 'scheduler') <> 'ok' then
    raise exception 'scheduler not ok: %', (select row_to_json(f) from analytics.data_freshness() f where f.item = 'scheduler'); end if;
  update cron.job set active = false where jobname = 'analytics_alerts';
  if (select status || '|' || value_text from analytics.data_freshness() where item = 'scheduler') <> 'warn|inactive: analytics_alerts' then
    raise exception 'inactive job not flagged'; end if;
  update cron.job set active = true;
  -- Failed runs: one 25 hours ago is history; one 2 hours ago warns.
  insert into cron.job_run_details(jobid, status, start_time)
  select jobid, 'failed', now() - interval '25 hours' from cron.job where jobname = 'analytics_nightly';
  if (select status from analytics.data_freshness() where item = 'scheduler') <> 'ok' then raise exception 'old failure flagged'; end if;
  insert into cron.job_run_details(jobid, status, start_time)
  select jobid, 'failed', now() - interval '2 hours' from cron.job where jobname = 'analytics_alerts';
  insert into cron.job_run_details(jobid, status, start_time)
  select jobid, 'succeeded', now() - interval '1 hour' from cron.job where jobname = 'analytics_alerts';
  select * into rec from analytics.data_freshness() where item = 'scheduler';
  if rec.status <> 'warn' or rec.value_text <> '1 failed runs in 24 hours: analytics_alerts' or (rec.detail ->> 'failed_runs_24h')::int <> 1 then
    raise exception 'recent failure not flagged: %', row_to_json(rec); end if;
  drop schema cron cascade;
  if (select count(*) from analytics.data_freshness()) < 12 then raise exception 'data_freshness rows missing'; end if;

  -- -------------------------------------------------------------------------
  -- Scheduling guard and privileges
  -- -------------------------------------------------------------------------
  if not exists (select 1 from pg_namespace where nspname = 'cron') and cardinality(analytics_private.schedule_alert_job()) <> 0 then
    raise exception 'schedule_alert_job without pg_cron'; end if;

  set local role analytics_api;
  if (select count(*) from admin_app.list_alert_rules()) < 8 then raise exception 'analytics_api cannot list rules'; end if;
  if (select open_count from admin_app.alert_summary()) <> 5 then raise exception 'analytics_api cannot read the summary'; end if;
  perform admin_app.create_alert_rule('admin@example.invalid',
    '{"name":"Via api role","metric":"kpi_health","measure":"failed_payments","window":"today","condition":"gt","threshold":0}', null);
  if (select ai_runs from analytics.kpi_health('2026-11-14', '2026-11-14')) <> 4 then raise exception 'analytics_api cannot read kpi_health'; end if;
  begin perform 1 from admin_app.alert_rules; raise exception 'analytics_api read alert_rules';
  exception when insufficient_privilege then null; end;
  begin insert into admin_app.alert_events(rule_id,window_from,window_to,message) values(rule_rate,'2026-01-01','2026-01-01','x');
    raise exception 'analytics_api wrote alert_events';
  exception when insufficient_privilege then null; end;
  begin perform analytics_private.evaluate_alerts(); raise exception 'analytics_api ran evaluate_alerts';
  exception when insufficient_privilege then null; end;
  -- (This transaction already holds an audit.read row, so the audited read works for analytics_api too.)
  perform admin_app.log_access('admin@example.invalid', 'audit.read', null, '{"limit":1}', null);
  if (select action from admin_app.audit_recent(1)) <> 'audit.read' then raise exception 'analytics_api cannot read the audit log'; end if;
  reset role;
  foreach t in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(t, 'admin_app.create_alert_rule(text, jsonb, text)', 'execute')
       or has_function_privilege(t, 'analytics.kpi_health(date, date, text, text, boolean, text, jsonb)', 'execute')
       or has_table_privilege(t, 'admin_app.alert_rules', 'select') then
      raise exception '% can reach alerts', t; end if;
  end loop;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics alerts: kpi_health, rule validation, evaluation windows, cooldown, acknowledgement and audited reads passed' as verification;
rollback;
