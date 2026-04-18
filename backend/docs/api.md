# API Documentation (Phase 3)

Base path:
- `/api/v1`

Response envelope:
- Success: `{ "success": true, "data": ..., "meta"?: ... }`
- Error: `{ "success": false, "error": { "code", "message", "details"? } }`

## Auth Requirement

All Phase 3 endpoints are protected.

```http
Authorization: Bearer <Supabase access token>
```

## Ownership Behavior

All Phase 3 data access is user-scoped.
Users can only access their own:
- `master_cvs`
- `tailored_cvs`
- `jobs`
- `ai_runs`
- `ai_suggestions`
- `cv_block_revisions`

## Common Error Codes

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `AUTH_INVALID_TOKEN`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `AI_PROVIDER_ERROR`
- `AI_FLOW_FAILED`
- `REVISION_NOT_APPLICABLE`
- `SUGGESTION_NOT_APPLICABLE`
- `INTERNAL_ERROR`
- `ROUTE_NOT_FOUND`

---

## AI Job Analysis / Question Flow

1) `POST /ai/job-analysis`

Purpose:
- analyze job description against a master CV

Body:
```json
{
  "master_cv_id": "uuid",
  "job": {
    "company_name": "string",
    "job_title": "string",
    "job_description": "string"
  }
}
```

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "keywords": ["..."],
  "requirements": ["..."],
  "strengths": ["..."],
  "gaps": ["..."],
  "summary": "string",
  "fit_score": 0
}
```

2) `POST /ai/follow-up-questions`

Purpose:
- generate structured follow-up questions for tailoring

Body:
```json
{
  "master_cv_id": "uuid",
  "job": {
    "company_name": "string",
    "job_title": "string",
    "job_description": "string"
  },
  "prior_analysis": {}
}
```

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "questions": [
    {
      "id": "string",
      "question": "string",
      "question_type": "single_choice",
      "choices": [{ "id": "string", "label": "string" }],
      "target_hint": "summary"
    }
  ]
}
```

---

## AI Tailored Draft Flow

3) `POST /ai/tailored-cv-draft`

Purpose:
- generate tailored draft from master CV + job + follow-up answers

Body:
```json
{
  "master_cv_id": "uuid",
  "tailored_cv_id": "uuid",
  "language": "en",
  "template_id": "uuid",
  "job": {
    "company_name": "string",
    "job_title": "string",
    "job_description": "string",
    "job_posting_url": "https://...",
    "location_text": "string",
    "notes": "string"
  },
  "answers": [
    {
      "question_id": "string",
      "answer_text": "string",
      "selected_options": ["..."]
    }
  ]
}
```

Behavior:
- validates `master_cv_id` ownership
- if `tailored_cv_id` exists, reuses it (must belong to same master CV)
- creates or updates linked job context
- persists AI run
- updates `tailored_cvs.current_content` with generated full snapshot
- updates `tailored_cvs.ai_generation_status` (`pending -> completed|failed`)

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "tailored_cv": {
    "id": "uuid",
    "title": "string",
    "language": "en",
    "status": "draft",
    "master_cv_id": "uuid",
    "job_id": "uuid",
    "template_id": "uuid",
    "ai_generation_status": "completed",
    "created_at": "iso",
    "updated_at": "iso",
    "current_content": {},
    "preview": {}
  },
  "job": {
    "id": "uuid",
    "company_name": "string",
    "job_title": "string",
    "status": "saved"
  },
  "generation_metadata": {
    "provider": "mock",
    "model_name": "mock-cv-builder-v1",
    "flow_type": "tailored_draft",
    "prompt_key": "tailored-draft",
    "prompt_version": "phase3-v1",
    "changed_block_ids": ["..."],
    "generation_summary": "string"
  }
}
```

---

## AI Block-Level Suggestions

4) `POST /ai/blocks/suggest`

Purpose:
- generate contextual suggestion(s) for one tailored block

Body:
```json
{
  "tailored_cv_id": "uuid",
  "block_id": "string",
  "action_type": "improve",
  "user_instruction": "string"
}
```

`action_type` values:
- `improve`, `summarize`, `rewrite`, `ats_optimize`, `shorten`, `expand`, `options`

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "suggestion_ids": ["uuid"],
  "suggestions": [
    {
      "id": "uuid",
      "ai_run_id": "uuid",
      "tailored_cv_id": "uuid",
      "block_id": "string",
      "action_type": "improve",
      "option_group_key": null,
      "status": "pending",
      "applied_at": null,
      "created_at": "iso",
      "before_content": {},
      "suggested_content": {},
      "rationale": "string"
    }
  ]
}
```

5) `POST /ai/blocks/compare`

Purpose:
- compare current block vs linked job requirements

Body:
```json
{
  "tailored_cv_id": "uuid",
  "block_id": "string"
}
```

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "comparison_summary": "string",
  "gap_highlights": ["..."],
  "improvement_guidance": ["..."],
  "matched_keywords": ["..."],
  "missing_keywords": ["..."]
}
```

6) `POST /ai/blocks/options`

Purpose:
- generate multiple rewrite options

Body:
```json
{
  "tailored_cv_id": "uuid",
  "block_id": "string",
  "user_instruction": "string",
  "option_count": 3
}
```

Response `data`:
```json
{
  "ai_run_id": "uuid",
  "option_group_key": "string",
  "suggestions": [
    {
      "id": "uuid",
      "action_type": "options",
      "option_group_key": "string",
      "status": "pending",
      "suggested_content": {},
      "rationale": "string"
    }
  ]
}
```

---

## AI Suggestion Apply / Reject

7) `GET /ai/suggestions/:suggestionId`

Response `data`:
```json
{
  "id": "uuid",
  "ai_run_id": "uuid",
  "tailored_cv_id": "uuid",
  "block_id": "string",
  "action_type": "rewrite",
  "option_group_key": null,
  "status": "pending",
  "applied_at": null,
  "created_at": "iso",
  "before_content": {},
  "suggested_content": {}
}
```

8) `POST /ai/suggestions/:suggestionId/apply`

Behavior:
- validates ownership + pending status + applicability
- applies `suggested_content` to target block
- creates revision with `change_source = 'ai'`
- marks suggestion `applied` and sets `applied_at`

Response `data`:
```json
{
  "suggestion": {
    "id": "uuid",
    "status": "applied",
    "applied_at": "iso"
  },
  "tailored_cv_id": "uuid",
  "updated_block": {},
  "section_id": "string"
}
```

9) `POST /ai/suggestions/:suggestionId/reject`

Behavior:
- validates ownership + pending status
- marks suggestion `rejected`
- does not mutate current tailored content

Response `data`:
```json
{
  "suggestion_id": "uuid",
  "status": "rejected"
}
```

10) `GET /tailored-cvs/:tailoredCvId/ai-history`

Purpose:
- list recent AI run and suggestion history for one tailored CV

Response `data`:
```json
{
  "tailored_cv_id": "uuid",
  "ai_runs": [
    {
      "id": "uuid",
      "flow_type": "block_suggest",
      "provider": "mock",
      "model_name": "mock-cv-builder-v1",
      "status": "completed",
      "error_message": null,
      "started_at": "iso",
      "completed_at": "iso"
    }
  ],
  "suggestions": [
    {
      "id": "uuid",
      "ai_run_id": "uuid",
      "tailored_cv_id": "uuid",
      "block_id": "string",
      "action_type": "improve",
      "option_group_key": null,
      "status": "pending",
      "applied_at": null,
      "created_at": "iso"
    }
  ]
}
```

---

## Tailored CV Manual Block Editing

11) `PATCH /tailored-cvs/:tailoredCvId/blocks/:blockId`

Purpose:
- manually patch one tailored CV block

Behavior (Phase 3 change):
- block update succeeds
- backend creates revision (`change_source = 'manual'`)

Body:
```json
{
  "fields": {},
  "meta": {},
  "replace_fields": false
}
```

Response `data`:
```json
{
  "tailored_cv": {},
  "updated_block": {},
  "section_id": "string"
}
```

---

## Revision History Endpoints

12) `GET /tailored-cvs/:tailoredCvId/revisions`

Response `data`:
```json
{
  "tailored_cv_id": "uuid",
  "revisions": [
    {
      "id": "uuid",
      "cv_kind": "tailored",
      "tailored_cv_id": "uuid",
      "block_id": "string",
      "block_type": "string",
      "revision_number": 3,
      "change_source": "manual",
      "ai_suggestion_id": null,
      "created_at": "iso",
      "created_by_user_id": "uuid"
    }
  ]
}
```

13) `GET /tailored-cvs/:tailoredCvId/blocks/:blockId/revisions`

Response `data`:
```json
{
  "tailored_cv_id": "uuid",
  "block_id": "string",
  "revisions": [
    {
      "id": "uuid",
      "revision_number": 2,
      "change_source": "ai",
      "created_at": "iso"
    }
  ]
}
```

14) `GET /revisions/:revisionId`

Response `data`:
```json
{
  "id": "uuid",
  "cv_kind": "tailored",
  "tailored_cv_id": "uuid",
  "block_id": "string",
  "block_type": "summary",
  "revision_number": 2,
  "change_source": "ai",
  "ai_suggestion_id": "uuid",
  "created_at": "iso",
  "created_by_user_id": "uuid",
  "content_snapshot": {}
}
```

15) `POST /revisions/:revisionId/restore`

Behavior:
- loads selected snapshot
- updates current tailored CV block to that snapshot
- creates new revision (`change_source = 'restore'`)

Response `data`:
```json
{
  "tailored_cv_id": "uuid",
  "restored_from_revision_id": "uuid",
  "restored_block": {},
  "section_id": "string",
  "created_revision": {
    "id": "uuid",
    "revision_number": 5,
    "change_source": "restore",
    "block_id": "string"
  }
}
```

16) `POST /revisions/compare`

Body:
```json
{
  "from_revision_id": "uuid",
  "to_revision_id": "uuid"
}
```

Response `data`:
```json
{
  "from_revision": {},
  "to_revision": {},
  "comparison": {
    "same_cv": true,
    "same_block": true,
    "changed_block_type": false,
    "changed_visibility": false,
    "changed_order": false,
    "changed_fields": ["text"],
    "changed_meta": [],
    "before_snapshot": {},
    "after_snapshot": {}
  }
}
```

Note:
- compare payload is practical field-level comparison for Phase 3 (not full semantic diff engine).

---

## Legacy Endpoints

Phase 1/2 endpoints remain active and backward compatible:
- system: `/health`, `/ready`, `/version`
- users/profile/settings/usage: `/me`, `/me/settings`, `/me/usage`
- dashboard endpoints
- master CV CRUD/content/block endpoints
- imports parse/review/convert endpoints
- tailored CV list/detail/content/source/preview endpoints
- jobs get/patch endpoints
