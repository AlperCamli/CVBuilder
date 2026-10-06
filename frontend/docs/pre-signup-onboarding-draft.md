# Upload-first onboarding

Local review starts at http://127.0.0.1:5173/guided-journey. Start the backend with
`npm run dev` in `backend`, and Vite with `npm run dev` in `frontend`.

The guided landing's Start free, hero, template, pricing, trial, and final CTAs
enter `/onboarding`. The main `/` landing remains a separate page.

## Journey

Landing → real PDF/DOCX upload → four optional questions while parsing and
CV analysis run → real signup → authenticated account claim → real CV score →
CV editor. The questionnaire retains the approved single-column UI, subtle
option entrance/check animations, keyboard controls, and reduced-motion support.

Questions cover goal, career stage, education level (including study in progress),
and referral source. Back, skip, refresh, and auth redirects preserve answers.
The sample CV, simulated timers, mock signup, and sample score/editor are removed.

## Ownership and authentication

The backend creates a separate `guest_imports` record and a private signed upload
path. The browser stores only a random 256-bit guest proof, filename, expiry,
answers, and question position; CV contents stay out of localStorage, URLs and
analytics. The database stores a SHA-256 proof digest. Guest endpoints reveal
processing status only, never parsed content or score.

Email verification and Google auth resume at `/app/onboarding` on the same device.
The backend verifies the Supabase session, resolves the application user ID, and
claims the guest record in a database transaction. A row lock prevents duplicate
claims; retries return the same account-owned import. The transaction creates
source-file/import records, transfers parse evidence, and saves questionnaire
answers to `users.onboarding_answers`. A different account cannot reclaim it.
The score URL includes the account-owned import ID so refreshing remains safe.
Continuing creates the actual master CV and opens its editor without deleting
existing CVs during this guest flow.

Parsing uses the existing AI parser and extraction fallback. Requests stay open
until results are durable; persisted five-minute leases allow interrupted work
to resume after refresh/auth, with at most three attempts. Unreadable documents
retain the existing unscorable/manual-review behavior. Scores are never invented.

Goal/career answers personalize score-page guidance and relevant AI improvement
and tailoring prompts. AI guidance explicitly forbids inventing facts from
survey answers. Referral source is saved for attribution and excluded from AI.
Analytics record stage/question views, enum answers/skips, upload file type,
account creation, and successful claims; no tokens, filenames, emails or CV text.

## Database and deployment

Migration: `backend/supabase/migrations/20261006140000_guest_onboarding.sql`.
It is applied to the Supabase project already linked to this workspace.
The local frontend/backend Supabase URLs and keys were repaired to use that
project; credentials stay in ignored `.env.local` files.

Guest proofs expire after 24 hours. Daily production cleanup is configured at
03:00 UTC in `backend/vercel.json`. Set a random `CRON_SECRET` in the production
backend environment before deploying. The cleanup endpoint rejects missing or
incorrect credentials. It deletes expired unclaimed objects and guest metadata,
keeps claimed account files, and retries failed object deletions on later runs.
Vercel auth redirect allowlists must include the deployed `/auth/callback` URL;
local callback URLs must be allowed for local signup/OAuth review.

Parsing duration follows the Node function configuration described in
[Vercel's documentation](https://vercel.com/docs/functions/configuring-functions/duration).
Daily cron invocations and secret authentication follow
[Vercel's cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Verification

Backend service/route tests cover proof checks, expiry, invalid files, parallel
processing, stale leases, attempt limits, answer validation, authenticated claims,
claim replay, and AI context boundaries. The SQL verification script checks
actual transactional ownership/replay, expiry and role isolation, then rolls
back all test records. Run it with `supabase db query --linked --file
tests/sql/guest-onboarding.sql` from `backend`.

Real browser verification used a synthetic CV and temporary confirmed test
account (no email sent): landing → storage upload → questions → account claim →
score → persisted CV editor. Refresh persistence, withheld pre-auth score,
320/390-pixel layout, and browser errors were checked. A simulated provider
response verified the email-confirmation UI, callback destination, and preserved
upload/answers without sending an email. Provider Google redirects
and email delivery require the project's existing authentication configuration;
they were not exercised with a personal Google account or a real email inbox.
