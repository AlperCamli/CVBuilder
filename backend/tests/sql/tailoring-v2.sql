begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); m uuid; j uuid; t1 uuid; t2 uuid; t3 uuid;
  s1 uuid; s2 uuid; s3 uuid; task uuid; run1 uuid; run2 uuid; run3 uuid; ms uuid; tbl text; rec public.tailoring_sessions;
begin
  insert into public.users(id,auth_user_id,email) values(u,a,'tailoring-test@example.invalid');
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'CV','tr','{}','scratch') returning id into m;
  insert into public.jobs(user_id,company_name,job_title,job_description) values(u,'Acme','Engineer','Private notes about the job') returning id into j;
  insert into public.tailored_cvs(user_id,master_cv_id,job_id,title,language,current_content) values(u,m,j,'CV 1','tr','{}') returning id into t1;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(u,m,'CV 2','tr','{}') returning id into t2;
  update public.jobs set tailored_cv_id=t1 where id=j;

  -- 1) The app's soft delete detaches, archives and scrubs the session; its runs stay.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,job_id,status,job_snapshot,analysis,answers,requirement_decisions,base_snapshot)
    values(u,t1,j,'reviewing','{"job_title":"Engineer","company_name":"Acme","job_description":"Full posting"}','{"requirements":[]}',
      '{"q1":{"answer":"yes","detail":"Served 12 merchants"}}','{"r1":"relevant"}','{"sections":[{"text":"Private CV"}]}') returning id into s1;
  insert into public.ai_runs(user_id,tailored_cv_id,job_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,total_tokens,cost_usd)
    values(u,t1,j,s1,'tailoring_block','mock','test','pending','{}',1200,0.0015) returning id into run1;
  update public.tailoring_sessions set analysis_run_id=run1 where id=s1;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,block_id,status,brief) values(s1,u,'block','b1','done','{"focus":"Private"}') returning id into task;
  insert into public.ai_suggestions(user_id,ai_run_id,tailored_cv_id,tailoring_session_id,tailoring_task_id,kind,action_type,suggested_content)
    values(u,run1,t1,s1,task,'rewrite','tailor','{"value":"Private rewrite"}');
  update public.tailored_cvs set is_deleted=true where id=t1;
  select * into rec from public.tailoring_sessions where id=s1;
  if rec.tailored_cv_id is not null or rec.status<>'archived' then raise exception 'Soft-deleted CV left its session active'; end if;
  if rec.base_snapshot<>'{}'::jsonb or rec.answers<>'{}'::jsonb or rec.requirement_decisions<>'{}'::jsonb or rec.analysis is not null then
    raise exception 'Detached session kept CV content';
  end if;
  if rec.job_snapshot<>'{"job_title":"Engineer","company_name":"Acme"}'::jsonb then raise exception 'Detached session job snapshot not reduced'; end if;
  if exists(select 1 from public.tailoring_session_tasks where session_id=s1) or exists(select 1 from public.ai_suggestions where tailoring_session_id=s1) then
    raise exception 'Detached session kept cards or task briefs';
  end if;
  if not exists(select 1 from public.ai_runs where id=run1 and tailoring_session_id=s1 and cost_usd=0.0015) or rec.analysis_run_id<>run1 then
    raise exception 'Soft delete lost cost data';
  end if;

  -- 2) A hard delete goes through the FK (set null) and the same scrub.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,job_snapshot,base_snapshot)
    values(u,t2,'generating','{"job_title":"Analyst","company_name":"","job_description":"Posting"}','{"sections":[]}') returning id into s2;
  insert into public.ai_runs(user_id,tailored_cv_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload)
    values(u,t2,s2,'tailoring_analysis','mock','test','pending','{}') returning id into run2;
  delete from public.tailored_cvs where id=t2;
  select * into rec from public.tailoring_sessions where id=s2;
  if not found or rec.tailored_cv_id is not null or rec.status<>'archived' or rec.base_snapshot<>'{}'::jsonb then raise exception 'Hard delete did not detach the session'; end if;
  if not exists(select 1 from public.ai_runs where id=run2 and tailoring_session_id=s2 and tailored_cv_id is null) then raise exception 'Hard delete lost cost data'; end if;

  -- 3) Account erasure (real service order) still removes everything, without writes to the subject.
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content) values(u,m,'CV 3','tr','{}') returning id into t3;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,job_snapshot,base_snapshot) values(u,t3,'reviewing','{}','{}') returning id into s3;
  insert into public.ai_runs(user_id,tailored_cv_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload)
    values(u,t3,s3,'tailoring_analysis','mock','test','pending','{}') returning id into run3;
  insert into public.ai_runs(user_id,tailored_cv_id,tailoring_session_id,parent_run_id,flow_type,provider,model_name,status,input_payload)
    values(u,t3,s3,run3,'tailoring_block','mock','test','pending','{}');
  update public.tailoring_sessions set analysis_run_id=run3 where id=s3;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id) values(s3,u,'summary','done',run3) returning id into task;
  insert into public.ai_suggestions(user_id,ai_run_id,tailored_cv_id,tailoring_session_id,tailoring_task_id,kind,action_type,suggested_content)
    values(u,run3,t3,s3,task,'rewrite','tailor','{}');
  -- "Also add to my main CV" copy on the master CV, with its block revision.
  insert into public.ai_suggestions(user_id,ai_run_id,master_cv_id,block_id,action_type,before_content,suggested_content,status,applied_at)
    values(u,run3,m,'b1','tailor','{}','{}','applied',now()) returning id into ms;
  insert into public.cv_block_revisions(user_id,cv_kind,master_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,ai_suggestion_id)
    values(u,'master',m,'b1','experience_item',1,'{}','ai',ms);
  perform public.request_account_erasure(u,a);
  begin
    update public.tailored_cvs set is_deleted=true where id=t3;
    raise exception 'Late CV delete accepted';
  exception when others then if sqlerrm<>'privacy_subject_unavailable' then raise; end if; end;
  delete from public.job_status_history where changed_by_user_id=u;
  foreach tbl in array array['cover_letter_exports','exports','imports','cv_block_revisions','ai_suggestions','tailoring_session_tasks','tailoring_sessions','ai_runs','cover_letters','tailored_cvs','jobs','master_cvs','files','usage_counters','subscriptions'] loop
    execute format('delete from public.%I where user_id=$1',tbl) using u;
  end loop;
  delete from public.guest_imports where claimed_user_id=u;
  delete from public.users where id=u;
  if exists(select 1 from public.tailoring_sessions where user_id=u) or exists(select 1 from public.ai_runs where user_id=u) then
    raise exception 'Erasure left tailoring data';
  end if;
end $$;
rollback;
select 'Tailoring sessions detach on CV delete, keep cost data, scrub CV content and erase with the account' as verification;
