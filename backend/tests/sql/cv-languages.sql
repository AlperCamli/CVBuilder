begin;
do $$
declare u uuid; cv uuid;
begin
  insert into public.users(auth_user_id,email) values(gen_random_uuid(),'cv-languages@example.test') returning id into u;
  insert into public.cv_languages(code,name,section_titles,is_active) values('de','Deutsch','{"experience":"Berufserfahrung"}',true),('fr','Français','{}',false),('pt-br','Português (Brasil)','{}',true),('pt-pt','Português (Portugal)','{}',true);
  insert into public.master_cvs(user_id,title,language,current_content,source_type)
    values(u,'Deutsch','de','{"version":"v1","language":"de","metadata":{},"sections":[]}','scratch') returning id into cv;
  begin
    insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Duplicate','DE','{"language":"de"}','scratch');
    raise exception 'duplicate master allowed';
  exception when unique_violation then null; end;
  begin
    insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Disabled','fr','{"language":"fr"}','scratch');
    raise exception 'disabled language allowed';
  exception when raise_exception then if sqlerrm <> 'unsupported_cv_language' then raise; end if; end;
  begin
    insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Mismatch','pt-br','{"language":"pt-pt"}','scratch');
    raise exception 'regional language mismatch allowed';
  exception when raise_exception then if sqlerrm <> 'cv_language_mismatch' then raise; end if; end;
  insert into public.master_cvs(user_id,title,language,current_content,source_type) values(u,'Brazil','pt-br','{"language":"pt-br"}','scratch'),(u,'Portugal','pt-pt','{"language":"pt-pt"}','scratch');
  update public.cv_languages set is_active=false where code='de';
  update public.master_cvs set title='Still editable' where id=cv;
  if has_table_privilege('authenticated','public.cv_languages','UPDATE') or has_table_privilege('anon','public.cv_languages','INSERT') then raise exception 'browser can modify language catalog'; end if;
end $$;
rollback;
select 'Admin CV catalog, disabled languages and regional uniqueness passed' as verification;
