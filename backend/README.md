# CV Builder Backend (Phase 4C)

Phase 4C extends the existing modular monolith with:
- `billing` module (Stripe checkout, customer portal, webhook sync)
- `entitlements` module (centralized plan/limit resolution)
- `usage` module (atomic monthly usage counters)
- backend freemium enforcement for tailored draft generation, AI suggestion actions, and exports
- English-only backend contract assumptions (no multilingual infrastructure added)

Frozen architecture decisions remain unchanged:
- React + Vite frontend is the UI source of truth.
- Backend is TypeScript.
- Supabase is used for database/auth/storage.
- Vercel is the deployment target.
- Architecture is modular monolith.
- Master CV and Tailored CV remain separate concepts/tables.

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
- `templates`
- `rendering`
- `files`
- `exports`
- `billing` (Phase 4C)
- `entitlements` (Phase 4C)
- `usage` (Phase 4C)

Shared layers:
- `shared/config`
- `shared/db`
- `shared/errors`
- `shared/http`
- `shared/middleware`
- `shared/validation`
- `shared/cv-content`

## Billing + Entitlements + Usage Flow

- Stripe checkout creates/uses a Stripe customer and starts subscription purchase.
- Stripe webhook events sync subscription lifecycle rows into `subscriptions`.
- Effective plan is resolved from subscription state (`active`/`trialing` => paid plan, otherwise free).
- Current-period usage is loaded from `usage_counters`.
- Entitlements are resolved centrally from:
  - effective plan
  - plan limits
  - current period usage
- Protected actions enforce entitlements server-side before execution.
- Usage counters are incremented only on successful limited actions.

## Setup

1) Copy env template

```bash
cp .env.example .env.local
```

2) Fill required values
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

3) Stripe billing env vars (required for billing runtime)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`

4) Optional billing URLs
- `BILLING_CHECKOUT_SUCCESS_URL`
- `BILLING_CHECKOUT_CANCEL_URL`
- `BILLING_PORTAL_RETURN_URL`

5) Optional exports config
- `EXPORTS_STORAGE_BUCKET` (default: `exports`)
- `EXPORT_DOWNLOAD_URL_TTL_SECONDS` (default: `600`, bounds: `60..86400`)

6) Install and run

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

Phase 4C adds:
- `20260418170000_phase4c_billing_entitlements.sql`
  - provider linkage indexes on `subscriptions`
  - atomic `increment_usage_counters(...)` function

Apply:

```bash
supabase db push
supabase db seed
```

## Phase 4C API Surface

Billing:
- `GET /billing/plan`
- `GET /billing/usage`
- `GET /billing/entitlements`
- `POST /billing/checkout`
- `POST /billing/portal`
- `POST /billing/webhooks` (no auth; Stripe signature validated)

Updated existing endpoints:
- `GET /me`
- `GET /me/usage`
- `GET /dashboard`

## Docs

- `docs/phase4c-architecture.md`
- `docs/database-schema.md`
- `docs/api.md`
- `docs/billing-entitlements.md`
- `docs/frontend-integration.md`
- `docs/environment.md`
- `docs/export-system.md`
