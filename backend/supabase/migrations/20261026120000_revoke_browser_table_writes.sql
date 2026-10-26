-- The browser only uses Supabase Auth and signed Storage uploads. Every table write
-- goes through the backend's service role, which validates input and gates access.
-- Owner-scoped write policies let a signed-in browser edit rows through PostgREST
-- that the backend later trusts, such as a files row's storage bucket and path.
begin;

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
-- Tables added by later migrations start without browser write access.
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own on public.users;
drop policy if exists master_cvs_insert_own on public.master_cvs;
drop policy if exists master_cvs_update_own on public.master_cvs;
drop policy if exists files_insert_own on public.files;
drop policy if exists files_update_own on public.files;
drop policy if exists imports_insert_own on public.imports;
drop policy if exists imports_update_own on public.imports;
drop policy if exists jobs_insert_own on public.jobs;
drop policy if exists jobs_update_own on public.jobs;
drop policy if exists tailored_cvs_insert_own on public.tailored_cvs;
drop policy if exists tailored_cvs_update_own on public.tailored_cvs;
drop policy if exists ai_runs_insert_own on public.ai_runs;
drop policy if exists ai_runs_update_own on public.ai_runs;
drop policy if exists ai_suggestions_insert_own on public.ai_suggestions;
drop policy if exists ai_suggestions_update_own on public.ai_suggestions;
drop policy if exists cv_block_revisions_insert_own on public.cv_block_revisions;
drop policy if exists job_status_history_insert_own on public.job_status_history;
drop policy if exists exports_insert_own on public.exports;
drop policy if exists exports_update_own on public.exports;
drop policy if exists cover_letters_insert_own on public.cover_letters;
drop policy if exists cover_letters_update_own on public.cover_letters;
drop policy if exists cover_letter_exports_insert_own on public.cover_letter_exports;
drop policy if exists cover_letter_exports_update_own on public.cover_letter_exports;

-- Usage accounting is backend-only; default PUBLIC execute must also be revoked.
revoke all on function public.increment_usage_counters(uuid, date, integer, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.increment_usage_counters(uuid, date, integer, integer, integer, bigint) to service_role;

-- Erasure deletes every inventoried object with the service role, so files rows only
-- contribute paths under the subject's own prefix. Claimed guest uploads are covered
-- by the guest_imports branch.
create or replace function public.privacy_storage_inventory(p_user uuid,p_offset integer,p_limit integer)
returns table(bucket text,path text) language plpgsql security definer set search_path=public as $$
declare storage_query text:='select null::text as bucket,null::text as path where false';
begin
  if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'invalid_page'; end if;
  if to_regclass('storage.objects') is not null then
    storage_query:='select bucket_id::text,name::text from storage.objects where starts_with(name,''users/''||$1::text||''/'') or starts_with(name,''privacy/''||$1::text||''/'')';
  end if;
  return query execute 'select q.bucket,q.path from (
    select storage_bucket::text as bucket,storage_path::text as path from public.files where user_id=$1 and starts_with(storage_path,''users/''||$1::text||''/'')
    union select ''imports'',storage_path from public.guest_imports where claimed_user_id=$1
    union select ''exports'',coalesce(storage_path,''privacy/''||$1::text||''/''||id::text||''.zip'') from public.privacy_jobs where subject_user_id=$1 and kind=''export''
    union '||storage_query||') q order by q.bucket,q.path offset $2 limit $3' using p_user,p_offset,p_limit;
end $$;

commit;
