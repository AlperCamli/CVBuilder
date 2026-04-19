# Phase 4.5 Screen/Flow Coverage Checklist

Status legend: `Done`, `Partial`, `Deferred`

| Area | Status | Notes |
|---|---|---|
| Dashboard | Done | Real data via `/dashboard`, `/jobs/board`, `/dashboard/activity` |
| Profile/account basics | Done | `/me`, `/me/settings`, update endpoints wired |
| Auth/session bootstrapping | Done | Central session + `/me` bootstrap in `AuthProvider` |
| Unauthorized/session-expired handling | Done | Central 401 handling + sign-out + route guards |
| Master CV list/detail/create/update/duplicate/delete | Done | List/resume pages + editor + duplicate/delete wired |
| Master CV preview | Done | Live preview via `/rendering/preview` with master context |
| Import flow | Done | Import create/upload-complete/parse wired |
| Parsed result review/update/convert | Done | `/imports/:id/result` get/patch + create master conversion |
| Tailored CV list/detail/create/update/delete | Done | List/editor/create flow + delete wired |
| Tailored CV preview | Done | Live preview via `/rendering/preview` with tailored context |
| AI job analysis | Done | `/ai/job-analysis` wired in tailor start |
| Follow-up questions | Done | `/ai/follow-up-questions` wired |
| Tailored draft generation | Done | `/ai/tailored-cv-draft` wired |
| Block-level AI suggestions | Done | Suggest/options/compare + pending suggestions UI |
| Apply/reject AI suggestions | Done | `/ai/suggestions/:id/apply` and `/reject` wired |
| Revision history and restore | Done | List/compare/restore wired in editor |
| Jobs/job tracker board + status updates | Done | `/jobs/board` + `/jobs/:id/status` drag/drop |
| Jobs detail/list/history endpoints | Done | Job board screen now opens backend-backed detail/history dialog and loads jobs list total |
| Template list/detail/assignment | Done | Template list + assignment + selected template detail retrieval wired in editor |
| PDF export | Done | Create + download wired |
| DOCX export | Done | Create + download wired |
| Export history and download | Done | `/tailored-cvs/:id/exports`, `/exports/:id/download` wired |
| Billing plan/usage/entitlements | Done | Pricing/profile screens use billing endpoints |
| Stripe checkout | Done | `/billing/checkout` redirect wired |
| Stripe customer portal | Done | `/billing/portal` redirect wired |
| Loading/empty/error states | Done | Implemented across integrated major screens |
| Backend-driven status rendering | Done | processing/completed/failed/pending/rejected/applied surfaced where relevant |

## Endpoint Layer Coverage

All Phase 4.5 endpoint groups are implemented in typed frontend API wrappers under `src/app/integration/backend-api.ts`.
