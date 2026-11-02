# Trial reminder queue

`public.trial_reminder_queue` is a read-only view for an external email agent that runs on a timer and sends trial reminders. It lists accounts in a card-backed trial, and accounts that canceled during their trial. The app sends no reminder emails itself.

- **Migration:** `backend/supabase/migrations/20261107130000_trial_reminder_queue.sql`
- **Test:** `backend/tests/sql/trial-reminder-queue.sql`, run by `npm run test:privacy-sql`

## Access
- Only the backend secret key can read it (`service_role`: SELECT only). `anon`, `authenticated` and the admin-analytics role have no access. RLS doesn't apply because it's a `security_invoker` view read as `service_role`.
- **Current setup:** the email agent gets no database access. Run the export query by hand and pass the result to the agent, as described in [trial-reminder-agent.md](trial-reminder-agent.md).
- If the agent ever queries the database directly, don't give it the secret key (`sb_secret_…`), which can read and write every table. Create a dedicated read-only role that can see only this view instead.
- The view holds personal data (email, name). Keep only what you need to send the email, and don't log full rows.

## Rows
There is one row per account, built from its **latest trial subscription** (the one with the latest `trial_start`). The account appears only if that subscription is in one of these categories:

| `category` | Meaning |
|---|---|
| `in_trial` | Status `trialing`, `trial_end` is in the future, and no cancellation is scheduled. The card is charged at `trial_end`. |
| `trial_canceled` | Canceled during the trial (either a cancel scheduled while trialing, or status `canceled` with `canceled_at` between `trial_start` and `trial_end`), and `trial_end` is less than 24 hours ago. These people won't be charged. |

Excluded:
- internal accounts (`users.is_internal`, which the nightly refresh sets from `ADMIN_EMAILS`);
- accounts pending deletion (`deletion_requested_at`) or with restricted processing (`processing_restricted_at`).

Ordering: `in_trial` rows come first, soonest `trial_end` first, then `trial_canceled` rows, also by `trial_end`. The view has an `ORDER BY`, but REST and SQL clients should still order by `sort_order` explicitly.

## Columns
| Column | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Account id (`public.users.id`) |
| `subscription_id` | uuid | The trial subscription the row is built from (`public.subscriptions.id`). Use it in de-duplication keys, because a later trial gets a new id. |
| `email` | text | Account email (`public.users.email`) |
| `full_name` | text, nullable | Name the person gave at signup |
| `locale` | text | Interface language: `en` or `tr`. Send the email in this language. |
| `plan_code` | text | Plan the trial converts to (for example `weekly`) |
| `market` | text, nullable | `TR` or `GLOBAL` (from the subscription, else the account's locked billing market) |
| `currency` | text, nullable | `USD` or `TRY` |
| `unit_amount` | bigint, nullable | Price charged after the trial, in minor units (cents or kuruş) |
| `billing_interval` | text, nullable | `week`, `month` or `year` |
| `price_display` | text, nullable | Ready-to-print price: `$4.99` for USD, `149,90 TL` for TRY. Add the interval yourself, for example "per week" or "haftalık". |
| `trial_start` | timestamptz | Trial start (UTC) |
| `trial_end` | timestamptz | Trial end, which is when the first charge happens (UTC) |
| `hours_until_trial_end` | numeric(1 decimal) | Hours from now to `trial_end`. It's negative for a trial that already ended, which only happens for `trial_canceled` rows, down to -24. |
| `category` | text | `in_trial` or `trial_canceled` |
| `canceled_at` | timestamptz, nullable | When the cancellation was requested |
| `sort_order` | bigint | 1..N in the order described above |

## How the agent should query it
**Supabase REST (PostgREST):**
```bash
curl -s "https://brgzizrnwsqnvjtvfbbs.supabase.co/rest/v1/trial_reminder_queue?select=*&order=sort_order" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```
- With a new `sb_secret_…` key, the `apikey` header is enough. The legacy `service_role` JWT needs both headers.
- Filters use PostgREST syntax. For example, reminders due in the next 24 hours:
  ```
  ?category=eq.in_trial&hours_until_trial_end=lte.24&order=sort_order
  ```

**SQL** (a direct connection as `postgres` or `service_role`):
```sql
-- Trials ending within a day: the "your trial ends tomorrow" reminder
select user_id, subscription_id, email, full_name, locale, price_display, billing_interval, trial_end, hours_until_trial_end
from public.trial_reminder_queue
where category = 'in_trial' and hours_until_trial_end <= 24
order by sort_order;

-- Canceled during the trial: a win-back or feedback email
select user_id, subscription_id, email, full_name, locale, trial_end, canceled_at
from public.trial_reminder_queue
where category = 'trial_canceled'
order by sort_order;
```

## De-duplication is the agent's job
The view is a live snapshot. The same person stays in it for every run until their trial ends (or for 24 hours after a canceled trial ends), so every run will see them again. The view records nothing about what was sent.

The agent must keep its own send log and check it before sending. A good key is `(subscription_id, category, reminder_kind)`, for example `(…, 'in_trial', 'ends_in_24h')`.

Choose reminder windows (for example 24 hours and 2 hours before `trial_end`) wider than the timer interval, so that a missed run doesn't skip a reminder.

Rows change between runs:
- A row can move from `in_trial` to `trial_canceled` when the person cancels.
- A row disappears when the trial converts to paid, when the account is deleted or restricted, or 24 hours after a canceled trial ends.

Before sending, re-read the row (or check that it is still in the latest snapshot), so you never email someone who just canceled or deleted their account.
