begin;
do $$
declare u uuid;
begin
  set local role service_role;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'expiry@example.invalid') returning id into u;
  insert into public.checkout_attempts(user_id,plan_code,trial_requested,trial_applied,checkout_session_id,outcome,created_at,resolved_at) values
    (u,'weekly',true,true,'cs_stale','open',now()-interval '26 hours',null),
    (u,'weekly',true,true,'cs_recent','open',now()-interval '2 hours',null),
    (u,'weekly',true,true,'cs_done','completed',now()-interval '30 hours',now()-interval '29 hours'),
    (u,'weekly',true,true,'cs_canceled','canceled',now()-interval '30 hours',now()-interval '29 hours');

  if public.expire_stale_checkout_attempts()<>1 then raise exception 'expected one stale attempt'; end if;
  if (select (outcome,resolved_at) from public.checkout_attempts where checkout_session_id='cs_stale')
     is distinct from ('expired'::text,(select created_at+interval '24 hours' from public.checkout_attempts where checkout_session_id='cs_stale')) then
    raise exception 'stale attempt not expired at its latest possible expiry';
  end if;
  if (select outcome from public.checkout_attempts where checkout_session_id='cs_recent')<>'open' then raise exception 'recent attempt expired'; end if;
  if (select string_agg(outcome,',' order by checkout_session_id) from public.checkout_attempts where checkout_session_id in ('cs_done','cs_canceled'))<>'canceled,completed' then
    raise exception 'resolved attempts changed';
  end if;
  -- Idempotent: a second run changes nothing.
  if public.expire_stale_checkout_attempts()<>0 then raise exception 'second run changed rows'; end if;
end $$;
rollback;

-- pg_cron present (a stand-in cron schema): the hourly job is scheduled once and purges its own history.
begin;
do $$
declare got text;
begin
  if public.schedule_checkout_expiry() then raise exception 'scheduled without pg_cron'; end if;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $f$
    insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $f$;
  create function cron.unschedule(p_job bigint) returns boolean language sql as $f$
    delete from cron.job where jobid = p_job returning true $f$;
  -- Without run details (old pg_cron) there is nothing to purge.
  if not public.schedule_checkout_expiry() then raise exception 'job not scheduled'; end if;
  if (select command from cron.job where jobname = 'checkout_attempts_expiry') <> 'select public.expire_stale_checkout_attempts()' then
    raise exception 'job command wrong without run details';
  end if;
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, end_time timestamptz);
  insert into cron.job(jobname, schedule, command) values ('other_job', '* * * * *', 'select 1');
  perform public.schedule_checkout_expiry();
  perform public.schedule_checkout_expiry();
  if (select count(*) from cron.job where jobname = 'checkout_attempts_expiry') <> 1 then raise exception 'job scheduled twice'; end if;
  insert into cron.job_run_details(jobid, end_time)
  select j.jobid, now() - x.age from cron.job j cross join (values (interval '8 days'), (interval '1 day')) x(age)
  where j.jobname in ('checkout_attempts_expiry', 'other_job');
  execute (select command from cron.job where jobname = 'checkout_attempts_expiry');
  select string_agg(j.jobname || '=' || (now() - d.end_time)::text, ',' order by j.jobname, d.end_time) into got
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid;
  if got <> 'checkout_attempts_expiry=1 day,other_job=8 days,other_job=1 day' then raise exception 'purge wrong: %', got; end if;
  if (select schedule from cron.job where jobname = 'checkout_attempts_expiry') <> '17 * * * *' then raise exception 'schedule wrong'; end if;
end $$;
rollback;

begin;
set local role authenticated;
do $$
begin
  perform public.expire_stale_checkout_attempts();
  raise exception 'browser role could run the checkout expiry';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.schedule_checkout_expiry();
  raise exception 'browser role could schedule the checkout expiry';
exception when insufficient_privilege then null;
end $$;
rollback;
select 'Checkout attempt expiry, scheduling, history purge, idempotence and privileges passed' as verification;
