# API Documentation (Phase 4A)

Base path:
- `/api/v1`

All Phase 4A endpoints are protected:

```http
Authorization: Bearer <supabase_access_token>
```

## Response Envelope

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

## Common Error Codes

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `AUTH_INVALID_TOKEN`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `INTERNAL_ERROR`

Template/rule violations use normalized validation or not-found errors.

## Ownership Behavior

All reads/writes are user-scoped. Users only access their own:
- jobs
- master CVs
- tailored CVs
- preview data
- dashboard activity derived from their entities

---

## Jobs / Tracker

### 1) `GET /jobs`

Purpose:
- list current user jobs for tracker

Query:
- `status?: saved|applied|interview|offer|rejected|archived`
- `search?: string` (company/job title contains)
- `sort_by?: created_at|updated_at|company_name|job_title|status|applied_at`
- `sort_order?: asc|desc`
- `linked_tailored_cv?: boolean`
- `page?: number` (default `1`)
- `limit?: number` (default `20`, max `100`)

`data`:
- `items[]` job summaries
- `page`
- `limit`
- `total`

Job summary fields:
- `id`
- `company_name`
- `job_title`
- `status`
- `job_posting_url`
- `location_text`
- `tailored_cv_id`
- `tailored_cv_title`
- `created_at`
- `updated_at`
- `applied_at`

### 2) `GET /jobs/:jobId`

Purpose:
- tracker detail screen payload

`data`:
- `job` (summary fields above)
- `job_description`
- `notes`
- `linked_tailored_cv` (`id`, `title`, `status`, `updated_at`) or `null`
- `status_last_changed_at`

### 3) `PATCH /jobs/:jobId`

Purpose:
- update job metadata (non-status)

Body:

```json
{
  "company_name": "optional",
  "job_title": "optional",
  "job_description": "optional",
  "job_posting_url": "optional or null",
  "location_text": "optional or null",
  "notes": "optional or null"
}
```

`data`:
- same shape as `GET /jobs/:jobId`

### 4) `PATCH /jobs/:jobId/status`

Purpose:
- status-only transition endpoint

Body:

```json
{
  "status": "saved|applied|interview|offer|rejected|archived"
}
```

Behavior:
- validates ownership
- records status history row in `job_status_history` when status changes
- sets `applied_at` if moving to `applied` and previously null

`data`:
- `job` (same as `GET /jobs/:jobId`)
- `status_history_entry` or `null` when unchanged

### 5) `GET /jobs/board`

Purpose:
- kanban-friendly grouped job payload

Query:
- `search?`
- `sort_by?`
- `sort_order?`
- `linked_tailored_cv?`

`data`:
- `groups[]` each item:
  - `status`
  - `count`
  - `items[]` (job summaries)
- `counts_by_status` object
- `total`

### 6) `GET /jobs/:jobId/history`

Purpose:
- return status transition history

`data`:
- `job_id`
- `current_status`
- `current_status_updated_at`
- `history[]`:
  - `id`
  - `from_status`
  - `to_status`
  - `changed_at`
  - `changed_by_user_id`

---

## Dashboard

### 7) `GET /dashboard`

Purpose:
- product-focused home dashboard payload

`data`:
- `user_summary` (`id`, `email`, `full_name`)
- `current_plan`
- `usage_summary`
- `master_cv_summary`
  - `total_count`
  - `primary_master_cv` or `null`
- `tailored_cv_summary`
  - `total_count`
  - `recent_items[]`
- `jobs_summary`
  - `total_count`
  - `counts_by_status`
  - `recent_items[]`
- `recent_activity[]`
- `locale`
- `onboarding_completed`

### 8) `GET /dashboard/activity`

Purpose:
- lightweight activity feed

`data`:
- `activity[]` items:
  - `id`
  - `type` (`tailored_cv_created|tailored_cv_updated|ai_suggestion_applied|revision_restored|job_status_changed`)
  - `message`
  - `timestamp`
  - `related_entity` (`kind`, `id`, `title`)

---

## Templates

### 9) `GET /templates`

Purpose:
- list active templates for user-facing selection

`data`:
- `templates[]`:
  - `id`
  - `name`
  - `slug`
  - `status`
  - `preview_config`
  - `export_config`
  - `created_at`
  - `updated_at`

### 10) `GET /templates/:templateId`

Purpose:
- get template detail metadata

`data`:
- `template` (same fields as list item)

### 11) `PATCH /master-cvs/:masterCvId/template`

Purpose:
- assign/unassign template for a Master CV

Body:

```json
{
  "template_id": "uuid or null"
}
```

Behavior:
- ownership check on master CV
- template existence and `active` status validation for non-null values

`data`:
- updated master CV detail

### 12) `PATCH /tailored-cvs/:tailoredCvId/template`

Purpose:
- assign/unassign template for a Tailored CV

Body:

```json
{
  "template_id": "uuid or null"
}
```

Behavior:
- ownership check on tailored CV
- template existence and `active` status validation for non-null values

`data`:
- updated tailored CV detail

---

## Rendering / Preview

### 13) `GET /master-cvs/:masterCvId/preview`

Purpose:
- finalized master preview contract

`data`:
- `cv` metadata
- `current_content` (canonical)
- `preview` (legacy plain preview)
- `selected_template` (resolved template summary with resolution mode)
- `rendering` (normalized render payload)

### 14) `GET /tailored-cvs/:tailoredCvId/preview`

Purpose:
- finalized tailored preview contract

`data`:
- `cv` metadata
- `linked_job` summary or `null`
- `current_content` (canonical)
- `preview` (legacy plain preview)
- `selected_template` (resolved template summary with resolution mode)
- `rendering` (normalized render payload)

### 15) `POST /rendering/preview`

Purpose:
- preview payload from unsaved/raw content without persistence

Body:

```json
{
  "cv_kind": "master|tailored",
  "current_content": {},
  "template_id": "uuid or null",
  "language": "optional",
  "context": {}
}
```

Behavior:
- normalizes incoming content
- resolves template (selected/default/none)
- does not write to DB

`data`:
- `current_content` (normalized canonical payload)
- `resolved_template`
- `rendering`
