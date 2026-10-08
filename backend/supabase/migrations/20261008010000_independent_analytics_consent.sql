-- Analytics-only synchronization must never re-enable or withdraw AI, renew
-- an AI grant, or invalidate an outstanding AI processing lease.
create function public.record_analytics_choice(p_user uuid,p_guest uuid,p_version text,p_analytics boolean)
returns void language plpgsql security definer set search_path=public as $$
declare old_analytics boolean;
begin
  if (p_user is null) = (p_guest is null) then raise exception 'invalid_subject'; end if;
  if p_analytics is null or p_version is null then raise exception 'invalid_choice'; end if;
  if p_user is not null then
    select analytics into old_analytics from public.users where id=p_user and deletion_requested_at is null for update;
  else
    select analytics into old_analytics from public.guest_imports where id=p_guest and claimed_user_id is null and deleted_at is null and expires_at>now() for update;
  end if;
  if not found then raise exception 'privacy_subject_unavailable'; end if;
  if not exists(select 1 from public.privacy_receipts where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='notice' and document_version=p_version) then
    insert into public.privacy_receipts(user_id,guest_id,purpose,choice,document_version) values(p_user,p_guest,'notice',true,p_version);
  end if;
  if p_analytics is distinct from old_analytics or not exists(select 1 from public.privacy_receipts where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='analytics' and document_version=p_version) then
    update public.privacy_receipts set retain_until=now()+interval '12 months' where user_id is not distinct from p_user and guest_id is not distinct from p_guest and purpose='analytics' and retain_until is null;
    insert into public.privacy_receipts(user_id,guest_id,purpose,choice,document_version) values(p_user,p_guest,'analytics',p_analytics,p_version);
  end if;
  if p_user is not null then update public.users set analytics=p_analytics where id=p_user;
  else update public.guest_imports set analytics=p_analytics,notice_version=p_version where id=p_guest; end if;
end $$;
revoke all on function public.record_analytics_choice(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.record_analytics_choice(uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';
