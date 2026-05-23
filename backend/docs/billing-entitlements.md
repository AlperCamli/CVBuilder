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
- recurring subscription, billed monthly
- starts with a `BILLING_TRIAL_PERIOD_DAYS`-day free trial (default `3`)

### `lifetime`
- limits and features identical to `pro` (all `null` limits, all features enabled)
- linked to Stripe price id from `STRIPE_LIFETIME_PRICE_ID`
- one-time payment (`mode: "payment"` Checkout session), no recurring billing
- persisted as a synthetic `subscriptions` row with `status: "active"` and `current_period_end: null`

## Free Trial Flow (Monthly Pro)

When a user starts checkout with `plan_code: "pro"`:
- `BillingService.createCheckoutSession` passes `trial_period_days` (default `3`, configured by `BILLING_TRIAL_PERIOD_DAYS`) into Stripe Checkout via `subscription_data.trial_period_days`
- Card details are collected up-front by Stripe Checkout
- During the trial Stripe reports `status: "trialing"`, which `EntitlementsService.resolveEffectivePlanCode` treats as an active paid plan (same `ACTIVE_PAID_STATUSES` set as `active`)
- Conversion to `active` happens automatically when Stripe charges on day 3
- Cancellation during the trial flips `cancel_at_period_end` and eventually transitions status to `canceled` → effective plan returns to `free`

The lifetime plan does not get a trial — `trial_period_days` is only applied when `plan.code !== "lifetime"`.

## Lifetime Purchase Flow

When a user starts checkout with `plan_code: "lifetime"`:
- `BillingService.createCheckoutSession` uses `mode: "payment"` (one-off) instead of `mode: "subscription"`
- `payment_intent_data.metadata` carries `app_user_id` and `plan_code: "lifetime"` so the webhook can attribute the charge
- On `checkout.session.completed`, the webhook detects `mode === "payment"` and `metadata.plan_code === "lifetime"` and calls `recordLifetimePurchase`
- `recordLifetimePurchase` upserts a `subscriptions` row with:
  - `plan_code: "lifetime"`
  - `status: "active"`
  - `provider_subscription_id: lifetime_<checkout_session_id>` (synthetic, since one-time payments have no Stripe subscription object)
  - `current_period_end: null` (never expires)
  - `cancel_at_period_end: false`
- No subsequent `customer.subscription.*` events fire for the lifetime path (there is no subscription object to update)

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

The frontend intercepts this error code to surface the upgrade prompt modal (see "Frontend Upsell Triggers" below).

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
    - if `mode === "subscription"`: fetches the resulting subscription and syncs via `syncStripeSubscription`
    - if `mode === "payment"` with `metadata.plan_code === "lifetime"`: records a lifetime subscription row via `recordLifetimePurchase`
    - other `mode === "payment"` cases: customer linkage is recorded but no subscription state changes
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- maps subscription price id -> plan code
- upserts subscription state deterministically

Idempotency approach:
- upsert by provider subscription id (real Stripe subscription id, or synthetic `lifetime_<session_id>` for lifetime purchases)
- customer linkage is ensured before subscription upsert

## Frontend Upsell Triggers

The frontend exposes a shared `UpgradePromptProvider` (mounted inside the authenticated layout) with a `useUpgradePrompt()` hook. Three trigger points fire the modal:

- **welcome** — first dashboard view after signup. Persisted via `localStorage` key `upgrade_welcome_prompt_shown` so it only fires once per user/browser.
- **export_first_in_session** — first time a non-pro/non-lifetime user clicks Export in a session. Persisted via `sessionStorage` key `cv-editor:export-upsell-shown`. Does not block the export.
- **limit_reached** — fired when the frontend receives an `ApiClientError` with `code === "ENTITLEMENT_EXCEEDED"`. The modal's copy interpolates the specific feature (`exports`, `tailored CVs`, `AI actions`).

All three variants share the same two CTAs: **Start 3-day free trial** (`createBillingCheckout({ plan_code: "pro" })`) and **Get Lifetime — $99** (`createBillingCheckout({ plan_code: "lifetime" })`).

## Configuration

Environment variables (see `src/shared/config/env.ts`):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | yes (prod) | — | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | yes (prod) | — | Stripe webhook signing secret |
| `STRIPE_PRO_PRICE_ID` | yes (prod) | — | Recurring price ID for Monthly Pro ($10/mo) |
| `STRIPE_LIFETIME_PRICE_ID` | yes (prod) | — | One-time price ID for Lifetime Pro ($99) |
| `BILLING_TRIAL_PERIOD_DAYS` | no | `3` | Trial length for Monthly Pro; `0` disables trial |
| `BILLING_CHECKOUT_SUCCESS_URL` | no | derived from `FRONTEND_APP_URL` | Checkout success redirect |
| `BILLING_CHECKOUT_CANCEL_URL` | no | derived from `FRONTEND_APP_URL` | Checkout cancel redirect |
| `BILLING_PORTAL_RETURN_URL` | no | derived from `FRONTEND_APP_URL` | Billing portal return URL |

## Known Limitations (Intentional for Phase 4C)

- no advanced invoicing workflows
- no coupon/campaign management
- no team/org billing
- no event replay ledger table for webhook dedup analytics
- no deep billing analytics pipeline
- storage usage is incremented on successful exports; deletion reconciliation is deferred
- lifetime purchases cannot be refunded via the in-app billing portal (handle manually in Stripe Dashboard)
