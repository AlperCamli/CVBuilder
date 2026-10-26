begin;
do $$
declare u uuid; a uuid:=gen_random_uuid(); victim uuid; f uuid; leaked text;
begin
  -- Every table write goes through the backend service role; browser roles keep reads only.
  select string_agg(format('%s:%s', c.relname, p.privilege), ', ') into leaked
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  cross join (values ('anon'),('authenticated')) r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(privilege)
  where c.relkind in ('r','p','v','m') and has_table_privilege(r.role, c.oid, p.privilege);
  if leaked is not null then raise exception 'browser table writes still granted: %', leaked; end if;

  -- Only the RLS helper may run as definer for browser roles.
  select string_agg(p.oid::regprocedure::text, ', ') into leaked
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  where p.prosecdef and p.proname <> 'is_current_user'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if leaked is not null then raise exception 'browser can execute definer functions: %', leaked; end if;

  insert into public.users(auth_user_id,email) values(a,'browser-writes@example.invalid') returning id into u;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'browser-victim@example.invalid') returning id into victim;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(u,'avatar','cv-assets','users/'||u||'/avatars/photo.png','photo.png','image/png',10) returning id into f;
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  if not exists(select 1 from public.files where id=f) then raise exception 'owner lost read access to own file row'; end if;
  begin
    update public.files set storage_path='users/'||victim||'/avatars/photo.png' where id=f;
    raise exception 'browser rewrote a file storage path';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.master_cvs(user_id,title,language,current_content,source_type)
      values(u,'Direct insert','en','{}','scratch');
    raise exception 'browser inserted a master CV';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Tables added by later migrations start without browser write grants.
  create table public.browser_grant_probe(id integer);
  if has_table_privilege('authenticated','public.browser_grant_probe','INSERT') or has_table_privilege('anon','public.browser_grant_probe','UPDATE') then
    raise exception 'new tables inherit browser write grants';
  end if;

  -- Erasure deletes inventoried objects, so a files row may only name the subject's own prefix.
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(u,'export_pdf','exports','users/'||victim||'/master-cvs/x/exports/y.pdf','y.pdf','application/pdf',10);
  if exists(select 1 from public.privacy_storage_inventory(u,0,500) where path like 'users/'||victim||'/%') then
    raise exception 'erasure inventory includes another user''s object';
  end if;
  if not exists(select 1 from public.privacy_storage_inventory(u,0,500) where path='users/'||u||'/avatars/photo.png') then
    raise exception 'erasure inventory dropped the subject''s own object';
  end if;
end $$;
rollback;
select 'Browser table writes, definer execution and erasure inventory ownership passed' as verification;
