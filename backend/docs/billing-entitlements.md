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

(With `FREE_USAGE_LIMITS_ENABLED=false`, the production default, these allowances are off and the subscription gate decides access.)

### `weekly`, `monthly`, `annual` (Pro, sold today)
- limits are effectively unlimited (`null` limits), all features enabled
- recurring subscriptions priced per billing market (USD and TRY; see `stripe-regional-setup.md`)
- `checkout_allowed: true`
- **`monthly` carries the free trial (`trial_supported: true`) since 2026-11-05**; `weekly` and `annual` are charged at checkout (`trial_supported: false`). Weekly carried the trial before 2026-11-05.

### `pro` (legacy)
- limits are effectively unlimited (`null` limits)
- linked to Stripe price id from `STRIPE_PRO_PRICE_ID`
- recurring subscription, billed monthly; no longer sold (`checkout_allowed: false`). It granted the trial before Weekly did.

### `lifetime` (legacy)
- limits and features identical to `pro` (all `null` limits, all features enabled)
- linked to Stripe price id from `STRIPE_LIFETIME_PRICE_ID`
- one-time payment (`mode: "payment"` Checkout session), no recurring billing; no longer sold
- persisted as a synthetic `subscriptions` row with `status: "active"` and `current_period_end: null`

## Free Trial Flow (Monthly Pro, since 2026-11-05)

The plan catalog is the single authority on which plan carries the trial: the purchasable plan with
`trial_supported: true` (`trialPlanCodes(catalog)` in `plan-definitions.ts`, today `["monthly"]`). Nothing else names
the trial plan: `GET /billing/prices` (`RegionalPricingService`, option `trialPlans`), checkout, and the daily
`billing_plan_catalog` refresh all read it from the catalog.

When a trial-eligible user starts checkout for the trial plan:
- `BillingService.createCheckoutSession` passes `trial_period_days` (default `3`, configured by `BILLING_TRIAL_PERIOD_DAYS`) into Stripe Checkout via `subscription_data.trial_period_days`
- Card details are collected up-front by Stripe Checkout (`payment_method_collection: "always"`, `payment_method_types: ["card"]`), and the submit button carries "You won't be charged today. Your trial ends on …" in the customer's language and time zone
- `GET /billing/prices` reports `trial_days: 3` on `monthly` and `0` on `weekly` and `annual`; the response shape did not change, only the plan that carries `trial_days`
- During the trial Stripe reports `status: "trialing"`, which `EntitlementsService.resolveEffectivePlanCode` treats as an active paid plan (same `ACTIVE_PAID_STATUSES` set as `active`)
- Conversion to `active` happens automatically when Stripe charges the **monthly** price (USD 14.99 / TRY 349.90 today, read from the market's Stripe price) at the end of day 3. Verified in Stripe test mode with test clocks by `scripts/verify-regional-trial-sandbox.ts` (due today 0, `trialing` for 3 days, then a paid `subscription_cycle` invoice of the full monthly price in both markets)
- Cancellation during the trial flips `cancel_at_period_end` and eventually transitions status to `canceled` → effective plan returns to `free`

### Weekly trials started before 2026-11-05

Trials opened on Weekly before the move keep converting to Weekly at the weekly price, as promised at their checkout;
nothing rewrites them. Every code path reads the trial's plan, interval and price from the subscription itself
(`subscriptions.plan_code`, its Stripe price), never from the current trial plan: access, the cancel screen and its
offer, plan changes, the trial reminder queue and analytics all work for a `weekly` trial and a `monthly` trial alike.

### `with_trial` contract (`POST /billing/checkout`)

`BillingService` reads `with_trial` once, as `wantsTrial(with_trial, plan_code)`: the explicit boolean, else what a
pre-2026-11-05 bundle meant by omitting it (a trial request only on Weekly, `LEGACY_TRIAL_PLAN_CODES`; its paid
Monthly and Annual buttons posted no `with_trial`). The same value drives the `trial_unavailable` guard, the trial
grant and `checkout_attempts.trial_requested`.

| Plan | `with_trial` | Result |
|---|---|---|
| trial plan (`monthly`) | `true` | trial if eligible; not eligible with a pricing quote → `409 pricing_changed` (the client shows the paid price and retries with `false`) |
| trial plan (`monthly`) | `false` or omitted | paid now, no trial (omitted = an old tab's paid "Continue with Monthly") |
| `annual` | `false` or omitted | paid now, no trial |
| `weekly` | `false` | paid now, no trial |
| `weekly` | omitted | **`409 trial_unavailable`**, message "The free trial now continues as Monthly Pro. Refresh the page and start it from there." (an old tab's "Start my 3-day free trial", never a paid Weekly charge) |
| `weekly` or `annual` | `true` | **`409 CONFLICT`, `details: { reason: "trial_unavailable", plan_code, trial_plan_code: "monthly" }`**, message "The free trial is not available on this plan." Nothing is charged; the client moves the request to the trial plan ("trial wins": an old `plan=weekly&trial=1` link or saved checkout becomes a Monthly trial) |

Both `409 trial_unavailable` cases come before any market lock, reservation, customer or Stripe call. The handling of
an omitted `with_trial` is **transitional** (stale bundles): once no pre-2026-11-05 bundle can be open (e.g. after
2026-12-31), an omitted `with_trial` can become a `400` (required). A promotion with `replaces_trial` charges its
discounted price now whatever `with_trial` says (never refused as `trial_unavailable`). Clients send `with_trial`
explicitly as a boolean on every checkout; a trial checkout needs `with_trial: true`.

### Trial Eligibility (one trial per user)

A free trial is granted only when **all** of the following hold, otherwise checkout proceeds as an immediate paid subscription (or the `409`s above):
- the plan is the catalog's trial plan
- `BILLING_TRIAL_PERIOD_DAYS > 0`
- the request asks for it (`with_trial: true`)
- the account has an unused release-cohort grant (`trial_transition_grants`, unchanged), or it has **never used a trial**

"Used a trial" is decided by `BillingSubscriptionsRepository.hasUsedTrial(userId)` in one query: any `subscriptions` row
with a real `provider_subscription_id` on a plan that has ever granted the trial (`TRIAL_CAPABLE_PLAN_CODES`:
`pro`, `weekly`, `monthly`) whose status is not `incomplete` / `incomplete_expired` (a Checkout whose first payment
never completed, e.g. a failed 3-D Secure, gave no access and does not use the trial up), **or** any row with
`trial_start` set (Stripe reported a trial on it, whatever its plan and status).
Since 2026-11-05 this includes Monthly, so an account that has ever paid for Monthly directly, or for Weekly, gets no
free trial; before, only Pro and Weekly rows counted. The row persists with its real Stripe subscription id even after
the subscription is canceled or deleted, so it is a durable signal. Placeholder customer-link rows (null
`provider_subscription_id`, `plan_code = "free"`, no `trial_start`) are excluded.

`BillingService.isUserTrialEligible(userId)` wraps this check and is shared by checkout and the billing-plan endpoint. `GET /billing/plan` returns the result as **`trial_eligible: boolean`** (eligibility for a checkout of the trial plan) so the frontend can render the correct CTA — "Start 3-day free trial" while eligible, "Start your subscription" once the trial has been consumed.

### Buying a plan without a trial

Clients pass `with_trial: false` on the trial plan to be billed immediately, even if the user is otherwise trial-eligible. Weekly and Annual are always billed immediately.

The checkout response reports the outcome so the UI can confirm what was created:
- `trial_applied: boolean`
- `trial_period_days: number | null`

`checkout_attempts.trial_requested` is `wantsTrial`: the explicit `with_trial`, else `true` only for Weekly (the old
tab's trial button, refused and recorded as `outcome = 'failed'`). An omitted `with_trial` on Monthly or Annual is not
a trial request.

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

> See `monetization-upsell-funnel.md` for the full, current trigger matrix, the context-aware copy rules, and the post-export return prompt added in June 2026.

The frontend exposes a shared `UpgradePromptProvider` (mounted inside the authenticated layout) with a `useUpgradePrompt()` hook. Four trigger points fire the modal:

- **welcome** — first dashboard view after signup. Persisted via `localStorage` key `upgrade_welcome_prompt_shown` so it only fires once per user/browser.
- **export_first_in_session** — first time a non-pro/non-lifetime user clicks Export in a session. Persisted via `sessionStorage` key `cv-editor:export-upsell-shown`. Does not block the export.
- **limit_reached** — fired **every time** the frontend receives an `ApiClientError` with `code === "ENTITLEMENT_EXCEEDED"`, on every surface that can produce one (CV editor AI actions and exports, job analysis, tailoring flow, cover letter generation/export, import improvement). The modal's copy is keyed off the gated action reported in `details.action` and leads with the backend's reason message.
- **post_export** — fired when a free-plan user returns to the tab/window after a successful CV export, pairing the subscription offer with a next-step CTA (cover letter for a tailored CV, job-specific customization for a master CV).

The trial CTA is **Start 3-day free trial** (`createBillingCheckout({ plan_code: "monthly", with_trial: true })` since 2026-11-05; `plan_code: "pro"` and later `"weekly"` before); paid CTAs send `with_trial: false`. Lifetime is no longer sold.

Without a pricing quote the backend may downgrade a trial request to an immediate paid subscription when the user is no longer trial-eligible (already used their one trial); with a quote (production) it answers `409 pricing_changed` instead. The checkout response's `trial_applied`/`trial_period_days` fields indicate what was actually created, so the frontend should not assume a trial was granted just because it requested one.

## Public Pricing → Sign-up → Checkout Journey

A public (unauthenticated) pricing page lives at `/pricing` and is linked from the marketing site's sticky nav (`PublicHeader`). Because Stripe Checkout requires an authenticated user, an anonymous visitor cannot check out directly. The flow is bridged with a persisted intent:

1. On the public `/pricing` page, clicking a paid CTA (**Start 3-day free trial**, **Subscribe now without trial**, or **Get Lifetime**) writes a `PendingCheckoutIntent` (`{ plan_code, with_trial? }`) to `localStorage` under key `cv-builder:pending-checkout`, then routes to `/signup`.
2. The intent is in `localStorage` (not router state) specifically so it survives the whole sign-up round-trip: immediate session, the email-verification redirect, and Google OAuth (`/auth/callback`) — all of which ultimately land the user authenticated in `/app`.
3. `CheckoutIntentResumer` (mounted in the authenticated layout) detects the intent the moment the user is authenticated, clears it up-front (so a cancelled attempt can't loop), and calls `createBillingCheckout` to redirect straight to Stripe — showing a "Taking you to secure checkout…" overlay.
4. Authenticated visitors who hit the public `/pricing` page are routed to the in-app `/app/pricing` billing page instead (no intent is stashed).

The shared `startStripeCheckout` helper builds the Checkout session for all three entry points (in-app pricing, public pricing resume, and the upsell modal) so success/cancel URLs and the `with_trial` opt-out stay consistent.

## Promotional Checkout

A promotion (`promotions` row plus cohorts, created by `npm run promotion:setup` from `promotions/<slug>/campaign.json`; see `docs/promotions/spec.md`) gives each recipient a personal link token (`?promo=`). Module: `src/modules/promotions/`.

- `GET /promotions/offer?token=` (public) resolves the token to `active | upcoming | ended | redeemed | ineligible | invalid`, counts the open (`open_count`, `first_opened_at`), and prices only the promoted plans in the token owner's saved billing market (else the request country). `discounted_amount = amount - round(amount * percent_off / 100)`, Stripe's rounding.
- `POST /billing/checkout` with `promotion_token` validates, in order: token exists (`invalid`), belongs to the signed-in user (`wrong_account`), not redeemed (`redeemed`), promotion not archived (`ended`), cohort window `[starts_at, ends_at)` open (`upcoming` / `ended`), `plan_code` in `plan_codes` (`plan_not_eligible`). A failure is `409` with `details: { reason: "promotion_unavailable", detail }`, before any market lock, reservation or Stripe call. It never falls back to the full price.
- A valid promotion adds `discounts: [{ coupon: stripe_coupon_id }]` to the Checkout session and `promotion_slug`, `promotion_cohort`, `promotion_id` to the session and subscription metadata. When `replaces_trial` is set the trial is skipped entirely (no `trial_period_days`, no "Trial eligibility changed" `pricing_changed`), whatever `with_trial` says. The pricing quote still binds the list price; the coupon applies on top.
- The coupon and promotion id are part of the checkout reservation key, so a pending regular checkout and a promotional one are different reservations (the second gets `checkout_pending` until the first is cancelled or expires).
- `checkout_attempts.promotion_id` is set on the opened attempt (rejected attempts are recorded as `failed` without it).
- The response adds `promotion: { slug, percent_off, amount_due }`, `amount_due` being the discounted first payment in minor units.
- `checkout.session.completed` with `metadata.promotion_id` sets `promotion_recipients.redeemed_at` and `redeemed_checkout_session_id` after the subscription sync, only while `redeemed_at` is null, so replays and later sessions keep the first redemption.

## Configuration

Environment variables (see `src/shared/config/env.ts`):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | yes (prod) | — | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | yes (prod) | — | Stripe webhook signing secret |
| `STRIPE_WEEKLY_PRICE_ID`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID` (+ `STRIPE_TRY_*`) | yes (prod) | — | Plan prices per market; see `stripe-regional-setup.md` |
| `STRIPE_PRO_PRICE_ID` | no | — | Legacy Pro price, kept to recognise old subscriptions |
| `STRIPE_LIFETIME_PRICE_ID` | no | — | Legacy Lifetime price, kept to recognise old purchases |
| `BILLING_TRIAL_PERIOD_DAYS` | no | `3` | Trial length on the catalog's trial plan (Monthly since 2026-11-05); `0` disables the trial |
| `BILLING_CHECKOUT_SUCCESS_URL` | no | derived from `FRONTEND_APP_URL` | Checkout success redirect |
| `BILLING_CHECKOUT_CANCEL_URL` | no | derived from `FRONTEND_APP_URL` | Checkout cancel redirect |
| `BILLING_PORTAL_RETURN_URL` | no | derived from `FRONTEND_APP_URL` | Billing portal return URL |

## Known Limitations (Intentional for Phase 4C)

- no advanced invoicing workflows
- no coupon/campaign management beyond link-token promotions (see Promotional Checkout)
- no team/org billing
- no event replay ledger table for webhook dedup analytics
- no deep billing analytics pipeline
- storage usage is incremented on successful exports; deletion reconciliation is deferred
- lifetime purchases cannot be refunded via the in-app billing portal (handle manually in Stripe Dashboard)

## Monetization Tracking

Invoices, subscription history, checkout attempts, paywall denials, activity, FX rates and the
price/plan catalogs are recorded for analysis only; see `docs/monetization-tracking.md`.
