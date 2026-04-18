# Architecture Note (Phase 3)

## Frozen Decisions (Still Applied)

- Frontend remains React + Vite and is the UI source of truth.
- Backend remains TypeScript.
- Supabase remains database/auth/storage backend.
- Deployment target remains Vercel.
- Architecture remains a modular monolith.
- Master CV and Tailored CV remain separate concepts and separate tables.
- Tailored CV remains the core product object.
- Tailored CVs remain stored as full current snapshots.
- AI block edits require explicit apply/reject before mutating current content.
- Block-level revision history is mandatory.
- No microservices introduced.

## Phase 3 Extension Strategy

Phase 3 extends Phase 1+2 without rewriting existing architecture:
- added `ai` module for orchestration, run/suggestion persistence, and flow endpoints
- added `cv-revisions` module for block history and restore/compare
- extended `tailored-cv` service so manual block edits create revisions
- preserved response/error contracts, auth/session handling, and repository-first data access style

## Module Responsibilities

## `ai`

Responsibilities:
- provider abstraction boundary (`AiProvider`)
- flow registry (`flow_type -> prompt config + output contract`)
- orchestration of AI runs with persistence (`ai_runs`)
- structured output validation before completion
- suggestion persistence (`ai_suggestions`) for block-level AI edits
- suggestion apply/reject coordination

Important behavior:
- AI block suggestion endpoints do **not** mutate `tailored_cvs.current_content`.
- Suggestion apply endpoint mutates content and creates revision (`change_source = 'ai'`).
- Suggestion reject endpoint only updates suggestion status.

## `cv-revisions`

Responsibilities:
- centralized revision number allocation
- revision creation for accepted block changes
- list/detail endpoints for revision browsing
- block-level restore endpoint
- compare endpoint for practical diff payload

Important behavior:
- restore is additive: it updates current block snapshot and creates a **new** revision with `change_source = 'restore'`.
- no destructive rollback/event-sourcing behavior introduced.

## `tailored-cv` (extended)

Responsibilities added in Phase 3:
- manual block update endpoint now creates revision (`change_source = 'manual'`)

Unchanged responsibilities:
- tailored current snapshot lifecycle
- source linkage to master CV and job
- list/detail/content preview/source flows

## `master-cv` and `jobs` (reused)

Phase 3 uses:
- `master-cv` read access as tailoring/analysis source
- `jobs` context for AI analysis and comparison flows

## Request and Orchestration Flow

1. Request enters Express and auth middleware resolves user context.
2. Zod validation normalizes inputs.
3. Controller delegates to service.
4. Service enforces ownership and business rules.
5. Repository layer performs Supabase access with user-scoped criteria.
6. AI flows persist `ai_runs` (`pending -> completed|failed`) and optionally `ai_suggestions`.
7. Block mutations create revisions via `cv-revisions` service.
8. Responses return normalized success envelope.
9. Errors are normalized by global middleware.

## AI Flow Architecture

- Distinct flow types: `job_analysis`, `follow_up_questions`, `tailored_draft`, `block_suggest`, `block_compare`, `multi_option`.
- Flow definitions include:
  - prompt key/version
  - system prompt string
  - output schema
- `AiService.executeFlow(...)` centralizes:
  - run creation
  - provider execution
  - output schema validation
  - completed/failed state persistence

This keeps provider logic modular and future-friendly for non-mock providers.

## Revision Architecture

- Revisions stored in `cv_block_revisions`.
- Revision number is per block scope (currently tailored CV block scope in active behavior).
- Snapshot is full block JSON (`content_snapshot`).
- Change sources tracked: `manual`, `ai`, `restore`, with `import/system` reserved for future extension.

## Future Compatibility Preserved

This Phase 3 implementation keeps extension points for later phases without contract rewrites:
- export pipelines can consume stable tailored snapshot + revision history
- billing can meter AI runs/actions from `ai_runs`/`ai_suggestions`
- localization can build on existing language fields and structured content model
- observability/security hardening can be layered over current service boundaries
