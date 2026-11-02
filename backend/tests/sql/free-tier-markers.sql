begin;
do $$
declare u uuid; a uuid:=gen_random_uuid(); m uuid; t uuid; s uuid; claimed int;
begin
  set local role service_role;
  insert into public.users(auth_user_id,email) values(a,'free-tier@example.invalid') returning id into u;
  if (select free_tailoring_used_at is not null or free_improve_used_at is not null from public.users where id=u) then
    raise exception 'a new account starts with a used free tier';
  end if;

  -- The backend's conditional claim succeeds once; a concurrent or repeated claim matches no row.
  update public.users set free_tailoring_used_at=now() where id=u and free_tailoring_used_at is null;
  get diagnostics claimed = row_count;
  if claimed<>1 then raise exception 'first free tailoring claim failed'; end if;
  update public.users set free_tailoring_used_at=now() where id=u and free_tailoring_used_at is null;
  get diagnostics claimed = row_count;
  if claimed<>0 then raise exception 'free tailoring was claimed twice'; end if;

  -- Sessions are not free unless the backend says so, and deleting the CV keeps the marker.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'CV','en','{}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(u,m,'Tailored','en','{}') returning id into t;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,job_snapshot,base_snapshot) values(u,t,'draft','{}','{}') returning id into s;
  if (select free_tier from public.tailoring_sessions where id=s) then raise exception 'sessions default to free'; end if;
  delete from public.tailored_cvs where id=t;
  if (select free_tailoring_used_at from public.users where id=u) is null then raise exception 'deleting the CV refunded free tailoring'; end if;
  reset role;

  -- Browsers cannot reset their own marker.
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  begin
    update public.users set free_tailoring_used_at=null, free_improve_used_at=null where id=u;
    raise exception 'browser reset a free-tier marker';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
select 'Free-tier markers claim once and stay server-owned' as verification;
