-- Guest AI belongs to a recovery session until account claim. Never invent a
-- user account or consent grant to track a pre-signup provider call.
alter table public.ai_runs alter column user_id drop not null;
alter table public.ai_runs
  add column guest_import_id uuid references public.guest_imports(id) on delete cascade,
  add column guest_lease_id uuid,
  add column import_id uuid references public.imports(id) on delete set null,
  add constraint ai_runs_subject_check check (
    (user_id is not null and guest_import_id is null and guest_lease_id is null)
    or (user_id is null and guest_import_id is not null and guest_lease_id is not null
        and flow_type='cv_parse' and master_cv_id is null and tailored_cv_id is null and job_id is null and import_id is null)
  );
create unique index ai_runs_guest_lease_idx on public.ai_runs(guest_import_id,guest_lease_id) where guest_import_id is not null;
create index ai_runs_import_idx on public.ai_runs(import_id) where import_id is not null;
-- Existing RLS uses is_current_user(user_id): NULL guest subjects have no
-- browser visibility. Guest run lifecycle is restricted to the backend role.
-- The general account-only guard cannot accept a guest subject. The AI guard
-- below preserves the same account deletion/restriction protection.
drop trigger privacy_subject_write on public.ai_runs;

create or replace function public.guard_ai_privacy_revision() returns trigger language plpgsql set search_path=public as $$
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
    if not found then raise exception 'privacy_subject_unavailable'; end if;
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

create function public.invalidate_guest_ai_runs() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.deleted_at is not null then
    delete from public.ai_runs where guest_import_id=new.id and user_id is null;
  elsif new.privacy_revision is distinct from old.privacy_revision or new.processing_restricted_at is not null then
    update public.ai_runs set status='failed',progress_stage='failed',completed_at=now(),
      error_message='Guest AI permission changed',input_payload='{}',output_payload=null,debug_payload=null
      where guest_import_id=new.id and user_id is null and status='pending';
  end if;
  return new;
end $$;
create trigger invalidate_guest_ai_runs after update of ai_processing,privacy_revision,deleted_at,processing_restricted_at
  on public.guest_imports for each row execute function public.invalidate_guest_ai_runs();
revoke all on function public.invalidate_guest_ai_runs() from public,anon,authenticated;

create or replace function public.claim_guest_import(p_id uuid, p_token_hash text, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g public.guest_imports; f_id uuid; i_id uuid;
begin
  select * into g from public.guest_imports where id = p_id for update;
  if not found or g.token_hash <> p_token_hash or g.expires_at <= now() or g.deleted_at is not null or g.processing_restricted_at is not null then
    raise exception 'guest_not_found';
  end if;
  if g.claimed_user_id is not null then
    if g.claimed_user_id <> p_user_id then raise exception 'guest_not_found'; end if;
    return g.claimed_import_id;
  end if;
  perform 1 from public.users where id=p_user_id and deletion_requested_at is null and processing_restricted_at is null for update;
  if not found then raise exception 'guest_not_found'; end if;
  if g.status <> 'parsed' or g.parsed_content is null then raise exception 'guest_not_ready'; end if;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(p_user_id,'source_upload','imports',g.storage_path,g.original_filename,g.mime_type,g.size_bytes)
    returning id into f_id;
  insert into public.imports(user_id,source_file_id,status,module_type,parser_name,raw_extracted_text,parsed_content,review_context)
    values(p_user_id,f_id,'parsed','standard',g.parser_name,g.raw_extracted_text,g.parsed_content,g.review_context)
    returning id into i_id;
  update public.users set onboarding_answers = g.answers - 'source', ai_provider=g.ai_provider, ai_notice_version=g.ai_notice_version, ai_processing=g.ai_processing, analytics=g.analytics, privacy_revision=privacy_revision+1 where id = p_user_id;
  perform public.count_guest_metrics(p_id,'signup');
  update public.privacy_receipts set user_id=p_user_id,guest_id=null where guest_id=p_id;
  update public.guest_imports set status = 'claimed', claimed_user_id = p_user_id,
    claimed_import_id = i_id, answers='{}', raw_extracted_text = null, parsed_content = null,
    review_context = null, cv_review = null where id = p_id;
  -- Each guest attempt is transferred exactly once with the CV claim. The
  -- caller cannot claim another visitor's telemetry; the guest row is locked.
  update public.ai_runs set status='failed',progress_stage='failed',completed_at=now(),
    error_message='Guest processing superseded',input_payload='{}',output_payload=null,debug_payload=null
    where guest_import_id=p_id and user_id is null and status='pending';
  update public.ai_runs set user_id=p_user_id,guest_import_id=null,guest_lease_id=null,import_id=i_id
    where guest_import_id=p_id and user_id is null;
  return i_id;
end; $$;
revoke all on function public.claim_guest_import(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_import(uuid,text,uuid) to service_role;

-- Import conversion links its parse runs into the existing CV AI history.
create function public.link_import_ai_runs() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.target_master_cv_id is not null and new.target_master_cv_id is distinct from old.target_master_cv_id then
    if not exists(select 1 from public.master_cvs where id=new.target_master_cv_id and user_id=new.user_id) then
      raise exception 'ai_run_import_owner_mismatch';
    end if;
    update public.ai_runs set master_cv_id=new.target_master_cv_id where import_id=new.id and user_id=new.user_id;
  end if;
  return new;
end $$;
create trigger link_import_ai_runs after update of target_master_cv_id on public.imports for each row execute function public.link_import_ai_runs();
revoke all on function public.link_import_ai_runs() from public,anon,authenticated;

notify pgrst,'reload schema';
