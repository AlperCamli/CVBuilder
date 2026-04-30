# Storage Strategy Note (Phase 4B)

Phase 4B now includes generated export storage and secure download delivery.

## Buckets

Expected buckets:
- `source-uploads`
- `exports`
- `parsed-artifacts` (future write path)

## Implemented in Phase 4B

- generated export files are uploaded to Supabase Storage
- storage path is deterministic:
  - `users/{userId}/tailored-cvs/{tailoredCvId}/exports/{exportId}.{ext}`
  - `users/{userId}/master-cvs/{masterCvId}/exports/{exportId}.{ext}`
- generated metadata rows are persisted in `files`
  - `file_type=export_pdf` / `file_type=export_docx`
- export lifecycle rows are persisted in `exports`
- download delivery uses signed URLs after ownership validation

## Signed URL Behavior

- endpoint: `GET /api/v1/exports/:exportId/download`
- response includes URL and expiration metadata
- expiration controlled by `EXPORT_DOWNLOAD_URL_TTL_SECONDS`

## Ownership and Security

- backend service-layer ownership checks gate all export operations
- signed URL is never issued before ownership + completion checks
- repositories continue user-scoped access patterns

## Deferred

- binary upload proxy endpoint for source files (frontend direct upload path remains valid)
- distributed retry queue for failed exports
- destructive export deletion lifecycle
- signed URL hardening beyond current TTL + ownership checks
