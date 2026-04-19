# Phase 4.5 Frontend-Backend Integration Note

## Scope

Phase 4.5 integrates the existing React + Vite frontend with the existing TypeScript modular-monolith backend and replaces mock data in major production flows.

The UI/UX structure is preserved. Backend architecture and product model decisions remain unchanged.

## Integration Approach

## 1) API foundation

Added a centralized integration layer under `src/app/integration`:

- `config.ts`
  - frontend env configuration (`VITE_API_BASE_URL`, Supabase vars)
- `supabase-client.ts`
  - singleton Supabase client
- `api-client.ts`
  - generic HTTP client (GET/POST/PATCH/PUT/DELETE), query serialization, response envelope parsing
- `api-error.ts`
  - normalized API error object (`ApiClientError`)
- `backend-api.ts`
  - typed feature-level endpoint wrappers
- `api-types.ts`
  - shared frontend contract types
- `cv-mappers.ts`
  - adapter between backend `current_content` model and editor section model
- `auth-context.tsx`
  - session/bootstrap + `/me` context loading + API binding
- `auth-route-guards.tsx`
  - protected and redirect-if-authenticated route wrappers

## 2) Auth token forwarding strategy

- Each API request obtains current Supabase session access token via `supabase.auth.getSession()`.
- Token is sent as:
  - `Authorization: Bearer <access_token>`
- Backend protected routes are called only through the centralized API client.
- On unauthorized (`401`) responses:
  - error is normalized
  - centralized `onUnauthorized` callback signs user out
  - protected in-memory state (`me`) is cleared
  - route guards push user back to authenticated entry flow
  - stale protected data is not retained on-screen

## 3) Response and error handling

- Backend success envelope `{ success: true, data }` is parsed centrally.
- Error envelope is normalized into `ApiClientError` with:
  - `status`, `code`, `details`, `isUnauthorized`
- Screen-level async states now consistently handle loading/success/error paths.

## 4) Mock replacement strategy

- Major app paths now fetch real backend data.
- Mock data is removed from production paths for:
  - dashboard
  - resumes/CV management
  - import parse/convert flow
  - tailored generation flow
  - CV editor save/template/AI/revisions/exports
  - job tracker board/status updates
  - profile/settings
  - billing/pricing
- Remaining intentionally non-phase flows (documented separately) are isolated.

## Screen-by-Screen Integration Summary

- `SignIn` / `SignUp`
  - real Supabase auth
- `Layout`
  - shows auth/session messages and sign-out with live account context
- `Dashboard`
  - `GET /dashboard`, `GET /jobs/board`, `GET /dashboard/activity`
- `Resumes`
  - `GET /master-cvs`, `GET /tailored-cvs`
  - master duplicate/delete
  - tailored export (PDF) and tailored delete
- `CVEditor`
  - load master/tailored details
  - save via content endpoints
  - template assignment + template detail fetch for selected template
  - rendering preview request
  - block AI actions (suggest/options/compare + apply/reject)
  - tailored AI history
  - revisions list/compare/restore
  - export PDF/DOCX + export history + download
- `UploadProcessing`
  - Supabase storage upload + import session + parse trigger
- `CVScore`
  - import result fetch/update + create master CV conversion
- `AIImproving`
  - import parsed-content update + conversion to master CV
- `TailorCV`
  - AI job analysis + follow-up question generation
- `TailoringFlow`
  - tailored draft generation and transition to editor
- `JobTracker`
  - jobs board + status update via drag/drop
  - jobs list total (`GET /jobs`)
  - job detail + status history dialog (`GET /jobs/:id`, `GET /jobs/:id/history`)
- `Profile`
  - me/settings + billing plan/usage + checkout/portal actions
- `Pricing`
  - billing plan/usage/entitlements + checkout/portal actions

## Backend Adjustments

- No backend architecture changes were made.
- No backend contract changes were required for Phase 4.5 integration.
