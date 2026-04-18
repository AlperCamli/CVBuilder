# Frontend Integration Note (Phase 4A)

Frontend remains the UI source of truth (React + Vite).  
Phase 4A adds tracker/dashboard/template/rendering contracts for direct binding.

## Auth

All Phase 4A endpoints require:

```http
Authorization: Bearer <supabase_access_token>
```

## Response Handling

Branch on `success`:

```ts
if (!json.success) {
  // json.error.code / json.error.message / json.error.details
}
```

## Dashboard Loading Flow

1) Call `GET /api/v1/dashboard`.
2) Bind:
- `master_cv_summary`
- `tailored_cv_summary.recent_items`
- `jobs_summary.counts_by_status`
- `jobs_summary.recent_items`
- `recent_activity`
3) Optional full feed: `GET /api/v1/dashboard/activity`.

## Job Tracker List + Board Flow

List view:
- `GET /api/v1/jobs`
- use query params for filters/sort/search/pagination:
  - `status`
  - `search`
  - `sort_by`
  - `sort_order`
  - `linked_tailored_cv`
  - `page`, `limit`

Board view:
- `GET /api/v1/jobs/board`
- response already grouped by status with counts.

Job detail:
- `GET /api/v1/jobs/:jobId`
- includes linked tailored CV summary when available.

History panel:
- `GET /api/v1/jobs/:jobId/history`

## Job Status Update Flow

Use status-only endpoint:
- `PATCH /api/v1/jobs/:jobId/status`

Body:

```json
{
  "status": "saved|applied|interview|offer|rejected|archived"
}
```

Response includes:
- updated job detail
- optional `status_history_entry`

Metadata edits (non-status):
- `PATCH /api/v1/jobs/:jobId`

## Template Listing + Selection Flow

Template gallery:
- `GET /api/v1/templates` (active templates)

Template detail:
- `GET /api/v1/templates/:templateId`

Assign to Master CV:
- `PATCH /api/v1/master-cvs/:masterCvId/template`

Assign to Tailored CV:
- `PATCH /api/v1/tailored-cvs/:tailoredCvId/template`

Body:

```json
{
  "template_id": "uuid or null"
}
```

## Preview Loading Flow

Master preview:
- `GET /api/v1/master-cvs/:masterCvId/preview`

Tailored preview:
- `GET /api/v1/tailored-cvs/:tailoredCvId/preview`

Both return:
- canonical `current_content`
- resolved template summary (`selected_template`)
- normalized `rendering` payload
- legacy `preview` payload (for compatibility)

Preferred frontend binding for preview screens:
- use `rendering` as display contract
- keep `current_content` as editor/source state

## Unsaved Preview Flow

For unsaved editor state:
- `POST /api/v1/rendering/preview`

Body:
- `cv_kind`
- raw/unsaved `current_content`
- optional `template_id`
- optional `language`
- optional `context`

Behavior:
- no persistence
- returns normalized `current_content` + `resolved_template` + `rendering`

## Deferred/Out-of-Scope Notes

- PDF/DOCX generation is not implemented in Phase 4A.
- Rendering contract is finalized so export pipelines can be added without frontend contract redesign.
