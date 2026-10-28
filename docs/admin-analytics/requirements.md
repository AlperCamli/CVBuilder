# Admin Analytics — Requirements (v1)

Internal dashboard for the CV Builder team at `admin.jobspecificcv.com`. It reads the production Supabase database; there is no separate data warehouse.

## Users and roles

| Role | Who | Access |
|---|---|---|
| Admin | Internal team, listed in `ADMIN_EMAILS` | Everything in this document |

- Admins sign in with Google through the same Supabase Auth project as the product.
- Any other signed-in account sees a "no access" page; signed-out visitors see the sign-in page.
- Admin accounts are the only internal accounts and are excluded from metrics by default. There is no manual flagging of test accounts.

## Functional requirements

### FR1 — Dashboards
Pages: **Overview, Monetization, AI cost & reliability, Engagement & retention, Tailoring v2, Acquisition, Data health, Users, Alerts.**

- KPI tiles show the current value and the change vs. the previous period of the same length.
- Every metric has an info tooltip with its definition and a link to its knowledge-base query.
- Charts mark data-era changes, for example "subscription history starts 2026-10-29".
- Groups with fewer than 5 users show a small-sample warning.
- Every page shows "data as of …".

### FR2 — Filters and sharing
- **Global filters:** date range (presets + custom), grain (day / week / month), currency (USD & TRY native / all in USD / all in TRY), include admin accounts (default off).
- All filter, breakdown and drill-down state is stored in the URL. Copying the link reproduces the view.
- All dates and times are UTC.

### FR3 — Interactive charts
- Hover tooltips, legend toggles, zoom or brush on time axes.
- **Breakdown selector** on charts that support it: market, plan, locale, AI flow, AI model/provider, template, onboarding path, currency. Long tails collapse into "Other".
- **Click-to-drill:**
  - clicking a bar, point or segment filters the page to it;
  - on failure and funnel metrics, it opens the list of users behind the number, and each user links to their timeline (FR4).

### FR4 — User lookup (signed-up users only)
- **Search** by email or user ID.
- **Account summary:** signup date, market, plan & subscription status, usage vs. plan limits, plan-limit denials, invoices, consent flags.
- **Timeline:** every action the user took, in chronological order. It is built on the KB query `queries/user_activity_timeline.md`, extended with tailoring sessions/tasks, checkout attempts, subscription events, invoices, entitlement denials and CV languages.
  - Failed or cancelled actions are highlighted with their stored error and duration.
  - The timeline can be filtered by event type and time window.
- **Shows metadata only.** No CV text, job descriptions, cover letter text or AI prompts and responses.
- **Privacy rules:**
  - Users with a pending deletion are not shown.
  - Erased users can't be found.
  - Users with restricted processing show a "restricted" marker only.
- Every search, profile view and timeline view is written to the audit log.

### FR5 — Freshness and refresh
- Live metrics are computed on request. Cached results in the browser are reused for up to 5 minutes.
- **Refresh** (per page) re-fetches everything on the page.
- **Recompute** rebuilds the heavy pre-computed metrics (cohorts, LTV, growth accounting) on demand. It is throttled to once every 5 minutes, and the heavy metrics also rebuild nightly.
- The Data health page shows the last nightly run, the last recompute, FX coverage and unpriced AI runs.

### FR6 — In-app alerts (no email in v1)
- Admins create, edit, mute and delete alert rules. A rule is a metric + window + condition, either a threshold or a % change vs. the previous window. Examples: AI cost/day > X, AI failure rate (1h) > Y%, failed payments today ≥ N.
- Rules are evaluated hourly in the database, with a per-rule cooldown so a rule doesn't fire repeatedly.
- Fired alerts appear as:
  - a header badge with the unacknowledged count;
  - an Alerts page with history and acknowledge;
  - a banner on Overview.
- Anomaly days (from `ai_daily_cost_anomalies`) are marked on the AI cost chart.

### FR7 — CSV export
- Any chart's data or user list can be downloaded as CSV with the current filters.
- User-list exports are written to the audit log.

## Out of scope

| Item | When |
|---|---|
| Social media analytics (Instagram, TikTok), creator role | v2 |
| Email alerts, scheduled email reports, email provider | v2 |
| Changing product data (refunds, trials, user edits, account flags) | Not planned |
| CV / AI content in user lookup | Not planned |
| Individual guest (not signed-up) visitors | Not planned |
| SQL editor / ad-hoc query builder | Not planned (KB stays the ad-hoc path) |
| GA4 traffic, ad spend, CAC | Not planned (not in the database) |
| Server error / crash log in the timeline | Later, if needed |
| Languages other than English; language editor coverage | Not planned |

The app writes only its own data: alert rules, alert acknowledgements, recompute requests and the audit log.

## Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | A page loads in under 2 s when warm; a cold backend start may add a few seconds. No analytics query runs longer than 15 s. |
| Correctness | One shared definition each for internal users, revenue (three currency variants via `fx_rates`) and AI cost. Dashboard numbers match the KB queries on the same data. |
| Security | The admin check runs on the server for every request. The service-role key never reaches the browser. Analytics functions can't be executed by `anon` or `authenticated`. Pages are `noindex`. |
| Privacy | User-level data is reachable only through audit-logged endpoints. Consent-dependent metrics are labelled "of consenting users". The privacy notice states that staff can view account activity. |
| Impact on product | Analytics must not slow the product: query timeout, heavy metrics pre-computed, read replica as the escape hatch. |
| Cost | No new paid services. |
| Maintainability | A new metric is one migration + one chart, with no backend deploy. |
| Devices | Built for laptops; Overview is readable on a phone. |
