-- Phase 6D:
-- Harden tailored_draft prompt contract for strict structured output and
-- preserve env-driven runtime model selection.

update public.ai_prompt_configs
set
  prompt_key = 'tailored-draft',
  prompt_version = 'phase5-v1',
  system_prompt = 'Generate one complete tailored CV snapshot in strict JSON only. Output must contain exactly one root object with current_content, generation_summary, and changed_block_ids. current_content must be a canonical CV content object with non-empty sections, each section containing non-empty blocks, and each block containing fields. Preserve the source master CV section structure/order while tailoring wording to the job and answers. Do not emit placeholder-only or repeated sections. Do not add markdown fences or prose outside JSON.',
  user_prompt_template = 'Use master CV + job context + answers to generate one ATS-aware tailored draft JSON. Keep full content meaningful, structured, and valid.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'tailored_draft'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;
