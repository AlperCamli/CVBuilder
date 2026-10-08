# Privacy operations and release

JobSpecificCV requires explicit, current permission for its AI-powered CV
experience. A rejection pauses upload/the CV experience and never starts a
provider call. Users can enable AI later, withdraw it, and enable it again.
Privacy settings, exports, deletion and subscription management remain available
while AI permission is off. Analytics is always an independent optional choice
that can be revisited using the permanent Privacy choices link.

The application defaults to no new CV uploads, no external AI and no Google
Analytics until operator arrangements are verified. A consent checkbox cannot
replace a legal basis, processor contract or international transfer safeguard.

## Operator-supplied facts and unresolved review

The supplied brand is JobSpecificCV, based in Canada, with privacy contact
`camlialper03@gmail.com`. The operator states the primary Supabase and Vercel
hosting region is Germany. This is not a claim that subprocessors, billing,
support, backups, analytics or the external AI provider process only in Germany.
The brand is operated by individuals rather than an identified registered company.
The operator initially requested that personal names and the mailing address stay
off the website, then supplied controller identity and city-level contact details
in `.env.example`. Configured controller/contact fields are displayed in the
privacy notice and returned by the public configuration endpoint. Before collection activation, resolve the public legal
operator identification/contact requirements; a brand is not automatically a
substitute for the responsible legal operator. The reviewed English/Turkish draft
does not verify provider contracts, international transfers or legal bases.
Do not set the approval flags or invent processor-manifest values to bypass this.

## Release prerequisites

1. Verify the actual controller identity, appropriate contact details and controlled privacy inbox.
   Configure `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS` and
   `PRIVACY_CONTACT_EMAIL`. Do not substitute the product brand for legal identity.
   Resolve the operator's request to keep personal names/address private before
   activating collection. Use an appropriate verified business identity/contact
   arrangement where applicable; do not assume a private home address must be
   published on every screen, or that hiding the controller identity is permitted.
2. Complete the Canada/Turkey/EU/UK/US applicability review: record a lawful basis for
   each purpose, voluntary-answer handling, any sensitive/third-party CV data,
   age/audience requirements, relevant US state thresholds, representatives,
   registrations (including VERBIS where applicable), DPIA and breach procedures.
   This is business/legal work; these matters cannot be verified from code.
3. Verify processor DPAs, subprocessors, processing countries, security, retention,
   training settings and transfer mechanisms for Supabase, Vercel, Stripe,
   Google Analytics and each enabled AI provider. For Turkish standard contracts,
   verify the prescribed contract and notification formalities; EU SCCs alone
   do not establish compliance with KVKK or UK transfer requirements.
4. Set `PRIVACY_PROCESSORS_JSON` to an array of actual verified arrangements:
   each row has `id,name,purpose,countries,retention,safeguards` (all non-empty).
   Required IDs are `supabase` and `vercel`; add `stripe` for live payments,
   `google-analytics` for GA, and the exact `AI_PROVIDER` for external AI.
   The values appear in the public notice: do not publish invented regions,
   contractual claims or zero-retention promises. Document provider-specific
   retained data and erasure/request processes separately in the review record.
5. Verify managed Storage buckets are private. The migration makes `imports`,
   `exports` and `cv-assets` private and denies pending-erasure identities access.
   Audit any custom configured buckets and their owner policies too.
6. Verify Vercel/Supabase/provider log retention. Application logging omits request
   URLs, headers, IP/user-agent, body and arbitrary error details, but upstream
   platform logs are outside this logger's control. Set a 14-day maximum where
   supported; if unavailable, change the policy and approve the actual retention
   before release. Do not claim the code purges platform logs.
7. Verify backup lifetime and restore access. The erasure ledger remains for
   90 days after completed deletion and throughout pending deletion. Backup
   retention must fit within that horizon; extend ledger retention before enabling
   longer backups. Limit backup access, put erased data beyond routine use, and
   reapply erasures before allowing a restored system to serve traffic.
8. Verify the financial-record exception: document exactly what Stripe must
   retain and for how long. The deletion worker cancels recurring subscriptions
   and deletes the Stripe customer profile; it does not delete statutory invoice
   history or invent a universal tax-retention period.
9. In the GA property, disable Google Signals, advertising personalization, Google Ads links and Enhanced Measurement (including automatic page/history, outbound-click, form and download events). Code sends only allowed categorical event fields and a neutral page URL; GA auto-measurement must not independently collect authentication URLs or filenames. Validate the production property with network inspection.
10. After the above review, configure `PRIVACY_REVIEW_APPROVED=true`. External AI
   separately requires `PRIVACY_AI_PROVIDER_APPROVED=true` and a matching processor
   entry. Google Analytics requires its processor entry and each visitor's opt-in.

These flags are operator attestations, not automated legal certification. Bump
the notice version in backend/frontend whenever purposes/providers or material
terms change; obtain fresh relevant consent. AI grants are bound to provider ID and notice version,
so changing providers cannot reuse an earlier provider's permission.

Keep `PRIVACY_AI_REQUIRED=true` for the agreed product policy. AI approval and a
current user grant are prerequisites for new uploads. There is no user permission
defaulting to accepted. A failed AI analysis reports failure/retry instead of
silently presenting a parser-only result as completed AI analysis. Internal local
text extraction is still used to prepare the input sent to the approved provider.
The launch review must establish why the external AI processing is objectively
necessary for the specified service and identify the applicable legal basis;
making a checkbox mandatory does not establish necessity. Keep non-essential
analytics separate. Review the
[Canadian meaningful-consent guidance](https://www.priv.gc.ca/en/privacy-topics/collecting-personal-information/consent/gl_omc_201805/)
and [ICO conditions of valid consent](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/).

## Migration and deploy

`.env.example` is a setup template, not a runtime file. Local startup loads
`.env` and `.env.local`; deployment uses configured backend environment variables.
Copy verified privacy settings into the active environment without replacing API
keys or switching the active AI provider accidentally. The template currently
selects Gemini, while the existing local runtime selects OpenAI.

Approval switches alone do not enable the feature when the provider list is empty.
`docs/privacy-processors.json` contains the disclosures now used in the local
`PRIVACY_PROCESSORS_JSON`, covering Supabase, Vercel, OpenAI, Stripe, Analytics
and Google sign-in. They describe published provider policies and the operator's
Germany hosting configuration, without claiming zero retention or Germany-only
processing for every supplier. They do not verify account-specific contracts,
backup settings, GA property settings or jurisdiction-specific formalities.
For another environment, review the actual configuration and set its
`PRIVACY_PROCESSORS_JSON` to the matching JSON array; the reference file is not
automatically loaded. Restart the backend after changing its environment. The
browser refreshes availability when Privacy choices is reopened, the connection
returns or the window regains focus. Applying the privacy migration and keeping
maintenance healthy remain separate prerequisites for guest upload processing.

Published provider references used for these disclosures:

- [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)
  and [backup behavior](https://supabase.com/docs/guides/platform/backups).
- [Vercel DPA](https://vercel.com/legal/dpa)
  and [privacy/retention policy](https://vercel.com/legal/privacy-notice).
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- [Stripe DPA](https://stripe.com/legal/dpa)
  and [retention/transfers](https://stripe.com/privacy).
- [Google processor terms](https://business.safety.google/adsprocessorterms/),
  [GA4 retention settings](https://support.google.com/analytics/answer/7667196?hl=en)
  and [Google identity privacy](https://policies.google.com/privacy).

Run `npm run privacy:check` from `backend` for a read-only readiness report.
It checks the actual environment, required processor entries, AI credential
presence, privacy schema, cleanup heartbeat and private managed buckets. It
never prints secrets, changes approval flags or certifies legal compliance.
For analytics also configure the frontend measurement ID and verify the GA
property settings listed above. Copy the local cron secret into the backend
deployment environment through its protected environment-variable settings;
never commit it to `.env.example`.

Run `npm run test:privacy-sql` with PostgreSQL binaries on PATH. This builds an
isolated database, applies every migration and tests the RPCs/guards in rollback
transactions. It does not connect to Supabase or read environment secrets.

Apply `20261006160000_privacy_controls.sql` to the target database before releasing
the backend/frontend together. Coordinate a short analysis maintenance window:
database guards intentionally invalidate historical unconsented external AI.
Do not enable collection with incomplete provider/controller details. Existing
accounts default to disabled optional permissions, without fabricated receipts.

Upload-first AI tracking also requires
`20261007010000_guest_ai_run_tracking.sql` before the backend update. It preserves
account guards, tracks guest attempts without inventing accounts, transfers runs
atomically during claim, and erases unclaimed run payloads with their guest
session. Run `npm run test:privacy-sql` to verify claim/RLS/expiry/deletion races
in the isolated database. `npm run privacy:check` checks the required tracking
columns without returning CV or account rows.

## Daily maintenance and monitoring

Analytics synchronization requires `20261008010000_independent_analytics_consent.sql`
before deploying the updated backend and frontend. Its service-only RPC records
analytics and notice receipts without changing AI permission, its version or an
in-flight processing lease. Browser choices are associated after guest creation
or authentication; retries never manufacture consent for an unknown choice.

Keep the single Vercel cron at `0 3 * * *` UTC. Set backend `CRON_SECRET` in the
deployment environment. Never put it in frontend variables, URLs or this repo.

The existing `GET /api/v1/guest-imports/cleanup` accepts only
`Authorization: Bearer <CRON_SECRET>`. Operators can invoke the same route for a
manual retry. Logs use `PRIVACY_CLEANUP_*` and `PRIVACY_JOB_RETRY` codes; details
are in service-role-only `privacy_cleanup_health` / `privacy_jobs` rows.
`GET /api/v1/privacy/health` exposes only a healthy boolean and HTTP 200/503 for
uptime monitoring. Configure the production monitor to alert on 503 or a missed
daily heartbeat. Initialization allows a 30-hour first-run grace period, not a
fabricated successful run. Beyond 30 hours without success, new guest uploads
are paused; existing accounts/recovery windows are preserved.

Maintenance uses ordered batches with a 20-second time budget. Failure metadata
and job leases remain durable. A successful heartbeat is not proof of zero
backlog: monitor backlog/oldest expiry as well. Resolve repeated failures and
run a protected manual retry; never delete retry metadata to hide a failure.

## Erasure and exports

Guest deletion requires the opaque guest proof, stays available after access
expiry, rejects account-owned uploads, and first writes a tombstone. Delete and
restart cannot silently abandon server data. Supabase signed upload URLs last
two hours; tombstones/manifests survive that window plus five minutes and physical
objects are swept again to prevent late uploads from recreating erased data.

Account deletion requires fresh password/OAuth AMR evidence within five minutes,
not a refreshed token's issue time. It writes a restoration/recreation block,
revokes sessions and rejects subsequent account writes before physical work.
Retries cancel Stripe subscriptions, delete objects, delete dependent records,
remove Supabase Auth and sweep outstanding-upload targets. A job is complete only
after the final sweep. Do not equate request acceptance with completed erasure.

Private ZIP exports contain account rows and owned source/generated files, not
guest proofs or authentication secrets. Archives expire after 24 hours; download
URLs expire after at most five minutes. Failed exports retry in maintenance;
inspect jobs stuck in `pending`, rather than declaring an incomplete archive ready.

## Other rights and backup restoration

The privacy inbox must be staffed. Verify identity proportionately, record the
request securely, and use an internal 30-day response target or an earlier
applicable legal deadline (a calendar month is not always 30 days). Provide
access/correction/erasure/portability/restriction/objection and provider follow-up
as applicable; do not require signup or purchase to exercise rights. Handle
lost-proof guest requests without disclosing CVs based only on a filename.
For restriction/objection requiring processing to stop, pause the affected
account/guest's processing using the backend-only RPC:
`set_privacy_restriction(p_user, p_guest, p_restricted)` with exactly one subject.
Use a service-role operator session after verified authorization; never expose
this power through a browser credential. The restriction invalidates in-flight
AI/parsing, blocks ordinary CV-processing writes and direct RLS access, while
account data export and account deletion remain available. Optional permissions
remain disabled after lifting it; the user can choose them again. Record the
rights-request rationale and resolution in a separate restricted case record.
Help the requester reject browser analytics too, and handle provider rights
requests under the verified provider arrangements.

Before restore: preserve the latest external account and guest erasure ledgers/job manifests, keep
the restored application offline, reapply pending/completed erasures to restored
DB/Auth/Storage, verify isolation, then allow traffic. Never restore erased data
into routine use just because its old backup is still available. Import the
latest `privacy_erasure_ledger` and `privacy_guest_erasure_ledger` copies first,
then run `scripts/replay-privacy-erasures.sql` with an operator database session.
For a fresh restoration, clear prior `restore_queued` markers once while workers
are stopped (`update privacy_jobs set manifest=manifest-'restore_queued' where
kind='deletion'`). Do not clear them between batches in the same restoration.
It requeues up to 100 restored account subjects and 100 deleted guests per call.
Repeat it and protected maintenance until restored subjects/objects have been
removed; inspect the pending jobs before opening traffic. The guest ledger
blocks even a restored guest proof that has not reached its original 24-hour
expiry. Configure a secure independent ledger snapshot/export procedure with
access restricted to recovery/compliance operators; ordinary DB backups alone
cannot preserve deletions made after the snapshot being restored.

Default reviewed policies: withdrawn permission evidence 12 months; raw completed
AI diagnostics seven days; expired archives 24 hours plus cleanup; erasure ledger
90 days after completion. Account content supports the continuing service;
perform and document an annual inactive-account/retention necessity review.
Monthly funnel/referral statistics have no guest/account IDs; reports suppress
cells under five. No career/education profiling is aggregated.

## Reproducible browser verification

Start a separate local Vite fixture server (does not change `.env.local`):

```sh
VITE_GA_MEASUREMENT_ID=G-PRIVACYTEST \
VITE_SUPABASE_URL=https://privacy-fixture.supabase.invalid \
VITE_SUPABASE_ANON_KEY=local-fixture-key \
VITE_API_BASE_URL=http://127.0.0.1:5174/api/v1 \
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5174 --strictPort
```

Run `node frontend/scripts/verify-privacy-browser.mjs` from the repository root.
It intercepts every API/Auth/Storage/Google request, uses isolated browser
contexts and tests both email and Google callback handoffs, optional questions,
AI rejection and later acceptance, guest/account withdrawal and resumption,
refresh recovery, the score/editor, answer clearing, analytics consent across tabs,
GPC and deletion confirmation. It performs no production mutations and transmits no
CVs to providers. SQL/service tests cover the real backend constraints/workers;
production provider settings, fresh OAuth AMR and paid billing cancellation also
need a staging check with approved provider arrangements before activation.
