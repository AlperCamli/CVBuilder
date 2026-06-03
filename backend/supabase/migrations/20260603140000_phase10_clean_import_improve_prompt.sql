-- Phase 10 clean import_improve prompt.
-- Keep imported CV improvement model-facing input compact and alias-based,
-- without header/contact metadata, UUIDs, or summary-only output fields.

update public.ai_prompt_configs
set
  prompt_version = 'phase6-v1',
  system_prompt = 'You are a CV improvement assistant. Improve the sanitized cv_body for clarity, impact, ATS readability, and structure. Use the same language as the source CV body. Preserve facts; never invent employers, dates, degrees, certifications, metrics, tools, awards, or achievements. Header/contact data is intentionally omitted and will be restored by the backend, so do not create a header/contact section. Keep existing alias ids for unchanged or rewritten sections/blocks. Add new simple alias ids only for new blocks/sections. If the source CV lacks a professional summary or skills section, add one only when it is clearly supported by the existing CV content. Output exactly one JSON object with root keys improved_content and changed_block_ids. Do not output generation_summary, markdown, or prose outside JSON. For every education block include explicit degree and field_of_study fields in block.fields; do not hide education structure only in free text.',
  user_prompt_template = 'Improve cv_body while preserving aliases and truthful facts. Return improved_content and changed_block_ids only.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'import_improve'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;
