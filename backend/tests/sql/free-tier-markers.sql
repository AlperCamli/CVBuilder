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
  if (select free_tier or free_ai_refinements<>0 from public.tailoring_sessions where id=s) then raise exception 'sessions default to free'; end if;
  -- The backend's compare-and-set refinement claim cannot go below zero.
  begin
    update public.tailoring_sessions set free_ai_refinements=-1 where id=s;
    raise exception 'negative refinement count accepted';
  exception when check_violation then null; end;
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

-- Backfill (20261107140000): only a successful earlier tailoring or improvement uses the free tier.
begin;
do $$
declare
  manual uuid; failed uuid; session_v2 uuid; draft_v1 uuid; generated uuid; improved uuid; pending_deletion uuid; m uuid;
  got text;
begin
  set local role service_role;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-manual@example.invalid') returning id into manual;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-failed@example.invalid') returning id into failed;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-session@example.invalid') returning id into session_v2;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-draft@example.invalid') returning id into draft_v1;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-generated@example.invalid') returning id into generated;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-improved@example.invalid') returning id into improved;
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'bf-deleting@example.invalid') returning id into pending_deletion;

  -- A manual copy (no AI generation) and failed runs or a session never analyzed keep the free tailoring.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(manual,'CV','en','{}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(manual,m,'Copy','en','{}');
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(failed,'CV','en','{}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,ai_generation_status) values(failed,m,'Failed','en','{}','failed');
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,job_snapshot,base_snapshot)
    select failed,id,'draft','{}','{}' from public.tailored_cvs where user_id=failed;
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at) values
    (failed,'tailored_draft','openai','gpt-6-luna','failed','{}','2026-01-01T10:00:00Z','2026-01-01T10:00:00Z'),
    (failed,'tailoring_analysis','openai','gpt-6-luna','failed','{}','2026-01-01T10:00:00Z','2026-01-01T10:00:00Z'),
    (failed,'job_analysis','openai','gpt-6-luna','completed','{}','2026-01-01T10:00:00Z','2026-01-01T10:00:00Z'),
    (failed,'import_improve','openai','gpt-6-luna','failed','{}','2026-01-01T10:00:00Z','2026-01-01T10:00:00Z');

  -- Successful tailoring: an analyzed v2 session, a completed v1 draft run, a generated tailored CV.
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(session_v2,'CV','en','{}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(session_v2,m,'T','en','{}','2026-03-05T00:00:00Z');
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,job_snapshot,base_snapshot,analysis,created_at)
    select session_v2,id,'reviewing','{}','{}','{}','2026-03-04T00:00:00Z' from public.tailored_cvs where user_id=session_v2;
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at) values
    (draft_v1,'tailored_draft','openai','gpt-6-luna','completed','{}','2026-02-02T00:00:00Z','2026-02-02T00:00:00Z'),
    (draft_v1,'tailored_draft','openai','gpt-6-luna','failed','{}','2026-02-01T00:00:00Z','2026-02-01T00:00:00Z'),
    (improved,'import_improve','openai','gpt-6-luna','completed','{}','2026-02-03T00:00:00Z','2026-02-03T00:00:00Z'),
    (pending_deletion,'tailored_draft','openai','gpt-6-luna','completed','{}','2026-02-02T00:00:00Z','2026-02-02T00:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(generated,'CV','en','{}','scratch') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,ai_generation_status,created_at)
    values(generated,m,'Generated','en','{}','completed','2026-02-04T00:00:00Z');

  -- Requested deletion after its tailoring: the frozen account is skipped.
  update public.users set deletion_requested_at=now() where id=pending_deletion;

  perform public.backfill_free_tier_markers();
  select string_agg(split_part(email,'@',1)||'='||coalesce(to_char(free_tailoring_used_at at time zone 'UTC','MM-DD'),'-')||'/'
                    ||coalesce(to_char(free_improve_used_at at time zone 'UTC','MM-DD'),'-'), ' ' order by email)
    into got from public.users where email like 'bf-%';
  if got <> 'bf-deleting=-/- bf-draft=02-02/- bf-failed=-/- bf-generated=02-04/- bf-improved=-/02-03 bf-manual=-/- bf-session=03-04/-' then
    raise exception 'backfill wrong: %', got;
  end if;
  -- Idempotent: a second run keeps the earlier dates.
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at) values
    (draft_v1,'tailoring_analysis','openai','gpt-6-luna','completed','{}','2025-12-01T00:00:00Z','2025-12-01T00:00:00Z');
  perform public.backfill_free_tier_markers();
  if (select to_char(free_tailoring_used_at at time zone 'UTC','MM-DD') from public.users where id=draft_v1) <> '02-02' then
    raise exception 'backfill overwrote a marker';
  end if;
  reset role;
end $$;
rollback;

begin;
set local role authenticated;
do $$
begin
  perform public.backfill_free_tier_markers();
  raise exception 'browser role could run the free-tier backfill';
exception when insufficient_privilege then null;
end $$;
rollback;
select 'Free-tier markers claim once, backfill only successful use and stay server-owned' as verification;
