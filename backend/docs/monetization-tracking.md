# Monetization Tracking

Tables that record billing facts for analysis. The application never reads them to grant or
deny access, so access behaviour is unchanged. Migration:
`supabase/migrations/20261029120000_monetization_tracking.sql`.

All tables are `service_role` only (no browser access). Amounts are in Stripe minor units
(cents / kuruş).

## Tables

| Table | One row per | Written by |
|-------|-------------|------------|
| `billing_invoices` | Stripe invoice (and legacy lifetime purchase, `provider_invoice_id = lifetime_<cs_id>`) | Webhooks `invoice.finalized/paid/payment_failed/voided/marked_uncollectible`, `charge.refunded`. The invoice is re-read from Stripe on every event, so the row is the latest state. |
| `subscription_events` | Status / plan / cancel-flag change of a subscription | DB trigger on `subscriptions` (covers webhook syncs, superseding, legacy purchases) + erasure worker |
| `checkout_attempts` | `POST /billing/checkout` call | `BillingService.createCheckoutSession`; resolved by `checkout.session.completed/expired` and checkout cancel |
| `entitlement_denials` | Day × user × plan × action × surface × reason (with `count`) | `assertSubscriptionAccess` / `assertActionAllowed` when they refuse |
| `user_activity_days` | User × active day | Authenticated requests (at most one write per user per day per instance) |
| `fx_rates` | Month × currency pair | Daily refresh cron |
| `billing_price_catalog` | Stripe price id configured in env (current + `STRIPE_HISTORICAL_PRICES`) | Daily refresh cron |
| `billing_plan_catalog` | Plan in `plan-definitions.ts` (limits, features, trial days) | Daily refresh cron |
| `trial_transition_cohorts` | Trial release cohort | Migration snapshot; erasure worker counts erased members |
| `subscription_erasure_stats` | Month × plan × status | Erasure worker, before subscriptions are deleted |

New columns:

- `subscriptions`: `trial_start`, `trial_end`, `canceled_at`, `ended_at`, `cancellation_reason`
  (Stripe `cancellation_details.reason`), `cancellation_feedback` (portal survey; free-text comments
  are not stored), `unit_amount`, `currency`, `billing_interval` (`week`/`month`/`year`/`one_time`),
  `market` (copied from `billing_markets`), `last_provider_event_id/at` (used by the history trigger).
- `usage_counters`: `plan_code`, `subscription_id` stamped on each increment. With a mid-month plan
  change the row keeps the latest plan; use `subscription_events` for exact splits.
- `users.is_internal`: exclude from analysis. Emails in `ADMIN_EMAILS` are flagged by the daily
  refresh; other accounts can be flagged by hand (the refresh never clears the flag).

## Semantics and caveats

- **`subscription_events.event_type`**: `created`, `trial_started`, `trial_converted` (trialing→active),
  `trial_canceled` (trialing→canceled/incomplete_expired), `activated`, `renewed` (active and
  `current_period_start` moved forward), `plan_changed`, `cancel_scheduled`, `cancel_unscheduled`,
  `past_due` (also `unpaid`), `canceled`, `superseded` (app replaced it with another active
  subscription), `reactivated` (active again after past_due/unpaid/canceled/inactive), `status_changed`.
- **`source`**: `stripe` (webhook; `occurred_at` is the Stripe event time), `app` (app-side change or
  checkout confirmation; `occurred_at` is processing time), `backfill`, `account_deletion`.
- History before this migration is one `created` row per subscription (`source = 'backfill'`,
  `to_status` = status at migration time). Stripe keeps events for 30 days only, so older
  transitions cannot be reconstructed; invoices can (see backfill).
- A trial whose first charge fails goes `trialing → past_due`, not `trial_converted`. The exact
  conversion signal is the first `paid` invoice with `billing_reason = 'subscription_cycle'` after the trial.
- **`billing_invoices.status`** is Stripe's status, except a paid invoice with refunds becomes
  `refunded` / `partially_refunded`. `created_at` is the invoice creation time at Stripe.
  `period_start/end` are the service period of the plan line (not Stripe's invoice period).
  `plan_code` comes from the plan line (not proration credits); it is null for prices not configured in env.
- Refunds of legacy lifetime purchases are not tracked (one-time charges have no invoice); the
  `lifetime_<cs_id>` row keeps `amount_refunded = 0`.
- **`entitlement_denials`**: `action = 'app_access'` is the route-level paywall, with `surface` = first path
  segment (`ai`, `exports`, `dashboard`, ...). Other actions (`export_pdf`, `ai_action`, ...) come from
  the service-level checks. Reasons: `no_subscription`, `subscription_inactive`, `trial_expired`,
  `free_limit`. Hits blocked only in the frontend never reach the backend.
- **Consent**: `entitlement_denials.user_id` and `user_activity_days` are only written for users with
  analytics consent (`users.analytics`) and without restricted processing. Without consent the denial is counted in the anonymous
  row (`user_id is null`); activity is not recorded. Withdrawing consent removes both. Internal
  accounts are not counted in denials.
- **`fx_rates`**: monthly average of ECB reference rates (via Frankfurter), `rate` = TRY per 1 USD.
  The running month is month-to-date (`is_final = false`) and is finalised after month end.
- **Erasure**: before deleting an account the worker calls `archive_billing_history`, which records a
  `canceled` event for live subscriptions, bumps `subscription_erasure_stats` and the trial cohort,
  then clears `user_id` and provider ids on invoices, events and checkout attempts. Amounts, plans,
  currencies, markets and dates remain. `subscription_id` is a plain uuid (no foreign key), so an
  erased account's invoices and events stay grouped.
- `trial_transition_cohorts.cohort_size` was snapshotted on 2026-10-29; accounts erased between the
  grant (2026-10-24) and the snapshot are not included.

## Operations

1. **Apply the migration before deploying the backend.** Subscription syncs now write the new
   `subscriptions` columns; deploying the code first makes every subscription webhook fail.
2. In the Stripe dashboard, add these events to the webhook endpoint (USD and TRY setups use the
   same endpoint): `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`,
   `invoice.marked_uncollectible`, `charge.refunded`, `checkout.session.expired`.
3. `CRON_SECRET` must be set (already required by the guest cleanup cron). The refresh runs daily
   at 03:30 UTC: `GET /api/v1/billing/analytics/refresh`.
4. Run the one-off backfill once after deploy: `npx tsx scripts/backfill-monetization.ts --dry-run`,
   then without `--dry-run`. It fills the new subscription columns, imports every invoice of known
   Stripe customers, refreshes the catalogs and loads monthly FX back to the first subscription.
   It is safe to re-run and never changes subscription status or plan.
