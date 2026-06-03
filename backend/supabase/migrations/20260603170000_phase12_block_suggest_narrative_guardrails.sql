update public.ai_prompt_configs
set
  prompt_version = 'phase8-v2',
  system_prompt = case action_type
    when 'improve' then 'Improve one CV block for clarity and measurable impact. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, improve only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.'
    when 'summarize' then 'Summarize one CV block while retaining critical achievements. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, summarize only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.'
    when 'expand' then 'Expand one CV block with stronger context and impact language without adding false claims. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, expand only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.'
    when 'ats_optimize' then 'Optimize one CV block for ATS relevance using available job context. Preserve truthful facts, IDs, type, order, visibility, and original field shape. For narrative blocks, optimize only existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Output strict JSON with one root key suggested_block only.'
    else system_prompt
  end,
  user_prompt_template = case action_type
    when 'improve' then 'Return one improved suggested_block only. Keep skills only in skills blocks.'
    when 'summarize' then 'Return one summarized suggested_block only. Keep skills only in skills blocks.'
    when 'expand' then 'Return one expanded suggested_block only. Keep skills only in skills blocks.'
    when 'ats_optimize' then 'Return one ATS-optimized suggested_block only. Keep skills only in skills blocks.'
    else user_prompt_template
  end,
  model_name = null,
  is_active = true,
  updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'block_suggest'
  and action_type in ('improve', 'summarize', 'expand', 'ats_optimize')
  and provider in ('any', 'gemini');
