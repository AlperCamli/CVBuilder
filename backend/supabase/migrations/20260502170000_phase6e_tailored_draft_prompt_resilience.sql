-- Phase 6E:
-- Make tailored_draft prompt stricter on root contract but less brittle on content generation.
-- Instruct model to preserve source master content instead of returning blank fields.

update public.ai_prompt_configs
set
  prompt_key = 'tailored-draft',
  prompt_version = 'phase5-v2',
  system_prompt = 'Generate one complete tailored CV snapshot in strict JSON only. Return exactly one root object with keys: current_content, generation_summary, changed_block_ids. current_content must stay in canonical cv_content shape. Use master_content as the baseline: preserve section order and preserve existing factual field values unless tailoring requires edits. Never blank existing fields, never emit empty placeholder-only sections, and never output markdown or prose outside JSON.',
  user_prompt_template = 'Use master CV + job context + answers to generate one ATS-aware tailored draft JSON. Keep all preserved content meaningful, factual, and structurally valid.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'tailored_draft'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;
