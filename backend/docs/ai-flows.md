# AI Flow Documentation (Phase 5)

## Scope

Phase 5 AI module supports:
- `job_analysis`
- `follow_up_questions`
- `tailored_draft`
- `import_improve` (new)
- `cv_parse` (new)
- `cover_letter_generation` (new)
- `block_suggest`
- `block_compare`
- `multi_option`

Additional reserved flow types in schema:
- `summary`
- `improve`

## Provider Runtime

Provider boundary:
- `AiProvider` interface in `src/modules/ai/provider/ai-provider.ts`

Implemented providers:
- `GeminiAiProvider` (real runtime, Google `@google/genai`)
- `OpenAiAiProvider` (real runtime, OpenAI `openai` SDK, Chat Completions + `json_schema` response format)
- `AnthropicAiProvider` (real runtime, `@anthropic-ai/sdk`, Messages API + structured outputs)
- `MockAiProvider` (dev/tests)

Runtime selection:
- `AI_PROVIDER=gemini|openai|anthropic|mock` — exactly one provider is active per deployment
- `GEMINI_API_KEY` required when `AI_PROVIDER=gemini`
- `OPENAI_API_KEY` required when `AI_PROVIDER=openai` (models: `AI_OPENAI_MODEL_LIGHT`/`AI_OPENAI_MODEL_HEAVY`, defaults `gpt-5.6-luna`/`gpt-5.6-terra`)
- `ANTHROPIC_API_KEY` required when `AI_PROVIDER=anthropic` (models: `AI_ANTHROPIC_MODEL_LIGHT`/`AI_ANTHROPIC_MODEL_HEAVY`, defaults `claude-haiku-4-5`/`claude-sonnet-5`)
- OpenAI/Anthropic retry/timeout/output caps come from the shared `AI_REQUEST_MAX_ATTEMPTS`, `AI_RETRY_BASE_DELAY_MS`, `AI_RETRY_MAX_DELAY_MS`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS_LIGHT`, `AI_MAX_OUTPUT_TOKENS_HEAVY` env vars (see `docs/environment.md`)

Shared provider behavior (`src/modules/ai/provider/provider-shared.ts`):
- heavy/light model routing per flow type (`tailored_draft`, `cv_parse`, `professional_summary` -> heavy)
- system/user prompt assembly with the prompt-injection guard around `input_payload`
- one controlled JSON recovery pass (fenced-block extraction, balanced-brace scan, trailing-comma repair, schema-preferred candidate selection)

Provider-specific notes:
- OpenAI: strict `json_schema` response format is enforced server-side whenever the flow schema is strict-compatible (closed objects, all properties required — e.g. `job_analysis`, `follow_up_questions`); other flows fall back to non-strict advisory schemas with Zod validation + recovery. `reasoning_effort` (default `low`, via `AI_OPENAI_REASONING_EFFORT`) limits GPT-5.x reasoning-token burn against the output cap, and `finish_reason=length` truncation fails fast with reason `output_truncated_by_token_limit` instead of surfacing as a contract-validation error. Model refusals surface as non-retryable `AiProviderError`s.
- Anthropic: structured outputs (`output_config.format`) enforce the schema after sanitization (constraint keywords stripped, objects closed). Flows whose schemas contain record-style objects (e.g. `cv_parse`) fall back to a prompt-embedded schema plus the recovery pass, because Anthropic structured outputs require closed objects. `refusal`/`max_tokens` stop reasons surface as explicit errors; `529 overloaded` is retryable and triggers heavy->light fallback.

Failure behavior:
- no silent provider fallback
- provider/runtime/schema failures fail the run and return AI errors
- Gemini retries are controlled by `AI_GEMINI_MAX_ATTEMPTS` (default `3`)
- on transient model-unavailable failures (`503/UNAVAILABLE`), Gemini provider can fall back heavy->light model once
- non-JSON responses get one controlled JSON recovery pass (extract + repair) before failing
- hard quota-exceeded `429 RESOURCE_EXHAUSTED` errors are treated as non-retryable
- each attempt has a per-call hard timeout (`AI_GEMINI_REQUEST_TIMEOUT_MS`, default `60000`); timeouts surface as retryable `504` errors
- `safetySettings` are set to `BLOCK_NONE` for all four standard harm categories so CV content (names, locations, demographic context) does not trip safety filters
- output is capped per tier via `AI_GEMINI_MAX_OUTPUT_TOKENS_LIGHT` / `AI_GEMINI_MAX_OUTPUT_TOKENS_HEAVY` to make truncation explicit instead of silent

Retry tuning env vars:
- `AI_GEMINI_MAX_ATTEMPTS` (default `3`)
- `AI_GEMINI_RETRY_BASE_DELAY_MS` (default `1000`)
- `AI_GEMINI_RETRY_MAX_DELAY_MS` (default `16000`)
- `AI_GEMINI_REQUEST_TIMEOUT_MS` (default `60000`)
- `AI_GEMINI_MAX_OUTPUT_TOKENS_LIGHT` (default `4096`)
- `AI_GEMINI_MAX_OUTPUT_TOKENS_HEAVY` (default `16384`)
- `AI_GEMINI_MODEL_LIGHT` (default `gemini-2.5-flash-preview`)
- `AI_GEMINI_MODEL_HEAVY` (default `gemini-3-flash`)

Static model tier routing:
- Heavy: `tailored_draft`, `import_improve`, `multi_option`, `cv_parse`
- Light: `job_analysis`, `follow_up_questions`, `block_suggest`, `block_compare`, `summary`, `improve`, `cover_letter_generation`

## Prompt Management

Prompt source:
- DB table `ai_prompt_configs` (profile-driven)

Resolution:
- `AiPromptResolver` loads active rows by `AI_PROMPT_PROFILE`
- chooses by `flow_type`, `provider`, optional `action_type`
- action-specific row wins over flow default row
- in-memory TTL cache avoids per-request DB roundtrips

Fallback path:
- non-production: if no DB row is found, registry defaults are used
- production: missing prompt rows fail resolution and startup coverage check fails boot

Prompt metadata persisted in `ai_runs.input_payload.prompt`:
- `prompt_key`
- `prompt_version`
- `provider`
- `model_name`
- resolved `system_prompt`
- resolved `user_prompt`

Language rule:
- AI prompts enforce English output.

## Flow Registry and Contracts

Registry:
- `src/modules/ai/flows/flow-registry.ts`

Each flow definition includes:
- `flow_type`
- `prompt_key`
- `prompt_version`
- `system_prompt`
- `output_schema` (Zod)

Output contracts:
- `src/modules/ai/flows/flow-contracts.ts`

Key outputs:
- `tailored_draft`: full `current_content` + `generation_summary` + `changed_block_ids`
- `import_improve`: full `improved_content` + `generation_summary` + `changed_block_ids`
- `block_suggest`/`multi_option`: structured suggestion variants with `suggested_block`
- `block_compare`: summary + matched/missing keywords + guidance

## Orchestration Lifecycle

`AiService.executeFlow(...)`:
1. resolve prompt using resolver + profile and deterministic tier model
2. create `ai_runs` row (`status=pending`, `progress_stage=queued`) with flow input + prompt metadata
3. update stages through lifecycle:
   - `building_prompt`
   - `calling_model`
   - `parsing_output`
   - `validating_output`
   - `persisting_result`
4. validate provider output against strict flow Zod schema
5. on success:
   - persist structured `output_payload`
   - set `status=completed`, `progress_stage=completed`
6. on failure:
   - persist `status=failed`, `progress_stage=failed`, `error_message`
   - persist sanitized debug metadata in `debug_payload` (including raw-output excerpt only on parse/provider failures)
   - throw normalized AI error

Tailoring lifecycle endpoints (polling):
- `POST /ai/tailoring-runs/start`
- `POST /ai/tailoring-runs/:aiRunId/execute`
- `GET /ai/tailoring-runs/:aiRunId/status`
- `GET /ai/tailoring-runs/:aiRunId/result`

## Suggestion and Apply Model (Master + Tailored)

Suggestion generation:
- supported for master or tailored targets
- target payload requires exactly one of:
  - `master_cv_id`
  - `tailored_cv_id`

Persistence:
- suggestion rows stay `pending` until user action
- `before_content` stores pre-AI snapshot
- `suggested_content` stores AI block variant

Apply:
- validates pending status and stale-content check
- replaces target block in current CV content
- tailored apply also writes `cv_block_revisions` (`change_source='ai'`)
- marks suggestion `applied`

Reject:
- marks suggestion `rejected`
- no content mutation

## Import Improve Flow

Endpoint:
- `POST /ai/import-improve`

Behavior:
- accepts parsed CV content (+ optional guidance)
- runs `import_improve` flow
- returns improved content + generation metadata
- import flow then persists improved parsed content before master CV conversion

## Cover Letter Generation Flow

Endpoint:
- `POST /ai/cover-letters/generate`

Behavior:
- accepts either `tailored_cv_id` or `master_cv_id` as CV context
- generates structured `{ title, content }` output via `cover_letter_generation`
- records one AI action usage on successful completion

## Version History Chains (Committed States)

Endpoints:
- `GET /tailored-cvs/:tailoredCvId/ai-block-versions`
- `GET /master-cvs/:masterCvId/ai-block-versions`

Chain builder source:
- applied suggestions only (`status='applied'`)

Chain composition per block:
- initial `original` snapshot (from first `before_content`)
- `manual_pre_ai` snapshot only when `before_content` differs from prior version
- each `ai_applied` snapshot from `suggested_content`

Excluded:
- pending/rejected variants

Result:
- fast preloaded block chains for instant client prev/next navigation

## Where AI Flows Run (Code Map)

HTTP routes:
- `src/modules/ai/ai.routes.ts`

Controller boundary:
- `src/modules/ai/ai.controller.ts`

Flow orchestration and persistence:
- `src/modules/ai/ai.service.ts`

Provider runtime:
- `src/modules/ai/provider/gemini-ai-provider.ts`
- `src/modules/ai/provider/openai-ai-provider.ts`
- `src/modules/ai/provider/anthropic-ai-provider.ts`
- `src/modules/ai/provider/provider-shared.ts`
- `src/modules/ai/provider/mock-ai-provider.ts`
- `src/modules/ai/provider/create-ai-provider.ts`

Flow definitions and strict output contracts:
- `src/modules/ai/flows/flow-registry.ts`
- `src/modules/ai/flows/flow-contracts.ts`

Prompt resolution:
- `src/modules/ai/prompts/prompt-resolver.ts`
- `src/modules/ai/prompts/prompt-config.repository.ts`

Prompt seed source:
- `supabase/seed.sql`

## Prompt Ops Runbook (No Admin UI)

Check active prompt rows for current profile:

```sql
select profile, flow_type, action_type, provider, model_name, prompt_key, prompt_version
from public.ai_prompt_configs
where profile = 'phase3-v1'
  and is_active = true
order by flow_type, action_type nulls first;
```

If this returns zero rows, runtime falls back to `flow-registry.ts` defaults.
In production, missing required rows for the active profile/provider fails boot.
Migration `20260731120000_ai_multi_provider_prompts.sql` clones the active
`gemini` rows to `openai` and `anthropic` (with `model_name` null so each
provider resolves its own env-configured model), so switching `AI_PROVIDER`
does not require re-seeding prompts. Provider-specific prompt tuning can later
override these rows per provider.

Apply migrations and seed prompts to linked environment:

```bash
supabase db push
supabase db query --linked -f supabase/seed.sql
```

Update prompts via SQL (example pattern):

```sql
update public.ai_prompt_configs
set system_prompt = '...new prompt...',
    prompt_version = 'phase5-v2',
    updated_at = now()
where profile = 'phase3-v1'
  and flow_type = 'follow_up_questions'
  and action_type is null
  and provider = 'gemini'
  and is_active = true;
```

Prompt changes are picked up by `AiPromptResolver` cache after TTL (30s) or process restart.
