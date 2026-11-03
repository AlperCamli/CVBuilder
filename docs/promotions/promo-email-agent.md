# Promotion email agent

How to run the external agent that sends promotion emails, starting with `flash50-2026-11` (50% off the first month of monthly Pro, 24 hours, two send-time cohorts). JobSpecificCV doesn't send these itself. You export the recipient list from the database by hand and give it to the agent with the rendered email files. The agent sends one email per recipient through the Gmail connector and keeps a send log so nobody gets the email twice.

The contract for the data and the offer is in [spec.md](spec.md). This document covers the sending side (spec §5). It follows the same pattern as [trial-reminder-agent.md](../trial-reminder-agent.md).

## 1. The routine

`flash50-2026-11` has two cohorts. Both get the same subject, copy and design; only the send time (and therefore the deadline text) differs, because send time is what the A/B test measures.

| Cohort | `send_at` (UTC) | Istanbul | `ends_at` (UTC) |
|---|---|---|---|
| A | 2026-11-04 07:00 | Wed Nov 4, 10:00 | 2026-11-05 07:00 (Thu 10:00 Istanbul) |
| B | 2026-11-04 15:00 | Wed Nov 4, 18:00 | 2026-11-05 15:00 (Thu 18:00 Istanbul) |

| Step | Who | When | What |
|---|---|---|---|
| 0 | You | Day before | Run the pre-send checklist (section 7). |
| 1 | You | At cohort A's `send_at` (not earlier) | Run the export query (section 2) and download the result as CSV or JSON. |
| 2 | You | Right after | Give the agent: the export, `NOW_UTC`, the send log (empty the first time), the files in `promotions/flash50-2026-11/email/` and the `COHORT` to send (`A`). |
| 3 | Agent | | Sends cohort A, returns the updated send log and a short report. |
| 4 | You | At cohort B's `send_at` | Export again (opt-outs and purchases since the morning drop out automatically), then repeat steps 2–3 with `COHORT = B` and the send log from step 3. |
| 5 | You | | Keep the final send log. Delete the exports. |

Always export fresh right before a send: the view only lists people who are eligible at query time, so a fresh export drops anyone who unsubscribed, subscribed or redeemed in the meantime. Send each cohort promptly at its `send_at`. A late send skews the A/B test and gives that cohort less of its 24 hours.

## 2. Export query

Supabase dashboard → project **CVBuilder** → SQL Editor → run the query → export as CSV or JSON.

```sql
select promotion_slug, cohort_key, cohort_label, send_at, ends_at, hours_until_end,
       user_id, email, locale, first_name, offer_url, unsubscribe_url
from public.promotion_email_queue
where promotion_slug = 'flash50-2026-11'
order by sort_order;
```

- The full column reference and more queries are in [promotion-email-queue.md](promotion-email-queue.md).
- The view already excludes internal accounts, accounts pending deletion or with restricted processing, current subscribers (active, trialing or past due), people who opted out, and people who already redeemed.
- `offer_url` and `unsubscribe_url` are personal. They carry the recipient's token, so never mix rows up, and never paste one person's link into another person's email.
- The export holds personal data (emails, names, tokens). Don't store it beyond the send, don't paste it into chat, and delete it afterwards.

| Column | Meaning |
|---|---|
| `promotion_slug` | `flash50-2026-11`. Part of the de-dup key. |
| `cohort_key` | `A` or `B`. Picks the send time and the `{{ends_at_display}}` text. |
| `send_at` | Don't send to this row before this time (UTC). |
| `ends_at` | Never send to this row at or after this time (UTC). |
| `hours_until_end` | Hours left in the row's window at export time. |
| `user_id` | Part of the de-dup key. Use it in reports instead of the email address. |
| `email` | Recipient. |
| `locale` | `en` or `tr`. Picks the email files and subject. |
| `first_name` | First word of the account name, or null. |
| `offer_url` | Personal link to the discounted pricing page. Goes into `{{offer_url}}`. |
| `unsubscribe_url` | Personal one-click unsubscribe link. Goes into `{{unsubscribe_url}}`. |

## 3. The email files

`node promotions/_templates/render.mjs flash50-2026-11` writes these files to `promotions/flash50-2026-11/email/`. Re-run it after any change to `copy.*.json` or the template, and never edit the output by hand.

| File | Use |
|---|---|
| `email.en.html`, `email.tr.html` | HTML body for `locale = en` / `tr`. |
| `email.en.txt`, `email.tr.txt` | Plain-text alternative for the same locale. |
| `manifest.json` | Subject, preheader, greeting strings and the `ends_at_display` text for each cohort and locale. |

Subjects (identical for both cohorts):

| Locale | Subject |
|---|---|
| `en` | `50% off your first month of Pro, 24h only` |
| `tr` | `Pro’da ilk aya %50 indirim, sadece 24 saat` |

The Turkish subject contains a typographic apostrophe (’). Copy it exactly from `manifest.json`.

`{{ends_at_display}}` values:

| Cohort | `en` | `tr` |
|---|---|---|
| A | `Thursday, Nov 5 at 10:00 Istanbul time (07:00 UTC)` | `5 Kasım Perşembe, 10:00 (İstanbul saati)` |
| B | `Thursday, Nov 5 at 18:00 Istanbul time (15:00 UTC)` | `5 Kasım Perşembe, 18:00 (İstanbul saati)` |

## 4. Building one email: exact replacement

Everything is plain string replacement on the file contents, done in this order. Replace every occurrence of each placeholder, not just the first.

1. Pick the files by `locale`: `email.{locale}.html` and `email.{locale}.txt`. If `locale` is anything other than `en` or `tr`, skip the row and report it.
2. Decide the name. Trim `first_name`. Treat it as empty if it's null or empty, longer than 30 characters, or contains `@`, a digit, `http` or `{`. If it's entirely lowercase, capitalize the first letter using the row's language rules (in Turkish, `i` becomes `İ`, as in `ilker` → `İlker`).
3. If the name is empty, use the fallback greeting. Replace the exact string `greeting_with_name` with `greeting_fallback` (from `manifest.json`) in both files:
   - `en`: `Hi {{first_name}},` → `Hi there,`
   - `tr`: `Merhaba {{first_name}},` → `Merhaba,`
4. In the HTML file, HTML-escape every value before inserting it: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`. This applies to the URLs too, because their `&utm_…` parts must become `&amp;utm_…` inside `href`. In the text file, insert the values unchanged.
5. Replace `{{offer_url}}` with `offer_url`, `{{unsubscribe_url}}` with `unsubscribe_url`, and `{{ends_at_display}}` with the value for the row's `cohort_key` and `locale` (section 3).
6. Replace `{{first_name}}` with the name. Do this last, so that nothing inside a name is ever treated as a placeholder.
7. Check the result. Neither file may still contain `{{`. Every `href` must start with `https://jobspecificcv.com`. If a check fails, don't send; report the `user_id`.

Don't change anything else in the HTML: no added tracking pixels, no link shorteners, no rewritten links, and no reformatting.

## 5. Sending rules

- Send a row only if `send_at <= NOW_UTC < ends_at` and `cohort_key = COHORT`. Never send after `ends_at`, even if the run started before it. Check the clock before each email, not only at the start of the run.
- The de-dup key is `(promotion_slug, user_id)`. If the key is in the send log, skip the row. One person gets at most one email per promotion, whichever cohort they're in.
- Only email people in the newest export. Someone who appeared in an earlier export but not the newest one has unsubscribed, paid or been removed.
- The send log is separate from the trial-reminder log. Its format is one line per email actually sent: `promotion_slug,user_id,cohort_key,locale,sent_at_utc`. Add a line only after the Gmail connector confirms the send.
- If a send fails, don't add it to the log. Retry once after a minute. If it fails again, report the `user_id` and the error, and move on.

### Gmail sending tips

- Send each email individually, one recipient in `To`. Never use BCC or CC, and never put more than one recipient on a message. Every link in the email is personal.
- Pace the sends: about one email every 5–10 seconds, with a pause of a minute or two after every 25. A cohort of about 55 takes 5–10 minutes. Stay well under Gmail's daily limits (about 500 per day for a personal account, 2,000 for Workspace).
- Send a multipart message, with the HTML body and the `.txt` file as the plain-text alternative. If the connector accepts only one body, send the HTML. Never send the text version alone when HTML is possible.
- If the connector allows custom headers, add `List-Unsubscribe: <{unsubscribe_url}>` with the row's raw URL. Gmail then shows its own unsubscribe link, which helps deliverability. The one-click `List-Unsubscribe-Post` header isn't supported yet, because the unsubscribe page needs a page load.
- Use the same sender name and address for both cohorts (for example `JobSpecificCV <…>`), so the sender isn't a second variable in the test.
- If Gmail starts returning rate-limit or "suspicious activity" errors, stop the run, report it, and let the operator decide. Don't keep retrying.

## 6. The agent prompt

Paste this as the agent's instructions. Attach the export, the send log and the four email files plus `manifest.json`, then fill in `NOW_UTC` and `COHORT`.

````text
You send a one-off promotion email for JobSpecificCV (https://jobspecificcv.com), an AI CV builder. The offer: for 24 hours, 50% off the first month of the monthly Pro plan (it replaces the 3-day free trial; regular monthly price after that; cancel anytime). The email files are already written. Your job is to personalize them with plain string replacement and send them, exactly once per person, inside each cohort's window.

## Inputs
1. EXPORT: rows from public.promotion_email_queue (CSV or JSON). Columns: promotion_slug, cohort_key (A|B), cohort_label, send_at (UTC), ends_at (UTC), hours_until_end, user_id, email, locale (en|tr), first_name (may be null), offer_url, unsubscribe_url.
2. NOW_UTC: {{NOW_UTC}}
3. COHORT: {{COHORT}}  (send only rows with this cohort_key)
4. SEND_LOG: lines of `promotion_slug,user_id,cohort_key,locale,sent_at_utc`. May be empty.
5. FILES: email.en.html, email.en.txt, email.tr.html, email.tr.txt, manifest.json.

## Who gets an email
For each row in EXPORT, send only if ALL are true:
- cohort_key = COHORT
- send_at <= current time < ends_at  (re-check the current time before each email; never send at or after ends_at)
- (promotion_slug, user_id) is not in SEND_LOG
- locale is en or tr, and email is present
Otherwise skip it. Never email anyone who is not in this EXPORT.

## Build each email (plain string replacement, in this order, every occurrence)
1. Files: email.{locale}.html and email.{locale}.txt. Subject: manifest.json → locales.{locale}.subject, copied exactly.
2. Name: trim first_name. Treat as empty if null/empty, longer than 30 characters, or containing "@", a digit, "http" or "{". If it is all lowercase, capitalize the first letter (Turkish rules for tr: i → İ).
3. If the name is empty: in both files replace manifest greeting_with_name with greeting_fallback (en: "Hi {{first_name}}," → "Hi there,"; tr: "Merhaba {{first_name}}," → "Merhaba,").
4. In the HTML file, HTML-escape every inserted value (& → &amp;, < → &lt;, > → &gt;, " → &quot;, ' → &#39;), including the URLs. In the text file insert values unchanged.
5. Replace {{offer_url}} with offer_url, {{unsubscribe_url}} with unsubscribe_url, {{ends_at_display}} with manifest locales.{locale}.ends_at_display.{cohort_key}.
6. Replace {{first_name}} with the name (last).
7. Verify: no "{{" remains in either body, and every href starts with https://jobspecificcv.com. If not, do not send; report the user_id.
Do not change any other part of the files. No tracking pixels, no link shorteners, no extra text.

## Send
- One email per recipient, recipient in To only. Never BCC or CC, never several recipients on one message.
- HTML body plus the .txt as the plain-text alternative (HTML only if the tool takes a single body).
- If the tool supports headers, add List-Unsubscribe: <unsubscribe_url> (the raw URL).
- Pace about one email every 5–10 seconds and pause a minute after every 25. If Gmail reports rate limits or blocks, stop and report.
- Add a SEND_LOG line only after the send succeeds. On failure, retry once after a minute, then report and move on.

## Return
1. SEND_LOG: the full updated log (old lines plus one new line per email actually sent): promotion_slug,user_id,cohort_key,locale,sent_at_utc
2. REPORT: emails sent per locale, rows skipped with the reason (already sent, outside window, other cohort, bad locale, failed check), and failed sends with the error. Use user_id only; never repeat email addresses, names or links.
If you cannot send emails, return the drafts for ONE en and ONE tr recipient (to, subject, html, text) for review, and do NOT add anything to SEND_LOG.
````

## 7. Pre-send checklist

Do all of this before cohort A goes out.

- [ ] **Frontend deployed.** `https://jobspecificcv.com/images/email/celebrate.png` loads (HTTP 200, `image/png`). Until the frontend with `frontend/public/images/email/` is deployed, the mascot image is broken in every email. The logo (`/images/logo.png`) is already live.
- [ ] **Offer page live.** The promotion API, the pricing-page offer banner and the `/unsubscribe` page are deployed (spec §3–§4), and the campaign setup script has run in **live** mode, so the queue view has rows and the Stripe coupon exists.
- [ ] **Render is current.** Run `node promotions/_templates/render.mjs flash50-2026-11`. It must finish without errors, and the files you attach must be the ones it just wrote.
- [ ] **Internal test send.** Run the agent once on a hand-made export holding only an internal test address. Use one `en` row and one `tr` row, a real test `offer_url` and `unsubscribe_url` (from a test recipient), one row with a `first_name` and one without. Check:
  - [ ] Subject, preheader (the inbox preview text) and greeting are right in both languages, and the fallback greeting shows when there's no name.
  - [ ] The mascot and logo load. The email looks right in Gmail web, the Gmail iOS or Android app (light and dark mode), and Apple Mail or Outlook if you have them.
  - [ ] **Click the button.** The pricing page opens with the offer banner and countdown, and the monthly plan shows 50% off with the crossed-out list price. **Confirm the discounted price shows** in both TRY (`/tr` link, or a TR billing market) and USD.
  - [ ] Go as far as Stripe Checkout (test mode, or stop before paying in live). The first payment is the discounted amount, and there's no free trial.
  - [ ] Click **Unsubscribe**. The confirmation page shows in the right language, and that test account is gone from the next export.
  - [ ] The plain-text part is present (in Gmail: ⋮ → Show original) and its links are complete.
- [ ] **Deliverability.** The sending address has SPF, DKIM and DMARC set up for its domain, and the test email didn't land in spam.
- [ ] **Legal.** Commercial email needs a lawful basis for each recipient. For Turkish recipients (Law No. 6563), check whether these accounts gave marketing consent and whether İYS registration applies to your sender. For US recipients (CAN-SPAM), add a postal address: set `footer_address` in both `copy.*.json` files and re-render. The unsubscribe link is already in every email.
- [ ] **Both cohorts get the same send.** Same sender, same subject, same files. Only the time and the `ends_at_display` text differ.

## 8. Reusing this for the next promotion

1. Create `promotions/<new-slug>/campaign.json` and run the setup script (spec §2).
2. Copy `copy.en.json` and `copy.tr.json` from this campaign and edit the text: percent, plan, duration, deadline strings per cohort, and the mascot `image_url`, `image_width` and `image_height` if the image changes. The template (`promotions/_templates/offer-email.html`) is generic and needs no change.
3. Run `node promotions/_templates/render.mjs <new-slug>`. It checks the subject length (45 characters at most, one emoji at most), required fields, the greeting placeholder, and that every `ends_at_display` matches the day, weekday and Istanbul time of the cohort's `ends_at` in `campaign.json`.
4. Optional preview: `node promotions/_templates/render.mjs <new-slug> --preview /some/dir/outside/the/repo` writes filled-in copies of each email, for every cohort, with and without a name, that point at the local image.
5. Change the slug in the export query (section 2) and in the agent prompt, and start a new, empty send log.
