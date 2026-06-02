-- Phase 9 auto-applied block suggestions and skills-friendly tailoring prompts.
-- Historical rows for removed flows/actions remain valid; this only changes
-- active prompt configuration used by new AI runs.

update public.ai_prompt_configs
set
  is_active = false,
  updated_at = now()
where profile = 'phase3-v1'
  and (
    flow_type in ('block_compare', 'multi_option')
    or (flow_type = 'block_suggest' and action_type in ('rewrite', 'shorten', 'options'))
  )
  and is_active = true;

update public.ai_prompt_configs
set
  prompt_version = 'phase6-v1',
  system_prompt = 'You are a CV tailoring assistant. Tailor the sanitized master_cv body for the target role using selected_topics, selected_keywords, and answered_questions. Use the same language as the source CV content. Preserve facts; never invent employers, dates, institutions, certifications, awards, or achievements. The CV header/contact data is intentionally omitted and will be restored by the backend, so do not create a header/contact section. Keep existing alias ids for unchanged or rewritten sections/blocks. Add new simple alias ids only for new blocks/sections. If the source CV has no skills section, you may add a concise Skills section using selected keywords/topics that are truthful skill signals. If an answer is negative or says the user lacks something, do not mention the weakness; find the best truthful fit using the existing CV content and selected signals. Output exactly one JSON object with root keys current_content and changed_block_ids. Do not output generation_summary, markdown, or prose outside JSON. For every education block include explicit degree and field_of_study fields in block.fields; do not hide education structure only in free text.',
  user_prompt_template = 'Tailor master_cv for the role using selected topics, selected keywords, and answered questions. Preserve aliases and return current_content plus changed_block_ids only.',
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'tailored_draft'
  and action_type is null
  and provider in ('any', 'gemini')
  and is_active = true;

update public.ai_prompt_configs
set
  prompt_version = 'phase8-v1',
  system_prompt = case action_type
    when 'improve' then 'Improve one CV block for clarity and measurable impact. Preserve truthful facts, IDs, type, order, and visibility. Output strict JSON with one root key suggested_block only.'
    when 'summarize' then 'Summarize one CV block while retaining critical achievements. Preserve truthful facts, IDs, type, order, and visibility. Output strict JSON with one root key suggested_block only.'
    when 'expand' then 'Expand one CV block with stronger context and impact language without adding false claims. Preserve truthful facts, IDs, type, order, and visibility. Output strict JSON with one root key suggested_block only.'
    when 'ats_optimize' then 'Optimize one CV block for ATS relevance using available job context. Preserve truthful facts, IDs, type, order, and visibility. Output strict JSON with one root key suggested_block only.'
    else system_prompt
  end,
  user_prompt_template = case action_type
    when 'improve' then 'Return one improved suggested_block only.'
    when 'summarize' then 'Return one summarized suggested_block only.'
    when 'expand' then 'Return one expanded suggested_block only.'
    when 'ats_optimize' then 'Return one ATS-optimized suggested_block only.'
    else user_prompt_template
  end,
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'block_suggest'
  and action_type in ('improve', 'summarize', 'expand', 'ats_optimize')
  and provider in ('any', 'gemini');

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
select
  'phase3-v1',
  'block_suggest',
  'ats_optimize',
  'gemini',
  null,
  'block-suggest-ats-optimize',
  'phase8-v1',
  'Optimize one CV block for ATS relevance using available job context. Preserve truthful facts, IDs, type, order, and visibility. Output strict JSON with one root key suggested_block only.',
  'Return one ATS-optimized suggested_block only.',
  true
where not exists (
  select 1
  from public.ai_prompt_configs
  where profile = 'phase3-v1'
    and flow_type = 'block_suggest'
    and action_type = 'ats_optimize'
    and provider = 'gemini'
    and is_active = true
);
