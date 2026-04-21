# AI Flow Documentation (Phase 5)

## Scope

Phase 5 AI module supports:
- `job_analysis`
- `follow_up_questions`
- `tailored_draft`
- `import_improve` (new)
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
- `GeminiAiProvider` (real runtime)
- `MockAiProvider` (dev/tests)

Runtime selection:
- `AI_PROVIDER=gemini|mock`
- `GEMINI_API_KEY` required when `AI_PROVIDER=gemini`

Failure behavior:
- no silent provider fallback
- provider/runtime/schema failures fail the run and return AI errors
- Gemini provider retries transient upstream errors (`429`, `503`, similar) with bounded backoff before marking run as failed

## Prompt Management

Prompt source:
- DB table `ai_prompt_configs` (profile-driven)

Resolution:
- `AiPromptResolver` loads active rows by `AI_PROMPT_PROFILE`
- chooses by `flow_type`, `provider`, optional `action_type`
- action-specific row wins over flow default row
- in-memory TTL cache avoids per-request DB roundtrips

Fallback path:
- if no DB row is found, registry defaults are used

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
1. resolve prompt/model using resolver + profile
2. create `ai_runs` row (`status=pending`) with flow input + prompt metadata
3. call provider with flow/input/prompt/schema
4. validate provider output against flow Zod schema
5. on success:
   - persist `output_payload`
   - set `status=completed`
6. on failure:
   - persist `status=failed` + `error_message`
   - throw normalized AI error

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
