-- Phase 4 part B: tailoring and acquisition metrics (20261103130000_analytics_tailoring_acquisition.sql).
begin;

create function pg_temp.mk_export(p_user uuid, p_tcv uuid, p_mcv uuid, p_at timestamptz) returns void
language plpgsql as $$
declare fl uuid;
begin
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
    values(p_user,'export_pdf','exports','users/'||p_user||'/x/'||gen_random_uuid()||'.pdf','x.pdf','application/pdf',10) returning id into fl;
  insert into public.exports(user_id,tailored_cv_id,master_cv_id,file_id,format,status,created_at,completed_at)
    values(p_user,p_tcv,p_mcv,fl,'pdf','completed',p_at,p_at);
end $$;

create function pg_temp.mk_file(p_user uuid, p_path text, p_mime text) returns uuid
language sql as $$
  insert into public.files(user_id,file_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
  values(p_user,'source_upload','imports',p_path,'cv',p_mime,10) returning id
$$;

-- t(): null-safe text for compact assertions.
create function pg_temp.t(p anyelement) returns text language sql immutable as $$ select coalesce(p::text, '-') $$;

do $$
declare
  violations text;
  got text;
  expected text;
  ta uuid; tb uuid; tc uuid; ti uuid; trs uuid;
  ma uuid; mb uuid; mc uuid; mi uuid; mr uuid;
  cv1 uuid; cv3 uuid; cv5 uuid; cv6 uuid; cvi uuid; cvr uuid;
  j1 uuid; j5 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid; s9 uuid; s10 uuid;
  ra uuid; r1 uuid; r2 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r7b uuid; rm uuid;
  t1 uuid; t2 uuid; t4 uuid; t5 uuid; t7 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid;
  m uuid; tcv uuid; jb uuid; fl uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid;
  q1 uuid; q2 uuid;
  l1 uuid; l2 uuid; ml2 uuid;
  k record;
begin
  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;

  -- =========================================================================
  -- Tailoring v2 (sessions from 2026-10-27). Accounts created before the onboarding range used below.
  -- ta = TR / tr with auto-apply on, tb = GLOBAL / en, tc = no market / en, ti = internal, trs = restricted later.
  -- =========================================================================
  insert into public.users(auth_user_id,email,created_at,ai_processing,locale,preferences)
    values(gen_random_uuid(),'tl-a@example.invalid','2026-09-01',true,'tr','{"tailoring_auto_apply":true}') returning id into ta;
  insert into public.users(auth_user_id,email,created_at,ai_processing) values(gen_random_uuid(),'tl-b@example.invalid','2026-09-01',true) returning id into tb;
  insert into public.users(auth_user_id,email,created_at,ai_processing) values(gen_random_uuid(),'tl-c@example.invalid','2026-09-01',true) returning id into tc;
  insert into public.users(auth_user_id,email,created_at,ai_processing,is_internal) values(gen_random_uuid(),'tl-i@example.invalid','2026-09-01',true,true) returning id into ti;
  insert into public.users(auth_user_id,email,created_at,ai_processing) values(gen_random_uuid(),'tl-r@example.invalid','2026-09-01',true) returning id into trs;
  insert into public.billing_markets(user_id,market) values(ta,'TR'),(tb,'GLOBAL');

  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(ta,'M','en','{}','scratch','2026-09-02') returning id into ma;
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(tb,'M','en','{}','scratch','2026-09-02') returning id into mb;
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(tc,'M','en','{}','scratch','2026-09-02') returning id into mc;
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(ti,'M','en','{}','scratch','2026-09-02') returning id into mi;
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(trs,'M','en','{}','scratch','2026-09-02') returning id into mr;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(ta,ma,'T','en','{}','2026-10-27T09:59:00Z') returning id into cv1;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(tb,mb,'T','en','{}','2026-10-27T08:59:00Z') returning id into cv3;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(tc,mc,'T','en','{}','2026-10-27T14:59:00Z') returning id into cv5;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(tc,mc,'T','en','{}','2026-10-27T17:59:00Z') returning id into cv6;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(ti,mi,'T','en','{}','2026-10-27T08:00:00Z') returning id into cvi;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(trs,mr,'T','en','{}','2026-10-27T08:00:00Z') returning id into cvr;
  insert into public.jobs(user_id,company_name,job_title,job_description,status,applied_at) values(ta,'Co','Role','Desc','interview','2026-10-27T12:46:00Z') returning id into j1;
  insert into public.job_status_history(job_id,from_status,to_status,changed_at,changed_by_user_id) values(j1,'applied','interview','2026-10-27T13:46:00Z',ta);
  insert into public.jobs(user_id,company_name,job_title,job_description,status) values(tc,'Co','Role','Desc','applied') returning id into j5;
  insert into public.job_status_history(job_id,from_status,to_status,changed_at,changed_by_user_id) values(j5,'saved','applied','2026-10-27T17:00:00Z',tc);

  -- S1 (ta, cv1, re-tailored by S2 so archived): analysed in 120 s, a gap question answered yes and a metric question
  -- skipped (last answer 10:06), finished 10:16, exported 10:46, applied 12:46, interview 13:46.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,job_id,status,base_snapshot,analysis,answers,questions_completed,finished_at,created_at)
    values(ta,cv1,j1,'archived','{}','{"questions":[{"id":"q1","kind":"gap","requirement_id":"r1"},{"id":"q2","kind":"metric"}]}',
           '{"q1":{"answer":"yes","answered_at":"2026-10-27T10:05:00Z"},"q2":{"detail":"  ","answered_at":"2026-10-27T10:06:00Z"}}',
           true,'2026-10-27T10:16:00Z','2026-10-27T10:00:00Z') returning id into s1;
  -- S2 (ta, cv1, live): analysed in 240 s, one gap question skipped at 11:10 (questions not completed, so no
  -- questions-step timing) plus an answer key with an impossible timestamp (ignored, never an error), not finished;
  -- cv1's 11:30 export is S2's.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,analysis,answers,created_at)
    values(ta,cv1,'reviewing','{}','{"questions":[{"id":"q1","kind":"gap"}]}',
           '{"q1":{"answered_at":"2026-10-27T11:10:00Z"},"qx":{"answered_at":"2026-02-30T25:00:00+99:00"}}','2026-10-27T11:00:00Z') returning id into s2;
  -- S3 (tb, cv3, archived): analysed in 60 s, no questions, finished 09:10, a failed task; cv3's only export (09:40)
  -- comes after S4 started, so S3 is not exported.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,analysis,questions_completed,finished_at,created_at)
    values(tb,cv3,'archived','{}','{"questions":[]}',true,'2026-10-27T09:10:00Z','2026-10-27T09:00:00Z') returning id into s3;
  -- S4 (tb, cv3, live): never analysed, errored.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,error_message,created_at)
    values(tb,cv3,'analyzing','{}','Analysis failed','2026-10-27T09:30:00Z') returning id into s4;
  -- S5 (tc, cv5): analysed in 600 s, gap answered no + open metric answered (last 15:20), finished 15:30, exported 16:00,
  -- applied 17:00 (status history only).
  insert into public.tailoring_sessions(user_id,tailored_cv_id,job_id,status,base_snapshot,analysis,answers,questions_completed,finished_at,created_at)
    values(tc,cv5,j5,'ready','{}','{"questions":[{"id":"q1","kind":"gap"},{"id":"q_open_metric","kind":"metric_open"}]}',
           '{"q1":{"answer":"no","answered_at":"2026-10-27T15:15:00Z"},"q_open_metric":{"entries":[{"v":1}],"answered_at":"2026-10-27T15:20:00Z"}}',
           true,'2026-10-27T15:30:00Z','2026-10-27T15:00:00Z') returning id into s5;
  -- S6 (tc, cv6, detached below): analysed in 60 s, finished 18:11, exported 18:31.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,analysis,questions_completed,finished_at,created_at)
    values(tc,cv6,'ready','{}','{"questions":[]}',true,'2026-10-27T18:11:00Z','2026-10-27T18:00:00Z') returning id into s6;
  -- Excluded: S7 internal, S8 has a mock run, S9 before the v2 launch, S10 restricted account.
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,created_at) values(ti,cvi,'ready','{}','2026-10-27T08:00:00Z') returning id into s7;
  insert into public.tailoring_sessions(user_id,status,base_snapshot,created_at) values(ta,'archived','{}','2026-10-27T08:00:00Z') returning id into s8;
  insert into public.tailoring_sessions(user_id,status,base_snapshot,created_at) values(tb,'archived','{}','2026-10-26T12:00:00Z') returning id into s9;
  insert into public.tailoring_sessions(user_id,tailored_cv_id,status,base_snapshot,created_at) values(trs,cvr,'ready','{}','2026-10-27T08:00:00Z') returning id into s10;

  -- Analysis runs (completed at the analysis time) linked back to their sessions.
  for k in select * from (values (s1,ta,cv1,'2026-10-27T10:02:00Z'::timestamptz),(s2,ta,cv1,'2026-10-27T11:04:00Z'),(s3,tb,cv3,'2026-10-27T09:01:00Z'),
                                 (s5,tc,cv5,'2026-10-27T15:10:00Z'),(s6,tc,cv6,'2026-10-27T18:01:00Z'),(s7,ti,cvi,'2026-10-27T08:01:00Z'),
                                 (s9,tb,null,'2026-10-26T12:01:00Z'),(s10,trs,cvr,'2026-10-27T08:01:00Z')) v(sid,uid,cv,done_at) loop
    insert into public.ai_runs(user_id,tailoring_session_id,tailored_cv_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
      values(k.uid,k.sid,k.cv,'tailoring_analysis','openai','gpt-6-luna','completed','{}',k.done_at - interval '30 seconds',k.done_at) returning id into ra;
    update public.tailoring_sessions set analysis_run_id = ra where id = k.sid;
  end loop;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(ta,s8,'tailoring_analysis','mock','mock','completed','{}','2026-10-27T08:00:10Z','2026-10-27T08:00:20Z') returning id into rm;
  update public.tailoring_sessions set analysis_run_id = rm where id = s8;

  -- Exports: S1 at 10:46, cv1 again at 11:30 (S2's window), cv3 at 09:40 (S4's window), S5 at 16:00, S6 at 18:31.
  perform pg_temp.mk_export(ta, cv1, null, '2026-10-27T10:46:00Z');
  perform pg_temp.mk_export(ta, cv1, null, '2026-10-27T11:30:00Z');
  perform pg_temp.mk_export(tb, cv3, null, '2026-10-27T09:40:00Z');
  perform pg_temp.mk_export(tc, cv5, null, '2026-10-27T16:00:00Z');
  perform pg_temp.mk_export(tc, cv6, null, '2026-10-27T18:31:00Z');

  -- Task runs (all attempts). R1, R2, R5, R6, R7, R7a, R7b on gpt-6-luna / openai; R4a, R4 on gemini.
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(ta,s1,'tailoring_block','openai','gpt-6-luna','completed','{"flow_input":{}}','2026-10-27T10:03:00Z','2026-10-27T10:03:10Z') returning id into r1;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(ta,s1,'tailoring_block','openai','gpt-6-luna','completed','{"flow_input":{}}','2026-10-27T10:03:00Z','2026-10-27T10:03:30Z') returning id into r2;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at)
    values(tb,s3,'tailoring_block','gemini','gemini-3-flash','failed','{}','x','2026-10-27T09:01:30Z','2026-10-27T09:01:35Z');
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at)
    values(tb,s3,'tailoring_block','gemini','gemini-3-flash','failed','{}','x','2026-10-27T09:02:00Z','2026-10-27T09:02:05Z') returning id into r4;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(tb,s3,'tailoring_structure','openai','gpt-6-luna','completed','{}','2026-10-27T09:02:00Z','2026-10-27T09:02:20Z') returning id into r5;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at)
    values(tc,s5,'tailoring_block','openai','gpt-6-luna','pending','{}','2026-10-27T15:11:00Z') returning id into r6;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at)
    values(tc,s5,'tailoring_block','openai','gpt-6-luna','failed','{}','x','2026-10-27T15:10:30Z','2026-10-27T15:10:40Z');
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(tc,s5,'tailoring_block','openai','gpt-6-luna','completed','{"flow_input":{"candidate_request":"x"}}','2026-10-27T15:10:50Z','2026-10-27T15:10:59Z') returning id into r7b;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at)
    values(tc,s5,'tailoring_block','openai','gpt-6-luna','completed','{"flow_input":{"refinement":"shorter"}}','2026-10-27T15:11:00Z','2026-10-27T15:12:40Z') returning id into r7;
  insert into public.ai_runs(user_id,tailoring_session_id,flow_type,provider,model_name,status,input_payload,error_message,started_at,completed_at)
    values(ti,s7,'tailoring_block','openai','gpt-6-luna','failed','{}','x','2026-10-27T08:02:00Z','2026-10-27T08:02:05Z');

  -- Tasks (created 2026-10-27): S1 block done 10 s with cards, summary done 30 s without a card (2 attempts), skills
  -- skipped; S3 block failed (2 attempts), structure done 20 s; S5 block running, block done 100 s (3 attempts).
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,completed_at,created_at) values
    (s1,ta,'block','done',r1,1,'2026-10-27T10:03:00Z','2026-10-27T10:03:10Z','2026-10-27T10:02:30Z') returning id into t1;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,completed_at,created_at) values
    (s1,ta,'summary','done',r2,2,'2026-10-27T10:03:00Z','2026-10-27T10:03:30Z','2026-10-27T10:02:30Z') returning id into t2;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,attempts,created_at) values (s1,ta,'skills','skipped',0,'2026-10-27T10:02:30Z');
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,completed_at,created_at) values
    (s3,tb,'block','failed',r4,2,'2026-10-27T09:02:00Z','2026-10-27T09:02:05Z','2026-10-27T09:01:20Z') returning id into t4;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,completed_at,created_at) values
    (s3,tb,'structure','done',r5,1,'2026-10-27T09:02:00Z','2026-10-27T09:02:20Z','2026-10-27T09:01:20Z') returning id into t5;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,created_at) values
    (s5,tc,'block','running',r6,1,'2026-10-27T15:11:00Z','2026-10-27T15:10:20Z');
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,ai_run_id,attempts,started_at,completed_at,created_at) values
    (s5,tc,'block','done',r7,3,'2026-10-27T15:11:00Z','2026-10-27T15:12:40Z','2026-10-27T15:10:20Z') returning id into t7;
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,attempts,created_at) values (s7,ti,'block','failed',1,'2026-10-27T08:02:00Z');
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,attempts,created_at) values (s8,ta,'block','failed',1,'2026-10-27T08:02:00Z');
  insert into public.tailoring_session_tasks(session_id,user_id,kind,status,attempts,created_at) values (s10,trs,'block','failed',1,'2026-10-27T08:02:00Z');

  -- Cards: C1 block applied+edited (initial), C2 block rejected (initial), C3 structure expired (payload wiped),
  -- C4 block applied with guard notes (quick fix), C5 block pending (quick fix), C6 skills rejected (refine).
  insert into public.ai_suggestions(ai_run_id,user_id,tailored_cv_id,tailoring_session_id,tailoring_task_id,action_type,suggested_content,status,applied_at,kind,meta,created_at) values
    (r1,ta,cv1,s1,t1,'tailor','{"edited":true}','applied','2026-10-27T10:10:00Z','block','{}','2026-10-27T10:03:10Z'),
    (r1,ta,cv1,s1,t1,'tailor','{}','rejected',null,'block','{}','2026-10-27T10:03:10Z'),
    (r5,tb,cv3,s3,t5,'tailor','{}','expired',null,'structure','{}','2026-10-27T09:02:20Z'),
    (r7,tc,cv5,s5,t7,'tailor','{}','applied','2026-10-27T15:20:00Z','block','{"guard_notes":["unsupported number"]}','2026-10-27T15:12:40Z'),
    (r7,tc,cv5,s5,t7,'tailor','{}','pending',null,'block','{"guard_notes":[]}','2026-10-27T15:12:40Z'),
    (r7b,tc,cv5,s5,t7,'tailor','{}','rejected',null,'skills','{}','2026-10-27T15:10:59Z');
  -- The add-to-main master copy (no session) never counts.
  insert into public.ai_suggestions(ai_run_id,user_id,master_cv_id,action_type,suggested_content,status,applied_at,kind,created_at)
    values(r1,ta,ma,'tailor','{}','applied','2026-10-27T10:10:00Z','block','2026-10-27T10:10:00Z');

  -- Deleting cv6 detaches S6 (scrubbed analysis and answers; the analysis run keeps the CV id).
  update public.tailored_cvs set is_deleted = true where id = cv6;
  update public.users set processing_restricted_at = now() where id = trs;

  -- ---- tailoring_funnel ----------------------------------------------------
  select string_agg(step_order || ':' || step || '/' || users || '/' || pg_temp.t(conversion_from_prev) || '/' || pg_temp.t(conversion_from_start)
                    || '/' || pg_temp.t(dropped) || '/' || distinct_users || '/' || pg_temp.t(timed_sessions) || '/'
                    || pg_temp.t(median_seconds_from_prev) || '/' || pg_temp.t(p90_seconds_from_prev), ' ' order by step_order)
    into got from analytics.tailoring_funnel('2026-10-20', '2026-10-28');
  if got <> '1:session_started/6/-/1.0000/-/3/-/-/- 2:analysed/5/0.8333/0.8333/1/3/5/120/456 '
            '3:passed_questions/2/0.6667/0.3333/1/2/2/420/564 4:finished/4/0.8000/0.6667/1/3/4/600/600 '
            '5:exported/3/0.7500/0.5000/1/2/3/1800/1800 6:applied/2/0.6667/0.3333/1/2/2/5400/6840 '
            '7:interview_or_offer/1/0.5000/0.1667/1/1/1/3600/3600' then
    raise exception 'tailoring_funnel wrong: %', got;
  end if;
  -- Internal sessions only when included (S7 analysed, unfinished); the mock, pre-launch and restricted ones never.
  select string_agg(users::text, ',' order by step_order) into got from analytics.tailoring_funnel('2026-10-20', '2026-10-28', p_include_internal => true);
  if got <> '7,6,2,4,3,2,1' then raise exception 'tailoring_funnel include_internal wrong: %', got; end if;
  -- Era: nothing before 2026-10-27.
  select users::text into got from analytics.tailoring_funnel('2026-10-20', '2026-10-26') where step_order = 1;
  if got <> '0' then raise exception 'tailoring_funnel era cutoff wrong: %', got; end if;
  -- Market filter (ta = TR: S1, S2) and breakdown.
  select string_agg(users::text, ',' order by step_order) into got from analytics.tailoring_funnel('2026-10-20', '2026-10-28', p_filters => '{"market":"TR"}');
  if got <> '2,2,1,1,1,1,1' then raise exception 'tailoring_funnel market filter wrong: %', got; end if;
  select string_agg(dimension || '=' || users, ',' order by dimension collate "C") into got from analytics.tailoring_funnel('2026-10-20', '2026-10-28', p_breakdown => 'market') where step_order = 1;
  if got <> 'GLOBAL=2,TR=2,unknown=2' then raise exception 'tailoring_funnel breakdown wrong: %', got; end if;
  select string_agg(dimension || '=' || users, ',' order by dimension collate "C") into got from analytics.tailoring_funnel('2026-10-20', '2026-10-28', p_breakdown => 'locale') where step_order = 4;
  if got <> 'en=3,tr=1' then raise exception 'tailoring_funnel locale breakdown wrong: %', got; end if;

  if analytics_private.try_timestamptz('2026-02-30T25:00:00+99:00') is not null
     or analytics_private.try_timestamptz('2026-10-27T11:10:00Z') <> timestamptz '2026-10-27T11:10:00Z' then
    raise exception 'try_timestamptz wrong';
  end if;

  -- ---- tailoring_task_reliability -------------------------------------------
  select pg_temp.t(task_failure_rate) || '/' || tasks || '/' || done_tasks || '/' || skipped_tasks || '/' || failed_tasks || '/' || open_tasks || '/'
         || pg_temp.t(block_failure_rate) || '/' || pg_temp.t(summary_failure_rate) || '/' || pg_temp.t(skills_failure_rate) || '/' || pg_temp.t(structure_failure_rate) || '/'
         || pg_temp.t(avg_attempts) || '/' || pg_temp.t(rerun_share) || '/' || pg_temp.t(done_without_card_share) || '/'
         || pg_temp.t(p50_task_seconds) || '/' || pg_temp.t(p95_task_seconds) || '/' || pg_temp.t(run_failure_rate) || '/' || runs || '/' || failed_runs
    into got from analytics.tailoring_task_reliability('2026-10-27', '2026-10-28') where bucket = '2026-10-27';
  if got <> '0.1667/7/4/1/1/1/0.3333/0.0000/0.0000/0.0000/1.67/0.5000/0.2500/25.0/89.5/0.3750/9/3' then
    raise exception 'tailoring_task_reliability wrong: %', got;
  end if;
  select string_agg(bucket || '/' || tasks || '/' || runs, ',' order by bucket) into got
    from analytics.tailoring_task_reliability('2026-10-27', '2026-10-28', 'day');
  if got <> '2026-10-27/7/9,2026-10-28/0/0' then raise exception 'tailoring_task_reliability buckets wrong: %', got; end if;
  select string_agg(dimension || '=' || tasks || '/' || pg_temp.t(task_failure_rate) || '/' || runs || '/' || pg_temp.t(run_failure_rate), ',' order by dimension collate "C") into got
    from analytics.tailoring_task_reliability('2026-10-27', '2026-10-27', p_breakdown => 'ai_provider');
  if got <> '(no run)=1/0.0000/0/-,gemini=1/1.0000/2/1.0000,openai=5/0.0000/7/0.1667' then
    raise exception 'tailoring_task_reliability breakdown wrong: %', got;
  end if;
  select tasks || '/' || done_tasks || '/' || open_tasks || '/' || pg_temp.t(task_failure_rate) into got
    from analytics.tailoring_task_reliability('2026-10-27', '2026-10-27', p_filters => '{"ai_model":"gpt-6-luna"}');
  if got <> '5/4/1/0.0000' then raise exception 'tailoring_task_reliability model filter wrong: %', got; end if;

  -- ---- tailoring_card_acceptance --------------------------------------------
  select string_agg(dimension || '=' || pg_temp.t(acceptance_rate) || '/' || cards, ', ' order by ord) into got
    from (select x.*, row_number() over () as ord from analytics.tailoring_card_acceptance('2026-10-27', '2026-10-28') x) y;
  if got <> 'run type: quick_fix=1.0000/2, guard notes: present=1.0000/1, kind: block=0.6667/4, all cards=0.5000/6, '
            'auto-apply: off (current setting)=0.5000/4, auto-apply: on (current setting)=0.5000/2, run type: initial=0.5000/2, '
            'guard notes: none=0.3333/5, kind: skills=0.0000/1, run type: refine=0.0000/1, kind: structure=-/1, '
            'run type: unknown (payload wiped)=-/1' then
    raise exception 'tailoring_card_acceptance wrong: %', got;
  end if;
  select decided || '/' || applied || '/' || rejected || '/' || pending || '/' || expired || '/' || applied_share || '/' || rejected_share
         || '/' || expired_share || '/' || pending_share || '/' || edited_share || '/' || sessions || '/' || users || '/' || driver
    into got from analytics.tailoring_card_acceptance('2026-10-27', '2026-10-28') where dimension = 'all cards';
  if got <> '4/2/2/1/1/0.3333/0.3333/0.1667/0.1667/0.5000/3/3/all' then raise exception 'tailoring_card_acceptance shares wrong: %', got; end if;
  select cards || '/' || acceptance_rate into got
    from analytics.tailoring_card_acceptance('2026-10-27', '2026-10-28', p_filters => '{"market":"TR"}') where dimension = 'all cards';
  if got <> '2/0.5000' then raise exception 'tailoring_card_acceptance market filter wrong: %', got; end if;
  select string_agg(dimension || '=' || cards, ',') into got
    from analytics.tailoring_card_acceptance('2026-10-27', '2026-10-28', p_filters => '{"ai_provider":"gemini"}');
  if got <> 'all cards=0' then raise exception 'tailoring_card_acceptance empty filter wrong: %', got; end if;

  -- ---- tailoring_questions ---------------------------------------------------
  select string_agg(dimension || '=' || pg_temp.t(answer_rate) || '/' || questions || '/' || answered || '/' || skipped_or_empty || '/' || never_touched
                    || '/' || sessions || '/' || sessions_with_kind || '/' || pg_temp.t(session_share) || '/' || pg_temp.t(avg_per_session) || '/'
                    || pg_temp.t(max_per_session) || '/' || pg_temp.t(gap_yes) || '/' || pg_temp.t(gap_some) || '/' || pg_temp.t(gap_no) || '/' || users, ' ' order by ord)
    into got from (select x.*, row_number() over () as ord from analytics.tailoring_questions('2026-10-27', '2026-10-28') x) y;
  if got <> 'metric_open=1.0000/1/1/0/0/4/1/0.2500/0.25/1/-/-/-/1 gap=0.6667/3/2/1/0/4/3/0.7500/0.75/1/1/0/1/2 '
            'all questions=0.6000/5/3/2/0/4/3/0.7500/1.25/2/1/0/1/2 metric=0.0000/1/0/1/0/4/1/0.2500/0.25/1/-/-/-/1' then
    raise exception 'tailoring_questions wrong: %', got;
  end if;

  -- ---- drill_tailoring_failed_sessions -------------------------------------
  perform admin_app.log_access('admin@example.invalid', 'people.drill_users', null, '{}'::jsonb, null);
  select string_agg(email || '=' || value, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-10-20', p_to => '2026-10-28', p_filters => '{"metric":"tailoring_failed_sessions","step":"exported"}');
  if got <> 'tl-b@example.invalid=1' then raise exception 'drill tailoring step exported wrong: %', got; end if;
  select string_agg(email || '=' || value, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-10-20', p_to => '2026-10-28', p_filters => '{"metric":"tailoring_failed_sessions","step":"finished"}');
  if got <> 'tl-a@example.invalid=1' then raise exception 'drill tailoring step finished wrong: %', got; end if;
  -- Failed or abandoned: S3 (failed task) and S4 (errored) of tb; S2 (ta) once it is 24 hours old.
  select string_agg(email || '=' || value || '/' || (detail ->> 'failed_tasks'), ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-10-20', p_to => '2026-10-28', p_filters => '{"metric":"tailoring_failed_sessions"}');
  -- S2 counts as abandoned once it is 24 hours old.
  expected := 'tl-b@example.invalid=2/1';
  if now() >= timestamptz '2026-10-28T11:00:00Z' then expected := 'tl-a@example.invalid=1/0,' || expected; end if;
  if got <> expected then
    raise exception 'drill tailoring failed sessions wrong: %', got;
  end if;
  select string_agg(email, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-10-20', p_to => '2026-10-28',
                                      p_filters => '{"metric":"tailoring_failed_sessions","step":"analysed","include_internal":true}');
  if got <> 'tl-b@example.invalid' then raise exception 'drill tailoring step analysed wrong: %', got; end if;
  begin
    perform * from analytics_people.drill_users(p_filters => '{"metric":"tailoring_failed_sessions","step":"bogus"}');
    raise exception 'unknown step accepted';
  exception when sqlstate '22023' then null;
  end;

  -- =========================================================================
  -- Activation funnel (March 2026 signups, all past their 7-day window)
  -- a1 TR upload: import 1h, master 2h, tailored 1d, export 2d, applied 3d.  a2 GLOBAL manual: master 1h (scratch),
  -- tailored 5d, export 8d (late).  a3 direct: failed import only.  a4 TR direct: import 1h, master 1h, master export
  -- 1d, applied 4d (history).  a5 direct: mock-parsed import only.  a6 internal (everything), a7 yesterday (pending),
  -- a8 restricted.
  -- =========================================================================
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-1@example.invalid','2026-03-02T10:00:00Z') returning id into a1;
  insert into public.users(auth_user_id,email,created_at,onboarding_metrics_counted_at) values(gen_random_uuid(),'act-2@example.invalid','2026-03-03T10:00:00Z','2026-03-03T10:00:00Z') returning id into a2;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-3@example.invalid','2026-03-04T10:00:00Z') returning id into a3;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-4@example.invalid','2026-03-05T10:00:00Z') returning id into a4;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-5@example.invalid','2026-03-06T10:00:00Z') returning id into a5;
  insert into public.users(auth_user_id,email,created_at,is_internal) values(gen_random_uuid(),'act-6@example.invalid','2026-03-07T10:00:00Z',true) returning id into a6;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-7@example.invalid',now() - interval '1 day') returning id into a7;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'act-8@example.invalid','2026-03-08T10:00:00Z') returning id into a8;
  insert into public.billing_markets(user_id,market) values(a1,'TR'),(a2,'GLOBAL'),(a4,'TR');

  fl := pg_temp.mk_file(a1, 'guests/' || gen_random_uuid() || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,created_at,updated_at) values(a1,fl,'converted','openai_cv_parser_v1','2026-03-02T11:00:00Z','2026-03-02T11:30:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a1,'M','en','{}','import','2026-03-02T12:00:00Z') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(a1,m,'T','en','{}','2026-03-03T10:00:00Z') returning id into tcv;
  perform pg_temp.mk_export(a1, tcv, null, '2026-03-04T10:00:00Z');
  insert into public.jobs(user_id,company_name,job_title,job_description,status,applied_at) values(a1,'Co','Role','Desc','applied','2026-03-05T10:00:00Z');

  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a2,'M','en','{}','scratch','2026-03-03T11:00:00Z') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(a2,m,'T','en','{}','2026-03-08T10:00:00Z') returning id into tcv;
  perform pg_temp.mk_export(a2, tcv, null, '2026-03-11T10:00:00Z');

  fl := pg_temp.mk_file(a3, 'users/' || a3 || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,error_message,created_at,updated_at) values(a3,fl,'failed','x','2026-03-04T11:00:00Z','2026-03-04T11:00:00Z');

  fl := pg_temp.mk_file(a4, 'users/' || a4 || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,created_at,updated_at) values(a4,fl,'converted','smart_pdf_parser_v2','2026-03-05T11:00:00Z','2026-03-05T11:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a4,'M','en','{}','import','2026-03-05T11:00:00Z') returning id into m;
  perform pg_temp.mk_export(a4, null, m, '2026-03-06T10:00:00Z');
  insert into public.jobs(user_id,company_name,job_title,job_description,status) values(a4,'Co','Role','Desc','applied') returning id into jb;
  insert into public.job_status_history(job_id,from_status,to_status,changed_at,changed_by_user_id) values(jb,'saved','applied','2026-03-09T10:00:00Z',a4);

  fl := pg_temp.mk_file(a5, 'users/' || a5 || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,created_at,updated_at) values(a5,fl,'parsed','mock_cv_parser_v1','2026-03-06T11:00:00Z','2026-03-06T11:00:00Z');

  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a6,'M','en','{}','scratch','2026-03-07T11:00:00Z') returning id into m;
  perform pg_temp.mk_export(a6, null, m, '2026-03-07T12:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(a8,'M','en','{}','scratch','2026-03-08T11:00:00Z') returning id into m;
  perform pg_temp.mk_export(a8, null, m, '2026-03-08T12:00:00Z');
  update public.users set processing_restricted_at = now() where id = a8;

  select string_agg(step_order || ':' || step || '/' || users || '/' || pg_temp.t(conversion_from_prev) || '/' || pg_temp.t(conversion_from_start)
                    || '/' || dropped || '/' || pg_temp.t(pending) || '/' || pg_temp.t(median_seconds_from_signup), ' ' order by step_order)
    into got from analytics.activation_funnel('2026-03-01', '2026-03-31');
  if got <> '1:signed_up/5/-/1.0000/2/0/- 2:cv_imported/2/0.4000/0.4000/3/-/3600 3:master_cv/3/1.0000/0.6000/0/-/3600 '
            '4:tailored_cv/2/0.6667/0.4000/1/-/259200 5:exported/2/0.5000/0.4000/1/-/129600 6:job_applied/2/1.0000/0.4000/0/-/302400' then
    raise exception 'activation_funnel wrong: %', got;
  end if;
  -- Exported / signed_up is kpi_overview's activation rate.
  select activation_rate::text into got from analytics.kpi_overview('2026-03-01', '2026-03-31');
  if got <> '0.4000' then raise exception 'activation_funnel not consistent with kpi_overview: %', got; end if;
  select string_agg(users::text, ',' order by step_order) into got from analytics.activation_funnel('2026-03-01', '2026-03-31', p_include_internal => true);
  if got <> '6,2,4,2,3,2' then raise exception 'activation_funnel include_internal wrong: %', got; end if;
  select string_agg(dimension || ':' || step || '=' || users || '/' || pg_temp.t(conversion_from_prev), ' ' order by step_order) into got
    from analytics.activation_funnel('2026-03-01', '2026-03-31', p_breakdown => 'onboarding_path') where dimension = 'direct';
  if got <> 'direct:signed_up=3/- direct:cv_imported=1/0.3333 direct:master_cv=1/1.0000 direct:tailored_cv=0/0.0000 direct:exported=1/- direct:job_applied=1/1.0000' then
    raise exception 'activation_funnel path breakdown wrong: %', got;
  end if;
  select string_agg(distinct dimension, ',') into got from analytics.activation_funnel('2026-03-01', '2026-03-31', p_breakdown => 'onboarding_path');
  if got <> 'direct,manual_create,upload' then raise exception 'activation_funnel path values wrong: %', got; end if;
  select string_agg(users::text, ',' order by step_order) into got from analytics.activation_funnel('2026-03-01', '2026-03-31', p_filters => '{"market":"TR"}');
  if got <> '2,2,2,1,2,2' then raise exception 'activation_funnel market filter wrong: %', got; end if;
  -- A signup still inside its window is pending, never a failure.
  select users || '/' || pending into got from analytics.activation_funnel(current_date - 2, current_date, p_filters => '{"onboarding_path":"direct"}') where step_order = 1;
  if got <> '0/1' then raise exception 'activation_funnel pending wrong: %', got; end if;

  -- ---- drill_activation_dropoff --------------------------------------------
  select string_agg(email, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"activation_dropoff","step":"exported"}');
  if got <> 'act-2@example.invalid' then raise exception 'drill activation exported wrong: %', got; end if;
  select string_agg(email, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"activation_dropoff","step":"signed_up"}');
  if got <> 'act-3@example.invalid,act-5@example.invalid' then raise exception 'drill activation signed_up wrong: %', got; end if;
  select string_agg(email, ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"activation_dropoff","step":"cv_imported"}');
  if got <> 'act-2@example.invalid,act-3@example.invalid,act-5@example.invalid' then raise exception 'drill activation cv_imported wrong: %', got; end if;
  select string_agg(email || '/' || (detail ->> 'onboarding_path'), ',' order by email) into got
    from analytics_people.drill_users(p_from => '2026-03-01', p_to => '2026-03-31', p_filters => '{"metric":"activation_dropoff","step":"tailored_cv","market":"TR"}');
  if got <> 'act-4@example.invalid/direct' then raise exception 'drill activation tailored_cv wrong: %', got; end if;
  begin
    perform * from analytics_people.drill_users(p_filters => '{"metric":"activation_dropoff"}');
    raise exception 'missing step accepted';
  exception when sqlstate '22023' then null;
  end;

  -- =========================================================================
  -- Onboarding segments (signups from 2026-10-06, analytics consent only)
  -- o1 upload / tailor / early / bachelor: master 1h, export 2d, subscription 3d, paid 6d, AI 0.30 + an unpriced run.
  -- o2 direct / tailor / change: master 1d, export 9d, subscription 20d, AI 0.10.  o3 manual, no answers.
  -- o4 no consent (coverage only).  o5 before 2026-10-06.  o6 yesterday / improve (not mature).  o7 internal.
  -- =========================================================================
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_answers) values(gen_random_uuid(),'onb-1@example.invalid','2026-10-07T10:00:00Z',true,
    '{"goal":"tailor","career":"early","education":"bachelor"}') returning id into o1;
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_answers) values(gen_random_uuid(),'onb-2@example.invalid','2026-10-08T10:00:00Z',true,
    '{"goal":"tailor","career":"change"}') returning id into o2;
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_metrics_counted_at) values(gen_random_uuid(),'onb-3@example.invalid','2026-10-09T10:00:00Z',true,'2026-10-09T10:00:00Z') returning id into o3;
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_answers) values(gen_random_uuid(),'onb-4@example.invalid','2026-10-10T10:00:00Z',false,'{"goal":"design"}') returning id into o4;
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_answers) values(gen_random_uuid(),'onb-5@example.invalid','2026-10-05T10:00:00Z',true,'{"goal":"tailor"}') returning id into o5;
  insert into public.users(auth_user_id,email,created_at,analytics,onboarding_answers) values(gen_random_uuid(),'onb-6@example.invalid',now() - interval '1 day',true,'{"goal":"improve"}') returning id into o6;
  insert into public.users(auth_user_id,email,created_at,analytics,is_internal,onboarding_answers) values(gen_random_uuid(),'onb-7@example.invalid','2026-10-07T10:00:00Z',true,true,'{"goal":"tailor"}') returning id into o7;
  perform pg_temp.mk_file(o1, 'guests/' || gen_random_uuid() || '/cv.pdf', 'application/pdf');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(o1,'M','en','{}','import','2026-10-07T11:00:00Z') returning id into m;
  perform pg_temp.mk_export(o1, null, m, '2026-10-09T10:00:00Z');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,created_at) values(o1,'stripe','sub_onb_1','pro','active','2026-10-10T10:00:00Z');
  insert into public.billing_invoices(user_id,provider_invoice_id,status,currency,amount_paid,billing_reason,paid_at,created_at)
    values(o1,'in_onb_1','paid','usd',1000,'subscription_cycle','2026-10-13T10:00:00Z','2026-10-13T10:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(o2,'M','en','{}','scratch','2026-10-09T10:00:00Z') returning id into m;
  perform pg_temp.mk_export(o2, null, m, '2026-10-17T10:00:00Z');
  insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_code,status,created_at) values(o2,'stripe','sub_onb_2','pro','active','2026-10-28T00:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(o4,'M','en','{}','scratch','2026-10-10T11:00:00Z') returning id into m;
  perform pg_temp.mk_export(o4, null, m, '2026-10-11T10:00:00Z');
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at,completed_at,input_tokens,output_tokens,total_tokens,cost_usd) values
    (o1,'cv_parse','openai','gpt-6-luna','completed','{}','2026-10-08T10:00:00Z','2026-10-08T10:00:05Z',10,10,20,0.30),
    (o1,'cv_parse','gemini','gemini-3-flash','completed','{}','2026-10-08T11:00:00Z','2026-10-08T11:00:05Z',100,10,110,null),
    (o2,'cv_parse','openai','gpt-6-luna','completed','{}','2026-10-09T10:00:00Z','2026-10-09T10:00:05Z',10,10,20,0.10),
    (o7,'cv_parse','openai','gpt-6-luna','completed','{}','2026-10-09T10:00:00Z','2026-10-09T10:00:05Z',10,10,20,5.00);

  select string_agg(dimension || '=' || pg_temp.t(activation_rate) || '/' || users || '/' || mature_7d || '/' || pg_temp.t(master_7d_rate) || '/' || mature_14d
                    || '/' || pg_temp.t(subscribed_14d_rate) || '/' || pg_temp.t(paid_14d_rate) || '/' || pg_temp.t(median_seconds_to_first_export)
                    || '/' || pg_temp.t(ai_cost_per_user) || '/' || ai_runs || '/' || unpriced_runs || '/' || pg_temp.t(consent_coverage) || '/' || fx_provisional, ' ')
    into got from analytics.onboarding_segments('2026-10-01', current_date) where segment = 'all';
  if got <> 'all consenting signups=0.3333/4/3/0.6667/3/0.3333/0.3333/475200/0.100000/3/1/0.6667/false' then
    raise exception 'onboarding_segments all row wrong: %', got;
  end if;
  select string_agg(dimension || '=' || pg_temp.t(activation_rate) || '/' || users || '/' || mature_7d || '/' || pg_temp.t(ai_cost_per_user), ' ' order by dimension collate "C")
    into got from analytics.onboarding_segments('2026-10-01', current_date) where segment <> 'all';
  if got <> 'career: (none)=0.0000/2/1/0.000000 career: change=0.0000/1/1/0.100000 career: early=1.0000/1/1/0.300000 '
            'education: (none)=0.0000/3/2/0.033333 education: bachelor=1.0000/1/1/0.300000 '
            'goal: (none)=0.0000/1/1/0.000000 goal: improve=-/1/0/0.000000 goal: tailor=0.5000/2/2/0.200000 '
            'path: direct=0.0000/2/1/0.050000 path: manual_create=0.0000/1/1/0.000000 path: upload=1.0000/1/1/0.300000' then
    raise exception 'onboarding_segments rows wrong: %', got;
  end if;
  -- TRY converts per run month (October month-to-date rate: provisional).
  insert into public.fx_rates(rate_month,base_currency,quote_currency,rate,sample_days,source,is_final) values('2026-10-01','USD','TRY',40,10,'test',false);
  select ai_cost_per_user || '/' || fx_provisional into got from analytics.onboarding_segments('2026-10-01', current_date, p_currency => 'try') where segment = 'all';
  if got <> '4.000000/true' then raise exception 'onboarding_segments try wrong: %', got; end if;
  select users::text into got from analytics.onboarding_segments('2026-10-01', current_date, p_filters => '{"onboarding_path":"upload"}') where segment = 'all';
  if got <> '1' then raise exception 'onboarding_segments path filter wrong: %', got; end if;
  select users || '/' || consent_coverage into got from analytics.onboarding_segments('2026-10-01', current_date, p_include_internal => true) where segment = 'all';
  if got <> '5/0.7143' then raise exception 'onboarding_segments include_internal wrong: %', got; end if;
  -- Nothing before the onboarding launch.
  select users::text into got from analytics.onboarding_segments('2026-09-01', '2026-10-05') where segment = 'all';
  if got <> '0' then raise exception 'onboarding_segments era cutoff wrong: %', got; end if;

  -- =========================================================================
  -- Import quality (imports 2026-10-10..12 of q1 = TR and q2; q1 exports on 2026-10-12)
  -- =========================================================================
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'imp-1@example.invalid','2026-09-01') returning id into q1;
  insert into public.users(auth_user_id,email,created_at) values(gen_random_uuid(),'imp-2@example.invalid','2026-09-01') returning id into q2;
  insert into public.billing_markets(user_id,market) values(q1,'TR');
  fl := pg_temp.mk_file(q1, 'guests/' || gen_random_uuid() || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,review_context,created_at,updated_at) values(q1,fl,'converted','openai_cv_parser_v1',
    '{"warnings":[],"diagnostics":{"final_stage":"pdfjs_text","quality":{"confidence":"high","low_confidence":false}}}','2026-10-10T10:00:00Z','2026-10-10T10:30:00Z');
  fl := pg_temp.mk_file(q1, 'users/' || q1 || '/cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  insert into public.imports(user_id,source_file_id,status,parser_name,review_context,created_at,updated_at) values(q1,fl,'parsed','smart_docx_parser_v1',
    '{"warnings":["AI parser failed: timeout"],"diagnostics":{"final_stage":"docx_xml_text","quality":{"confidence":"medium","low_confidence":true}}}','2026-10-11T10:00:00Z','2026-10-11T10:00:00Z');
  fl := pg_temp.mk_file(q2, 'users/' || q2 || '/cv.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,review_context,created_at,updated_at) values(q2,fl,'converted','smart_pdf_parser_v2',
    '{"diagnostics":{"final_stage":"pdf_ocr_tesseract","quality":{"confidence":"low","low_confidence":true}}}','2026-10-11T09:00:00Z','2026-10-11T12:00:00Z');
  fl := pg_temp.mk_file(q2, 'users/' || q2 || '/cv.doc', 'application/msword');
  insert into public.imports(user_id,source_file_id,status,error_message,created_at,updated_at) values(q2,fl,'failed','x','2026-10-12T09:00:00Z','2026-10-12T09:00:00Z');
  fl := pg_temp.mk_file(q2, 'users/' || q2 || '/cv2.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,created_at,updated_at) values(q2,fl,'uploaded','2026-10-12T10:00:00Z','2026-10-12T10:00:00Z');
  fl := pg_temp.mk_file(q2, 'users/' || q2 || '/cv3.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,created_at,updated_at) values(q2,fl,'parsed','mock_cv_parser_v1','2026-10-12T11:00:00Z','2026-10-12T11:00:00Z');
  -- Before the diagnostics era: in the all / mime / source rows only.
  fl := pg_temp.mk_file(q1, 'users/' || q1 || '/old.pdf', 'application/pdf');
  insert into public.imports(user_id,source_file_id,status,parser_name,created_at,updated_at) values(q1,fl,'parsed','smart_pdf_parser_v2','2026-09-20T10:00:00Z','2026-09-20T10:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(q1,'M','en','{}','import','2026-09-21T10:00:00Z') returning id into m;
  perform pg_temp.mk_export(q1, null, m, '2026-10-12T15:00:00Z');

  select string_agg(dimension || '=' || pg_temp.t(conversion_rate) || '/' || imports || '/' || parsed || '/' || failed || '/' || stuck || '/'
                    || pg_temp.t(parse_success_rate) || '/' || converted || '/' || pg_temp.t(median_seconds_to_master) || '/' || mature_7d || '/'
                    || pg_temp.t(export_7d_rate) || '/' || users, ' ' order by dimension collate "C")
    into got from analytics.import_quality('2026-10-10', '2026-10-12') where segment in ('all', 'mime', 'source');
  if got <> 'all imports=0.6667/5/3/1/1/0.7500/2/6300/5/0.4000/2 mime: doc=-/1/0/1/0/0.0000/0/-/1/0.0000/1 '
            'mime: docx=0.0000/1/1/0/0/1.0000/0/-/1/1.0000/1 mime: pdf=1.0000/3/2/0/1/1.0000/2/6300/3/0.3333/2 '
            'source: guest_upload=1.0000/1/1/0/0/1.0000/1/1800/1/1.0000/1 source: in_app_upload=0.5000/4/2/1/1/0.6667/1/10800/4/0.2500/2' then
    raise exception 'import_quality rows wrong: %', got;
  end if;
  select string_agg(dimension || '=' || pg_temp.t(conversion_rate) || '/' || imports || '/' || pg_temp.t(parse_success_rate), ' ' order by dimension collate "C")
    into got from analytics.import_quality('2026-09-15', '2026-10-12') where segment not in ('all', 'mime', 'source');
  if got <> 'ai fallback: AI failed -> heuristic=0.0000/1/- ai fallback: none=1.0000/2/- confidence: high=1.0000/1/- confidence: low=1.0000/1/- '
            'confidence: medium=0.0000/1/- final stage: docx_xml_text=0.0000/1/- final stage: pdf_ocr_tesseract=1.0000/1/- final stage: pdfjs_text=1.0000/1/- '
            'low confidence: false=1.0000/1/- low confidence: true=0.5000/2/- parser: ai=1.0000/1/- parser: heuristic=1.0000/1/- '
            'parser: heuristic (after AI fallback)=0.0000/1/-' then
    raise exception 'import_quality quality rows wrong: %', got;
  end if;
  select imports || '/' || parsed into got from analytics.import_quality('2026-09-15', '2026-10-12') where segment = 'all';
  if got <> '6/4' then raise exception 'import_quality wide range wrong: %', got; end if;
  select imports::text into got from analytics.import_quality('2026-10-10', '2026-10-12', p_filters => '{"market":"TR"}') where segment = 'all';
  if got <> '2' then raise exception 'import_quality market filter wrong: %', got; end if;

  -- =========================================================================
  -- Languages (2026-10-14..20): l1 (TR / tr) masters tr + en (the en one saved from a translation), tailored en;
  -- l2 (GLOBAL) master en, tailored de. Translations: l1 -> en failed then completed (applied by the heuristic);
  -- l2 -> tr completed (replaced a master) and pending; a wiped payload; a mock run.
  -- =========================================================================
  insert into public.users(auth_user_id,email,created_at,locale,ai_processing) values(gen_random_uuid(),'lang-1@example.invalid','2026-09-01','tr',true) returning id into l1;
  insert into public.users(auth_user_id,email,created_at,ai_processing) values(gen_random_uuid(),'lang-2@example.invalid','2026-09-01',true) returning id into l2;
  insert into public.billing_markets(user_id,market) values(l1,'TR'),(l2,'GLOBAL');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(l1,'M','tr','{}','scratch','2026-10-14T10:00:00Z') returning id into m;
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(l1,'M','en','{}','scratch','2026-10-15T12:30:00Z') returning id into m;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(l1,m,'T','en','{}','2026-10-16T10:00:00Z');
  insert into public.master_cvs(user_id,title,language,current_content,source_type,created_at) values(l2,'M','en','{}','scratch','2026-10-14T10:00:00Z') returning id into ml2;
  insert into public.tailored_cvs(user_id,master_cv_id,title,language,current_content,created_at) values(l2,ml2,'T','de','{}','2026-10-16T10:00:00Z');
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,output_payload,error_message,started_at,completed_at,total_tokens) values
    (l1,'cv_translate','openai','gpt-6-luna','failed','{"target_language":"en"}',null,'x','2026-10-15T11:00:00Z','2026-10-15T11:05:00Z',null),
    (l1,'cv_translate','openai','gpt-6-luna','completed','{"target_language":"en"}','{}',null,'2026-10-15T12:00:00Z','2026-10-15T12:10:00Z',1000),
    (l2,'cv_translate','openai','gpt-6-luna','completed','{"target_language":"tr"}',jsonb_build_object('applied_master_cv_id', ml2),null,'2026-10-17T10:00:00Z','2026-10-17T10:10:00Z',500),
    (l2,'cv_translate','openai','gpt-6-luna','completed','{}','{}',null,'2026-10-18T10:00:00Z','2026-10-18T10:10:00Z',200),
    (l2,'cv_translate','mock','mock','completed','{"target_language":"tr"}','{}',null,'2026-10-18T10:00:00Z','2026-10-18T10:10:00Z',999);
  insert into public.ai_runs(user_id,flow_type,provider,model_name,status,input_payload,started_at) values
    (l2,'cv_translate','openai','gpt-6-luna','pending','{"target_language":"tr"}','2026-10-19T10:00:00Z');

  select string_agg(dimension || '=' || language_name || '/' || cv_users || '/' || pg_temp.t(user_share) || '/' || master_cvs || '/' || tailored_cvs || '/'
                    || translation_runs || '/' || translations_completed || '/' || translations_failed || '/' || pg_temp.t(translation_success_rate) || '/'
                    || translations_applied || '/' || pg_temp.t(translation_apply_rate) || '/' || translating_users || '/' || translation_tokens, ' ' order by ord)
    into got from (select x.*, row_number() over () as ord from analytics.language_adoption('2026-10-14', '2026-10-20') x) y;
  if got <> 'en=English/2/1.0000/2/1/2/1/1/0.5000/1/1.0000/1/1000 tr=Türkçe/1/0.5000/1/0/2/1/0/1.0000/1/1.0000/1/500 '
            'de=(not in catalog)/1/0.5000/0/1/0/0/0/-/0/-/0/0 (unknown)=(not in catalog)/0/0.0000/0/0/1/1/0/1.0000/0/0.0000/1/200' then
    raise exception 'language_adoption wrong: %', got;
  end if;
  select string_agg(dimension || '=' || cv_users || '/' || translation_runs, ',' order by dimension collate "C") into got
    from analytics.language_adoption('2026-10-14', '2026-10-20', p_filters => '{"locale":"tr"}');
  if got <> 'en=1/2,tr=1/0' then raise exception 'language_adoption locale filter wrong: %', got; end if;

  -- =========================================================================
  -- Contract: arguments, metadata, drill keys
  -- =========================================================================
  begin
    perform * from analytics.tailoring_funnel(p_breakdown => 'plan');
    raise exception 'unsupported breakdown accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform * from analytics.onboarding_segments(p_filters => '{"plan":"pro"}');
    raise exception 'unsupported filter accepted';
  exception when sqlstate '22023' then null;
  end;
  select string_agg(c.name, ',' order by c.name) into got
  from admin_app.metric_catalog() c
  where c.name in ('tailoring_funnel', 'tailoring_task_reliability', 'tailoring_card_acceptance', 'tailoring_questions',
                   'activation_funnel', 'onboarding_segments', 'import_quality', 'language_adoption')
    and c.meta ? 'measures' and c.meta ? 'kb' and c.meta ? 'min_group';
  if got <> 'activation_funnel,import_quality,language_adoption,onboarding_segments,tailoring_card_acceptance,tailoring_funnel,tailoring_questions,tailoring_task_reliability' then
    raise exception 'catalog meta incomplete: %', got;
  end if;
  -- Every numeric column has a measure.
  select string_agg(p.proname || '.' || a.name, ',') into got
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname = 'analytics'
  cross join lateral unnest(p.proargnames, p.proallargtypes::regtype[], p.proargmodes) a(name, typ, mode)
  where p.proname in ('tailoring_funnel', 'tailoring_task_reliability', 'tailoring_card_acceptance', 'tailoring_questions',
                      'activation_funnel', 'onboarding_segments', 'import_quality', 'language_adoption')
    and a.mode = 't' and a.typ in ('bigint'::regtype, 'numeric'::regtype) and a.name <> 'step_order'
    and not (pg_catalog.obj_description(p.oid, 'pg_proc')::jsonb -> 'measures' ? a.name);
  if got is not null then raise exception 'columns without measures: %', got; end if;
  select string_agg(c.name || ':' || (c.meta ->> 'consent_scoped') || ':' || coalesce(c.meta ->> 'drill', 'false'), ',' order by c.name) into got
  from admin_app.metric_catalog() c
  where c.name in ('tailoring_funnel', 'activation_funnel', 'onboarding_segments');
  if got <> 'activation_funnel:false:true,onboarding_segments:true:false,tailoring_funnel:false:true' then
    raise exception 'consent / drill meta wrong: %', got;
  end if;
  select string_agg(dk.key || '>' || (dk.meta ->> 'metric'), ',' order by dk.key) into got
  from admin_app.drill_keys() dk where dk.key in ('tailoring_failed_sessions', 'activation_dropoff');
  if got <> 'activation_dropoff>activation_funnel,tailoring_failed_sessions>tailoring_funnel' then raise exception 'drill keys wrong: %', got; end if;
  select string_agg(dm.key, ',' order by dm.key) into got
  from jsonb_object_keys((select c.meta -> 'drill_metrics' from admin_app.metric_catalog() c where c.name = 'drill_users')) dm(key)
  where dm.key in ('tailoring_failed_sessions', 'activation_dropoff');
  if got <> 'activation_dropoff,tailoring_failed_sessions' then raise exception 'drill_metrics not republished: %', got; end if;

  select string_agg(object_name || ': ' || problem, '; ') into violations from analytics_private.contract_violations();
  if violations is not null then raise exception 'contract violations: %', violations; end if;
end $$;
select 'Analytics tailoring and acquisition metrics, drill-downs and consent scoping passed' as verification;
rollback;
