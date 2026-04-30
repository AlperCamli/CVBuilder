# Billing and Entitlements (Phase 4C)

## Provider

- Payment provider: `Stripe` only.
- Billing logic is centralized under `src/modules/billing`.

## Plan Definitions

Defined centrally in `src/modules/entitlements/plan-definitions.ts`.

### `free`
- tailored CV generations / month: `3`
- exports / month: `5`
- AI actions / month: `20`
- storage bytes: `25 * 1024 * 1024` (25 MB)

### `pro`
- limits are effectively unlimited (`null` limits)
- linked to Stripe price id from `STRIPE_PRO_PRICE_ID`

## Effective Plan Resolution

Resolved from subscription state:
- `active` or `trialing` subscription => use subscription `plan_code`
- otherwise => fallback to `free`

This makes backend the source of truth regardless of frontend assumptions.

## Entitlement Resolution

Inputs:
- effective plan code
- current month `usage_counters` row

Outputs:
- `can_generate_tailored_cv`
- `can_export_pdf`
- `can_export_docx`
- `can_use_ai_actions`
- `limits`
- `remaining`

`remaining` is computed as `max(limit - used, 0)` when limit exists, otherwise `null`.

## Usage Counting Rules

Primary meter table:
- `usage_counters`

Atomic increment function:
- `public.increment_usage_counters(...)`

### Actions that consume usage

- `tailored_cv_generations_count`
  - increments when tailored draft generation succeeds (`/ai/tailored-cv-draft`)

- `exports_count`
  - increments when export reaches completed state (master or tailored CV export endpoints)

- `ai_actions_count`
  - increments when AI suggestions/options are successfully persisted (`/ai/blocks/suggest`, `/ai/blocks/options`)

- `storage_bytes_used`
  - increments by generated export file size when export completes

### Actions that do not consume usage

- failed draft generation
- failed export generation/storage
- failed AI suggestion generation/persistence
- read-only endpoints
- block compare endpoint (`/ai/blocks/compare`)

## Backend Enforcement Hooks

Enforced in service layer (not controller layer):
- `AiService.generateTailoredCvDraft` -> `tailored_cv_generation`
- `AiService.suggestBlock` -> `ai_action`
- `AiService.generateBlockOptions` -> `ai_action`
- `ExportsService.createExportByFormat` (`pdf`/`docx`) -> export entitlement

Enforcement failure returns:
- `ENTITLEMENT_EXCEEDED`

## Stripe Customer and Subscription Linkage

Linkage persistence strategy:
- customer/subscription IDs are stored in `subscriptions`
- provider linkage indexes added for efficient lookup

Customer linkage is established by:
- checkout flow (ensure customer exists and persist customer id)
- webhook flow (customer/subscription event sync)

## Webhook Lifecycle Handling

Endpoint:
- `POST /api/v1/billing/webhooks`

Behavior:
- validates Stripe signature
- processes:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- maps subscription price id -> plan code
- upserts subscription state deterministically

Idempotency approach:
- upsert by provider subscription id
- customer linkage is ensured before subscription upsert

## Known Limitations (Intentional for Phase 4C)

- no advanced invoicing workflows
- no coupon/campaign management
- no team/org billing
- no event replay ledger table for webhook dedup analytics
- no deep billing analytics pipeline
- storage usage is incremented on successful exports; deletion reconciliation is deferred
