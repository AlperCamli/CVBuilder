# Promotions: spec and shared contract

The first campaign is `flash50-2026-11`: 50% off the **first month of the monthly Pro plan**. The discount **replaces the 3-day trial**, so the first payment is charged immediately at half price and later months cost the regular price. Every non-paying account gets an email with a personal link.

The send time is an A/B test. The audience is split in two at random, stratified by locale. Cohort A is emailed on Nov 4 at 10:00 Istanbul time (07:00 UTC), cohort B on Nov 4 at 18:00 Istanbul time (15:00 UTC). **Each cohort gets its own 24-hour window, starting at its send time.** Subject, copy and design are identical for both cohorts, so send time is the only variable.

The system is built for repeat use. A promotion is data: a `campaign.json` file, plus database rows created from it by a setup script. Running a new campaign means adding a new folder under `promotions/`. Extending a window means changing `ends_at` and re-running the setup script, with no code change. The campaign config is [`promotions/flash50-2026-11/campaign.json`](../../promotions/flash50-2026-11/campaign.json).

Emails are sent by an external email agent through a Gmail connector. The app sends nothing itself, which matches the trial-reminder pattern in [`docs/trial-reminder-queue.md`](../trial-reminder-queue.md).

## 1. Database (one migration, `backend/supabase/migrations/20261110120000_promotions.sql`)

```
promotions
  id uuid pk default gen_random_uuid()
  slug text unique not null
  name text not null
  percent_off integer not null check (percent_off between 1 and 100)
  plan_codes text[] not null            -- purchase plan codes: weekly | monthly | annual
  duration text not null check (duration in ('once','repeating','forever'))
  duration_in_months integer null       -- required iff duration = 'repeating'
  replaces_trial boolean not null default true
  stripe_coupon_id text not null
  site_url text not null
  utm jsonb not null default '{}'
  created_at timestamptz not null default now()
  archived_at timestamptz null

promotion_cohorts
  id uuid pk, promotion_id uuid fk -> promotions on delete cascade
  key text not null                     -- 'A', 'B', ...
  label text null
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at)
  unique (promotion_id, key)

promotion_recipients
  promotion_id uuid fk -> promotions on delete cascade
  user_id uuid fk -> users on delete cascade
  cohort_id uuid fk -> promotion_cohorts on delete cascade
  token text unique not null default encode(gen_random_bytes(18), 'hex')   -- the ?promo= link token
  assigned_at timestamptz not null default now()
  first_opened_at timestamptz null      -- first time the offer was resolved through the link
  open_count integer not null default 0
  redeemed_at timestamptz null          -- set from the webhook when a discounted checkout completes
  redeemed_checkout_session_id text null
  primary key (promotion_id, user_id)

marketing_email_preferences
  user_id uuid pk fk -> users on delete cascade
  unsubscribe_token text unique not null default encode(gen_random_bytes(24), 'hex')
  opted_out_at timestamptz null
  created_at / updated_at timestamptz

checkout_attempts  + promotion_id uuid null fk -> promotions on delete set null
```

RLS is enabled on every new table, with no policies for `anon` or `authenticated`. Only `service_role` (the backend) can access them. The admin-analytics role may get SELECT on `promotions` and `promotion_cohorts`, plus aggregate-only access to recipients, if the analytics work needs it later.

### View `public.promotion_email_queue` (read-only, `service_role` only, `security_invoker`)

One row per recipient of an unarchived promotion who is **still eligible when the query runs**. Excluded:
- `users.is_internal`
- accounts pending deletion (`deletion_requested_at`) or with restricted processing (`processing_restricted_at`)
- accounts with a subscription in `active`, `trialing` or `past_due` (`plan_code <> 'free'`)
- accounts that opted out (`marketing_email_preferences.opted_out_at is not null`)
- accounts that already redeemed

| Column | Meaning |
|---|---|
| `promotion_slug`, `cohort_key`, `cohort_label` | |
| `send_at` | Equal to the cohort's `starts_at`. The agent sends at or after this time. |
| `ends_at` | Never send after this time. |
| `hours_until_end` | numeric(1 decimal) |
| `user_id`, `email`, `locale` (`en` or `tr`) | |
| `first_name` | First word of `full_name` in its original case, or null |
| `offer_url` | `{site_url}{/tr if locale = tr}/pricing?promo={token}&utm_source=…&utm_medium=…&utm_campaign=…&utm_content={cohort_key}` |
| `unsubscribe_url` | `{site_url}{/tr if tr}/unsubscribe?t={unsubscribe_token}` |
| `sort_order` | Ordered by cohort, then locale |

A `marketing_email_preferences` row is created for each recipient when the setup script assigns recipients, so the unsubscribe token always exists.

## 2. Campaign setup script: `backend/scripts/promotions/setup-campaign.ts`

Run with `npm run promotion:setup -- --config ../promotions/<slug>/campaign.json [--dry-run]`. The script is idempotent:
1. Finds or creates the Stripe coupon, with metadata `promotion_slug` used to find it: `percent_off`, `duration`, `applies_to.products = [the product id of each plan in plan_codes]` (env `STRIPE_<PLAN>_PRODUCT_ID`), `name`. Coupons are currency-agnostic, so the same coupon covers USD and TRY. The script refuses to create anything in live mode unless `--live` is passed.
2. Upserts the `promotions` row, then upserts cohorts by `(promotion_id, key)`. Changing `ends_at` in the JSON and re-running extends the window.
3. Assigns recipients. Eligible means never subscribed or lapsed, using the same exclusions as the queue view. Each user gets a deterministic seeded random cohort, balanced within each `stratify_by` group. Users who already have an assignment keep it. By default no new recipients are added after the first cohort's `starts_at`. Ensures each recipient has a `marketing_email_preferences` row.
4. Prints a summary: counts per cohort and locale, the coupon id, and the mode (test or live). It never prints emails or tokens.

## 3. API contract (base `/api/v1`)

### `GET /promotions/offer?token=<token>`: public, rate-limited
Resolves a link token. Every call increments `open_count`, and the first call sets `first_opened_at`.
```json
{
  "status": "active" | "upcoming" | "ended" | "redeemed" | "ineligible" | "invalid",
  "promotion": { "slug": "flash50-2026-11", "percent_off": 50, "plan_codes": ["monthly"], "duration": "once",
                 "duration_in_months": null, "replaces_trial": true, "starts_at": "…", "ends_at": "…" } | null,
  "prices": { "market": "TR", "currency": "try",
              "plans": [ { "code": "monthly", "amount": 29990, "discounted_amount": 14995 } ] } | null
}
```
- `ineligible` means the user is currently paying, or the account has been deleted or restricted.
- `invalid` means the token is unknown. In that case `promotion` and `prices` are null.
- `prices` covers only the plans in `plan_codes`. It uses the token user's saved billing market if there is one, otherwise the request country, which matches what checkout will charge. `discounted_amount` uses Stripe's rounding: `amount - round(amount * percent_off / 100)`, in minor units.
- The response never includes the user's email or name.

### `POST /billing/checkout`: adds the optional body field `promotion_token: string`
When it is present, the server checks all of the following:
- the token exists and belongs to the **authenticated** user
- the cohort window is open
- `plan_code` is in `plan_codes`
- the recipient has not redeemed
- the promotion is not archived

If any check fails, the server returns **409** with `reason: "promotion_unavailable"` and `detail: "ended" | "upcoming" | "wrong_account" | "plan_not_eligible" | "redeemed" | "invalid"`. It never silently falls back to full price. The frontend then offers to continue at the regular price.

When the checks pass:
- Stripe Checkout gets `discounts: [{ coupon: stripe_coupon_id }]`.
- If `replaces_trial`, the trial is forced off (`trial_period_days = null`), whatever `with_trial` says.
- The metadata on the session and subscription gains `promotion_slug`, `promotion_cohort` and `promotion_id`.
- The idempotency key hash includes the coupon id.
- `checkout_attempts.promotion_id` is set.
- The response gains `promotion: { slug, percent_off, amount_due }` (`amount_due` is the discounted first payment, in minor units).
- The regional pricing quote still binds the list price, and the discount is applied on top.

### Webhook `checkout.session.completed`
If the metadata has `promotion_id`, the handler sets `promotion_recipients.redeemed_at` and `redeemed_checkout_session_id`. This is idempotent.

### `POST /marketing/unsubscribe` `{ "token": "<unsubscribe_token>" }`: public, rate-limited
Sets `opted_out_at` (and keeps the first value). Always returns `200 { "ok": true }`, even for an unknown token, so it doesn't reveal which tokens are valid.

## 4. Frontend contract
- `/pricing?promo=<token>` and `/tr/pricing?promo=<token>` (public guided-journey pricing), and the in-app pricing route, call `GET /promotions/offer`.
- When the token is active, the page shows:
  - a banner with a live countdown to `ends_at`
  - a "50% off first month" badge on the monthly plan only, with the list price crossed out and `discounted_amount` shown
  - no trial wording on the discounted CTA, and a disclosure: "then {price}/month, cancel anytime"
- When the offer is `ended`, `upcoming`, `redeemed`, `ineligible` or `invalid`, the page shows a short notice and normal prices.
- The token is stored in `sessionStorage` (wrapped in try/catch) and carried through signup or sign-in into the pending checkout, so a signed-out recipient still gets the discount after logging in. Checkout sends `promotion_token`, and the frontend handles every 409 `promotion_unavailable` detail.
- New page `/unsubscribe?t=` and `/tr/unsubscribe?t=` calls `POST /marketing/unsubscribe` and confirms in EN or TR. It works without signing in and is excluded from SEO.
- Copy goes in `en.json` / `tr.json`.

## 5. Email (outputs under `promotions/`)
- The reusable template is `promotions/_templates/offer-email.html`, a 600px table layout with inline CSS that works in Gmail and in dark mode. The renderer is `promotions/_templates/render.mjs`, and campaign copy lives in `promotions/<slug>/copy.{en,tr}.json`.
- Rendered output for each locale: `promotions/<slug>/email/email.{en,tr}.html` and `.txt`.
- Per-recipient placeholders: `{{first_name}}` (with a fallback greeting when it's empty), `{{offer_url}}`, `{{unsubscribe_url}}`.
- The mascot image is `frontend/public/images/email/<pose>.png`, at most 480px wide and under about 80 KB. It's referenced by its absolute `https://jobspecificcv.com/images/email/…` URL, so the frontend must be deployed before sending.
- The deadline is printed as text. For `tr`: "5 Kasım, 10:00 / 18:00 (İstanbul)". For `en`: Istanbul time plus UTC. Because the deadline differs by cohort, it's a placeholder too: `{{ends_at_display}}`.
- The send instructions for the email agent are in `docs/promotions/promo-email-agent.md`. They cover how to send, the de-dup key `(promotion_slug, user_id)`, never sending after `ends_at`, and sending each cohort at its `send_at`.

## 6. Safety rules for this build
- No git commits, pushes or deploys.
- Don't apply migrations to the production Supabase project. Write the migration and its SQL test only.
- Use Stripe test mode only.
- Send no emails.
- Never print secrets, emails or tokens.
