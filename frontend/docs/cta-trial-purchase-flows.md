# CTA, trial, purchase and template flows

Implemented 24 October 2026. This implements Tasks 3.1–3.4 and supersedes the earlier freemium proposal for these journeys. The four onboarding questions remain in place.

> **Since 2026-11-05 the trial continues as Monthly Pro.** The 3-day free trial (card required, Stripe Checkout `trial_period_days`) is now attached to the Monthly plan: at trial end Stripe charges the regional monthly price (USD $14.99 / TRY ₺349,90, read live from the Stripe price IDs). Weekly stays purchasable as the lowest-commitment paid plan, charged immediately, without a trial; Annual is unchanged. Trial checkouts use `/app/checkout?plan=monthly&trial=1` and send `with_trial: true`; old links or saved intents that ask for a trial on another plan (`plan=weekly&trial=1`, `{ plan_code: "weekly", with_trial: true }`) are treated as a Monthly trial, never as an immediate Weekly charge. Subscriptions that started a Weekly trial before this date still convert to Weekly as promised at their checkout. Sections below that mention a Weekly trial or Weekly renewal describe the behaviour before this change.

## Trial entry

Public Start Free Trial buttons enter `/onboarding`. Users upload an existing PDF/DOCX or create a new CV, complete/skip the four questions, and create or sign into their account. Email verification and Google OAuth preserve the onboarding handoff.

Uploaded CVs are claimed by the authenticated account and reviewed on `/app/cv-score?source=guest&import=…`. A new, blank CV has nothing to score, so it skips the score page: the signup CTA reads “Create account & open CV editor”, and `/app/onboarding` creates the blank CV, applies any selected template and opens `/app/cv/:id`. Older `/app/cv-score?source=scratch` links redirect to that handoff.

The score page retains Continue to CV editor, Customize for a job, and Improve with AI. Before executing an action it checks the backend subscription state. An inactive account enters `/app/checkout` with the selected action, source, import and language encoded in a validated internal return destination. The checkout screen explains the 3-day trial, card requirement, regional renewal price of the trial plan (Monthly since 2026-11-05; Weekly before) and cancellation terms, then opens hosted Stripe Checkout.

Stripe returns to `/app/checkout?checkout=success&session_id=…`. The client asks the backend to confirm that session. The backend retrieves it from Stripe, verifies session/subscription ownership, completion/payment status and active/trialing state, and synchronizes the subscription. Only then does the client return to the saved score action and execute it. Refresh retains the action and import context.

A blank CV is created at signup, without activation, because the editor is free; tailoring and AI improvements are offered from the editor. Actual AI operations retain their consent checks.

## Direct Pro purchase

Public Weekly, Monthly and Yearly choices open `/signup?purchase=1` with an explicit selected-plan checkout destination. Pending plan state has a 24-hour expiry and supports signup refresh, email verification and Google OAuth. Existing authenticated accounts skip the signup form.

After authentication the checkout route acts as a background handoff to Stripe, without displaying an intermediate checkout page or requiring another click. It still verifies the account, current regional pricing and selected plan before opening Stripe. Errors, unavailable pricing or trial ineligibility reveal recovery controls immediately; a handoff taking longer than eight seconds also reveals the existing controls without creating a second checkout request. Deliberate trial activation and cancellation/success returns keep their existing screens and checks. Explicit paid choices (Weekly, Monthly, Annual) use `with_trial: false`; choosing a paid plan never silently selects a trial, and "Choose Pro monthly" charges the monthly price even for an account that could still start the trial. The trial card is the only entry to the free trial (decided 2026-11-05). Successful confirmation returns to `/onboarding?step=upload`, then questions and score. The active subscription means no second activation is required when selecting a score action.

Checkout API errors and a return from incomplete/canceled paid checkout show a 3-day trial alternative. That alternative opens trial activation and, after confirmation, the Upload/Create entry. A card declined inside Stripe stays within Stripe's payment form until the customer retries or returns to the app; the app shows its fallback on return. Accounts that have used their trial and have no unused transition offer are directed to Pro plans.

The cancellation return uses the approved mint upgrade-card design and the existing guide mascot mirrored to face left. Trial-eligible accounts see “Why don’t you try the free trial first?”, their live regional renewal terms for the trial plan (Monthly since 2026-11-05), a trial action, and a secondary retry for the originally selected paid period. Accounts without trial eligibility see paid retry/plan choices instead. Returning from a canceled trial retains trial activation rather than creating a paid subscription. All actions preserve the validated next destination; email/support links remain available. English and Turkish copy is localized. The nonfunctional “Let me help you choose” control is removed from public pricing.

Ordinary app navigation never consumes a saved purchase intent. Existing subscribers manage subscription changes through the billing portal rather than creating duplicate subscriptions.

## Trial activation screen and billing recovery (November 2026)

- The trial screen shows a timeline (today at zero, a reminder email before the trial ends, the first charge of the trial plan on today + trial days in the user's locale and regional price; Monthly since 2026-11-05, previously Weekly), the two-click cancel promise, a Stripe trust block, what Pro unlocks and a short FAQ. Paywalls open `/app/checkout?trial=1&source=<export|ai|tailoring|cover_letter>&next=…`; `source` picks the headline and survives Pricing, Stripe and the return.
- Trial Stripe sessions carry `custom_text.submit.message` in the account language with the trial end date in the browser's time zone (`time_zone` on the checkout request; Turkey or UTC otherwise).
- Profile shows Cancel trial / Cancel subscription, which opens the Stripe portal directly on the cancellation step (`flow: "cancel"`; falls back to the portal home if the configuration refuses), and Manage billing. Portal configurations must allow cancellation: `npm run stripe:regional-portals` reports it and `-- --enable-cancellation` turns it on.
- A `past_due`/`unpaid`/`paused` Stripe subscription is not sent to a new checkout: Checkout, Pricing and Profile offer Update payment method (`flow: "payment_method"`).
- Purchases from in-app Pricing return to `next` when present; accounts that finished the entry onboarding return to `/app` instead of the upload step. Signup → pay → onboarding from the landing is unchanged.
- `checkout.session.expired` resolves the attempt as `expired`; `20261107150000_checkout_expiry.sql` backfills attempts open for over 25 hours and expires them hourly with pg_cron.
- Funnel counters: `checkout_view`, `checkout_redirect`, `checkout_success` (trial|pro) and `checkout_canceled`, next to the existing GA4 events.

## Template selection

Template showcase start links and Make It Yours carry the actual catalog slug in the onboarding URL and retain it in browser storage for the 24-hour onboarding window. Preview-dialog CTAs use the previewed template; showcase CTAs use the currently selected template. Demo export handoffs also retain their selected style.

After activation and CV creation/import conversion, the selected active catalog template is assigned through the existing template API before opening the editor/job flow. AI-improved import conversion applies the same template. The renderer/exporter transforms the uploaded document's structured content into that template; the source facts are not replaced with sample content.

Unavailable templates produce an explicit recovery message and a Use default template option on the score screen. Existing upload/account ownership, expiry and storage-recovery behavior remains enforced. Pre-account browser-only state cannot be restored on another device without its original recovery state.

## Free tier (November 2026)

This supersedes the subscription wall in the sections around it: accounts without an active or trialing subscription use the app before entering a card.

| Capability | Free | Trial / Pro | Release cohort without Pro |
| --- | --- | --- | --- |
| App shell, dashboard, CV score, job tracker, templates, on-screen preview | yes | yes | yes (as free) |
| Upload/import a new CV, create or duplicate CVs, manual editing (main and tailored), photos, revisions, manual cover letters | yes | yes | yes |
| Improve with AI from the score page | once per account (`users.free_improve_used_at`) | yes | once (backfilled if already used) |
| AI tailoring session (analysis, questions, cards, refine, finish) | one session per account (`users.free_tailoring_used_at`, `tailoring_sessions.free_tier`) | yes | once (backfilled if already used) |
| Exports and downloads (any format, CV or cover letter), a second tailoring, all other AI (editor suggestions, translation, cover letter generation, legacy tailoring runs) | trial prompt | yes | trial prompt |

- The backend route map is `classifyAppRequest` in `backend/src/modules/entitlements/access-policy.ts`; `BillingService.authorizeAppRequest` applies it and `claimFreeUse` sets a marker with a conditional update when the free use starts (concurrent requests get one). A failed start releases it; deleting the CV does not. Trialing/Pro accounts never set markers.
- Refusals are `403` with `details: { reason: "trial_required", surface: "export" | "ai" | "tailoring" | "cover_letter" | "other", action }` and are recorded in `entitlement_denials` with that action and surface.
- `GET /billing/plan` adds `free_tier: { tailoring_available, improve_available }`; `can_edit_existing_cvs` is true for every account.
- The frontend no longer redirects from `SubscriptionGate`. Gated actions open the trial prompt (`showTrialPrompt`), which navigates to `/app/checkout?trial=1&source=<surface>&next=<return path>`. Export prompts return with `?resume=export` and the editor reopens the download after activation; score actions resume with `action=`.
- Funnel events: `score_view`, `score_action`, `free_tailoring_started`, `free_tailoring_finished`, `free_improve_used`, `paywall_shown`.

## Access and limits

Frontend route checks and backend middleware require active/trialing subscriptions for new document creation, AI, exports and job tailoring. New accounts still activate a trial or purchase Pro before entering the application.

Existing accounts in the release cohort retain access to the dashboard, My CVs, and owned main/tailored CVs without a subscription. They can read, manually edit/save, change templates and display settings, manage photos, review/restore revisions, and delete existing CVs. These permissions remain after the renewed trial is redeemed, expired or canceled. Creating or duplicating CVs, AI translation/inference, tailoring, all export formats and export-history download endpoints remain gated. Existing file ownership and restricted-account checks remain enforced.

The billing response separates `app_access` (full Pro access) from `can_edit_existing_cvs` (manual workspace access); trial eligibility does not control manual access. Free accounts report all four Pro entitlement flags as false even while old usage quotas are disabled. Direct API requests receive the same policy as frontend navigation. Manual editing needs no AI consent, while actual AI requests retain their consent requirement.

Editor Pro actions save pending edits before opening the existing dismissible limit/upgrade popup. Dismissing returns to manual editing. Tailoring deep links retain their destination; accounts with no trial remaining enter explicit paid checkout. Onboarding import reads/claiming, account/privacy management, pricing, checkout and public support remain reachable.

Defaults are configured in the backend, with examples in `backend/.env.example`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `BILLING_REQUIRE_SUBSCRIPTION` | `true` | Requires activation for Pro features and new-account application access |
| `FREE_USAGE_LIMITS_ENABLED` | `false` | Suspends the old free quotas while retaining their definitions, counters and enforcement code |
| `BILLING_TRIAL_PERIOD_DAYS` | `3` | Length of the free trial, which continues as Monthly Pro since 2026-11-05 (Weekly before) |

Reintroducing freemium later requires deliberately disabling subscription-required access and enabling free quotas, together with restoring appropriate public offers. Disabling quotas alone never bypasses subscription access checks. Legacy paid plans continue to be recognized.

Trial and subscription prices continue to come from signed regional pricing responses. Card collection is explicit in Stripe Checkout. A browser success query does not grant access. Confirmed trial activation is tracked separately from the paid checkout completion event, with existing analytics consent respected.

## Verification

- Frontend and backend TypeScript checks and production builds passed.
- Regression results: 175 frontend tests, 666 backend tests, and 17 isolated browser journey scenarios passed.
- Checkout follow-up: 175 frontend tests, TypeScript/production build, and 23 isolated browser journeys passed, including silent auto handoff, slow-request recovery without duplicate sessions, unavailable pricing, trial ineligibility, already-active accounts, and localized cancellation retry/trial paths. Desktop and mobile (390px/320px) cancellation layouts were inspected with the existing mascot mirrored left.
- Existing regression suites plus new subscription access, verified confirmation, return destination, template persistence and Stripe card-collection tests.
- `node scripts/verify-subscription-journeys.mjs` from `frontend` runs isolated browser journeys for the three score actions, all paid billing periods, email/verification/Google auth, purchase cancellation/error fallback, full upload/questionnaire/claim, scratch creation, template handoff, and unpaid/forged-success access attempts.
- Stripe test-mode hosted card checkouts verified both TRY and USD trials with three-day duration, trialing subscriptions and zero due today. Temporary test objects were cleaned up; no live subscriptions or charges were created.
- Public HTML snapshots are regenerated by the frontend build so server-rendered pages match the new CTAs and pricing terms.

The isolated browser tests exercise the real app UI with test transports. Provider email delivery and a personal Google account are not used. Actual Stripe test-mode checkout is verified separately from the app's isolated auth/payment journey tests.

## Existing-user transition (24 October 2026)

Apply `backend/supabase/migrations/20261024120000_trial_transition.sql` **before deploying the new backend**. It snapshots the app accounts present at migration time into a service-role-only grant table. Do not rerun this migration to add later signups. New accounts keep normal first-trial eligibility. The presence of a release-cohort grant also identifies existing accounts for permanent manual CV access, regardless of whether the grant has been redeemed.

Each existing account receives one fresh 3-day trial opportunity, including accounts with a previously consumed trial. Existing active paid/trial subscriptions are not changed; an unused transition offer remains available when they next need activation. No subscription is started automatically, no card is charged by the migration, and trial history is retained. Existing users who have never tried Pro receive one transition trial, not two stacked trials.

Existing users enter their manual CV workspace without a permissions banner or an automatic upgrade prompt. Attempting a premium action opens the existing `limit_reached` upgrade popup with short, feature-specific Pro-required wording. Trial-eligible accounts can activate their renewed trial; others can purchase Pro. Actual quota errors retain the existing limit-exceeded wording. Dismissal returns to manual editing. Premium navigation from My CVs or a direct URL opens the same popup and returns the underlying page to a manual workspace, while retaining the requested destination for successful checkout.

The onboarding checklist remains hidden on checkout so it cannot cover the activation button.

Only a verified Stripe subscription marked as the transition trial and showing a started trial redeems the grant. Failed or abandoned checkout does not use it. Confirmation and webhook retries are idempotent; cancellation does not restore it again. Direct paid purchases do not consume an unused grant. Account deletion cascades to the grant.

The public Support page and email option is implemented as described below. Contact forms and chat remain out of scope.


## Support page and email

- Public `/support` and `/tr/support` pages work without sign-in, subscription access, or backend availability. Both are prerendered and included in the sitemap with reciprocal locale links.
- The landing/pricing footer, shared site footer, and signed-in sidebar link to Support. Changing the interface language keeps visitors on the corresponding Support URL.
- FAQs cover trial activation, cancellation in the billing portal, the existing-user transition, failed payments, PDF/DOCX uploads up to 20 MB, exports, and sign-in recovery.
- Email buttons use `contact@jobspecificcv.com` with a prefilled subject. The visible address can also be copied; denied/unavailable clipboard access shows a manual-copy fallback. No account information is automatically added to the email.
- Checkout/payment and CV upload errors include email links with the relevant subject and a Support guide link that opens in another tab, preserving the current workflow.
- Browser verification covers English/Turkish public access, actual clipboard copying, denied clipboard access, FAQ expansion, responsive layout, language switching, upload errors, and payment-error support links. No email is sent by the tests.


## Turkey price update

The release target is TRY 149.90 per week and TRY 349.00 per month; the existing annual price remains unchanged. Production amounts are read from Stripe using the configured regional price IDs. Creating new Stripe prices also requires pointing `STRIPE_TRY_WEEKLY_PRICE_ID` and `STRIPE_TRY_MONTHLY_PRICE_ID` to those prices and redeploying the backend environment. Historical synthetic test catalogs are not customer-facing prices.
