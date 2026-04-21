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
    'phase5-v1',
    'Analyze the job description against CV context and return strictly structured JSON. Output must be in English.',
    'Analyze role fit and produce actionable, concise findings.',
    true
  ),
  (
    'phase3-v1',
    'follow_up_questions',
    null,
    'gemini',
    'gemini-2.5-flash',
    'follow-up-questions',
    'phase5-v1',
    'Generate concise follow-up questions for tailoring. Output must be in English and strict JSON.',
    'Generate missing-context questions from job requirements and prior gaps.',
    true
  ),
  (
    'phase3-v1',
    'tailored_draft',
    null,
    'gemini',
    'gemini-2.5-flash',
    'tailored-draft',
    'phase5-v1',
    'Generate a complete tailored CV snapshot while preserving factual integrity. Output must be in English and strict JSON.',
    'Use master CV + job context + answers to generate an ATS-aware tailored draft.',
    true
  ),
  (
    'phase3-v1',
    'import_improve',
    null,
    'gemini',
    'gemini-2.5-flash',
    'import-improve',
    'phase5-v1',
    'Improve imported CV content for clarity and impact without fabricating facts. Output must be in English and strict JSON.',
    'Improve parsed imported content and return full improved content snapshot.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'improve',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-improve',
    'phase5-v1',
    'Improve CV block text for clarity and measurable impact. Output must be in English and strict JSON.',
    'Provide one improved rewrite while preserving factual claims.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'rewrite',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-rewrite',
    'phase5-v1',
    'Rewrite CV block text with stronger wording and clean structure. Output must be in English and strict JSON.',
    'Provide one rewritten variant that remains truthful.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'summarize',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-summarize',
    'phase5-v1',
    'Summarize CV block text while retaining critical achievements. Output must be in English and strict JSON.',
    'Provide one concise summary variant.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'shorten',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-shorten',
    'phase5-v1',
    'Shorten CV block text while keeping key impact signals. Output must be in English and strict JSON.',
    'Provide one compact variant.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'expand',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-expand',
    'phase5-v1',
    'Expand CV block text with stronger context and impact language without adding false claims. Output must be in English and strict JSON.',
    'Provide one expanded variant.',
    true
  ),
  (
    'phase3-v1',
    'block_suggest',
    'options',
    'gemini',
    'gemini-2.5-flash',
    'block-suggest-options',
    'phase5-v1',
    'Generate multiple rewrite options for a CV block. Output must be in English and strict JSON.',
    'Generate concise alternatives with different writing styles.',
    true
  ),
  (
    'phase3-v1',
    'multi_option',
    'options',
    'gemini',
    'gemini-2.5-flash',
    'block-options',
    'phase5-v1',
    'Generate three high-quality alternatives for a CV block. Output must be in English and strict JSON.',
    'Return three options only.',
    true
  ),
  (
    'phase3-v1',
    'block_compare',
    null,
    'gemini',
    'gemini-2.5-flash',
    'block-compare',
    'phase5-v1',
    'Compare CV block text against the job description and return practical gap guidance. Output must be in English and strict JSON.',
    'Provide matched keywords, missing keywords, and concrete guidance.',
    true
  );
