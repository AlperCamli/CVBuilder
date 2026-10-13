-- Replace only a reviewed, successful translation. No master is deleted.
-- The previous document and the applied-run marker commit with the replacement.
create function public.replace_master_from_translation(p_user_id uuid,p_master_id uuid,p_run_id uuid,p_summary text)
returns public.master_cvs language plpgsql security definer set search_path=public as $$
declare
  translated public.ai_runs;
  master public.master_cvs;
  content jsonb;
  language_key text;
begin
  select * into translated from public.ai_runs where id=p_run_id and user_id=p_user_id and flow_type='cv_translate' for update;
  if not found then raise exception 'translation_not_found'; end if;
  content := translated.output_payload->'current_content';
  if translated.status<>'completed' or jsonb_typeof(content) is distinct from 'object' or jsonb_typeof(content->'sections') is distinct from 'array' then
    raise exception 'translation_not_ready';
  end if;
  if translated.master_cv_id=p_master_id then raise exception 'cannot_replace_translation_source'; end if;
  language_key := replace(lower(btrim(translated.input_payload->>'target_language')),'_','-');
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || language_key,0));
  -- Use the same row order even when two languages are translated into each other.
  perform id from public.master_cvs where user_id=p_user_id and id in (translated.master_cv_id,p_master_id) order by id for update;
  if not exists(select 1 from public.master_cvs where id=translated.master_cv_id and user_id=p_user_id and not is_deleted and coalesce(module_type,'standard')='standard') then
    raise exception 'translation_source_not_found';
  end if;
  select * into master from public.master_cvs where id=p_master_id and user_id=p_user_id and not is_deleted;
  if not found then raise exception 'master_not_found'; end if;
  if coalesce(master.module_type,'standard')<>'standard' or replace(lower(btrim(master.language)),'_','-') is distinct from language_key
    or replace(lower(btrim(content->>'language')),'_','-') is distinct from language_key then
    raise exception 'cv_language_mismatch';
  end if;
  if translated.output_payload ? 'applied_master_cv_id' then
    if translated.output_payload->>'applied_master_cv_id' is distinct from p_master_id::text then raise exception 'translation_already_applied'; end if;
    return master;
  end if;
  if not exists(select 1 from public.cv_languages where code=language_key and is_active) then raise exception 'unsupported_cv_language'; end if;
  insert into public.cv_block_revisions(user_id,cv_kind,master_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,created_by_user_id)
  values(p_user_id,'master',p_master_id,'__document__','document',
    coalesce((select max(revision_number) from public.cv_block_revisions where master_cv_id=p_master_id and block_id='__document__'),0)+1,
    master.current_content,'ai',p_user_id);
  update public.master_cvs set current_content=content,summary_text=p_summary,
    template_id=nullif(translated.input_payload->'source'->>'template_id','')::uuid,
    source_type=coalesce(translated.input_payload->'source'->>'source_type','scratch')
    where id=p_master_id returning * into master;
  update public.ai_runs set output_payload=output_payload || jsonb_build_object('applied_master_cv_id',p_master_id) where id=p_run_id;
  return master;
end $$;
revoke all on function public.replace_master_from_translation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.replace_master_from_translation(uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
