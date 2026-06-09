# Storage Strategy Note (Phase 4B)

Phase 4B now includes generated export storage and secure download delivery.

## Buckets

Expected buckets:
- `source-uploads`
- `exports`
- `parsed-artifacts` (future write path)
- `cv-assets` (profile photos / user display assets)

> Ops note: the `cv-assets` bucket (configurable via `CV_ASSETS_STORAGE_BUCKET`) must exist
> in the Supabase project, private, with the same user-scoped access posture as the other
> buckets. Photo objects are written under `users/{userId}/avatars/{fileId}.{ext}` and are
> only ever served through short-lived signed URLs.

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

## Profile Photos (CV Assets)

Profile photos are managed files, not inline base64 in the CV content JSON.

- Upload uses the signed direct-to-storage pattern (mirrors imports):
  1. `POST /api/v1/cv-photos/upload-url` validates the content type (PNG/JPEG) and size and
     returns a signed upload target (`file_id`, `storage_bucket`, `storage_path`, `token`).
  2. The client uploads the file straight to storage via `uploadToSignedUrl`.
  3. `POST /api/v1/cv-photos/:fileId/complete` re-validates the stored object (ownership,
     size, PNG/JPEG magic bytes), persists a `files` row (`file_type=avatar`), and returns a
     signed URL.
- `metadata.photo` stores the `files.id` (a managed reference). Legacy CVs may still carry an
  inline `data:` URI; both shapes are supported.
- Display: `GET /api/v1/cv-photos/:fileId/url` returns a fresh signed URL. The rendering
  preview resolves `header.photo` to a signed URL server-side; exports resolve it to a base64
  data URI before PDF/DOCX embedding (the embedders only accept data URIs).
- Removal: `DELETE /api/v1/cv-photos/:fileId` soft-deletes the `files` row and best-effort
  deletes the storage object. Replacing a photo cleans up the previous managed object.
- Only PNG and JPEG are accepted (the export embedders' supported formats). Server-side
  resizing / format normalization (e.g. webp) is intentionally deferred — it would require an
  image-processing dependency.

## Deferred

- binary upload proxy endpoint for source files (frontend direct upload path remains valid)
- server-side profile-photo resizing / re-encoding (e.g. webp → png) via an image library
- orphan sweep for avatar files no longer referenced by any CV revision
- distributed retry queue for failed exports
- destructive export deletion lifecycle
- signed URL hardening beyond current TTL + ownership checks
