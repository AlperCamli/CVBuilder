# Architecture Note (Phase 4B)

## Frozen Decisions (Reconfirmed)

- Frontend remains React + Vite and is the UI source of truth.
- Backend remains TypeScript.
- Supabase remains database/auth/storage.
- Vercel remains deployment target.
- Backend remains modular monolith.
- Master CV and Tailored CV remain separate concepts/tables.
- Tailored CV remains the core product object.
- Tailored CV snapshots remain full current snapshots.
- Rendering contract remains the shared preview/export input contract.
- No microservices introduced.

## How Phase 4B Extends Earlier Phases

Phase 4B extends Phase 1-4A without redesign:
- keeps route/controller/service/repository layering
- keeps existing error envelope + auth/session model
- keeps template assignment and rendering resolution behavior
- adds export persistence + storage delivery as additive modules

## Module Responsibilities (Phase 4B)

### `exports`
- create export records (`processing -> completed|failed`)
- coordinate rendering, generation, storage, file metadata, completion/failure transitions
- expose export list/detail/download API contracts
- enforce one-off template override for export requests
- enforce template export capability checks from `template.export_config`

### `files`
- deterministic export storage path generation
- upload/delete storage object operations
- generated file metadata persistence in `files`
- signed URL creation (only after ownership checks in exports service)

### `rendering` (reused)
- single source of normalized render payload
- export services consume rendering payload directly
- no ad hoc controller-level content mapping for PDF/DOCX

### `templates` + `tailored-cv` (reused)
- template validation/resolution for export overrides and inherited template behavior
- tailored ownership, content snapshot source, `last_exported_at` updates

## Export Orchestration Rationale

Shared lifecycle for both PDF and DOCX:
1. Validate ownership and template input.
2. Create export row as `processing`.
3. Build rendering payload through `rendering` module.
4. Generate format bytes in generator layer.
5. Upload bytes to Supabase Storage.
6. Create `files` metadata row.
7. Mark export `completed` with `file_id`, `template_id`, `completed_at`.
8. Update `tailored_cvs.last_exported_at`.

Failure handling:
- update export row to `failed` with safe error message
- best-effort storage and metadata cleanup
- never leave a fake `completed` state without a valid file link

## Download Strategy

Chosen strategy: signed URL after ownership check.

- API endpoint: `GET /api/v1/exports/:exportId/download`
- response includes `download_url`, `expires_at`, `expires_in_seconds`
- expiration configured by `EXPORT_DOWNLOAD_URL_TTL_SECONDS`
- backend streaming is intentionally not used in Phase 4B

## Deferred by Design

- distributed async export worker/queue
- automatic retry orchestration
- destructive export deletion (`DELETE /exports/:exportId`)
- billing/localization/observability/security hardening features
