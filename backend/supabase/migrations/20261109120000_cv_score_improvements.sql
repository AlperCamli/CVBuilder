-- Improvement score (backend/docs/cv-scoring.md, "Improvement score"). After "Improve with AI"
-- the backend recomputes the upload's CV score on top of its stored review. A tracked AI run
-- (flow_type cv_review_verify, code-only prompt, so ai_prompt_configs is unchanged) checks which
-- review issues the rewrite resolved, and each result is kept in cv_score_improvements.
begin;

alter table public.ai_runs drop constraint if exists ai_runs_flow_type_check;
alter table public.ai_runs add constraint ai_runs_flow_type_check check (flow_type in
 ('block_compare','multi_option','job_analysis','follow_up_questions','tailored_draft','block_suggest','skills_pool','import_improve','professional_summary','summary','improve','cv_parse','cv_review','cv_review_verify','cover_letter_generation','cv_translate','tailoring_analysis','tailoring_block','tailoring_skills','tailoring_structure'));

-- One row per improvement score. review_after is the recomputed review (same shape as the
-- stored CvReview). The import link is cleared, not cascaded, when the upload is deleted.
create table public.cv_score_improvements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  import_id uuid references public.imports(id) on delete set null,
  score_before integer not null check (score_before between 0 and 100),
  score_after integer not null check (score_after between score_before and 100),
  review_after jsonb not null,
  created_at timestamptz not null default now()
);
create index cv_score_improvements_user_created_idx on public.cv_score_improvements (user_id, created_at desc);
create index cv_score_improvements_import_idx on public.cv_score_improvements (import_id) where import_id is not null;

-- Backend only: RLS on with no policies, and no browser grants at all.
-- Privacy: the data download lists this table (privacy.service.ts OWNED_TABLES) and account
-- erasure deletes it before imports. The guard runs on insert only, so a late result for an
-- account pending deletion or restricted is rejected, while the FK's own "set null" when an
-- upload is deleted (an update) is never blocked.
alter table public.cv_score_improvements enable row level security;
revoke all on public.cv_score_improvements from public, anon, authenticated;
grant all on public.cv_score_improvements to service_role;

create trigger privacy_subject_write before insert on public.cv_score_improvements
for each row execute function public.reject_deleted_subject_write();

comment on table public.cv_score_improvements is 'CV score before and after Improve with AI, computed by the backend on top of the stored upload review (cv-scoring.md, Improvement score).';
comment on column public.cv_score_improvements.review_after is 'The recomputed CV review (same shape as imports.review_context.cv_review), with a limitation noting the AI improvement.';

commit;
