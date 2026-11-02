-- CV review v2: the onboarding score's content criteria are rated by a tracked AI run
-- (flow_type cv_review). Its prompt lives only in code, so ai_prompt_configs is unchanged.
begin;

alter table public.ai_runs drop constraint if exists ai_runs_flow_type_check;
alter table public.ai_runs add constraint ai_runs_flow_type_check check (flow_type in
 ('block_compare','multi_option','job_analysis','follow_up_questions','tailored_draft','block_suggest','skills_pool','import_improve','professional_summary','summary','improve','cv_parse','cv_review','cover_letter_generation','cv_translate','tailoring_analysis','tailoring_block','tailoring_skills','tailoring_structure'));

commit;
