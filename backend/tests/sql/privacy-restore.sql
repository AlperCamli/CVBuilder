-- Isolated restore fixture: old data exists before the latest external ledgers
-- are imported. No production database is read or written by the verifier.
insert into public.users(id,auth_user_id,email) values('93000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000001','restored@example.invalid');
insert into public.privacy_jobs(user_id,subject_user_id,auth_user_id,kind,status,step,completed_at)
 values('93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001',null,'deletion','complete','upload_guard',now());
insert into public.guest_imports(id,token_hash,original_filename,mime_type,size_bytes,storage_path,status,parsed_content,answers)
 values('95000000-0000-0000-0000-000000000001','restore-proof','cv.pdf','application/pdf',20,'guests/restore/source.pdf','parsed','{}','{"career":"student"}');
insert into public.privacy_erasure_ledger(auth_id_hash,user_id) values(encode(digest('94000000-0000-0000-0000-000000000001','sha256'),'hex'),'93000000-0000-0000-0000-000000000001');
insert into public.privacy_guest_erasure_ledger(guest_id,storage_path) values('95000000-0000-0000-0000-000000000001','guests/restore/source.pdf');
\ir ../../scripts/replay-privacy-erasures.sql
\ir ../../scripts/replay-privacy-erasures.sql
begin;
do $$ begin
 if (select deletion_requested_at is null from public.users where id='93000000-0000-0000-0000-000000000001') then raise exception 'Restored account not blocked'; end if;
 if not exists(select 1 from public.privacy_jobs where subject_user_id='93000000-0000-0000-0000-000000000001' and status='pending' and step='start' and auth_user_id='94000000-0000-0000-0000-000000000001' and manifest->>'restore_queued'='true') then raise exception 'Restored erasure not queued'; end if;
 if (select deleted_at is null or parsed_content is not null or answers<>'{}'::jsonb from public.guest_imports where id='95000000-0000-0000-0000-000000000001') then raise exception 'Guest backup revived deleted data'; end if;
 if public.begin_guest_import_parse('95000000-0000-0000-0000-000000000001',gen_random_uuid()) then raise exception 'Restored guest acquired processing lease'; end if;
end $$;
rollback;
select 'Restored account and unexpired guest proof blocked; erasure requeued idempotently' as verification;
