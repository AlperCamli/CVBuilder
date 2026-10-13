-- The review screen saves an import as reviewed before replacing a master.
-- Retain the existing master ID, tailored documents, ownership and revision rules.
create or replace function public.replace_master_from_import(p_user_id uuid,p_master_id uuid,p_import_id uuid,p_content jsonb,p_summary text)
returns public.master_cvs language plpgsql security definer set search_path=public as $$
declare master public.master_cvs; imported public.imports;
begin
  select * into imported from public.imports where id=p_import_id and user_id=p_user_id for update;
  if not found then raise exception 'import_not_found'; end if;
  select * into master from public.master_cvs where id=p_master_id and user_id=p_user_id and not is_deleted for update;
  if not found then raise exception 'master_not_found'; end if;
  if imported.target_master_cv_id=p_master_id and imported.status='converted' then return master; end if;
  if imported.status not in ('parsed','reviewed','converted','needs_review') then raise exception 'import_not_ready'; end if;
  if split_part(replace(lower(master.language),'_','-'),'-',1) is distinct from split_part(replace(lower(p_content->>'language'),'_','-'),'-',1) or coalesce(master.module_type,'standard')<>coalesce(imported.module_type,'standard') then raise exception 'cv_language_mismatch'; end if;
  insert into public.cv_block_revisions(user_id,cv_kind,master_cv_id,block_id,block_type,revision_number,content_snapshot,change_source,created_by_user_id)
  values(p_user_id,'master',p_master_id,'__document__','document',
    coalesce((select max(revision_number) from public.cv_block_revisions where master_cv_id=p_master_id and block_id='__document__'),0)+1,
    master.current_content,'import',p_user_id);
  update public.master_cvs set current_content=p_content,summary_text=p_summary,source_type='import' where id=p_master_id returning * into master;
  update public.imports set target_master_cv_id=p_master_id,status='converted',parsed_content=p_content,error_message=null where id=p_import_id;
  return master;
end $$;
revoke all on function public.replace_master_from_import(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.replace_master_from_import(uuid,uuid,uuid,jsonb,text) to service_role;

notify pgrst, 'reload schema';
