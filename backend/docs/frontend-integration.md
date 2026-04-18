# Frontend Integration Note (Phase 3)

Frontend remains the UI source of truth. Backend now supports full AI + revision workflows required for Phase 3.

## Auth

Frontend must attach Supabase access token:

```http
Authorization: Bearer <supabase_access_token>
```

All Phase 3 endpoints are protected.

## Response Handling

Always branch on top-level `success`:

```ts
if (!json.success) {
  // handle json.error.code, json.error.message, json.error.details
}
```

## New Wireable Flows

## 1) Job Analysis Flow

1. Call `POST /api/v1/ai/job-analysis`
2. Use returned `keywords`, `requirements`, `strengths`, `gaps`, `summary`
3. Keep `ai_run_id` for history/diagnostics UI

## 2) Follow-Up Question Flow

1. Call `POST /api/v1/ai/follow-up-questions`
2. Render `questions` by `question_type`
3. Collect answers in frontend state for draft generation

Question types returned:
- `single_choice`
- `multi_select`
- `text`

## 3) Tailored Draft Generation Flow

1. Submit `master_cv_id`, `job`, and collected `answers` to:
   - `POST /api/v1/ai/tailored-cv-draft`
2. Optional: include `tailored_cv_id` to regenerate existing draft
3. Backend returns:
   - `ai_run_id`
   - updated/created `tailored_cv` snapshot
   - linked `job` summary
   - `generation_metadata`

Behavior note for frontend:
- this endpoint is expected to persist full tailored snapshot directly (primary generation flow).

## 4) Block AI Suggestion Flow

For one block:
- `POST /api/v1/ai/blocks/suggest`

For multiple options:
- `POST /api/v1/ai/blocks/options`

For comparison-only insights:
- `POST /api/v1/ai/blocks/compare`

Important:
- suggest/options endpoints do not mutate current tailored content.
- they return persisted pending suggestions.

## 5) Suggestion Apply / Reject Flow

- Detail: `GET /api/v1/ai/suggestions/:suggestionId`
- Apply: `POST /api/v1/ai/suggestions/:suggestionId/apply`
- Reject: `POST /api/v1/ai/suggestions/:suggestionId/reject`

UI expectations:
- `apply` updates block content and creates revision
- `reject` only changes suggestion state
- disable apply/reject actions when suggestion is no longer `pending`

## 6) Manual Block Editing With Revision Side Effects

Manual block patch endpoint remains:
- `PATCH /api/v1/tailored-cvs/:tailoredCvId/blocks/:blockId`

Phase 3 side effect:
- each successful manual block patch creates a block revision automatically

No frontend request shape change is required.

## 7) Revision Browsing and Restore Flow

- list all tailored revisions:
  - `GET /api/v1/tailored-cvs/:tailoredCvId/revisions`
- list revisions for one block:
  - `GET /api/v1/tailored-cvs/:tailoredCvId/blocks/:blockId/revisions`
- load revision detail:
  - `GET /api/v1/revisions/:revisionId`
- restore a revision:
  - `POST /api/v1/revisions/:revisionId/restore`
- compare two revisions:
  - `POST /api/v1/revisions/compare`

Restore behavior:
- restore creates a new revision row; history is preserved.

## 8) Tailored CV AI History Screen

Endpoint:
- `GET /api/v1/tailored-cvs/:tailoredCvId/ai-history`

Use this for:
- recent run timeline
- suggestion status timeline
- debugging/status surfaces

## Pending/Failed State Handling

Draft generation state:
- backend uses `tailored_cv.ai_generation_status` (e.g., `pending`, `completed`, `failed`)

AI run state:
- `ai_runs.status` is `pending | completed | failed`

Suggested UI behavior:
1. show spinner/disabled actions while generation is pending
2. on failure, read normalized error response and show retry CTA
3. keep last successful tailored snapshot until new generation succeeds

## Forward-Compatibility Notes

Current Phase 3 contracts are intentionally stable for upcoming phases:
- export pipeline integration
- billing/metering integration
- localization expansion
- observability/security hardening

Frontend should avoid coupling to internal provider names and treat AI/revision payloads as contract-driven APIs.
