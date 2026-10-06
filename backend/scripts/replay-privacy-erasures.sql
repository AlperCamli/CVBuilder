-- Operator-only restore procedure. Keep the application offline and restore the
-- latest external account AND guest erasure ledgers before running this script.
-- Never run it using a browser/anon credential. Auth/Storage erasure is completed
-- by the existing maintenance worker after these jobs/tombstones are restored.
-- Repeat the script and protected maintenance until no restored subjects remain.
begin;
set local search_path=public,extensions;
do $$
declare u record; g record; job uuid;
begin
  for u in
    select users.id,users.auth_user_id from public.users
      join public.privacy_erasure_ledger l on l.auth_id_hash=encode(digest(users.auth_user_id::text,'sha256'),'hex')
    where not exists(select 1 from public.privacy_jobs j where j.subject_user_id=users.id and j.kind='deletion' and j.manifest->>'restore_queued'='true')
    order by users.id limit 100
  loop
    job:=public.request_account_erasure(u.id,u.auth_user_id);
    update public.privacy_jobs set status='pending',step='start',manifest='{"restore_queued":true}',auth_user_id=u.auth_user_id,
      lease_until=null,retry_at=now(),completed_at=null,expires_at=null where id=job;
  end loop;
  for g in
    select guest_imports.id,guest_imports.token_hash from public.guest_imports
      join public.privacy_guest_erasure_ledger l on l.guest_id=guest_imports.id
    where guest_imports.claimed_user_id is null and guest_imports.deleted_at is null
    order by guest_imports.id limit 100
  loop perform public.delete_guest_import(g.id,g.token_hash); end loop;
end $$;
commit;
