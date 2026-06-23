insert into public.cv_templates (name, slug, status, preview_config, export_config)
values
  (
    'Modern Clean',
    'modern-clean',
    'active',
    '{"preview": "v1"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Minimal Professional',
    'minimal-professional',
    'active',
    '{"preview": "v1"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Executive Timeline',
    'executive-timeline',
    'active',
    '{"preview": "v1", "theme": "dark"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": false}}'::jsonb
  ),
  (
    'Creative Portfolio',
    'creative-portfolio',
    'active',
    '{"preview": "v2", "theme": "light"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": false}}'::jsonb
  ),
  (
    'Academic Classic',
    'academic-classic',
    'active',
    '{"preview": "v1", "theme": "classic"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Academic Serif',
    'latex-academic-serif',
    'active',
    '{"preview": "v1", "theme": "latex", "badges": ["LaTeX"]}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Research CV',
    'latex-research-cv',
    'active',
    '{"preview": "v1", "theme": "latex", "badges": ["LaTeX"]}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Tech Compact',
    'tech-compact',
    'active',
    '{"preview": "v1", "theme": "compact"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
  ),
  (
    'Two Column Modern',
    'two-column-modern',
    'active',
    '{"preview": "v2", "theme": "light"}'::jsonb,
    '{"pdf": {"enabled": true}, "docx": {"enabled": false}}'::jsonb
  ),
  (
    'Template Playground',
    'template-playground',
    'inactive',
    '{"preview": "v1", "theme": "test"}'::jsonb,
    '{"pdf": {"enabled": false}, "docx": {"enabled": false}}'::jsonb
  )
on conflict (slug) do update
set
  name = excluded.name,
  status = excluded.status,
  preview_config = excluded.preview_config,
  export_config = excluded.export_config,
  updated_at = now();

delete from public.ai_prompt_configs
where profile = 'phase3-v1';

insert into public.ai_prompt_configs (
  profile,
  flow_type,
  action_type,
  provider,
  model_name,
  prompt_key,
  prompt_version,
  system_prompt,
  user_prompt_template,
  is_active
)
values
  (
    'phase3-v1',
    'job_analysis',
    null,
    'gemini',
    'gemini-2.5-flash',
    'job-analysis',
    'phase6-v1',
    'You are an expert at choosing CV keywords and topics recruiters expect to see. Analyze the provided job description for the target role and return only the most useful CV topics and ATS keywords. Output strict JSON with root keys topics and keywords.',
    'Analyze this job description for the provided role. Return concise topics and keywords a talent hunter would want to see in the CV.',
    true
  ),
  (
    'phase3-v1',
    'follow_up_questions',
    null,
    'gemini',
    'gemini-2.5-flash',
    'follow-up-questions',
    'phase6-v1',
    'Generate concise follow-up questions based only on selected CV topics and keywords. Ask how the user wants those topics reflected in the CV. Prefer short answers; use yes_no only for true yes/no questions. Output strict JSON with questions only.',
    'Generate short follow-up questions from selected_topics and selected_keywords.',
    true
  ),
  (
    'phase3-v1',
    'tailored_draft',
    null,
    'gemini',
    'gemini-2.5-flash',
    'tailored-draft',
    'phase6-v1',
    'You are a CV tailoring assistant. Tailor the sanitized master_cv body for the target role using selected_topics, selected_keywords, and answered_questions. Use the same language as the source CV content. Preserve facts; never invent employers, dates, institutions, certifications, awards, or achievements. The CV header/contact data is intentionally omitted and will be restored by the backend, so do not create a header/contact section. Keep existing alias ids for unchanged or rewritten sections/blocks. Add new simple alias ids only for new blocks/sections. If an answer is negative or says the user lacks something, do not mention the weakness; find the best truthful fit using the existing CV content and selected signals. Output exactly one JSON object with root keys current_content and changed_block_ids. Do not output generation_summary, markdown, or prose outside JSON. For every education block include explicit degree and field_of_study fields in block.fields; do not hide education structure only in free text.',
    'Tailor master_cv for the role using selected topics, selected keywords, and answered questions. Preserve aliases and return current_content plus changed_block_ids only.',
    true
  ),
  (
    'phase3-v1',
    'import_improve',
    null,
    'gemini',
    'gemini-2.5-flash',
    'import-improve',
    'phase7-v1',
    'Parent orchestration flow for imported CV improvement. The backend fans out block-level improvement, skills generation, and professional summary runs, then returns one improved CV snapshot. This parent flow is not sent to the model.',
    'Orchestrate imported CV improvement using block-level AI runs.',
    true
  ),
  (
    'phase3-v1',
    'professional_summary',
    null,
    'gemini',
    'gemini-2.5-flash',
    'professional-summary',
    'phase1-v1',
    'Write a concise professional CV summary from sanitized cv_body only. Use the same language as the source CV content. Preserve facts; never invent employers, dates, degrees, certifications, metrics, tools, awards, or achievements. Header/contact data is intentionally omitted, so do not include names, email, phone, location, links, or a header. Output strict JSON with one root key summary_text only.',
    'Write one professional summary from cv_body. Return summary_text only.',
    true
  ),
  (
    'phase3-v1',
    'cv_parse',
    null,
    'gemini',
    null,
    'cv-parse',
    'phase5-v1',
    'Parse unstructured raw CV text into strict canonical CV JSON. Use canonical section types only: header, summary, experience, education, skills, languages, certifications, courses, projects, volunteer, awards, publications, references. Use canonical metadata keys only: full_name, headline, email, phone, location, photo, social_links, urls. For awards use issuer. For language entries, map non-proficiency bracket details to certificate instead of proficiency. Never invent facts.',
    'Parse the raw CV text and return canonical cv_content JSON with canonical section names and canonical metadata keys.',
    true
  ),
  (
    'phase3-v1',
    'cv_parse',
    null,
    'any',
    null,
    'cv-parse',
    'phase5-v1',
    'Parse unstructured raw CV text into strict canonical CV JSON. Use canonical section types only: header, summary, experience, education, skills, languages, certifications, courses, projects, volunteer, awards, publications, references. Use canonical metadata keys only: full_name, headline, email, phone, location, photo, social_links, urls. For awards use issuer. For language entries, map non-proficiency bracket details to certificate instead of proficiency. Never invent facts.',
    'Parse the raw CV text and return canonical cv_content JSON with canonical section names and canonical metadata keys.',
    true
  ),
  (
    'phase3-v1',
    'cover_letter_generation',
    null,
    'gemini',
    'gemini-2.5-flash',
    'cover-letter-generation',
    'phase5-v1',
    'Generate concise, high-impact cover letters tailored to the target role and company. Output must be in English and strict JSON. Use real \\n\\n paragraph breaks: salutation line, opening paragraph, body paragraph(s), closing paragraph, then a blank line, then Sincerely, on its own line, then candidate name on its own line.',
    'Generate a tailored cover letter with persuasive and factual language and preserve the required paragraph/newline structure.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'improve',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-improve',
    'phase8-v2',
    'Improve one CV block for clarity and measurable impact. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, improve only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.',
    'Return one improved suggested_block only. Keep skills only in skills blocks.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'summarize',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-summarize',
    'phase8-v2',
    'Summarize one CV block while retaining critical achievements. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, summarize only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.',
    'Return one summarized suggested_block only. Keep skills only in skills blocks.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'expand',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-expand',
    'phase8-v2',
    'Expand one CV block with stronger context and impact language without adding false claims. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, expand only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.',
    'Return one expanded suggested_block only. Keep skills only in skills blocks.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'ats_optimize',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-ats-optimize',
    'phase8-v2',
    'Optimize one CV block for ATS relevance using available job context. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, optimize only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.',
    'Return one ATS-optimized suggested_block only. Keep skills only in skills blocks.',
    true
  );
