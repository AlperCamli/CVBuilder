# CV Builder Backend (Phase 4A)

Phase 4A extends the existing modular-monolith backend with:
- Job tracker backend integration (`jobs`)
- Real dashboard aggregation (`dashboard`)
- Template metadata + assignment support (`templates`, `master-cv`, `tailored-cv`)
- Stable rendering contract for preview/export pipelines (`rendering`)

Frozen decisions preserved:
- React + Vite frontend remains UI source of truth.
- Backend remains TypeScript.
- Supabase remains DB/auth/storage.
- Vercel remains deployment target.
- Architecture remains modular monolith.
- Master CV and Tailored CV stay separate tables/objects.

## Modules

Core modules:
- `auth`
- `users`
- `system`
- `dashboard`
- `master-cv`
- `tailored-cv`
- `jobs`
- `imports`
- `ai`
- `cv-revisions`
- `templates` (Phase 4A)
- `rendering` (Phase 4A)

Shared layers:
- `shared/config`
- `shared/db`
- `shared/errors`
- `shared/http`
- `shared/middleware`
- `shared/validation`
- `shared/cv-content`

## Architecture Layering

- Routes: endpoint wiring + auth/validation middleware.
- Controllers: thin request/session adapters.
- Services: business rules and orchestration.
- Repositories: Supabase/Postgres data access boundaries.

No business logic is placed in route files.

## Setup

1) Copy env template

```bash
cp .env.example .env.local
```

2) Fill required values
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional AI config:
- `AI_PROVIDER` (default: `mock`)
- `AI_DEFAULT_MODEL`
- `AI_PROMPT_PROFILE`

3) Install and run

```bash
npm install
npm run dev
```

Backend default URL:
- `http://localhost:4000`

API base:
- `http://localhost:4000/api/v1`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run lint`
- `npm run test`

## Migrations

Source-of-truth migrations are in:
- `supabase/migrations`

Phase 4A adds:
- `20260418123000_phase4a_jobs_dashboard_rendering.sql`
  - aligns job status vocabulary (`interview`, `offer`)
  - adds `job_status_history`

Apply:

```bash
supabase db push
supabase db seed
```

## Phase 4A API Surface (Added/Finalized)

- Jobs tracker:
  - `GET /jobs`
  - `GET /jobs/board`
  - `GET /jobs/:jobId`
  - `PATCH /jobs/:jobId`
  - `PATCH /jobs/:jobId/status`
  - `GET /jobs/:jobId/history`

- Dashboard:
  - `GET /dashboard`
  - `GET /dashboard/activity`

- Templates:
  - `GET /templates`
  - `GET /templates/:templateId`
  - `PATCH /master-cvs/:masterCvId/template`
  - `PATCH /tailored-cvs/:tailoredCvId/template`

- Rendering/preview:
  - `GET /master-cvs/:masterCvId/preview` (finalized contract)
  - `GET /tailored-cvs/:tailoredCvId/preview` (finalized contract)
  - `POST /rendering/preview`

## Docs

- `docs/architecture.md` (Phase 4A architecture note)
- `docs/database-schema.md` (Phase 4A schema note)
- `docs/api.md` (Phase 4A endpoint contracts)
- `docs/rendering-contract.md` (normalized rendering payload contract)
- `docs/frontend-integration.md` (frontend binding flows)
