-- Multi-provider AI support: clone active Gemini prompt rows for the OpenAI and
-- Anthropic providers so the production prompt-profile boot guard passes when
-- AI_PROVIDER is switched. Prompts are provider-agnostic today; model_name is
-- left null so each provider resolves its own light/heavy model from env config.

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
  src.profile,
  src.flow_type,
  src.action_type,
  new_provider.provider,
  null,
  src.prompt_key,
  src.prompt_version,
  src.system_prompt,
  src.user_prompt_template,
  true
from public.ai_prompt_configs src
cross join (values ('openai'), ('anthropic')) as new_provider(provider)
where src.provider = 'gemini'
  and src.is_active = true
  and not exists (
    select 1
    from public.ai_prompt_configs existing
    where existing.profile = src.profile
      and existing.flow_type = src.flow_type
      and coalesce(existing.action_type, '') = coalesce(src.action_type, '')
      and existing.provider = new_provider.provider
      and existing.is_active = true
  );
