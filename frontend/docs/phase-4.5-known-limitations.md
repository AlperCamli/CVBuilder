# Phase 4.5 Known Limitations

## Remaining Partially Mocked or Non-Integrated UI

- Cover letter pages (`CoverLetters`, `CoverLetterEditor`) are not part of this phase’s required backend integration and still use local/demo behavior.
- Forgot-password page remains frontend-only placeholder flow.

## Intentional Adapter Debt (Minimal, Documented)

- CV editor save uses full-content update endpoints (`PUT /master-cvs/:id/content`, `PUT /tailored-cvs/:id/content`) rather than dispatching per-keystroke block patch requests.

## Backend Contract Gaps Deferred

- `DELETE /exports/:exportId` is not currently implemented in backend; frontend API method is intentionally disabled and documented.

## Hardening Follow-up (Phase 5)

- Expand contract tests around all integrated endpoint payloads.
- Add integration/e2e tests for auth expiry, import failures, AI suggestion workflows, export retries, and billing redirects.
- Add observability and telemetry around API failures, status transitions, and long-running flows.
