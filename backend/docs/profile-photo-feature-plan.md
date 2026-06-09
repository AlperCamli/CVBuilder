# Profile Photo Feature — Implementation Plan

> Status: **Implemented.** Profile photos are now managed files (bucket `cv-assets`,
> `file_type=avatar`) referenced by `metadata.photo` (a `files.id`), replacing the inline
> base64 approach. Preview resolves the reference to a signed URL server-side; exports
> resolve it to a base64 data URI before embedding. Legacy inline `data:` photos still work.
>
> **Decisions taken during implementation (vs. the original options in §15):**
> - **Upload mechanism:** signed direct-to-storage upload + a `complete` validation step
>   (not a base64 proxy). The global `express.json()` body limit (100 kb) makes proxying
>   multi-MB images impractical, and this mirrors the existing import upload flow.
> - **Reference shape:** `metadata.photo` stores the `files.id` (Option A).
> - **Image processing:** **no** server-side resize/normalize dependency was added. Only
>   **PNG/JPEG** are accepted (validated by magic bytes); other formats are rejected up front
>   so they can never silently drop at export. Resizing / webp→png normalization remains a
>   documented follow-up (would require an image library such as `sharp`).
> - **Entitlements:** ungated.
> - **Cleanup:** best-effort storage delete + `files` soft-delete on remove/replace; an
>   orphan sweep for files still referenced by old revisions is deferred.
>
> **Requires provisioning:** the `cv-assets` Supabase Storage bucket (private) must exist,
> with user-scoped RLS consistent with the other buckets. Configurable env:
> `CV_ASSETS_STORAGE_BUCKET`, `CV_PHOTO_MAX_BYTES`, `CV_PHOTO_URL_TTL_SECONDS`.
>
> The remainder of this document is the original design write-up, kept for context.

---

## 1. Context & the problem

The CV editor already has a "Profile Photo" control in the Header section, but it is only
superficially wired up:

- [frontend/src/app/components/CVSections.tsx](frontend/src/app/components/CVSections.tsx#L75-L84) —
  `handlePhotoUpload` reads the selected file with `FileReader.readAsDataURL` and stores the
  **entire image as a base64 data URI string** in `data.photo`.
- That string is mapped verbatim into the CV content as `metadata.photo`
  ([frontend/src/app/integration/cv-mappers.ts](frontend/src/app/integration/cv-mappers.ts#L1233)
  on write, [:2006](frontend/src/app/integration/cv-mappers.ts#L2006) on header build,
  [:1256](frontend/src/app/integration/cv-mappers.ts#L1256) on metadata round-trip).
  The frontend type is `metadata.photo: string | null`
  ([api-types.ts:364](frontend/src/app/integration/api-types.ts#L364)).
- Rendering copies it onto the presentation header:
  `header.photo = toMetadataString(metadata.photo)`
  ([rendering-presentation.ts:1102](backend/src/modules/rendering/rendering-presentation.ts#L1102)).
- The live preview renders `<img src={header.photo}>`
  ([CVPresentationPreview.tsx:310-322](frontend/src/app/components/CVPresentationPreview.tsx#L310-L322)).
- Both exporters accept **only a base64 data URI**, and only `png`/`jpeg`:
  - PDF: `parseDataUriImage` regex `^data:(image/(png|jpeg|jpg));base64,…`
    ([pdf-generator.ts:229](backend/src/modules/exports/generators/pdf-generator.ts#L229)).
  - DOCX: same shape via `parseDataUriImage`
    ([docx-generator.ts:22-31](backend/src/modules/exports/generators/docx-generator.ts#L22-L31)).
  - The export document mapper only forwards the photo if it is a data URI:
    `photo_data_uri: isDataUriImage(header.photo) ? header.photo : null`
    ([rendering-document.mapper.ts:103,146](backend/src/modules/exports/generators/rendering-document.mapper.ts#L103-L146)).

### Why this is "not really implemented"

Storing the image inline as base64 inside the versioned CV content JSON causes real
problems:

1. **Payload & DB bloat.** A 1 MB photo becomes a ~1.4 MB string that is saved on every
   autosave, returned on every CV load, and **duplicated into every revision snapshot**
   (see [revision-system.md](backend/docs/revision-system.md)).
2. **Sent everywhere unnecessarily.** The image string travels into AI flows (tailored
   draft / import-improve operate on `current_content`), inflating tokens and latency.
3. **No validation or processing.** There is no size cap, dimension cap, MIME allow-list,
   cropping, or compression. `accept="image/*"` lets a user pick `webp`/`gif`/`heic`, which
   the exporters then silently **drop** (only png/jpeg pass `isDataUriImage`), so the photo
   shows in the editor preview but vanishes in the PDF/DOCX — a parity break.
4. **No reuse / lifecycle.** The image cannot be reused across CVs or cover letters, and
   there is no cleanup path.

The good news: the architecture already anticipated this. The `files` table + `FilesService`
storage abstraction exist, and the `FileType` union **already includes `"avatar"`**
([domain.ts:207-213](backend/src/shared/types/domain.ts#L207-L213)) — it is simply unused for
storage today (only referenced as an allowed header field name in the import canonicalizer
[import-content-canonicalizer.ts:914-920](backend/src/modules/imports/import-content-canonicalizer.ts#L914-L920)
and AI coercion allow-lists).

---

## 2. Goals & non-goals

**Goals**
- Profile photo persists as a managed file in object storage, not inline in CV JSON.
- The photo renders identically in the **editor preview, PDF, and DOCX** (preview/export
  parity — see [preview-export-parity.md](backend/docs/preview-export-parity.md)).
- Server-side validation (type, size, dimensions) and normalization so exports never
  silently drop a photo.
- Existing CVs that still carry an inline data-URI photo keep working (backward compatible).
- Reuse the established storage, signed-URL, ownership/RLS, and `files`-table patterns
  rather than inventing new ones.

**Non-goals (out of scope for v1)**
- In-browser cropping/zoom UI (can be a follow-up; plan leaves room for it).
- Per-template "show/hide photo" toggle UI (noted under Templates; header already drives it).
- Sharing one photo across multiple CVs as a managed asset library.

---

## 3. Current architecture (as-is) data flow

```
[Editor] FileReader.readAsDataURL ──► data.photo (base64 data URI)
   └─ cv-mappers ──► metadata.photo (string, in versioned CV content JSON)
        ├─ buildRendering ──► presentation.header.photo
        │     ├─ Preview: <img src={header.photo}>            (works: data URI)
        │     └─ Export mapper: photo_data_uri (only if data URI) ──► pdf/docx embed
        └─ stored in master_cvs.current_content + every revision snapshot
```

The only persistence is "inside the CV content JSON". There is **no `files` row, no storage
object, no signed URL** involved for photos today.

---

## 4. Target architecture (to-be)

Store the photo as an object in Supabase Storage, track it in the `files` table with
`file_type = 'avatar'`, and keep only a **stable reference** in `metadata.photo`. Resolve
that reference to a **signed URL** for the preview and to a **data URI** at export time
(because the PDF/DOCX generators require a data URI).

```
[Editor] pick file ──► POST photo to backend (proxy upload, see §6.1)
   backend: validate + normalize (resize, re-encode png/jpeg)
            ──► upload to storage bucket (FilesService)
            ──► insert files row (file_type='avatar')
            ──► return { file_id, signed_url }
   editor sets metadata.photo = <reference>   (NOT base64)

[Load/Preview]  metadata.photo (reference) ──► resolve to signed URL ──► <img src>
[Export]        metadata.photo (reference) ──► backend downloads bytes ──► data URI
                 ──► existing pdf/docx embed path (unchanged)
```

### Reuse these existing building blocks
- `FilesService` — `buildExportStoragePath`-style deterministic paths, `uploadExportObject`
  (storage write), `createExportFileMetadata` (`files` row), `createSignedDownloadAccess`
  (signed URL), `deleteStorageObject` + `softDeleteFileMetadata` (cleanup)
  ([files.service.ts](backend/src/modules/files/files.service.ts)). Generalize the
  export-specific helpers (or add avatar-specific siblings) — see §6.
- `FilesRepository` — `uploadStorageObject`, `createSignedUrl`/`createSignedDownloadUrl`,
  `createFile`, `findById`, `softDeleteById`, `deleteStorageObject`
  ([files.repository.ts](backend/src/modules/files/files.repository.ts)).
- Signed-upload pattern (if chosen over proxy) from imports:
  `createSignedUploadUrl(bucket, path)` → frontend
  `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`
  ([imports.repository.ts:236-256](backend/src/modules/imports/imports.repository.ts#L236-L256),
  [UploadProcessing.tsx:45-55](frontend/src/app/pages/UploadProcessing.tsx#L45-L55)).
- `FileType = 'avatar'` already exists ([domain.ts:212](backend/src/shared/types/domain.ts#L212)).

---

## 5. Storage & data-model decisions

### 5.1 Bucket & path
- **Bucket:** add a dedicated bucket, e.g. `cv-assets` (private), configured via env like the
  existing `EXPORTS_STORAGE_BUCKET`
  ([env.ts:32,191](backend/src/shared/config/env.ts#L32)). Alternatively reuse
  `source-uploads` (already listed in [storage-strategy.md](backend/docs/storage-strategy.md#L5-L10)).
  Recommendation: a new `cv-assets` bucket keeps user-supplied display assets separate from
  raw import sources and generated exports.
- **Path convention** (mirrors the deterministic `users/{userId}/…` scheme used for exports
  and imports): `users/{userId}/avatars/{fileId}.{ext}`.

### 5.2 What goes in `metadata.photo`
`metadata.photo` should stop holding base64. Pick one reference representation:

| Option | `metadata.photo` value | Pros | Cons |
|---|---|---|---|
| **A. File id (recommended)** | `files.id` (UUID) | Stable; ownership re-checkable; cleanup-friendly; URL never stale in stored content | Requires a resolve step on read for both preview and export |
| B. Storage path | `cv-assets/users/{u}/avatars/{f}.png` | Self-describing | Leaks layout; still needs signing; weaker ownership linkage |
| C. Signed URL | `https://…?token=…` | Zero resolve step | **Expires** → stored content rots; not viable |

Use **Option A (file id)** and resolve to a signed URL at the edges. Keep the field a plain
string so the content schema is unchanged; document the two accepted shapes:
`data:image/...` (legacy inline) **or** a `files.id`. Detection: a `data:` prefix ⇒ legacy
inline path; otherwise ⇒ managed-file reference.

> Note: `metadata.photo` is not currently documented in
> [content-model.md](backend/docs/content-model.md#L12-L20) (the metadata example omits it).
> Update that doc to formally include `photo` and its accepted shapes.

### 5.3 `files` row
- `file_type = 'avatar'`, `storage_bucket = cv-assets`, `storage_path` per §5.1,
  `mime_type` (`image/png` or `image/jpeg` after normalization), `size_bytes`, `checksum`.
- RLS is user-scoped (see [authorization-rls.md](backend/docs/authorization-rls.md)); the
  `files` repository already enforces `user_id` scoping.

---

## 6. Backend work

### 6.1 Upload mechanism — decision

Two viable approaches; **recommend the backend proxy** for photos:

- **(Recommended) Backend proxy upload.** New authenticated endpoint accepts the raw image
  (multipart or a size-capped base64/body), then validates, **normalizes** (re-encode to
  png/jpeg, resize to a max edge, strip EXIF), uploads via `FilesService`, writes the `files`
  row, and returns `{ file_id, signed_url }`. Rationale: photos are small (cap ~5 MB), and we
  *need* server-side processing + format normalization so exports never drop the image. This
  centralizes the "always a safe png/jpeg" guarantee.
- **(Alternative) Signed direct upload**, mirroring imports
  ([UploadProcessing.tsx](frontend/src/app/pages/UploadProcessing.tsx#L45-L55)): issue a
  signed upload URL, frontend uploads directly, then a `finalize` call validates/normalizes
  server-side by downloading the object. More moving parts; only worth it if very large
  uploads or zero-proxy bandwidth is a hard requirement.

### 6.2 New module / endpoints
Add a small `avatars` (or `cv-assets`) module, or extend `files` into a public-facing module
(there is currently **no** public `files` route — `FilesService` is used only internally by
exports). Suggested endpoints:

- `POST /api/v1/cv-photos` — upload (proxy). Body: image; returns `{ file_id, signed_url, expires_at }`.
- `GET /api/v1/cv-photos/:fileId/url` — resolve a fresh signed URL (ownership-checked) for preview.
- `DELETE /api/v1/cv-photos/:fileId` — soft-delete metadata + delete storage object.

Wire it in `build-services.ts` next to the existing `FilesService`/`ImportsService`
([build-services.ts:63-64,103](backend/src/app/build-services.ts#L63-L64)). Document the
endpoints in [api.md](backend/docs/api.md).

### 6.3 Validation & processing
- MIME allow-list: `image/png`, `image/jpeg`, `image/webp` (normalize webp → png/jpeg).
- Max size (e.g. 5 MB) and max dimensions (e.g. resize longest edge to ~512 px).
- Re-encode to png or jpeg and strip metadata (avoids the silent-drop parity bug and removes
  EXIF/orientation surprises). Pick an image lib already acceptable to the backend stack
  (e.g. `sharp`) — confirm dependency policy before adding.

### 6.4 Export integration — the critical change
The export pipeline currently embeds the photo only when `header.photo` is a data URI
([rendering-document.mapper.ts:146](backend/src/modules/exports/generators/rendering-document.mapper.ts#L146)).
After migration, `header.photo` will usually be a **file id**, so:

- In `exports.service` before generation (it already rebuilds rendering with overridden
  metadata around [exports.service.ts:377-440](backend/src/modules/exports/exports.service.ts#L377-L440)),
  resolve `metadata.photo`: if it is a managed reference, **download the bytes**
  (`filesRepository.downloadStorageObject`, as imports already do
  [imports.repository.ts:258-268](backend/src/modules/imports/imports.repository.ts#L258-L268))
  and convert to a `data:image/...;base64,…` data URI; pass that through as `header.photo`.
- If it is already a data URI (legacy CV), pass through unchanged.
- The PDF/DOCX generators and `isDataUriImage` then work **unchanged**.

This keeps the data-URI contract at the generator boundary while moving real storage upstream.

### 6.5 Cleanup lifecycle
- On replace/remove: soft-delete the old `files` row and best-effort delete the storage object
  (`FilesService.softDeleteFileMetadata` + `deleteStorageObject`).
- On CV delete: enqueue/trigger avatar cleanup for referenced files (decision: immediate vs
  deferred sweep). Note: a photo could be referenced by multiple CV revisions — prefer
  soft-delete + a later orphan sweep over hard delete to avoid breaking historical revisions.

---

## 7. Frontend work

- Replace `handlePhotoUpload` ([CVSections.tsx:75-84](frontend/src/app/components/CVSections.tsx#L75-L84)):
  instead of `readAsDataURL`, call the new upload endpoint, then set
  `data.photo = <file_id>` and hold the returned `signed_url` in local UI state for the
  thumbnail (`<img src={signedUrl}>`). Show upload progress + validation errors.
- Remove flow ([CVSections.tsx:119](frontend/src/app/components/CVSections.tsx#L119)): call
  `DELETE /cv-photos/:id` (best-effort) and set `data.photo = null`.
- Preview source resolution: the editor's live preview reads `header.photo`. The CV load
  path should resolve a managed reference to a signed URL (either the backend includes a
  resolved `photo_url` alongside the content for the editor/preview, or the editor calls
  `GET /cv-photos/:id/url`). Keep `<img src>` working for legacy data URIs unchanged
  ([CVPresentationPreview.tsx:310-322](frontend/src/app/components/CVPresentationPreview.tsx#L310-L322)).
- `cv-mappers`: no schema change needed (`metadata.photo` stays a string), but stop assuming
  base64; store/round-trip the reference verbatim
  ([cv-mappers.ts:1233,1256,2006](frontend/src/app/integration/cv-mappers.ts#L1233)).
- Add `backend-api.ts` client methods for the new endpoints (mirror
  `createImportUploadUrl` style [backend-api.ts:356-359](frontend/src/app/integration/backend-api.ts#L356-L359)).

---

## 8. Rendering & export parity

- **Preview:** signed URL via `<img>` (already supported; just supply a URL instead of a data
  URI).
- **Export:** backend resolves reference → data URI (§6.4) → existing embed path. Photo
  size/positioning constants are already defined and shared
  ([preview-export-parity.md:23,39](backend/docs/preview-export-parity.md#L23-L39),
  `photoSize`/`HEADER_PHOTO_GAP` in [pdf-generator.ts:119,281-295](backend/src/modules/exports/generators/pdf-generator.ts#L119)).
  No layout math changes required.

---

## 9. Templates

Photo display is currently a **header-level** concern: every template's header renders the
photo when present ([CVPresentationPreview.tsx:310](frontend/src/app/components/CVPresentationPreview.tsx#L310),
PDF/DOCX header builders). Templates that should not show a photo simply shouldn't render it.

Optional enhancement (follow the `skills_display` precedent on `TemplateProfile` in
[rendering-presentation.ts](backend/src/modules/rendering/rendering-presentation.ts)):
add a `photo_display: "show" | "hide"` profile flag so specific templates can suppress the
photo even when one is set. Out of scope for v1; noted for [adding-templates.md](backend/docs/adding-templates.md).

---

## 10. Backward compatibility & migration

- **Coexistence:** detect `metadata.photo` shape — `data:` prefix ⇒ legacy inline path (kept
  working everywhere it already works); otherwise ⇒ managed-file reference. No forced
  migration is required.
- **Optional migration script:** convert existing inline data URIs to managed files (decode,
  store, write `files` row, swap `metadata.photo` to the file id) to shrink CV JSON and
  de-duplicate revisions. Run as a one-off backfill; gate behind a feature flag and verify
  revision snapshots are left intact.

---

## 11. Entitlements & limits (decision needed)

No existing plan gates the photo feature (no `photo`/`avatar` flags in
[entitlements](backend/src/modules/entitlements/)). Decide whether profile photo is:
- ungated (recommended for v1), or
- a paid-plan feature (would add an entitlement flag + check, mirroring `can_export_pdf`
  in [domain.ts](backend/src/shared/types/domain.ts#L326)).

Also fix concrete limits: max file size, max dimensions, allowed input types, normalized
output type.

---

## 12. Security

- All endpoints authenticated; ownership enforced in the service layer before any signed URL
  is issued (same posture as exports in [storage-strategy.md](backend/docs/storage-strategy.md#L29-L33)).
- Private bucket; never expose raw storage paths to clients — only signed URLs with a TTL
  (reuse `EXPORT_DOWNLOAD_URL_TTL_SECONDS`-style config).
- Validate/normalize server-side (don't trust client MIME); strip EXIF; cap size to prevent
  storage abuse. Enforce RLS on the `files` table.

---

## 13. Phased rollout / task breakdown

1. **Infra:** create `cv-assets` bucket + env var; confirm RLS policies for `files` rows of
   type `avatar`.
2. **Backend storage:** generalize `FilesService` for avatars (path builder, upload, metadata,
   signed URL, delete); add `avatars`/`cv-photos` module + 3 endpoints; wire in
   `build-services.ts`; add validation/normalization.
3. **Export integration:** resolve `metadata.photo` reference → data URI in `exports.service`
   prior to generation; keep legacy data-URI pass-through.
4. **Frontend:** swap `handlePhotoUpload` to the upload endpoint; resolve signed URL for
   preview; remove/replace flow; `backend-api.ts` client methods.
5. **Docs:** update [content-model.md](backend/docs/content-model.md),
   [api.md](backend/docs/api.md), [storage-strategy.md](backend/docs/storage-strategy.md),
   [export-system.md](backend/docs/export-system.md).
6. **(Optional)** backfill migration; per-template `photo_display` flag.

---

## 14. Testing & verification

- **Backend unit:** validation rejects oversized/wrong-type uploads; normalization yields
  png/jpeg; export resolver converts a stored reference to a data URI and a legacy data URI
  passes through unchanged (extend `exports`/`rendering-document.mapper` tests under
  `backend/tests/`).
- **Parity:** a CV with a managed photo renders the image in preview **and** in both PDF and
  DOCX exports (the bug today: non-png/jpeg shows in preview, missing in export).
- **Round-trip:** uploading sets `metadata.photo` to a file id; reload resolves a signed URL;
  CV content JSON no longer contains base64.
- **Lifecycle:** replace/remove deletes the prior object; deleting a CV does not break
  historical revisions.
- **Manual E2E (`/run` or `/verify`):** upload a photo, save, reload, export PDF + DOCX, and
  confirm the image appears in all three; upload a `webp` and confirm it survives export.

---

## 15. Open decisions to confirm before building

1. `metadata.photo` representation — **file id (recommended)** vs storage path.
2. Upload mechanism — **backend proxy (recommended)** vs signed direct upload + finalize.
3. New `cv-assets` bucket vs reuse `source-uploads`.
4. Image processing dependency (e.g. `sharp`) — confirm it is acceptable to add.
5. Entitlement gating (ungated vs paid) and concrete size/dimension limits.
6. Cleanup policy — immediate delete vs deferred orphan sweep (given revision references).

---

## Key files reference

| Concern | File |
|---|---|
| Editor photo control (current base64 capture) | [frontend/src/app/components/CVSections.tsx:75-146](frontend/src/app/components/CVSections.tsx#L75-L146) |
| Content mapping of `metadata.photo` | [frontend/src/app/integration/cv-mappers.ts:1233,1256,2006](frontend/src/app/integration/cv-mappers.ts#L1233) |
| Preview photo render | [frontend/src/app/components/CVPresentationPreview.tsx:310-322](frontend/src/app/components/CVPresentationPreview.tsx#L310-L322) |
| Rendering header photo | [backend/src/modules/rendering/rendering-presentation.ts:1102](backend/src/modules/rendering/rendering-presentation.ts#L1102) |
| Export mapper (data-URI gate) | [backend/src/modules/exports/generators/rendering-document.mapper.ts:103,146](backend/src/modules/exports/generators/rendering-document.mapper.ts#L103-L146) |
| PDF photo embed | [backend/src/modules/exports/generators/pdf-generator.ts:229,281-295](backend/src/modules/exports/generators/pdf-generator.ts#L229) |
| DOCX photo embed | [backend/src/modules/exports/generators/docx-generator.ts:22-51](backend/src/modules/exports/generators/docx-generator.ts#L22-L51) |
| Storage abstraction | [backend/src/modules/files/files.service.ts](backend/src/modules/files/files.service.ts), [files.repository.ts](backend/src/modules/files/files.repository.ts) |
| Signed-upload precedent | [backend/src/modules/imports/imports.repository.ts:236-268](backend/src/modules/imports/imports.repository.ts#L236-L268), [frontend/src/app/pages/UploadProcessing.tsx:45-55](frontend/src/app/pages/UploadProcessing.tsx#L45-L55) |
| `FileType` incl. `avatar` | [backend/src/shared/types/domain.ts:207-227](backend/src/shared/types/domain.ts#L207-L227) |
| Storage strategy doc | [backend/docs/storage-strategy.md](backend/docs/storage-strategy.md) |
| Preview/export parity doc | [backend/docs/preview-export-parity.md](backend/docs/preview-export-parity.md) |
