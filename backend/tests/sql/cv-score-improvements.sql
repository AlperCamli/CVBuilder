-- Improvement score storage and the cv_review_verify flow (20261109120000_cv_score_improvements.sql).
begin;
do $$
declare
  a uuid := gen_random_uuid(); u uuid; other uuid; f uuid; imp uuid; row_id uuid; run uuid; leaked text; job uuid;
begin
  -- Backend only: RLS on, no policies, no browser privileges of any kind.
  if not (select relrowsecurity from pg_class where oid = 'public.cv_score_improvements'::regclass) then
    raise exception 'cv_score_improvements has RLS disabled';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cv_score_improvements') then
    raise exception 'cv_score_improvements has a browser policy';
  end if;
  select string_agg(format('%s:%s', r.role, p.privilege), ', ') into leaked
  from (values ('anon'), ('authenticated')) r(role)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
  where has_table_privilege(r.role, 'public.cv_score_improvements', p.privilege);
  if leaked is not null then raise exception 'browser privileges on cv_score_improvements: %', leaked; end if;

  insert into public.users(auth_user_id, email) values (a, 'score-improvement@example.invalid') returning id into u;
  insert into public.users(auth_user_id, email) values (gen_random_uuid(), 'score-other@example.invalid') returning id into other;
  insert into public.files(user_id, file_type, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
    values (u, 'source_upload', 'imports', 'users/' || u || '/imports/cv.pdf', 'cv.pdf', 'application/pdf', 20) returning id into f;
  insert into public.imports(user_id, source_file_id, status, parsed_content) values (u, f, 'parsed', '{}') returning id into imp;

  -- The verify run is a tracked user flow linked to the upload; unknown flows stay rejected.
  insert into public.ai_runs(user_id, import_id, flow_type, provider, model_name, status, input_payload)
    values (u, imp, 'cv_review_verify', 'openai', 'test-model', 'pending', '{}') returning id into run;
  begin
    insert into public.ai_runs(user_id, flow_type, provider, model_name, status, input_payload)
      values (u, 'cv_review_verify_v2', 'openai', 'test-model', 'pending', '{}');
    raise exception 'unknown flow type accepted';
  exception when check_violation then null; end;

  -- The service role stores a score that never goes down and stays within 0-100.
  set local role service_role;
  insert into public.cv_score_improvements(user_id, import_id, score_before, score_after, review_after)
    values (u, imp, 62, 71, '{"version":"cv-review-v2","method":"ai","score":71}') returning id into row_id;
  begin
    insert into public.cv_score_improvements(user_id, import_id, score_before, score_after, review_after) values (u, imp, 70, 69, '{}');
    raise exception 'a lower score was stored';
  exception when check_violation then null; end;
  begin
    insert into public.cv_score_improvements(user_id, import_id, score_before, score_after, review_after) values (u, imp, 90, 101, '{}');
    raise exception 'a score above 100 was stored';
  exception when check_violation then null; end;
  reset role;

  -- The owner's browser session can neither read nor write it.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  begin
    perform 1 from public.cv_score_improvements;
    raise exception 'browser read cv_score_improvements';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.cv_score_improvements(user_id, score_before, score_after, review_after) values (u, 1, 2, '{}');
    raise exception 'browser wrote cv_score_improvements';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Deleting the upload keeps the score and clears its link.
  delete from public.ai_runs where id = run;
  delete from public.imports where id = imp;
  if (select import_id from public.cv_score_improvements where id = row_id) is not null then raise exception 'import link not cleared'; end if;

  -- A late result for a restricted account is rejected.
  perform public.set_privacy_restriction(u, null, true);
  begin
    insert into public.cv_score_improvements(user_id, score_before, score_after, review_after) values (u, 50, 55, '{}');
    raise exception 'restricted account stored a score';
  exception when others then if sqlerrm <> 'privacy_subject_unavailable' then raise; end if; end;
  perform public.set_privacy_restriction(u, null, false);

  -- Erasure (privacy.service.ts order): the table is deleted before imports, then the account.
  insert into public.imports(user_id, source_file_id, status, parsed_content) values (u, f, 'parsed', '{}') returning id into imp;
  insert into public.cv_score_improvements(user_id, import_id, score_before, score_after, review_after) values (u, imp, 40, 48, '{}');
  job := public.request_account_erasure(u, a);
  begin
    insert into public.cv_score_improvements(user_id, score_before, score_after, review_after) values (u, 48, 50, '{}');
    raise exception 'score stored after the deletion request';
  exception when others then if sqlerrm <> 'privacy_subject_unavailable' then raise; end if; end;
  delete from public.cv_score_improvements where user_id = u;
  delete from public.imports where user_id = u;
  delete from public.files where user_id = u;
  delete from public.users where id = u;
  if exists (select 1 from public.cv_score_improvements where user_id = u) then raise exception 'erasure left scores behind'; end if;

  -- Deleting an account directly cascades too, including rows still linked to an upload.
  insert into public.files(user_id, file_type, storage_bucket, storage_path, original_filename, mime_type, size_bytes)
    values (other, 'source_upload', 'imports', 'users/' || other || '/imports/cv.pdf', 'cv.pdf', 'application/pdf', 20) returning id into f;
  insert into public.imports(user_id, source_file_id, status, parsed_content) values (other, f, 'parsed', '{}') returning id into imp;
  insert into public.cv_score_improvements(user_id, import_id, score_before, score_after, review_after) values (other, imp, 30, 35, '{}');
  delete from public.imports where id = imp;
  delete from public.files where id = f;
  delete from public.users where id = other;
  if exists (select 1 from public.cv_score_improvements where user_id = other) then raise exception 'account delete left scores behind'; end if;
end $$;
rollback;
select 'CV score improvements: backend-only storage, monotone scores, import unlinking and erasure passed' as verification;
