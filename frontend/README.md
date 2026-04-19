# CV Builder Frontend

React + Vite client for CV Builder, integrated with the TypeScript backend in Phase 4.5.

## What Phase 4.5 Added

- Replaced major production-path mock data with real backend API integration
- Added centralized API client + normalized error handling
- Added Supabase session integration + bearer token forwarding for protected backend routes
- Added route guards and session-expired handling
- Wired dashboard, CV, import, AI, revisions, jobs, templates, exports, and billing flows to backend endpoints

## Prerequisites

- Node.js 20+
- Running backend API (default: `http://localhost:4000/api/v1`)
- Supabase project configured for auth + storage

## Environment Variables

Copy `.env.example` to `.env.local` and set values:

- `VITE_API_BASE_URL`: Backend base URL including `/api/v1`
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anon key
- `VITE_SUPABASE_IMPORTS_BUCKET`: Storage bucket used by import flow (default: `imports`)

## Local Run

1. Install dependencies:
   - `npm install`
2. Run dev server:
   - `npm run dev`
3. Open the app URL printed by Vite.

## Authentication Against Backend

- Frontend authentication is handled with Supabase Auth.
- After sign-in, each API call fetches the current Supabase access token and forwards:
  - `Authorization: Bearer <access_token>`
- Protected backend endpoints trust this bearer token.
- On `401`, frontend centrally signs the user out, clears protected state, and redirects to sign-in through route guards.

## Stripe Local Testing Assumptions

- Billing actions use backend endpoints:
  - `POST /billing/checkout`
  - `POST /billing/portal`
- Backend returns redirect URLs (`checkout_url`, `portal_url`) and frontend navigates directly.
- Frontend sends explicit return URLs to:
  - `/app/pricing?checkout=success`
  - `/app/pricing?checkout=cancel`
  - `/app/profile`
- Ensure backend Stripe env vars are configured (`STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`).
- For local subscription sync, run:
  - `stripe listen --forward-to localhost:4000/api/v1/billing/webhooks`

## Additional Integration Docs

- [Phase 4.5 Integration Note](./docs/phase-4.5-integration-note.md)
- [Contract Mapping Note](./docs/phase-4.5-contract-mapping.md)
- [Screen/Flow Coverage Checklist](./docs/phase-4.5-screen-flow-checklist.md)
- [Known Limitations](./docs/phase-4.5-known-limitations.md)
