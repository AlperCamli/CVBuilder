-- Privacy defaults are disabled; historical consent is never inferred.
alter table public.users
  add column ai_provider text,
  add column ai_notice_version text,
  add column processing_restricted_at timestamptz,
  add column ai_processing boolean not null default false,
  add column analytics boolean not null default false,
  add column privacy_revision integer not null default 0,
  add column deletion_requested_at timestamptz;
alter table public.guest_imports
  add column ai_provider text,
  add column ai_notice_version text,
  add column processing_restricted_at timestamptz,
  add column ai_processing boolean not null default false,
  add column analytics boolean not null default false,
  add column privacy_revision integer not null default 0,
  add column notice_version text,
  add column deleted_at timestamptz,
  add column delete_retry_at timestamptz,
  add column delete_attempts integer not null default 0,
  add column metrics_counted boolean not null default false;

create table public.privacy_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  guest_id uuid references public.guest_imports(id) on delete cascade,
  purpose text not null check (purpose in ('notice','analytics','ai_processing')),
  choice boolean not null,
  provider text,
  document_version text not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz
);
create table public.privacy_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  subject_user_id uuid not null,
  auth_user_id uuid,
  kind text not null check (kind in ('deletion','export')),
  status text not null default 'pending' check (status in ('pending','working','complete')),
  step text not null default 'start',
  manifest jsonb not null default '{}',
  storage_path text,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  lease_until timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index privacy_one_deletion_per_user on public.privacy_jobs(subject_user_id) where kind = 'deletion';
create table public.privacy_erasure_ledger (
  auth_id_hash text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days'
);
create table public.privacy_cleanup_health (
  id boolean primary key default true check (id),
  initialized_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  failures integer not null default 0,
  backlog integer not null default 0,
  oldest_expired_at timestamptz
);
insert into public.privacy_cleanup_health(id) values (true);
create table public.onboarding_monthly_stats (
  month date not null,
  metric text not null check (metric in ('upload','questions','signup','referral')),
  option text not null default 'total',
  count bigint not null default 0,
  primary key(month,metric,option)
);
-- Reporting never exposes cells with fewer than five submissions.
create view public.onboarding_stats_report with (security_invoker = true) as
  select month, metric, option, count from public.onboarding_monthly_stats where count >= 5;

do $$ declare t text; begin
  foreach t in array array['privacy_receipts','privacy_jobs','privacy_erasure_ledger','privacy_cleanup_health','onboarding_monthly_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.onboarding_stats_report from anon, authenticated;
grant select on public.onboarding_stats_report to service_role;
-- Browser clients cannot change protection fields through PostgREST.
revoke insert, update on public.users from anon, authenticated;

create or replace function public.is_current_user(target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.users where id = target_user_id and auth_user_id = auth.uid() and deletion_requested_at is null and processing_restricted_at is null);
$$;

-- Service-role writes also reject late work after account deletion starts.
create function public.reject_deleted_subject_write() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists(select 1 from public.users where id = new.user_id and deletion_requested_at is null and processing_restricted_at is null) then
    -- jobs has reverse SET NULL FKs to CVs/letters being erased. Permit only
    -- the database's nested FK clearing, never an ordinary late application write.
    if tg_op='UPDATE' and tg_table_name='jobs' and pg_trigger_depth()>1 then
      if (to_jsonb(new)-array['tailored_cv_id','cover_letter_id','updated_at'])=(to_jsonb(old)-array['tailored_cv_id','cover_letter_id','updated_at']) and
      (new.tailored_cv_id is null or new.tailored_cv_id is not distinct from old.tailored_cv_id) and
      (new.cover_letter_id is null or new.cover_letter_id is not distinct from old.cover_letter_id) then return new; end if;
    end if;
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['files','imports','master_cvs','tailored_cvs','jobs','cover_letters','exports','cover_letter_exports','ai_runs','ai_suggestions','cv_block_revisions','subscriptions','usage_counters'] loop
    execute format('create trigger privacy_subject_write before insert or update on public.%I for each row execute function public.reject_deleted_subject_write()',t);
  end loop;
end $$;

create function public.record_privacy_choices(p_user uuid, p_guest uuid, p_version text, p_ai boolean, p_analytics boolean, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
declare old_ai boolean; old_analytics boolean; old_provider text; old_ai_version text;
begin
  if (p_user is null) = (p_guest is null) then raise exception 'invalid_subject'; end if;
  if p_user is not null then
    select ai_processing,analytics,ai_provider,ai_notice_version into old_ai,old_analytics,old_provider,old_ai_version from public.users where id=p_user and deletion_requested_at is null for update;
  else
    select ai_processing,analytics,ai_provider,ai_notice_version into old_ai,old_analytics,old_provider,old_ai_version from public.guest_imports where id=p_guest and claimed_user_id is null and deleted_at is null and expires_at>now() for update;
  end if;
  if not found then raise exception 'privacy_subject_unavailable'; end if;
  if not exists(select 1 from public.privacy_receipts where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='notice' and document_version=p_version) then
    insert into public.privacy_receipts(user_id,guest_id,purpose,choice,document_version) values(p_user,p_guest,'notice',true,p_version);
  end if;
  if p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version)) or not exists(select 1 from public.privacy_receipts where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='ai_processing') then
    update public.privacy_receipts set retain_until=now()+interval '12 months' where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='ai_processing' and retain_until is null;
    insert into public.privacy_receipts(user_id,guest_id,purpose,choice,document_version,provider) values(p_user,p_guest,'ai_processing',p_ai,p_version,p_provider);
  end if;
  if p_analytics is distinct from old_analytics or not exists(select 1 from public.privacy_receipts where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='analytics') then
    update public.privacy_receipts set retain_until=now()+interval '12 months' where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='analytics' and retain_until is null;
    insert into public.privacy_receipts(user_id,guest_id,purpose,choice,document_version) values(p_user,p_guest,'analytics',p_analytics,p_version);
  end if;
  if p_user is not null then
    update public.users set ai_provider=case when p_ai then p_provider else null end,ai_processing=p_ai,ai_notice_version=case when p_ai then p_version else null end,analytics=p_analytics,privacy_revision=privacy_revision+case when p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version)) then 1 else 0 end where id=p_user;
    if not p_ai then
      update public.ai_runs set status='failed',error_message='AI permission withdrawn',input_payload='{}',output_payload=null,debug_payload=null,completed_at=now() where user_id=p_user and status='pending';
    end if;
  else
    update public.guest_imports set ai_provider=case when p_ai then p_provider else null end,ai_processing=p_ai,ai_notice_version=case when p_ai then p_version else null end,analytics=p_analytics,notice_version=p_version,
      privacy_revision=privacy_revision+case when p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version)) then 1 else 0 end,
      status=case when status='parsing' and (p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version))) then 'uploaded' else status end,
      lease_id=case when p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version)) then null else lease_id end,
      lease_expires_at=case when p_ai is distinct from old_ai or (p_ai and (p_provider is distinct from old_provider or p_version is distinct from old_ai_version)) then null else lease_expires_at end
      where id=p_guest;
  end if;
end $$;

create function public.delete_guest_import(p_id uuid,p_token_hash text) returns void language plpgsql security definer set search_path=public as $$
declare g public.guest_imports;
begin
  select * into g from public.guest_imports where id=p_id for update;
  if not found or g.token_hash<>p_token_hash then raise exception 'guest_not_found'; end if;
  if g.claimed_user_id is not null or exists (
    select 1 from public.files where storage_bucket='imports' and storage_path=g.storage_path
  ) then raise exception 'guest_claimed'; end if;
  update public.guest_imports set deleted_at=coalesce(deleted_at,now()),answers='{}',original_filename='Deleted upload',
    raw_extracted_text=null,parsed_content=null,review_context=null,cv_review=null,error_message=null,lease_id=null,lease_expires_at=null,
    ai_processing=false,analytics=false,privacy_revision=privacy_revision+1 where id=p_id;
  delete from public.privacy_receipts where guest_id=p_id;
end $$;

create function public.count_guest_metrics(p_id uuid,p_stage text) returns void language plpgsql security definer set search_path=public as $$
declare g public.guest_imports; mon date;
begin
  select * into g from public.guest_imports where id=p_id for update;
  if not found or not g.analytics or g.metrics_counted or g.deleted_at is not null or g.processing_restricted_at is not null then return; end if;
  mon:=date_trunc('month',g.created_at at time zone 'UTC')::date;
  insert into public.onboarding_monthly_stats(month,metric,option,count) values(mon,'upload','total',1)
    on conflict(month,metric,option) do update set count=onboarding_monthly_stats.count+1;
  if g.answers<>'{}'::jsonb then
    insert into public.onboarding_monthly_stats(month,metric,option,count) values(mon,'questions','total',1)
      on conflict(month,metric,option) do update set count=onboarding_monthly_stats.count+1;
  end if;
  if g.answers->>'source' in ('search','social','friend','community','article','other') then
    insert into public.onboarding_monthly_stats(month,metric,option,count) values(mon,'referral',g.answers->>'source',1)
      on conflict(month,metric,option) do update set count=onboarding_monthly_stats.count+1;
  end if;
  if p_stage='signup' then
    insert into public.onboarding_monthly_stats(month,metric,option,count) values(mon,'signup','total',1)
      on conflict(month,metric,option) do update set count=onboarding_monthly_stats.count+1;
  end if;
  update public.guest_imports set metrics_counted=true where id=p_id;
end $$;

create function public.request_account_erasure(p_user uuid,p_auth uuid) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare job uuid;
begin
  perform 1 from public.users where id=p_user and auth_user_id=p_auth for update;
  if not found then raise exception 'privacy_subject_unavailable'; end if;
  insert into public.privacy_erasure_ledger(auth_id_hash,user_id) values(encode(digest(p_auth::text,'sha256'),'hex'),p_user) on conflict do nothing;
  update public.users set deletion_requested_at=coalesce(deletion_requested_at,now()),ai_processing=false,analytics=false,privacy_revision=privacy_revision+1 where id=p_user;
  insert into public.privacy_jobs(user_id,subject_user_id,auth_user_id,kind) values(p_user,p_user,p_auth,'deletion')
    on conflict(subject_user_id) where kind='deletion' do update set subject_user_id=excluded.subject_user_id returning id into job;
  return job;
end $$;

create function public.acquire_privacy_job(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.privacy_jobs set status='working',lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id=p_id and status<>'complete' and retry_at<=now() and (lease_until is null or lease_until<now());
  return found;
end $$;

-- Procedures are backend-only; default PUBLIC execute must also be revoked.
do $$ declare f text; begin
  foreach f in array array['record_privacy_choices(uuid,uuid,text,boolean,boolean,text)','delete_guest_import(uuid,text)','count_guest_metrics(uuid,text)','request_account_erasure(uuid,uuid)','acquire_privacy_job(uuid)'] loop
    execute 'revoke all on function public.'||f||' from public, anon, authenticated';
    execute 'grant execute on function public.'||f||' to service_role';
  end loop;
end $$;

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
  return i_id;
end; $$;
revoke all on function public.claim_guest_import(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_import(uuid,text,uuid) to service_role;

create or replace function public.begin_guest_import_parse(p_id uuid, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.guest_imports set status = 'parsing', lease_id = p_lease_id,
    lease_expires_at = now() + interval '5 minutes', attempts = attempts + 1, error_message = null
    where id = p_id and claimed_user_id is null and deleted_at is null and processing_restricted_at is null and expires_at > now() and attempts < 3
    and (status in ('uploaded','failed') or (status = 'parsing' and lease_expires_at < now()));
  return found;
end; $$;
revoke all on function public.begin_guest_import_parse(uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_guest_import_parse(uuid,uuid) to service_role;
notify pgrst, 'reload schema';

-- Results must belong to the same permission generation as their input. A
-- withdraw/re-enable cycle cannot make an old outstanding AI call acceptable.
alter table public.ai_runs add column privacy_revision integer;
create function public.guard_ai_privacy_revision() returns trigger language plpgsql set search_path=public as $$
declare permitted boolean; current_revision integer;
begin
  select ai_processing,privacy_revision into permitted,current_revision from public.users where id=new.user_id and deletion_requested_at is null;
  if tg_op='INSERT' then
    new.privacy_revision:=current_revision;
  elsif new.provider<>'mock' and new.status='completed' and (old.status is distinct from new.status or old.output_payload is distinct from new.output_payload) then
    if not coalesce(permitted,false) or new.privacy_revision is distinct from current_revision then raise exception 'ai_permission_changed'; end if;
  end if;
  return new;
end $$;
create trigger guard_ai_result before insert or update on public.ai_runs for each row execute function public.guard_ai_privacy_revision();
create function public.guard_ai_suggestion_revision() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.ai_runs r join public.users u on u.id=r.user_id where r.id=new.ai_run_id and r.user_id=new.user_id and u.deletion_requested_at is null and (r.provider='mock' or (u.ai_processing and r.privacy_revision=u.privacy_revision))) then raise exception 'ai_permission_changed'; end if;
  return new;
end $$;
create trigger guard_ai_suggestion before insert on public.ai_suggestions for each row execute function public.guard_ai_suggestion_revision();
-- A revoked token must not retain direct profile access while erasure retries.
drop policy users_select_own on public.users;
create policy users_select_own on public.users for select to authenticated using (auth.uid()=auth_user_id and deletion_requested_at is null);
notify pgrst,'reload schema';

-- Referral attribution is statistical, not an enduring personal profile field.
update public.users set onboarding_answers=onboarding_answers-'source';
-- Scrubbing must not touch accounts whose deletion is still retrying.
create function public.scrub_privacy_diagnostics() returns void language sql security definer set search_path=public as $$
  update public.ai_runs set debug_payload=null where status<>'pending' and completed_at<now()-interval '7 days'
    and exists(select 1 from public.users u where u.id=ai_runs.user_id and u.deletion_requested_at is null and u.processing_restricted_at is null);
$$;
revoke all on function public.scrub_privacy_diagnostics() from public,anon,authenticated;
grant execute on function public.scrub_privacy_diagnostics() to service_role;
-- Managed buckets must never permit public CV/archive access. Supabase Storage
-- is absent in the isolated SQL test database, so this block is conditional.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public=false where id in ('imports','exports','cv-assets');
    execute $policy$ create policy privacy_block_erased_accounts on storage.objects as restrictive for all to authenticated
      using (bucket_id not in ('imports','exports','cv-assets') or exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.deletion_requested_at is null))
      with check (bucket_id not in ('imports','exports','cv-assets') or exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.deletion_requested_at is null)) $policy$;
  end if;
end $$;

-- Inventory includes orphan objects from issued upload URLs, account-owned
-- guests/ paths and archive targets even before an export upload starts.
create function public.privacy_storage_inventory(p_user uuid,p_offset integer,p_limit integer)
returns table(bucket text,path text) language plpgsql security definer set search_path=public as $$
declare storage_query text:='select null::text as bucket,null::text as path where false';
begin
  if p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'invalid_page'; end if;
  if to_regclass('storage.objects') is not null then
    storage_query:='select bucket_id::text,name::text from storage.objects where starts_with(name,''users/''||$1::text||''/'') or starts_with(name,''privacy/''||$1::text||''/'')';
  end if;
  return query execute 'select q.bucket,q.path from (
    select storage_bucket::text as bucket,storage_path::text as path from public.files where user_id=$1
    union select ''imports'',storage_path from public.guest_imports where claimed_user_id=$1
    union select ''exports'',coalesce(storage_path,''privacy/''||$1::text||''/''||id::text||''.zip'') from public.privacy_jobs where subject_user_id=$1 and kind=''export''
    union '||storage_query||') q order by q.bucket,q.path offset $2 limit $3' using p_user,p_offset,p_limit;
end $$;
revoke all on function public.privacy_storage_inventory(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.privacy_storage_inventory(uuid,integer,integer) to service_role;

-- A deletion racing a new export must prevent that export from being registered.
create function public.guard_privacy_export_subject() returns trigger language plpgsql set search_path=public as $$
begin
  if new.kind='export' and (tg_op='INSERT' or new.status='working' or new.status='complete') and
    not exists(select 1 from public.users where id=new.subject_user_id and deletion_requested_at is null) then
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;
create trigger guard_privacy_export before insert or update on public.privacy_jobs for each row execute function public.guard_privacy_export_subject();
notify pgrst,'reload schema';

create index privacy_jobs_due_idx on public.privacy_jobs(retry_at) where status<>'complete';
create index privacy_archives_expiry_idx on public.privacy_jobs(expires_at) where kind='export';
create index privacy_receipts_retention_idx on public.privacy_receipts(retain_until) where retain_until is not null;
create index guest_imports_deleted_idx on public.guest_imports(deleted_at) where deleted_at is not null;

-- Authentication may have validated a JWT just before erasure. Protect the
-- user row itself against that stale request recreating an application identity.
create function public.guard_erased_identity() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  if tg_op='INSERT' then
    if exists(select 1 from public.privacy_erasure_ledger where auth_id_hash=encode(digest(new.auth_user_id::text,'sha256'),'hex')) then raise exception 'privacy_subject_unavailable'; end if;
  elsif old.deletion_requested_at is not null and
    (to_jsonb(new)-array['deletion_requested_at','privacy_revision','ai_processing','analytics','ai_provider','ai_notice_version','updated_at']) is distinct from
    (to_jsonb(old)-array['deletion_requested_at','privacy_revision','ai_processing','analytics','ai_provider','ai_notice_version','updated_at']) then
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;
create trigger privacy_identity_write before insert or update on public.users for each row execute function public.guard_erased_identity();

-- Compliance operators can honor verified restriction/objection requests without
-- erasing the data or requiring the person to grant another optional permission.
create function public.set_privacy_restriction(p_user uuid,p_guest uuid,p_restricted boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if (p_user is null)=(p_guest is null) then raise exception 'invalid_subject'; end if;
  if p_user is not null then
    perform 1 from public.users where id=p_user and deletion_requested_at is null for update;
    if not found then raise exception 'privacy_subject_unavailable'; end if;
    if p_restricted then
      update public.ai_runs set status='failed',completed_at=now(),error_message='Processing restricted',input_payload='{}',output_payload=null,debug_payload=null where user_id=p_user and status='pending';
    end if;
    update public.users set processing_restricted_at=case when p_restricted then now() else null end, ai_processing=false,analytics=false,privacy_revision=privacy_revision+1 where id=p_user;
  else
    update public.guest_imports set processing_restricted_at=case when p_restricted then now() else null end, ai_processing=false,analytics=false,privacy_revision=privacy_revision+1,
      lease_id=null,lease_expires_at=null,status=case when status='parsing' then 'uploaded' else status end
      where id=p_guest and deleted_at is null and claimed_user_id is null;
    if not found then raise exception 'privacy_subject_unavailable'; end if;
  end if;
end $$;
revoke all on function public.set_privacy_restriction(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_privacy_restriction(uuid,uuid,boolean) to service_role;

-- Minimal guest erasure evidence survives row cleanup so a recent backup cannot
-- revive a deleted guest's still-unexpired recovery proof.
create table public.privacy_guest_erasure_ledger (
  guest_id uuid primary key,
  storage_path text not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now()+interval '90 days'
);
alter table public.privacy_guest_erasure_ledger enable row level security;
revoke all on public.privacy_guest_erasure_ledger from public,anon,authenticated;
grant all on public.privacy_guest_erasure_ledger to service_role;
create index privacy_guest_ledger_retention_idx on public.privacy_guest_erasure_ledger(retain_until);
create function public.record_guest_erasure() returns trigger language plpgsql set search_path=public as $$
begin
  if new.deleted_at is not null then
    insert into public.privacy_guest_erasure_ledger(guest_id,storage_path) values(new.id,new.storage_path) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger privacy_guest_erasure before update of deleted_at on public.guest_imports for each row execute function public.record_guest_erasure();
create function public.guard_erased_guest_work() returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.privacy_guest_erasure_ledger where guest_id=new.id) and
    (new.deleted_at is null or new.parsed_content is not null or new.raw_extracted_text is not null or new.answers<>'{}'::jsonb or new.claimed_user_id is not null) then
    raise exception 'privacy_subject_unavailable';
  end if;
  return new;
end $$;
create trigger privacy_guest_work before insert or update on public.guest_imports for each row execute function public.guard_erased_guest_work();
notify pgrst,'reload schema';
