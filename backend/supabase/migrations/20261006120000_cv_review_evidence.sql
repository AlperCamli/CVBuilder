-- Persist extraction evidence independently of editable CV content, and retain
-- the comparison captured when tailoring completed. No generated scores backfilled.
alter table public.imports add column if not exists review_context jsonb;
alter table public.tailored_cvs add column if not exists tailoring_review jsonb;
notify pgrst, 'reload schema';
