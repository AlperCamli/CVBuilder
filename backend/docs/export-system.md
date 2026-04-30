# Export System (Phase 4B)

## Scope

Phase 4B implements:
- Master + tailored CV export persistence (`exports` table)
- PDF generation pipeline
- DOCX generation pipeline
- Supabase Storage upload + `files` metadata persistence
- signed URL download flow

Out of scope in this phase:
- distributed async workers/retry queue
- export delete/revoke endpoint
- non-Tailored-CV preview-file export helper endpoint

## Lifecycle

For both PDF and DOCX:
1. Validate target CV ownership (`master` or `tailored`).
2. Create `exports` row (`status=processing`).
3. Resolve template (one-off request override or CV/default fallback).
4. Build rendering payload via `rendering` module.
5. Generate format bytes in generator layer.
6. Upload bytes to Supabase Storage (`exports` bucket).
7. Create generated file metadata row in `files`.
8. Mark export row `completed` with `file_id`, `completed_at`, resolved `template_id`.
9. Update `tailored_cvs.last_exported_at` when target is tailored.

Failure behavior:
- export row is transitioned to `failed`
- safe `error_message` is persisted
- best-effort cleanup runs for uploaded object and metadata
- no completed state is returned on failure

## PDF Path

- input: normalized rendering payload (`rendering.version=v1`)
- generator: `pdf-lib`
- output: A4, wrapped text, section headings, bullet lines
- template awareness: minimal style tokens (heading/accent colors by template slug/export config)

## DOCX Path

- input: normalized rendering payload (`rendering.version=v1`)
- generator: `docx`
- output: semantic Word structure (title, headings, paragraphs, bullets)
- template awareness: minimal style tokens (heading/accent colors by template slug/export config)

## Template Resolution Rules

- Request `template_id` is one-off only and does not mutate CV template assignment.
- If request `template_id` is provided, it must be assignable (`active`).
- If not provided, export uses target CV assigned template (inactive allowed for compatibility) or rendering fallback default active template.
- `exports.template_id` stores the template actually used for that export (`null` when none).
- `template.export_config` is checked per format (`pdf`/`docx`); disabled format is rejected.

## Storage + File Metadata Rules

- bucket: `EXPORTS_STORAGE_BUCKET` (default `exports`)
- deterministic path:
  - `users/{userId}/tailored-cvs/{tailoredCvId}/exports/{exportId}.{ext}`
  - `users/{userId}/master-cvs/{masterCvId}/exports/{exportId}.{ext}`
- metadata persistence:
  - `files.file_type=export_pdf` for PDF
  - `files.file_type=export_docx` for DOCX

## Download Strategy

Chosen strategy: signed URLs only.

Download endpoint:
- `GET /api/v1/exports/:exportId/download`

Response fields:
- `download_url`
- `expires_at`
- `expires_in_seconds`

Expiration behavior:
- TTL from `EXPORT_DOWNLOAD_URL_TTL_SECONDS` (default `600` seconds)
- owner check occurs before signed URL creation

## Known Limitations (Phase 4B)

- preview/export pixel parity is best-effort, not guaranteed
- DOCX output prioritizes semantic usability over exact visual fidelity
- synchronous export execution may have higher request latency for large documents
- no automatic retry queue yet
- no delete/revoke API yet
