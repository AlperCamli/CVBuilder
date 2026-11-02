-- Checkout expiry: checkout_attempts rows are resolved by Stripe webhooks, but checkout.session.expired
-- only reaches endpoints subscribed to it, so abandoned sessions could stay 'open' forever.
-- - public.expire_stale_checkout_attempts() marks attempts still open 25 hours after creation as expired.
--   Stripe sessions live at most 24 hours, so none of them can still complete. resolved_at is the latest
--   moment Stripe could have expired the session, not the time this job ran.
-- - It runs once here (backfill) and hourly through pg_cron where pg_cron exists (Supabase); the local SQL
--   test has no pg_cron. The webhook stays the normal, timely path; resolved rows are never touched.
begin;

create function public.expire_stale_checkout_attempts() returns integer
language sql volatile set search_path = ''
as $$
  with expired as (
    update public.checkout_attempts
       set outcome = 'expired', resolved_at = created_at + interval '24 hours'
     where outcome = 'open' and created_at < now() - interval '25 hours'
    returning 1
  )
  select count(*)::integer from expired
$$;
revoke all on function public.expire_stale_checkout_attempts() from public, anon, authenticated;
grant execute on function public.expire_stale_checkout_attempts() to service_role;

do $$
begin
  perform public.expire_stale_checkout_attempts();
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'checkout_attempts_expiry';
    execute 'select cron.schedule($1, $2, $3)'
      using 'checkout_attempts_expiry', '17 * * * *', 'select public.expire_stale_checkout_attempts()';
  else
    raise notice 'pg_cron is not installed: checkout_attempts_expiry is not scheduled';
  end if;
end $$;

commit;
