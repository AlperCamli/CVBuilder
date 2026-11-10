-- Account erasure deletes a user's tables one by one. Deleting a parent makes the
-- database run each ON DELETE SET NULL foreign key as a nested UPDATE of the child
-- rows, and the privacy guards rejected that UPDATE because the subject is already
-- erased or restricted. On 2026-11-10 deleting imports before ai_runs stuck three
-- erasures this way. The guards now let through exactly that referential clearing,
-- so erasure no longer depends on the order of the table list or on remembering
-- new SET NULL links.
--
-- A write counts as FK clearing only when all of these hold:
--   * it is an UPDATE fired by another trigger (pg_trigger_depth() > 1); the
--     database runs referential actions as triggers, an application statement
--     never has depth > 1 on its own row;
--   * every column it changes, other than updated_at, is now NULL and belongs to
--     an ON DELETE SET NULL foreign key of the table (read from pg_constraint, so
--     no column list to maintain);
--   * for every such foreign key, the parent row the old value pointed to no
--     longer exists, which is what distinguishes the RI action from a trigger
--     that nulls a link on its own (tailoring_detach_deleted_cv does this to
--     tailoring_sessions.tailored_cv_id while the soft-deleted CV still exists).
-- Everything else for an unavailable subject is still rejected, including a direct
-- UPDATE that only sets a foreign key to NULL. This replaces the jobs-only special
-- case in reject_deleted_subject_write, which did not check that the parent was gone.

create or replace function public.privacy_fk_clearing_only(p_table regclass, p_old jsonb, p_new jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed text[]; fk record; parent_exists boolean;
begin
  if pg_catalog.pg_trigger_depth() < 2 then return false; end if;
  select pg_catalog.array_agg(n.key) into changed from pg_catalog.jsonb_each(p_new) n
    where n.key <> 'updated_at' and n.value is distinct from p_old->n.key;
  if changed is null or exists(
    select 1 from pg_catalog.unnest(changed) c(col)
    where p_new->c.col <> 'null'::jsonb or not exists(
      select 1 from pg_catalog.pg_constraint k
      join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey)
      where k.conrelid=p_table and k.contype='f' and k.confdeltype='n' and a.attname=c.col)
  ) then return false; end if;
  for fk in
    select k.confrelid::regclass as parent,
      pg_catalog.string_agg(pg_catalog.format('%I = %L::%s', pa.attname, p_old->>ca.attname::text,
        pg_catalog.format_type(pa.atttypid, pa.atttypmod)), ' and ') as match
    from pg_catalog.pg_constraint k
    cross join lateral pg_catalog.generate_subscripts(k.conkey, 1) i
    join pg_catalog.pg_attribute ca on ca.attrelid=k.conrelid and ca.attnum=k.conkey[i]
    join pg_catalog.pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[i]
    where k.conrelid=p_table and k.contype='f' and k.confdeltype='n'
      and k.conkey && (select pg_catalog.array_agg(a.attnum) from pg_catalog.pg_attribute a where a.attrelid=p_table and a.attname=any(changed))
    group by k.oid, k.confrelid
  loop
    execute pg_catalog.format('select exists(select 1 from %s where %s)', fk.parent, fk.match) into parent_exists;
    if parent_exists then return false; end if;
  end loop;
  return true;
end $$;

-- Only the guards call it; a direct call has trigger depth 0 and returns false anyway.
revoke all on function public.privacy_fk_clearing_only(regclass, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.reject_deleted_subject_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists(select 1 from public.users where id = new.user_id and deletion_requested_at is null and processing_restricted_at is null) then
    -- Let through only the database's own ON DELETE SET NULL clearing, never an application write.
    if tg_op='UPDATE' and pg_trigger_depth()>1 then
      if public.privacy_fk_clearing_only(tg_relid, to_jsonb(old), to_jsonb(new)) then return new; end if;
    end if;
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;

create or replace function public.guard_ai_privacy_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare permitted boolean; current_revision integer; g public.guest_imports;
begin
  if new.user_id is null then
    select * into g from public.guest_imports where id=new.guest_import_id for share;
    permitted:=found and g.deleted_at is null and g.processing_restricted_at is null
      and g.claimed_user_id is null and g.expires_at>now() and g.ai_processing
      and g.ai_provider=new.provider and g.ai_notice_version is not null
      and g.lease_id=new.guest_lease_id and g.lease_expires_at>now();
    current_revision:=g.privacy_revision;
    if tg_op='INSERT' and not coalesce(permitted,false) then raise exception 'ai_permission_changed'; end if;
  else
    select ai_processing,privacy_revision into permitted,current_revision from public.users
      where id=new.user_id and deletion_requested_at is null and processing_restricted_at is null;
    if not found then
      -- A parent delete nulling this run's link (import, CV, job, parent run) is the only write allowed.
      if tg_op='UPDATE' and pg_trigger_depth()>1 then
        if public.privacy_fk_clearing_only(tg_relid, to_jsonb(old), to_jsonb(new)) then return new; end if;
      end if;
      raise exception 'privacy_subject_unavailable';
    end if;
    if new.import_id is not null and not exists(select 1 from public.imports where id=new.import_id and user_id=new.user_id) then
      raise exception 'ai_run_import_owner_mismatch';
    end if;
  end if;
  if tg_op='INSERT' then
    new.privacy_revision:=current_revision;
  elsif old.user_id is distinct from new.user_id or old.guest_import_id is distinct from new.guest_import_id then
    if old.user_id is not null or new.user_id is null or not exists(
      select 1 from public.guest_imports where id=old.guest_import_id and claimed_user_id=new.user_id and claimed_import_id=new.import_id
    ) then raise exception 'ai_run_owner_transfer_invalid'; end if;
    new.privacy_revision:=current_revision;
  end if;
  if tg_op='UPDATE' and new.provider<>'mock' and new.status='completed' and
    (old.status is distinct from new.status or old.output_payload is distinct from new.output_payload) then
    if not coalesce(permitted,false) or new.privacy_revision is distinct from current_revision then raise exception 'ai_permission_changed'; end if;
  end if;
  return new;
end $$;

-- Deleting the requesting user nulls privacy_jobs.user_id; a completed export of an
-- erased subject must not block that.
create or replace function public.guard_privacy_export_subject()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind='export' and (tg_op='INSERT' or new.status='working' or new.status='complete') and
    not exists(select 1 from public.users where id=new.subject_user_id and deletion_requested_at is null) then
    if tg_op='UPDATE' and pg_trigger_depth()>1 then
      if public.privacy_fk_clearing_only(tg_relid, to_jsonb(old), to_jsonb(new)) then return new; end if;
    end if;
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;
