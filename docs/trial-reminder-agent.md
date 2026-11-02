# Trial reminder email agent

How to run the external agent that sends trial reminder emails. JobSpecificCV doesn't send these itself. On a timer, you export the current trial list from the database and give it to the agent. The agent decides who gets which email, writes it in the right language and sends it, and it keeps a send log so nobody gets the same email twice.

Why it matters: the checkout screen promises "We'll email you a reminder before your trial ends". This agent keeps that promise. A reminder that actually arrives is what makes people comfortable entering a card for a free trial, and it prevents "I was charged without warning" refunds and chargebacks.

## 1. The routine

| Step | Who | What |
|---|---|---|
| 1 | You, every **4 hours** | Run the export query (section 2) in the Supabase SQL editor and download the result as CSV or JSON |
| 2 | You | Give the agent three things: the export, the current time in UTC, and the agent's send log from the previous run (empty the first time) |
| 3 | Agent | Picks the emails due now, writes them in EN or TR, sends them, and returns the updated send log plus a short report |
| 4 | You | Keep the updated send log for the next run |

Why every 4 hours: the reminder window is 24 hours wide (section 3), so even if you skip a run or two, nobody misses their reminder. Running more often is fine; running less often than every 12 hours risks a late reminder.

## 2. Export query

Supabase dashboard → project **CVBuilder** → SQL Editor → run the query below → export the result as CSV or JSON.

```sql
select subscription_id, email, full_name, locale, plan_code, market,
       price_display, billing_interval, trial_end, hours_until_trial_end,
       category, canceled_at
from public.trial_reminder_queue
order by sort_order;
```

- People still in their trial come first, soonest ending first. People who canceled during their trial come last.
- The list only holds people who need an email now or soon. Paying customers, internal accounts and deleted accounts are never in it.
- The export contains personal data (emails and names). Don't store it anywhere beyond what the agent needs, and delete old exports.

The columns are described in [trial-reminder-queue.md](trial-reminder-queue.md). The ones the agent uses:

| Column | Meaning |
|---|---|
| `subscription_id` | The trial's id. Used in the send log so the same trial never gets the same email twice. |
| `email`, `full_name` | Recipient. `full_name` may be empty. |
| `locale` | `tr` or `en`. Write the email in this language. |
| `price_display`, `billing_interval` | Price after the trial, e.g. `149,90 TL` + `week` → "haftalık 149,90 TL", or `$4.99` + `week` → "$4.99 per week". |
| `trial_end` | When the trial ends and the first charge happens (UTC). |
| `hours_until_trial_end` | Hours left at export time. Negative only for canceled trials that already ended. |
| `category` | `in_trial` (will be charged at `trial_end`) or `trial_canceled` (canceled, won't be charged). |
| `market` | `TR` or `GLOBAL`. Decides the time zone shown in the email (section 3). |

## 3. The rules

The agent sends at most **one** email of each type per trial:

| Email type (`reminder_kind`) | Who | When |
|---|---|---|
| `ends_in_24h` | `category = in_trial` | `hours_until_trial_end` is between 2 and 26 |
| `ends_soon` | `category = in_trial` | `hours_until_trial_end` is 2 or less **and** `ends_in_24h` was never sent (a late fallback so the promise is still kept) |
| `cancel_confirmed` | `category = trial_canceled` | Any time it's in the list |

- Never send `ends_soon` if `ends_in_24h` was already sent for that trial.
- Never send an `in_trial` email to someone whose latest row is `trial_canceled`.
- The send-log key is `subscription_id + reminder_kind`. If the key is already in the log, skip.
- Anyone not in the newest export gets no email, even if a previous export had them (they may have paid, deleted the account or been removed).
- Show the charge time in the person's time zone: `Europe/Istanbul` for market `TR`, otherwise UTC with "UTC" written after the time. Format dates in the email's language (TR: "4 Kasım 2026, 19:59"; EN: "November 4, 2026, 4:59 PM UTC").

What every email must contain:
- the exact date and time of the charge (in_trial) or the confirmation that no charge will happen (canceled);
- the price and interval exactly as the data says;
- how to cancel: **Profile → Cancel trial** at https://jobspecificcv.com/app/profile (in_trial only);
- a plain, honest tone, with no pressure tactics, fake urgency, discounts or marketing content (these are service messages);
- no tracking pixels and no link shorteners.

## 4. The agent prompt

Paste this as the agent's instructions. Replace the `{{…}}` parts each run, or let the agent read them from the files you attach.

````text
You send trial reminder emails for JobSpecificCV (https://jobspecificcv.com), an AI CV builder. People start a 3-day free trial by entering a card; when the trial ends, the card is charged automatically for the plan shown in the data. We promised every trial user a reminder email before they are charged. Your job is to keep that promise accurately and politely.

## Inputs (each run)
1. EXPORT: the current trial list (CSV or JSON). Columns: subscription_id, email, full_name, locale (tr|en), plan_code, market (TR|GLOBAL), price_display, billing_interval (week|month|year), trial_end (UTC timestamp), hours_until_trial_end (hours left at export time), category (in_trial|trial_canceled), canceled_at.
2. NOW_UTC: the current time in UTC: {{NOW_UTC}}
3. SEND_LOG: the list of emails already sent, one entry per line as `subscription_id,reminder_kind,sent_at_utc`. It may be empty.

## Decide who gets an email
For each row in EXPORT:
- If category = in_trial and 2 < hours_until_trial_end <= 26, and the log has no `ends_in_24h` for this subscription_id: send `ends_in_24h`.
- If category = in_trial and hours_until_trial_end <= 2, and the log has neither `ends_in_24h` nor `ends_soon` for this subscription_id: send `ends_soon`.
- If category = trial_canceled and the log has no `cancel_confirmed` for this subscription_id: send `cancel_confirmed`.
- Otherwise send nothing.
Never email anyone who is not in this EXPORT. Never send the same subscription_id + reminder_kind twice. If a row looks wrong (no email, trial_end missing, unknown category or locale), skip it and mention it in your report.

## Write the email
- Language: Turkish if locale = tr, English otherwise. Turkish uses the friendly "sen" form, like the product.
- Greeting: use the first word of full_name when present ("Merhaba Ayşe," / "Hi Ayşe,"), otherwise "Merhaba," / "Hi,".
- Time zone: Europe/Istanbul for market TR; otherwise UTC, written with "UTC". Use the person's language for date formats (TR: "4 Kasım 2026, 19:59"; EN: "November 4, 2026, 4:59 PM UTC").
- Price: price_display plus the interval ("haftalık 149,90 TL" / "$4.99 per week"; monthly: "aylık" / "per month"; yearly: "yıllık" / "per year").
- Keep it short (under 120 words), honest and calm. No discounts, no pressure, no exclamation marks in subjects, no tracking links. Sign as "JobSpecificCV".

ends_in_24h and ends_soon (charge is coming):
- Subject EN: "Your JobSpecificCV trial ends on {date}". TR: "JobSpecificCV denemen {date} tarihinde bitiyor".
- Say the trial ends at {date time}, and that the card will then be charged {price + interval} automatically, until they cancel.
- Say that, to keep using it, they don't need to do anything.
- Say how to cancel without being charged: Profile → Cancel trial at https://jobspecificcv.com/app/profile, before {date time}.
- ends_soon only: say plainly that the trial ends in under 2 hours.

cancel_confirmed (they canceled during the trial):
- Subject EN: "Your JobSpecificCV trial is canceled". TR: "JobSpecificCV denemen iptal edildi".
- Confirm they will not be charged.
- If trial_end is in the future: say they can keep using it until {date time}.
- Say their CVs stay in their account and they can come back any time.
- You may ask in one sentence what made them cancel (reply to this email). Nothing else.

## Send and report
Send each email with your email tool. Then return:
1. SEND_LOG: the full updated log, with the old entries plus one new line per email actually sent: `subscription_id,reminder_kind,sent_at_utc`.
2. REPORT: how many emails of each kind you sent, any failed sends (with the error), and any skipped rows (with the reason). Don't repeat email addresses or names in the report; use subscription_id.
If you can't send emails, return the drafts (to, subject, body) instead and do NOT add them to SEND_LOG.
````

## 5. Example emails

Use these as a reference for tone; the agent writes its own from the rules above.

**TR, `ends_in_24h`**
> **Konu:** JobSpecificCV denemen 4 Kasım 2026 tarihinde bitiyor
>
> Merhaba Ayşe,
>
> 3 günlük ücretsiz denemen 4 Kasım 2026, 19:59'da bitiyor. Sonrasında kartından haftalık 149,90 TL otomatik olarak çekilecek; iptal edene kadar her hafta yenilenir.
>
> Kullanmaya devam etmek istiyorsan bir şey yapmana gerek yok. Ücret ödemek istemiyorsan bu tarihten önce Profil → Denemeyi iptal et adımıyla iptal edebilirsin: https://jobspecificcv.com/app/profile
>
> JobSpecificCV

**EN, `cancel_confirmed`**
> **Subject:** Your JobSpecificCV trial is canceled
>
> Hi Sam,
>
> Your trial is canceled and you won't be charged. You can keep using JobSpecificCV until November 4, 2026, 4:59 PM UTC, and your CVs stay in your account if you come back later.
>
> If you have a moment, just reply and tell us what made you cancel. It helps us improve.
>
> JobSpecificCV

## 6. Checks before the first real run

- Do one run with your own test account in a trial and check that the email arrives, that the date, time and price are right, and that the cancel link works.
- Make sure the sender address is set up for deliverability (SPF/DKIM for the sending domain). Otherwise reminders land in spam, and the promise is broken anyway.
