# Storage Strategy Note (Phase 2)

Storage is now integrated for import metadata + parser source reads.

## Buckets

Expected buckets:
- `source-uploads`
- `exports` (future write path)
- `parsed-artifacts` (future write path)

## What Phase 2 Implements

- backend persists uploaded source file metadata in `files`
- import sessions reference source files through `imports.source_file_id`
- parse step downloads source file from Supabase Storage using stored `storage_bucket` + `storage_path`

## What Phase 2 Does Not Implement Yet

- upload binary proxy endpoint (frontend can upload directly)
- generated exports storage flow (`export_pdf`, `export_docx` rows reserved only)
- parsed-artifact file generation pipeline
- signed-url lifecycle hardening

## Forward Compatibility

`files.file_type` and linkage model are already compatible with:
- export generation storage
- parser artifacts
- avatar/media ownership tracking
