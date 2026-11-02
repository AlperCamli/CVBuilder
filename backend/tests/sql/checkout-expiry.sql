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

begin;
set local role authenticated;
do $$
begin
  perform public.expire_stale_checkout_attempts();
  raise exception 'browser role could run the checkout expiry';
exception when insufficient_privilege then null;
end $$;
rollback;
select 'Checkout attempt expiry, idempotence and privileges passed' as verification;
