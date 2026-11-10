-- A claimed guest upload keeps its guests/ path, and the daily cleanup deletes the
-- claimed guest_imports row about a day after upload. From then on the account's
-- files row is the only record of the object, so erasure no longer inventoried it
-- and left the CV in storage. files rows now also contribute guests/ paths in the
-- imports bucket. Only claim_guest_import writes such a row (in-app imports are
-- confined to users/<id>/imports/), and a path that another account's files row
-- also points at is never inventoried.
create or replace function public.privacy_storage_inventory(p_user uuid,p_offset integer,p_limit integer)
returns table(bucket text,path text) language plpgsql security definer set search_path=public as $$
declare storage_query text:='select null::text as bucket,null::text as path where false';
begin
  if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'invalid_page'; end if;
  if to_regclass('storage.objects') is not null then
    storage_query:='select bucket_id::text,name::text from storage.objects where starts_with(name,''users/''||$1::text||''/'') or starts_with(name,''privacy/''||$1::text||''/'')';
  end if;
  return query execute 'select q.bucket,q.path from (
    select f.storage_bucket::text as bucket,f.storage_path::text as path from public.files f where f.user_id=$1 and (
      starts_with(f.storage_path,''users/''||$1::text||''/'')
      or (f.storage_bucket=''imports'' and starts_with(f.storage_path,''guests/'') and not exists(
        select 1 from public.files o where o.storage_bucket=f.storage_bucket and o.storage_path=f.storage_path and o.user_id<>$1)))
    union select ''imports'',storage_path from public.guest_imports where claimed_user_id=$1
    union select ''exports'',coalesce(storage_path,''privacy/''||$1::text||''/''||id::text||''.zip'') from public.privacy_jobs where subject_user_id=$1 and kind=''export''
    union '||storage_query||') q order by q.bucket,q.path offset $2 limit $3' using p_user,p_offset,p_limit;
end $$;
