# Phase 4.5 Contract Mapping Note

## Purpose

This note documents intentional frontend adapter/mapping decisions where UI view models differ from backend response shapes.

## Mapping Decisions

## 1) API envelope to typed payloads

- Backend returns envelope format:
  - success: `{ success: true, data: ... }`
  - error: `{ success: false, error: { code, message, details? } }`
- Frontend mapping:
  - `api-client.ts` unwraps `data`
  - errors are normalized to `ApiClientError`

Reason: Keep screen code clean and avoid repeating envelope parsing.

## 2) Auth/session mapping

- Supabase session (`@supabase/supabase-js`) is frontend auth source.
- Backend identity context is mapped from `GET /me` response in `AuthProvider`.

Reason: Session/token concerns stay centralized; feature pages consume already-authenticated API instance.

## 3) CV content mapping for editor

- Backend stores CV content as structured `current_content` JSON.
- Existing editor UI works with ordered `EditorSection[]` state.
- Adapter introduced:
  - `cvContentToEditorSections(...)`
  - `editorSectionsToCvContent(...)`
  - `getSectionFirstBlockId(...)`

Reason: Preserve existing UX and component contracts without changing backend content model.

## 4) Dashboard/job board mapping

- Backend jobs board response is grouped by status.
- UI kanban columns consume normalized local `Job[]` cards.

Reason: Keep drag/drop UI logic straightforward while using backend status grouping as source of truth.

## 5) AI suggestion mapping

- Backend suggestion payload includes detailed block content.
- UI maps suggestions to lightweight card model:
  - `id`, `rationale`, `status`, `suggested_content`

Reason: Avoid over-coupling popup state to full backend payload; apply/reject remains server-driven.

## 6) Export download mapping

- Export create may include immediate `download.download_url`.
- If not present, UI falls back to `GET /exports/:exportId/download`.

Reason: Supports both immediate-complete and eventually-complete export states using one UX path.

## 7) Billing mapping

- Plan/usage/entitlements come from billing endpoints.
- Profile and pricing UI resolve effective plan primarily from `/billing/plan`, with `/me.current_plan` as secondary display fallback.

Reason: Billing endpoints are canonical source for commerce state; `/me` remains account summary.

## Minimal Backend Changes

- None required.

## Deferred/Intentional Non-Mappings

- Manual CV save currently uses full-content endpoints (`PUT .../content`) rather than per-block patch endpoints for every edit interaction.

These do not change backend contracts and are documented for future hardening/UI expansion.
