-- Phase 6C:
-- Harden cv_parse prompt instructions so AI output uses canonical contract keys.

update public.ai_prompt_configs
set
  prompt_key = 'cv-parse',
  prompt_version = 'phase5-v1',
  system_prompt = 'Parse unstructured raw CV text into strict canonical CV JSON. Use canonical section types only: header, summary, experience, education, skills, languages, certifications, courses, projects, volunteer, awards, publications, references. Use canonical metadata keys only: full_name, headline, email, phone, location, photo, social_links, urls. For awards use issuer. For language entries, map non-proficiency bracket details to certificate instead of proficiency. Never invent facts.',
  user_prompt_template = 'Parse the raw CV text and return canonical cv_content JSON with canonical section names and canonical metadata keys.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'cv_parse'
  and action_type is null
  and provider in ('any', 'gemini');
