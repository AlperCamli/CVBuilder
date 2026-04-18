# CV Builder Backend (Phase 3)

Phase 3 backend implementation for CV Builder.

This backend now provides:
- Phase 1 foundation modules (`auth`, `users`, `dashboard`, `system`)
- Phase 2 CV domains (`master-cv`, `imports`, `tailored-cv`, `jobs`)
- Phase 3 AI orchestration module (`ai`)
- Phase 3 block-level revision module (`cv-revisions`)
- Unified response/error contracts and validation patterns
- Additive Supabase schema + RLS policies for AI and revision flows

## Stack

- Runtime: Node.js + Express
- Language: TypeScript
- Validation: Zod
- Logging: Pino + pino-http
- Database/Auth/Storage: Supabase
- Deployment target: Vercel

## Architecture

Backend remains a **modular monolith**.

Layering rules:
- Routes: endpoint wiring + middleware composition
- Controllers: thin request/session adapters
- Services: business workflows/orchestration
- Repositories: Supabase/Postgres access boundaries

New Phase 3 modules:
- `ai`
  - provider abstraction boundary
  - flow registry and flow execution
  - `ai_runs` persistence for all AI workflows
  - `ai_suggestions` persistence and apply/reject coordination
- `cv-revisions`
  - block-level revision creation/list/detail/restore/compare
  - centralized revision number handling

## Project Structure

```txt
backend/
  api/
    index.ts
  src/
    app/
    modules/
      auth/
      users/
      dashboard/
      system/
      master-cv/
      imports/
      tailored-cv/
      jobs/
      ai/
      cv-revisions/
    shared/
      config/
      db/
      middleware/
      errors/
      logging/
      types/
      utils/
      validation/
      cv-content/
  supabase/
    migrations/
    seed.sql
  docs/
```

## Setup

1. Copy env template:

```bash
cp .env.example .env.local
```

2. Fill required values:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

3. Optional AI config (defaults included):
- `AI_PROVIDER` (`mock`)
- `AI_DEFAULT_MODEL` (default `mock-cv-builder-v1`)
- `AI_PROMPT_PROFILE` (default `phase3-v1`)

4. Install and run:

```bash
npm install
npm run dev
```

Backend default local URL:
- `http://localhost:4000`

API base:
- `http://localhost:4000/api/v1`

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - build TypeScript output
- `npm run start` - run built server
- `npm run typecheck` - strict type check
- `npm run lint` - type-based lint gate
- `npm run test` - run tests

## Supabase Migrations

Run migrations and seed:

```bash
supabase db push
supabase db seed
```

Phase 3 migration adds:
- `ai_runs`
- `ai_suggestions`
- `cv_block_revisions`

## Auth Behavior

Protected endpoints require:

```http
Authorization: Bearer <supabase_access_token>
```

All Phase 3 endpoints are protected.

## AI Integration Notes

- Current provider implementation: `mock` provider behind provider abstraction.
- All AI flows persist `ai_runs` with `pending -> completed|failed` transitions.
- Suggestion-producing flows persist `ai_suggestions` with `pending/applied/rejected` lifecycle.
- AI suggestion flows never mutate current CV content directly.
- Tailored draft generation is the intentional exception: it is a primary generation flow and can persist full tailored snapshot directly.

Follow-up answer model used in Phase 3:
- Frontend sends answers in request payload to `/api/v1/ai/tailored-cv-draft`.
- Backend also persists those answers inside `ai_runs.input_payload` for audit/reproducibility.

## Frontend Integration

Existing React + Vite frontend can now wire:
- Job analysis and follow-up questions
- AI-generated tailored draft creation/update
- Block-level AI suggestions + apply/reject
- Tailored CV manual block editing with automatic revision creation
- Revision list/detail/restore/compare flows
- Tailored CV AI history view

See docs for full contracts:
- `docs/api.md`
- `docs/frontend-integration.md`
- `docs/architecture.md`
- `docs/database-schema.md`
- `docs/ai-flows.md`
- `docs/revision-system.md`

## Response Contracts

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {}
  }
}
```

## Out of Scope in Phase 3

- PDF/DOCX generation
- Billing/checkout
- Full job board/kanban history
- Public web CV export
- Final localization rollout
- Security/observability hardening beyond current protected API implementation
