# Promotions

A promotion is a time-limited Stripe discount offered to non-paying accounts by email, with a personal link per recipient. The first one is `flash50-2026-11`: 50% off the first month of monthly Pro, replacing the 3-day trial, with an A/B test on send time (cohort A 07:00 UTC, cohort B 15:00 UTC on Nov 4, each with its own 24-hour window).

The contract every part follows is [spec.md](spec.md). This page explains how the parts fit together and how to run, extend and archive a campaign.

## How it works end to end
1. **Config.** Each campaign is a folder `promotions/<slug>/` with `campaign.json` (discount, plans, cohorts and windows, UTM, assignment seed), email copy `copy.{en,tr}.json` and the rendered email under `email/`.
2. **Setup.** `npm run promotion:setup` reads `campaign.json` and:
   - finds or creates the Stripe coupon (metadata `promotion_slug`, `percent_off`, `duration`, `applies_to.products` = the plans' products, covering the USD and TRY prices);
   - upserts the `promotions` row and one `promotion_cohorts` row per cohort;
   - assigns every eligible account (non-paying, not internal, not pending deletion or restricted, not opted out) to a cohort with a deterministic seeded shuffle balanced per locale, which creates its `promotion_recipients` row and personal link token;
   - makes sure each recipient has a `marketing_email_preferences` row (the unsubscribe token).
3. **Send.** The operator exports `public.promotion_email_queue` ([promotion-email-queue.md](promotion-email-queue.md)) and hands it to the external email agent ([promo-email-agent.md](promo-email-agent.md)), which sends each cohort at its `send_at` and never after `ends_at`. The app sends nothing.
4. **Offer page.** The link `…/pricing?promo=<token>` calls `GET /api/v1/promotions/offer` (`backend/src/modules/promotions/`), which counts the open and returns the offer status and discounted prices. The frontend shows the countdown and the discounted monthly price.
5. **Checkout.** `POST /api/v1/billing/checkout` with `promotion_token` checks the token, window, plan and redemption, applies the coupon, turns the trial off when `replaces_trial`, and records `checkout_attempts.promotion_id`. Any failed check is a 409 `promotion_unavailable`, never a silent full-price checkout.
6. **Redemption.** The `checkout.session.completed` webhook sets `promotion_recipients.redeemed_at`, which removes the person from the queue.
7. **Unsubscribe.** `…/unsubscribe?t=<token>` calls `POST /api/v1/marketing/unsubscribe` (`backend/src/modules/marketing/`). It sets `opted_out_at` once and always answers `200 { ok: true }`, so it never reveals which tokens exist. Opted-out accounts leave the queue and are never assigned to later campaigns.

## Code map
| Part | Where |
|---|---|
| Tables, view, grants | `backend/supabase/migrations/20261110120000_promotions.sql`; test `backend/tests/sql/promotion-email-queue.sql` |
| Setup script | `backend/scripts/promotions/setup-campaign.ts`; pure logic (config schema, coupon terms, eligibility, cohort assignment) in `backend/scripts/promotions/campaign.ts`, tested by `backend/tests/promotion-setup.unit.test.ts` |
| Offer API, checkout and webhook | `backend/src/modules/promotions/`, `backend/src/modules/billing/` |
| Unsubscribe API | `backend/src/modules/marketing/`; test `backend/tests/marketing-unsubscribe.unit.test.ts` |
| Email template and renderer | `promotions/_templates/` |
| Privacy | Account deletion removes recipient and preference rows (foreign keys `on delete cascade`). The data export includes `marketing_email_preferences` and `promotion_recipients` without their tokens (`backend/src/modules/privacy/privacy.service.ts`). |

## Data model in one paragraph
`promotions` (one row per slug, with the Stripe coupon id and `archived_at`) → `promotion_cohorts` (key, `starts_at`, `ends_at`) → `promotion_recipients` (one row per promotion and account: cohort, link `token`, `first_opened_at`, `open_count`, `redeemed_at`). `marketing_email_preferences` is per account and shared by all campaigns (`unsubscribe_token`, `opted_out_at`). `checkout_attempts.promotion_id` records which checkouts used a promotion. Every table is backend-only (`service_role`, RLS on, no browser policies).

## The setup script
Run from `backend/` (it reads `backend/.env.local` like the app, or the process environment):

```bash
npm run promotion:setup -- --config ../promotions/<slug>/campaign.json --dry-run   # plan only
npm run promotion:setup -- --config ../promotions/<slug>/campaign.json             # test-mode key
npm run promotion:setup -- --config ../promotions/<slug>/campaign.json --live      # live-mode key
```

| Option | Effect |
|---|---|
| `--dry-run` | Prints the plan (coupon, promotion, cohort changes, recipients per cohort and locale). Writes nothing to Stripe or the database. Works before the migration is applied. |
| `--live` | Required for a live-mode Stripe key, even with `--dry-run`. Without it a live key is never used, and a non-dry run stops. |
| `--assign-after-start` | Also adds accounts that became eligible after the first cohort's `starts_at`. By default assignment closes then, so the A/B test isn't skewed by late signups. |
| `--allow-remote-test-db` | Allows a test-mode coupon to be written to a non-local Supabase project (a staging copy). Without it the script refuses, so a test coupon never ends up in the production database. |

It is idempotent: the coupon is found by `metadata.promotion_slug`, rows are upserted by `slug` and `(promotion_id, key)`, existing recipients keep their cohort and token, and existing preference rows keep their unsubscribe token and opt-out. The output contains counts, coupon and product ids only, never emails, names or tokens.

Environment it needs: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and the app's other required variables), `STRIPE_SECRET_KEY`, `STRIPE_<PLAN>_PRODUCT_ID` for each plan in `plan_codes` (or `STRIPE_PRODUCT_ID` for a shared product), and the plan's `STRIPE_<PLAN>_PRICE_ID` / `STRIPE_TRY_<PLAN>_PRICE_ID` so the coupon also covers a TRY price that lives on another product.

Stripe coupon names are limited to 40 characters. When `name` is longer, the coupon is named generically (`50% off first payment`); set `coupon_name` in `campaign.json` to choose the customer-facing name.

## Runbooks
### Run a new campaign
1. Copy `promotions/flash50-2026-11/` to `promotions/<new-slug>/`. The slug is lowercase letters, digits and dashes; use a new one for every campaign, because coupon terms can't be changed.
2. Edit `campaign.json`: `slug`, `name`, `percent_off`, `plan_codes`, `duration` (`once`, `repeating` plus `duration_in_months`, or `forever`), `replaces_trial`, `utm.campaign`, the cohorts with their UTC `starts_at`/`ends_at`, and `assignment.seed` (use the slug). One cohort is fine when there is no A/B test.
3. Write the copy (`copy.{en,tr}.json`) and render the email with `promotions/_templates/render.mjs`.
4. Check the frontend and backend support the plan and wording (for example, a discount on `annual` needs the pricing page badge on that plan).
5. Dry run, then run for real with `--live` well before the first `starts_at`. Check the summary counts.
6. Before each cohort's `send_at`, export the queue for that cohort and give it to the email agent.

### Extend a window
Change the cohort's `ends_at` in `campaign.json` and re-run the setup script (dry run first). Only the cohort row changes; the coupon has no expiry date, so it keeps working. Links, cohorts and tokens stay the same. If the email says the deadline (`{{ends_at_display}}`), update the copy too for any email not yet sent.

### End early or archive a campaign
Add `"archived_at": "<ISO time>"` to `campaign.json` and re-run the setup script. An archived promotion leaves the queue at once, and checkout rejects its tokens. Set `"archived_at": null` and re-run to undo it. Rows are kept for analysis: never delete a `promotions` row that checkouts used (`checkout_attempts.promotion_id` would be cleared). In Stripe you may also delete the coupon after the last window has ended; existing discounted subscriptions keep their discount.

### Check results
```sql
-- Opens and redemptions per cohort and locale (no personal data)
select p.slug, c.key, u.locale, count(*) as recipients,
       count(r.first_opened_at) as opened, count(r.redeemed_at) as redeemed
from public.promotion_recipients r
join public.promotions p on p.id = r.promotion_id
join public.promotion_cohorts c on c.id = r.cohort_id
join public.users u on u.id = r.user_id
where p.slug = 'flash50-2026-11'
group by 1, 2, 3 order by 1, 2, 3;
```

## Deploying the first time
Order: **migration → backend → frontend → setup script → send**. The migration is additive (new tables, a nullable column, a view), so it is safe to apply before the code.

```bash
cd backend
npx supabase db push --linked --dry-run     # review: 20261110120000_promotions.sql (and nothing unfinished)
npx supabase db push --linked --yes
npm run promotion:setup -- --config ../promotions/flash50-2026-11/campaign.json --live --dry-run
npm run promotion:setup -- --config ../promotions/flash50-2026-11/campaign.json --live
```

`supabase db push` applies every pending local migration, so follow the clean-worktree procedure in `docs/admin-analytics/development.md` §8.

## Safety rules
- Use Stripe test mode while developing; the script needs `--live` for a live key.
- Never print or log emails, names, link tokens or unsubscribe tokens. Queue exports are personal data; delete them after the send.
- Each person gets at most one email per promotion (`(promotion_slug, user_id)` in the agent's send log), only inside their cohort's window, and only while they are in the latest queue export.
