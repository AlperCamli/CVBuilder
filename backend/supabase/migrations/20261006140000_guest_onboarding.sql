-- Guest uploads stay separate from account-owned CVs. Only the backend service
-- role can read them or claim them; browser clients never receive parsed content.
alter table public.users add column if not exists onboarding_answers jsonb not null default '{}';
alter table public.imports add column if not exists review_context jsonb;
create table public.guest_imports (
  id uuid primary key,
  token_hash text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  storage_path text not null unique,
  status text not null default 'uploaded' check (status in ('uploaded','parsing','parsed','failed','claimed')),
  answers jsonb not null default '{}',
  parser_name text,
  raw_extracted_text text,
  parsed_content jsonb,
  review_context jsonb,
  cv_review jsonb,
  error_message text,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  claimed_user_id uuid references public.users(id) on delete cascade,
  claimed_import_id uuid references public.imports(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
alter table public.guest_imports enable row level security;
revoke all on public.guest_imports from anon, authenticated;
grant all on public.guest_imports to service_role;
create index guest_imports_expiry_idx on public.guest_imports(expires_at);

-- A row lock makes parallel tabs and retried callbacks return the same import.
create function public.claim_guest_import(p_id uuid, p_token_hash text, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g public.guest_imports; f_id uuid; i_id uuid;
begin
  select * into g from public.guest_imports where id = p_id for update;
  if not found or g.token_hash <> p_token_hash or g.expires_at <= now() then
    raise exception 'guest_not_found';
  end if;
  if g.claimed_user_id is not null then
    if g.claimed_user_id <> p_user_id then raise exception 'guest_not_found'; end if;
    return g.claimed_import_id;
  end if;
  if g.status <> 'parsed' or g.parsed_content is null then raise exception 'guest_not_ready'; end if;
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(p_user_id,'source_upload','imports',g.storage_path,g.original_filename,g.mime_type,g.size_bytes)
    returning id into f_id;
  insert into public.imports(user_id,source_file_id,status,module_type,parser_name,raw_extracted_text,parsed_content,review_context)
    values(p_user_id,f_id,'parsed','standard',g.parser_name,g.raw_extracted_text,g.parsed_content,g.review_context)
    returning id into i_id;
  update public.users set onboarding_answers = g.answers where id = p_user_id;
  update public.guest_imports set status = 'claimed', claimed_user_id = p_user_id,
    claimed_import_id = i_id, raw_extracted_text = null, parsed_content = null,
    review_context = null, cv_review = null where id = p_id;
  return i_id;
end; $$;
revoke all on function public.claim_guest_import(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_import(uuid,text,uuid) to service_role;
create function public.begin_guest_import_parse(p_id uuid, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.guest_imports set status = 'parsing', lease_id = p_lease_id,
    lease_expires_at = now() + interval '5 minutes', attempts = attempts + 1, error_message = null
    where id = p_id and claimed_user_id is null and expires_at > now() and attempts < 3
    and (status in ('uploaded','failed') or (status = 'parsing' and lease_expires_at < now()));
  return found;
end; $$;
revoke all on function public.begin_guest_import_parse(uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_guest_import_parse(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
