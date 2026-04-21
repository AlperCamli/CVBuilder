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
