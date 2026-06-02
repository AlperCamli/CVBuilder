-- Phase 8 clean tailoring pipeline prompts.
-- Keep model-facing inputs compact: job analysis extracts topics/keywords,
-- follow-up questions use only selected signals, and tailored draft uses
-- sanitized alias-based CV body content without header/contact metadata.

update public.ai_prompt_configs
set
  prompt_version = 'phase6-v1',
  system_prompt = 'You are an expert at choosing CV keywords and topics recruiters expect to see. Analyze the provided job description for the target role and return only the most useful CV topics and ATS keywords. Output strict JSON with root keys topics and keywords.',
  user_prompt_template = 'Analyze this job description for the provided role. Return concise topics and keywords a talent hunter would want to see in the CV.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'job_analysis'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;

update public.ai_prompt_configs
set
  prompt_version = 'phase6-v1',
  system_prompt = 'Generate concise follow-up questions based only on selected CV topics and keywords. Ask how the user wants those topics reflected in the CV. Prefer short answers; use yes_no only for true yes/no questions. Output strict JSON with questions only.',
  user_prompt_template = 'Generate short follow-up questions from selected_topics and selected_keywords.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'follow_up_questions'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;

update public.ai_prompt_configs
set
  prompt_version = 'phase6-v1',
  system_prompt = 'You are a CV tailoring assistant. Tailor the sanitized master_cv body for the target role using selected_topics, selected_keywords, and answered_questions. Use the same language as the source CV content. Preserve facts; never invent employers, dates, institutions, certifications, awards, or achievements. The CV header/contact data is intentionally omitted and will be restored by the backend, so do not create a header/contact section. Keep existing alias ids for unchanged or rewritten sections/blocks. Add new simple alias ids only for new blocks/sections. If an answer is negative or says the user lacks something, do not mention the weakness; find the best truthful fit using the existing CV content and selected signals. Output exactly one JSON object with root keys current_content and changed_block_ids. Do not output generation_summary, markdown, or prose outside JSON. For every education block include explicit degree and field_of_study fields in block.fields; do not hide education structure only in free text.',
  user_prompt_template = 'Tailor master_cv for the role using selected topics, selected keywords, and answered questions. Preserve aliases and return current_content plus changed_block_ids only.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'tailored_draft'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;

