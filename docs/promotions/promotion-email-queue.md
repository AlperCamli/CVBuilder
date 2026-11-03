# Promotion email queue

`public.promotion_email_queue` is a read-only view for the external email agent that sends promotional offers (for example `flash50-2026-11`). It lists every recipient of an unarchived promotion who can still be emailed right now, with a ready-to-use personal offer link and unsubscribe link. The app sends no promotional emails itself.

- **Migration:** `backend/supabase/migrations/20261110120000_promotions.sql`
- **Test:** `backend/tests/sql/promotion-email-queue.sql`, run by `npm run test:privacy-sql`
- **Filled by:** `npm run promotion:setup` (see [README.md](README.md)). Nobody is in the queue until the setup script has assigned recipients.

## Access
- Only the backend secret key can read it (`service_role`: SELECT only). `anon`, `authenticated` and the admin-analytics role have no access. RLS doesn't apply because it's a `security_invoker` view read as `service_role`. The underlying tables (`promotions`, `promotion_cohorts`, `promotion_recipients`, `marketing_email_preferences`) have RLS on with no browser policies.
- **Current setup:** the email agent gets no database access. Run the export query below by hand and pass the result to the agent, as described in [promo-email-agent.md](promo-email-agent.md).
- If the agent ever queries the database directly, don't give it the secret key (`sb_secret_…`), which can read and write every table. Create a dedicated read-only role that can see only this view instead.
- The view holds personal data (email, first name) and two bearer links: `offer_url` carries the recipient's promotion token and `unsubscribe_url` their unsubscribe token. Anyone holding a row can open that person's offer or unsubscribe them. Keep exports only as long as the send needs them, and don't log full rows.

## Rows
There is one row per `(promotion, account)` in `promotion_recipients`, as long as all of these hold **when the query runs**:
- the promotion is not archived (`promotions.archived_at is null`);
- the account has not redeemed this promotion (`redeemed_at is null`);
- the account has not opted out of marketing email (`marketing_email_preferences.opted_out_at is null`);
- the account is not internal (`users.is_internal`), pending deletion (`deletion_requested_at`) or restricted (`processing_restricted_at`);
- the account has no subscription in `active`, `trialing` or `past_due` with `plan_code <> 'free'` (it is not paying or in a trial);
- the account has a `marketing_email_preferences` row. The setup script creates one for every recipient; a recipient without one has no unsubscribe link and is left out.

Rows are **not** filtered by time. A cohort whose window has ended stays in the view with a negative `hours_until_end`, and a cohort that hasn't started yet is already there. The agent decides what is due (see below).

Ordering: by cohort send time (`send_at`), then promotion and cohort key, then `locale` (`en` before `tr`), then `user_id`. The view has an `ORDER BY`, but REST and SQL clients should still order by `sort_order` explicitly.

## Columns
| Column | Type | Meaning |
|---|---|---|
| `promotion_slug` | text | Campaign id, for example `flash50-2026-11` (`promotions.slug`) |
| `cohort_key` | text | A/B cohort, for example `A` or `B` |
| `cohort_label` | text, nullable | Operator label, for example `10:00 Istanbul` |
| `send_at` | timestamptz | The cohort's `starts_at`. Send at or after this time. |
| `ends_at` | timestamptz | The cohort's window end. **Never send after this time.** |
| `hours_until_end` | numeric(1 decimal) | Hours from now to `ends_at`; negative once the window has ended |
| `user_id` | uuid | Account id (`public.users.id`). With `promotion_slug` it is the de-duplication key. |
| `email` | text | Account email |
| `locale` | text | `en` or `tr`. Send the email in this language. |
| `first_name` | text, nullable | First word of `full_name` in its original case; null when there is no name. Use the fallback greeting then. |
| `offer_url` | text | `{site_url}[/tr]/pricing?promo={token}&utm_source=…&utm_medium=…&utm_campaign=…&utm_content={cohort_key}` |
| `unsubscribe_url` | text | `{site_url}[/tr]/unsubscribe?t={unsubscribe_token}` |
| `sort_order` | bigint | 1..N in the order described above |

`/tr` is added for `locale = 'tr'`. UTM values come from `promotions.utm` (the campaign's `utm` block); a missing key is left out of the link.

## Export query (run by hand, pass the result to the email agent)
Supabase dashboard → project **CVBuilder** → SQL Editor → run → export as CSV or JSON.

```sql
-- One campaign; every cohort (the agent sends each at its send_at)
select promotion_slug, cohort_key, send_at, ends_at, hours_until_end,
       user_id, email, locale, first_name, offer_url, unsubscribe_url
from public.promotion_email_queue
where promotion_slug = 'flash50-2026-11'
order by sort_order;

-- Only the rows that are due right now (window open)
select promotion_slug, cohort_key, send_at, ends_at, hours_until_end,
       user_id, email, locale, first_name, offer_url, unsubscribe_url
from public.promotion_email_queue
where promotion_slug = 'flash50-2026-11' and send_at <= now() and ends_at > now()
order by sort_order;

-- Counts only (safe to share): who is still in the queue per cohort and locale
select cohort_key, locale, count(*)
from public.promotion_email_queue
where promotion_slug = 'flash50-2026-11'
group by 1, 2 order by 1, 2;
```

Export each cohort **shortly before its `send_at`**, not once for the whole campaign. The view is a live snapshot: someone who subscribed, opted out or deleted their account after an earlier export must not be emailed from a stale file.

**Supabase REST (PostgREST)**, if a direct read is ever set up:
```bash
curl -s "https://brgzizrnwsqnvjtvfbbs.supabase.co/rest/v1/promotion_email_queue?promotion_slug=eq.flash50-2026-11&cohort_key=eq.A&order=sort_order" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

## De-duplication is the agent's job
The view records nothing about what was sent. The same person stays in it until the promotion is archived, they redeem, opt out, start paying, or their account is deleted or restricted. The agent keeps its own send log keyed by **`(promotion_slug, user_id)`** and checks it before sending, so each person gets at most one email per promotion.

Rows change between runs:
- A row disappears when the person redeems the offer, opts out through `unsubscribe_url`, starts a subscription or trial, is marked internal, or requests deletion or restriction.
- Archiving the promotion (`archived_at`) removes all of its rows.
- Extending a window (a new `ends_at` plus a setup re-run) changes `ends_at` and `hours_until_end` only; tokens and cohorts stay the same.
