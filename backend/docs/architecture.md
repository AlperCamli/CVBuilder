# Architecture Note (Phase 4A)

## Frozen Decisions (Reconfirmed)

- Frontend remains React + Vite and is the UI source of truth.
- Backend remains TypeScript.
- Supabase remains database/auth/storage.
- Vercel remains deployment target.
- Backend remains a modular monolith.
- Master CV and Tailored CV remain separate concepts and tables.
- Tailored CV remains the core product object.
- Tailored CV snapshots remain full current snapshots.
- Block-level revision compatibility remains intact.
- AI block changes remain apply/reject gated.
- No microservices introduced.

## How Phase 4A Extends Earlier Phases

Phase 4A extends Phase 1-3 without architecture rewrite:
- keeps existing module boundaries and response/error conventions
- replaces placeholder dashboard reads with persisted aggregations
- finalizes jobs tracker endpoints and status transition handling
- adds template metadata module and dedicated template assignment endpoints
- introduces centralized rendering module used by both master/tailored preview endpoints and unsaved preview endpoint

## Module Responsibilities (Phase 4A)

### `jobs`
- tracker list/detail/update endpoints
- status-only transition endpoint
- kanban board grouped payload
- lightweight status transition history (`job_status_history`)
- job-to-tailored linkage visibility in list/detail/board payloads

### `dashboard`
- user-facing summary composition from persisted entities
- counts and recent items for master CVs, tailored CVs, jobs
- counts by job status
- lightweight recent activity feed from existing tables

### `templates`
- active template listing
- template detail retrieval
- template assignment validation rule (`active` required for assignment)
- template resolution support for rendering (selected/default/none)

### `rendering`
- single normalized rendering payload builder
- canonical-content-to-render transformation (no schema redesign)
- template-aware render contract for:
  - frontend preview
  - future PDF export pipeline
  - future DOCX export pipeline

### `master-cv` / `tailored-cv` (extended)
- dedicated template assignment endpoints
- preview endpoints finalized to return:
  - canonical `current_content`
  - resolved template summary
  - normalized rendering payload

## Rendering Contract Rationale

Phase 4A chooses one consistent strategy:
- preview responses return both canonical editor state and normalized rendering payload.

Why:
- frontend keeps direct access to canonical `current_content` (editor compatibility)
- preview/export layers share one stable render contract
- no duplicate transformation logic in controllers
- preserves backward compatibility while enabling future export implementations

## Layering and Data Access

- Routes: auth + validation + endpoint binding.
- Controllers: thin wrappers only.
- Services: ownership checks + business rules + orchestration.
- Repositories: Supabase access only.

All protected operations remain user-scoped in service/repository queries.

## Forward Compatibility

Phase 4A keeps extension paths clean for later phases:
- export execution can consume rendering contract directly
- billing can continue to meter usage/AI/export events
- localization can continue from language fields and structured content
- observability/security hardening can layer on current module boundaries without refactor
