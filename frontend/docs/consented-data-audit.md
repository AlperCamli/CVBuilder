# Consented experience data audit — 8 October 2026

Journey: guided landing → upload → questions during processing → signup → score → editor.

Fixed gaps:

- Analytics initialization dropped events and page/component views before its
  configuration request finished. Only consented events now wait in bounded memory.
- General SPA screen navigation was unmeasured. Safe manual page views now cover
  public pages and app screens; accepting after page load records the current screen.
- The analytics parameter allowlist discarded useful flow/surface/path/method and
  outcome/count metadata. Safe keys are retained, with route/value sanitization.
- CV editing, AI suggestions, job/cover-letter writes and revision outcomes had
  no shared activity coverage. The app API wrapper records action/success/failure
  without request bodies, responses, IDs, URLs or provider errors.
- A choice made before account creation had no later database association on
  direct signup/login. Account readiness now triggers association and retry.
- Combined consent updates could replay a stale AI choice while syncing analytics.
  A locked analytics-only RPC updates only analytics and notice receipts.
- A slow acceptance could overwrite a later cross-tab rejection. Completion
  compares the browser preference snapshot and retries newer choices.
- Checklist/first-export settings writes silently ignored database failures.
  Serialized progress saves retry with backoff and show a retry status; account
  teardown disposes pending work.
- Guest answers/consent saves can be interrupted by navigation. Small requests
  use fetch keepalive; signup still waits for answers and privacy saves.

Verified existing persistence:

- Guest answers save to `guest_imports.answers` through authorized, serialized
  PATCH requests. Claim copies goal/career/education to `users.onboarding_answers`;
  referral stays out of the account/AI profile.
- CV parsing, suggestions and other provider calls use `ai_runs`, with guest runs
  transferred during claim. Parsed CV data, review context and account content
  persist through existing repositories. The score uses local scoring rules.
- CV editor content saves have an error/unsaved status and draft recovery. Preview
  generation, read-only history fetches and cosmetic UI preferences do not need
  database persistence merely because analytics consent was given.
- Consented guest referral/funnel totals aggregate at claim or abandonment
  cleanup, once per guest. Reports suppress cells below five. This is delayed
  aggregate reporting, not a copy of every GA event in the application database.

Expected exclusions and limits:

- Without analytics consent (including GPC), Google receives no app telemetry.
  With no guest/account yet, the browser choice is retained locally; its receipt
  is associated at upload/authentication rather than creating an extra visitor profile.
- Raw CVs/answers/IDs belong in authorized application storage, never Google
  event payloads. Essential CV saves do not depend on optional analytics consent.
- Before release, configure GA manual measurement and disable automatic enhanced
  collectors as documented in `ga4-conversion-tracking.md`. Verify collection in
  GA Realtime/DebugView; the app cannot read the property's reporting/filters.
- Network failures, browser blockers, closed tabs and offline exits can lose
  browser telemetry. No client implementation guarantees every interaction.
- Provider disclosures use the configured processor policy; do not turn OpenAI's
  no-training-by-default policy into a claim about unverified organization sharing
  settings. The app cannot inspect those settings using the ordinary API key.
