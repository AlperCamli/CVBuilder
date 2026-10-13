-- CV languages are configured by admins, independently of UI locales.
create table public.cv_languages (
  code text primary key check (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' and length(code) <= 16),
  name text not null check (length(btrim(name)) between 1 and 80),
  direction text not null default 'ltr' check (direction in ('ltr','rtl')),
  section_titles jsonb not null check (jsonb_typeof(section_titles) = 'object'),
  is_active boolean not null default false,
  sort_order integer not null default 0
);
alter table public.cv_languages enable row level security;
revoke all on public.cv_languages from public, anon, authenticated;
grant all on public.cv_languages to service_role;
insert into public.cv_languages(code,name,section_titles,is_active,sort_order) values
('en','English','{"summary":"Professional Summary","experience":"Work Experience","education":"Education","skills":"Skills","languages":"Languages","certifications":"Certifications","courses":"Courses","projects":"Projects","volunteer":"Volunteer Work","awards":"Awards","publications":"Publications","references":"References"}',true,0),
('tr','Türkçe','{"summary":"Profesyonel Özet","experience":"İş Deneyimi","education":"Eğitim","skills":"Beceriler","languages":"Diller","certifications":"Sertifikalar","courses":"Kurslar","projects":"Projeler","volunteer":"Gönüllülük","awards":"Ödüller","publications":"Yayınlar","references":"Referanslar"}',true,1);

create or replace function public.guard_master_language() returns trigger language plpgsql set search_path=public as $$
declare existing uuid; language_key text;
begin
  if coalesce(new.module_type,'standard') <> 'standard' then return new; end if;
  language_key := replace(lower(btrim(new.language)),'_','-');
  if tg_op='INSERT' then
    if not exists(select 1 from public.cv_languages where code=language_key and is_active) then raise exception 'unsupported_cv_language'; end if;
    new.language := language_key;
  end if;
  if tg_op='UPDATE' and new.language is distinct from old.language then raise exception 'cv_language_requires_translation'; end if;
  if new.current_content ? 'language' and replace(lower(btrim(new.current_content->>'language')),'_','-') is distinct from language_key then raise exception 'cv_language_mismatch'; end if;
  if new.is_deleted then return new; end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and old.is_deleted) then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || language_key,0));
    select id into existing from public.master_cvs where user_id=new.user_id and not is_deleted
      and coalesce(module_type,'standard')='standard' and replace(lower(btrim(language)),'_','-')=language_key and id<>new.id limit 1;
    if existing is not null then raise exception 'master_language_exists' using errcode='23505',detail=existing::text; end if;
  end if;
  return new;
end $$;
