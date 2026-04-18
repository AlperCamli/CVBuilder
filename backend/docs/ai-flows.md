# AI Flow Documentation (Phase 3)

## Scope

Phase 3 AI module supports:
- job analysis
- follow-up question generation
- tailored draft generation
- block suggestion generation
- block-to-job comparison
- multi-option block rewrites

## Flow Types

Persisted `ai_runs.flow_type` values used now:
- `job_analysis`
- `follow_up_questions`
- `tailored_draft`
- `block_suggest`
- `block_compare`
- `multi_option`

Reserved flow types kept in schema for forward compatibility:
- `summary`
- `improve`

## Provider Abstraction

Boundary:
- `AiProvider` interface in `src/modules/ai/provider/ai-provider.ts`

Current provider:
- `MockAiProvider`

Selection:
- `createAiProvider(config)` uses env-driven provider selection
- current supported value: `AI_PROVIDER=mock`

Why this matters:
- controllers/services do not embed provider-specific code
- future provider can be added by implementing `AiProvider` without endpoint contract changes

## Flow Registry

Location:
- `src/modules/ai/flows/flow-registry.ts`

Each flow definition includes:
- `flow_type`
- `prompt_key`
- `prompt_version`
- `system_prompt`
- `output_schema` (Zod)

This provides organized prompt/config metadata and strict output parsing contracts.

## Structured Contracts

Output schemas live in:
- `src/modules/ai/flows/flow-contracts.ts`

Examples:
- job analysis: keywords/requirements/strengths/gaps/summary/fit score
- follow-up questions: typed question objects with optional choices
- tailored draft: full `current_content` snapshot + generation metadata
- block suggestion: suggestion variants with `suggested_block`
- block compare: summary + matched/missing keyword arrays + guidance

## Orchestration Lifecycle

`AiService.executeFlow(...)` does:
1. create `ai_runs` row with `status = pending`
2. execute provider with flow metadata + shaped input payload
3. validate provider output against flow schema
4. on success:
   - persist normalized output into `ai_runs.output_payload`
   - set `status = completed` + `completed_at`
5. on failure:
   - set `status = failed` + `error_message` + `completed_at`
   - return normalized AI failure error to API layer

## Suggestion Persistence Model

For suggestion-producing flows:
- backend creates `ai_suggestions` rows with `status = pending`
- `before_content` stores snapshot at generation time
- `suggested_content` stores suggested block payload
- no immediate CV mutation happens

Apply path:
- validates pending state and applicability
- mutates target block in `tailored_cvs.current_content`
- creates block revision (`change_source = 'ai'`)
- marks suggestion `applied`

Reject path:
- marks suggestion `rejected`
- does not mutate tailored content

## Follow-Up Answer Model Decision

Phase 3 decision:
- answers are sent in request payload to `/ai/tailored-cv-draft`
- answers are also persisted in `ai_runs.input_payload.flow_input.answers`

Result:
- draft generation remains stateless from frontend perspective
- backend still keeps auditable run inputs for debugging/replay

## Failure Handling

- Provider/runtime/schema failures are normalized and returned without raw internals.
- `ai_runs` failure rows are persisted where run creation succeeded.
- Tailored draft flow sets `tailored_cvs.ai_generation_status = failed` when generation fails.

## Known Limitations (Phase 3)

- Provider is mock/rule-based for now.
- Prompt configs are code-based, not DB-managed yet.
- Block compare is practical keyword-based analysis, not full semantic scorer.
- No asynchronous job queue/background workers yet.

## Extension Points (Next Phases)

- add real provider implementations under same `AiProvider` contract
- externalize prompt/config versioning
- introduce provider fallback/ensemble strategies
- add richer traceability/observability around token usage and latency
