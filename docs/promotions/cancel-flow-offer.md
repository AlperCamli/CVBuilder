# Cancel-flow offers and plan changes

When someone clicks **Profile → Cancel trial** or **Cancel subscription**, the app shows one screen (`/app/cancel`) before Stripe's cancellation. The screen has a full-size **No thanks, cancel my …** button directly under the offer. Cancelling never depends on the screen loading: if nothing can be loaded, the app goes straight to Stripe.

Each audience has its own one-time offer:

| Cancelling | Offer | How it is accepted | Charged |
|---|---|---|---|
| Free trial (on Monthly; a few trials started before 2026-11-05 are on Weekly) | 50% off the first month of Monthly (`trial-cancel-save50`) | Stripe Checkout; the trial is ended at Stripe once it is paid | ₺174,95 now, then ₺349,90 monthly |
| Paid Weekly | Monthly from the end of the paid week, first month 50% off (`weekly-cancel-save50`) | In place: a subscription schedule switches the plan at the period end | Nothing now; ₺174,95 when the week ends, then ₺349,90 monthly |
| Monthly | 50% off the next renewal (`monthly-cancel-save50`) | In place: a `once` coupon on the subscription | Nothing now; ₺174,95 at the next renewal, then ₺349,90 |
| Annual | No offer: a "here's what you'd lose" screen with **Keep Pro** | n/a | n/a |

An account can accept one cancel-screen offer in total. For example, someone who paid the trial offer doesn't later get the Monthly offer. Without an offer (Annual, an archived promotion, or an offer already used), the screen lists what Pro includes. It shows **Keep Pro** and **No thanks, cancel my …**.

Each offer is a promotion like the email campaigns ([README.md](README.md)): a `campaign.json`, a Stripe coupon and a `promotions` row. It has `channel: "cancel_flow"` and a `cancel_audience` (`trial`, `weekly`, `monthly` or `annual`), and no cohorts, links or emails. An Annual offer can be added later with a campaign whose audience is `annual` and whose plan is `annual` (its next renewal is discounted).

## The trial offer: what "Keep Pro" does
Since 2026-11-05 the free trial is on the Monthly plan (it was on Weekly before). The offer and its mechanism are the same for both: the trial being cancelled can be a monthly trial or a legacy weekly one, and the screen reads its plan and price from the subscription.

1. **Stripe Checkout, paid now.** The button opens a Stripe Checkout for the monthly price in the trial's own market (TRY or USD), with the 50% `once` coupon and no trial. The amounts come from the Stripe price IDs, so the screen always shows the live price. With today's TRY price, the user pays ₺174,95 instead of ₺349,90.
2. **On payment, the trial is ended at Stripe.** Once the new monthly subscription is `active`, the backend cancels the trial subscription immediately, with no invoice and no proration. The trial therefore ends and is never charged: no first monthly charge at day 3 (or, for a legacy weekly trial, no weekly charge). This runs from every sync of the new subscription, so it happens through the `checkout.session.completed` webhook and through the return page's confirmation, whichever arrives first. The accepted offer row makes repeats a no-op.
3. **Pro starts.** Stripe returns to `/app/checkout?…&checkout=success`, which confirms the payment and shows the usual "Welcome to Pro" screen with the Pro benefits. Backing out of Stripe returns to the offer screen with "Payment wasn't completed. Your free trial hasn't changed."

| When | Charge (TR market) |
|---|---|
| Paying at checkout | ₺174,95, the first month at 50% off; the trial ends |
| The trial's original end | nothing; the trial no longer exists |
| A month after paying | ₺349,90, then monthly until cancelled |

This was verified in Stripe test mode with a test clock on a weekly trial (payment 17495 kuruş, no trial invoice after day 3, then 34990). A monthly trial goes through the same steps; only the plan of the subscription that is ended differs.

Safeguards:
- The offer only appears while the trial has more than two hours left. The checkout session expires within 60 to 90 minutes, so it can never be paid after the trial has already billed.
- Repeated clicks within the same half hour reuse one Stripe session, through an idempotency key.
- The trial is only ended if it belongs to the same Stripe customer as the new subscription.
- The replacement is recorded in the trial's cancellation comment (`replaced_by:<subscription id>`), not in a metadata update. A metadata update would send a "still trialing" webhook, and syncing it would deactivate the new paid subscription, because the database allows one active or trialing subscription per account. The ended trial is stored as `inactive` (superseded), not as a canceled trial.

## The paid offers
Both are applied in place, with nothing charged at the time. Stripe uses the card on file later. Both were checked in Stripe test mode with test clocks:
- **Paid Weekly → Monthly:** a subscription schedule keeps the current paid week as it is, then switches to Monthly with the coupon on its first invoice. It is released after one cycle. The test clock gave nothing until the week ended, then 17495, then 34990. Until the switch, Profile shows "Switching to Monthly on {date}" with **Keep Weekly**.
- **Monthly (or Annual) renewal discount:** a `once` coupon on the subscription discounts its next invoice. The test clock gave 17495 at the renewal, then 34990. The offer is refused if the subscription already has a discount.

## Who sees an offer
The offer appears only when all of these are true. Otherwise the no-offer screen shows:
- the subscription is `trialing` (on any plan: Monthly, or a legacy Weekly trial), or `active` on Weekly, Monthly or Annual with no plan change waiting;
- no cancellation is scheduled, and the trial or paid period has more than two hours left;
- the account has never accepted a cancel-screen offer;
- the account has a locked billing market and regional prices are available;
- an unarchived `cancel_flow` promotion exists for that audience (the newest one is used).

## Plan changes from Pricing
A paying account's **Choose {plan}** button doesn't start a second subscription. Instead:
- **Upgrade (longer plan), or any change during a trial:** Stripe's confirmation page (portal flow `subscription_update_confirm`). It shows the amount due today, prorated against the unused part of the current period, and charges it at once. A trial keeps its trial and is charged the new plan at its end.
- **Downgrade (shorter plan):** `/app/change-plan?plan=…` explains that the current plan stays active until its end, the remaining time isn't refunded, and the new plan starts then. Confirming creates the same kind of subscription schedule (no coupon). Nothing is refunded or credited. The test clock gave Annual → Monthly at the year end, no customer balance, then 34990. **Keep {plan}** (on that page or in Profile) releases the schedule.
- While a change is waiting, every **Choose** button leads to the change-plan page, which shows the waiting change and **Keep {current} instead**.

The pending change is written to the Stripe subscription's metadata (`cv_scheduled_plan_code`, `cv_scheduled_change_at`). Each sync copies it to `subscriptions.scheduled_plan_code` / `scheduled_change_at`, and `GET /billing/plan` returns it as `scheduled_change`. The metadata stays after the switch, because schedule phase metadata is merged, so a change only counts as pending while its time is in the future and differs from the current plan.

Downgrades made in the Stripe portal itself (**Manage billing → Update plan**) follow the portal setting `schedule_at_period_end`. New portal configurations get it automatically. The two existing live ones need `npm run stripe:regional-portals -- --schedule-downgrades` (see below).

Internal accounts see it too, so the screen can be tested with a real trial.

## Data
- `promotions.channel` is `email` (the default, for every email campaign) or `cancel_flow`. A cancel-flow promotion has exactly one plan.
- `promotion_cancel_offers` has one row per promotion and account. It records `first_shown_at`, `last_shown_at` and `show_count` (the screen was shown), `last_checkout_at` (Keep Pro opened checkout), `declined_at` (the user opened Stripe's cancellation after seeing the offer) and `accepted_at` (paid, and the trial ended). The table is backend-only. Account deletion removes the rows, and the data export includes them.
- `checkout_attempts` records the offer's checkouts with `promotion_id`.
- `trial_reminder_queue` leaves out accounts that now have another active or past-due paid subscription. Someone who paid the offer gets no reminder and no "trial canceled" email.
- Stripe metadata on the new subscription: `cancel_offer=1`, `promotion_slug`, `promotion_id`, `replaces_subscription`, `replaces_plan_code`.

Funnel for the slug, excluding internal accounts: shown `count(*)`, then checkout opened `count(last_checkout_at)`, then paid `count(accepted_at)`.

Analytics note: since `20261112120000_trial_outcomes_charge_pending.sql`, the "Trial to paid" metric counts a trial ended by the paid offer as converted (outcome `converted_switch`, `replacement_subscription_id` = the monthly subscription): the replacement was created between the trial start and the trial end + 1 day and has a collected `subscription_create` or `subscription_cycle` invoice. If nothing was collected (e.g. a 100% coupon), the ended trial stays `superseded` (not resolved). A plan change made during a trial is on the same subscription, so it converts through its paid first renewal (`converted`) or a paid plan-change invoice (`converted_plan_change`), and the paid-weekly and renewal offers never change how the original trial counted. The paid monthly subscription counts as new MRR. In Plan mix, replacing a legacy weekly trial counts as a weekly → monthly switch; replacing a monthly trial is no plan switch (monthly → monthly). The `analytics-monetization.sql` test covers both.

## API (base `/api/v1`, signed in)
- `GET /billing/cancel-offer` returns `{ status: "available", offer: { kind, slug, percent_off, plan_code, currency, amount, discounted_amount, current_plan_code, current_amount, period_end } }`, or `{ status: "unavailable", offer: null }`. `kind` is `checkout` (trial), `switch_at_period_end` (paid Weekly) or `renewal_discount` (Monthly/Annual). The call records the show. Amounts are in minor units, and the response never includes the coupon or any Stripe id.
- `POST /billing/cancel-offer/checkout` with body `{ success_url?, cancel_url? }` is for the trial only. Both URLs must be on the app's own origin. It returns `{ checkout_url, checkout_session_id, currency, amount, amount_due }`.
- `POST /billing/cancel-offer/accept` with body `{}` is for the paid kinds only. It returns `{ accepted: true, offer, plan }`.
- Both accept paths return 409 `cancel_offer_unavailable` when the offer no longer applies.
- `POST /billing/portal` with `flow: "cancel"` (the **No thanks** button) records the decline. With `flow: "change_plan", plan_code` it opens Stripe's confirmation for an upgrade; a downgrade gets 409 `plan_change_downgrade`.
- `POST /billing/plan-change { plan_code }` schedules a downgrade at the period end. It returns 409 `plan_change_not_downgrade`, `plan_change_pending` or `plan_change_unavailable` when that doesn't apply.
- `DELETE /billing/plan-change` keeps the current plan by releasing a waiting change.

## Turning it on, changing it, turning it off
Apply migration `backend/supabase/migrations/20261111120000_cancel_flow_offers.sql`. Then run each step from `backend/` with the production Stripe key and price IDs, trying `--dry-run` first:

```bash
npm run promotion:setup -- --config ../promotions/trial-cancel-save50/campaign.json --live
npm run promotion:setup -- --config ../promotions/weekly-cancel-save50/campaign.json --live
npm run promotion:setup -- --config ../promotions/monthly-cancel-save50/campaign.json --live
npm run stripe:regional-portals -- --schedule-downgrades   # portal downgrades wait for the period end
```

The script creates (or finds) the coupon `50% off your first month` on the monthly product. Every monthly price, USD and TRY, is on that product. The script also writes the `promotions` row and prints which offer the screen now shows. To turn the offer off, add `"archived_at": "<ISO time>"` to the config and re-run. To change the discount, use a new slug: coupon terms cannot change at Stripe.

## Code
| Part | Where |
|---|---|
| Screens | `frontend/src/app/pages/CancelSubscription.tsx` (`/app/cancel`), `frontend/src/app/pages/ChangePlan.tsx` (`/app/change-plan`), `frontend/src/app/components/CancelOfferScreen.tsx`, `frontend/src/app/integration/cancel-offer.ts`; Pricing and Profile |
| Offers and plan changes | `BillingService` `getCancelOffer`, `createCancelOfferCheckout`, `acceptCancelOffer`, `finishCancelOffer`, `schedulePlanChange`, `releasePlanChange` in `backend/src/modules/billing/billing.service.ts` |
| Stripe | `StripeBillingGateway` `cancelReplacedSubscription`, `scheduleSubscriptionChange`, `releaseScheduledChange`, `applyRenewalDiscount`, plan-change portal flow in `backend/src/modules/billing/stripe-gateway.ts`; portal setting in `portal-setup.ts` |
| Offer rows | `backend/src/modules/promotions/` |
| Tests | `backend/tests/cancel-offer.integration.test.ts`, `backend/tests/sql/cancel-flow-offers.sql`, `frontend/src/app/components/CancelOfferScreen.test.tsx`, browser check `frontend/scripts/verify-cancel-offer.mjs` |
