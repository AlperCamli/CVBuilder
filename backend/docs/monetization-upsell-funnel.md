# Monetization, Upsell Triggers, and Funnel Update

Date: 2026-06-12. This update makes the upselling strategy more aggressive and context-aware. It is a frontend-only change — no backend code was modified. The backend's existing `ENTITLEMENT_EXCEEDED` contract (see `billing-entitlements.md`) is the trigger source for most of it.

## Goals

1. Show an upgrade offer **every time** a user hits a plan limit, with copy that explains **why** the offer is appearing right now (e.g. AI limit hit → "unlimited AI improvements for $10/month").
2. Catch the user **the moment they return** to the tab after exporting a CV (they typically open the PDF and come back) with a subscription offer plus the natural next step: a cover letter for a tailored CV, or "Make your next job application with us — do you need a job-specific CV?" for a master CV.
3. Tighten the visitor → signup funnel: sign-up-first CTAs that preserve the intended destination, and friction-reducing copy.

## 1. Limit-hit offers — every limit, every time, context-aware

### Backend contract (unchanged, now fully consumed)

`BillingService.assertActionAllowed` throws `EntitlementExceededError` (HTTP 403, code `ENTITLEMENT_EXCEEDED`) with `details.action` set to the gated action (`ai_action`, `export_pdf`, `export_docx`, `tailored_cv_generation`) and a human message such as "Monthly AI action limit has been reached".

### New shared helper

`frontend/src/app/integration/entitlement-upsell.ts`:

- `isEntitlementExceeded(error)` — type guard for `ApiClientError` with code `ENTITLEMENT_EXCEEDED`.
- `resolveEntitlementFeature(error, fallback)` — reads `details.action` from the error so the modal copy matches the limit the backend actually enforced; falls back to the caller's best guess.

### Wired surfaces

Previously only CV exports in the editor opened the upgrade modal; everywhere else the limit error was shown as inline text only. Now **every** surface that can receive `ENTITLEMENT_EXCEEDED` opens the upgrade modal alongside the existing inline error:

| Surface | Action(s) | File |
|---|---|---|
| CV editor — AI block actions (improve / summarize / ATS-optimize / expand) | `ai_action` | `frontend/src/app/pages/CVEditor.tsx` (`runAiAction`) |
| CV editor — skills pool generate / refresh | `ai_action` | `CVEditor.tsx` (`openSkillsPool`, `refreshSkillsPool`) |
| CV editor — PDF/DOCX export | `export_pdf` / `export_docx` | `CVEditor.tsx` (`handleExport`, pre-existing, now uses the shared helper) |
| Customize CV — job analysis | `ai_action` | `frontend/src/app/pages/TailorCV.tsx` |
| Tailoring flow — follow-up questions | `ai_action` | `frontend/src/app/pages/TailoringFlow.tsx` |
| Tailoring flow — tailored draft generation | `tailored_cv_generation` | `TailoringFlow.tsx` |
| Cover letter — AI generation | `ai_action` | `frontend/src/app/pages/CoverLetterEditor.tsx` |
| Cover letter — export | export | `CoverLetterEditor.tsx` |
| Upload flow — AI import improvement | `ai_action` | `frontend/src/app/pages/AIImproving.tsx` |

There is intentionally **no dedupe** on the `limit_reached` variant: the modal fires on every limit hit, per the aggressive-monetization decision.

### Context-aware copy

`UpgradePromptModal` (`frontend/src/app/components/UpgradePromptModal.tsx`) now builds `limit_reached` copy per gated action. The body always leads with the backend's reason (the exact warning the user saw, e.g. "Monthly AI action limit has been reached.") followed by a price-anchored pitch:

- `ai_action` → title "You've hit your monthly AI limit", pitch "Get unlimited AI improvements, rewrites, and suggestions with Pro — just $10/month."
- `export_pdf` / `export_docx` → "You've hit your monthly export limit" / unlimited PDF + DOCX exports pitch.
- `tailored_cv_generation` → "You've hit your customized CV limit" / unlimited job-specific CVs pitch.

A trial sentence ("Start with a 3-day free trial.") is appended only while the user is still trial-eligible (existing `GET /billing/plan` → `trial_eligible` mechanism).

Prices come from new exported constants `PRO_MONTHLY_PRICE` ($10) and `LIFETIME_PRICE` ($99) in `frontend/src/content/pricing.ts`, which `PLAN_CARDS` and the modal both consume — a single source of truth if pricing changes.

## 2. Post-export return prompt

New upgrade-prompt variant: `post_export`.

### Mechanism

In `CVEditor.tsx`:

1. On a **successful** export, `armPostExportReturnPrompt()` checks the billing plan and, for free-plan users only, arms a one-shot ref `{ kind: "master" | "tailored", away: false }`. Pro/lifetime users never see this prompt.
2. A `blur` / `focus` / `visibilitychange` listener set tracks the user leaving the tab or window (opening the downloaded PDF flips `away`) and fires the prompt **at the exact moment they return** (window focus or tab becomes visible). The ref is then cleared, so it fires at most once per export — but re-arms on every subsequent export (no per-session cap).
3. If the user never leaves the tab, no prompt fires (there is no "return" moment).

The existing first-master-export guided navigation (auto-routing to the customize flow with a toast) takes precedence: when it triggers, the return prompt is not armed because the editor navigates away.

### Content

The modal shows the standard Pro/Lifetime checkout CTAs plus a prominent **next-step** button:

- **Tailored CV exported** → "Need a cover letter to go with it?" — next step **Write my cover letter** routes to `/app/cover-letter/:jobId` (the linked job's id is now captured alongside `tailoredJobData`; falls back to `/app/cover-letters` if the CV has no linked job).
- **Master CV exported** → "Make your next job application with us" / "Do you need a job-specific CV?" — next step **Create a job-specific CV** routes to `/app/tailor/:cvId`.

The next-step CTA is plumbed through new `UpgradePromptOptions` fields (`exportedCvKind`, `nextStep: { label, onSelect }`) in `frontend/src/app/contexts/UpgradePromptContext.tsx`.

## 3. Funnel improvements (visitor → signup → first CV)

### Problem

The marketing CTAs ("Get started", "Create your CV") pointed at `/app/create`. For an anonymous visitor `RequireAuth` bounced them to the **sign-in** page (a login form is hostile to a first-time visitor) and the intended destination was lost — after authenticating they landed on the dashboard, not the creation flow.

### Changes

- `RequireAuth` (`frontend/src/app/integration/auth-route-guards.tsx`) now redirects anonymous users to **`/signup`** and stashes the intended destination in router state (`{ from: pathname + search }`).
- New `resolvePostAuthDestination(state)` helper (same file) validates the stashed path (must start with `/app`) and is honored by:
  - `RedirectIfAuthenticated` (already-authenticated users hitting `/signin` / `/signup`),
  - `SignIn` after password sign-in,
  - `SignUp` after an immediate-session signup.
- The "Sign up" / "Sign in" cross-links on the two auth pages pass router state through, so switching forms doesn't drop the destination.
- `PublicHeader` and `Landing` CTAs are now auth-aware: anonymous visitors go straight to `/signup` with `from: "/app/create"` (no redirect flicker); authenticated users go straight to `/app/create`.
- Landing CTA copy: "Create your CV — it's free" with "Free to start · No credit card required" microcopy under both the hero and the bottom CTA, reducing perceived signup risk.

### Post-signup destination: `/app/create`

Every signup path now lands the new user in the CV creation flow (`/app/create`) instead of the dashboard — unless a deeper destination was preserved via `from` (e.g. a deep link or the pending-checkout journey), which always wins.

- **Password signup with immediate session** — `SignUp` navigates directly to `resolvePostAuthDestination(state, "/app/create")`.
- **Google OAuth and email verification** — these round-trips leave the app and cannot carry router state, so the destination is stashed in `localStorage` (`cv-builder:post-auth-redirect`, 24-hour expiry, `/app`-prefixed paths only) by `frontend/src/app/integration/post-auth-redirect.ts` — the same pattern as `PendingCheckoutIntent`. It is consumed once by whichever consumer sees it first:
  - `AuthCallback` (`/auth/callback`, the OAuth return) navigates to the stashed path instead of `/app`.
  - `PostAuthRedirectResumer` (mounted in the authenticated layout next to `CheckoutIntentResumer`) catches re-entries that skip `/auth/callback`, such as the email-verification link, the first time the user lands anywhere in `/app`.

Plain sign-in is unaffected: `SignIn` never stashes, and its default destination remains `/app`.

## Upsell trigger matrix (after this update)

| Variant | Trigger | Frequency | Audience |
|---|---|---|---|
| `welcome` | First dashboard view after signup | Once ever (`localStorage`) | Free users |
| `export_first_in_session` | Opening the export dialog | Once per session (`sessionStorage`) | Free users |
| `limit_reached` | Any `ENTITLEMENT_EXCEEDED` error, all surfaces | **Every time** | Free users (by definition) |
| `post_export` | Returning to the tab/window after a successful export | Every export return | Free users |

All variants share the checkout CTAs: Start 3-day free trial (or "Start your subscription" once the trial is consumed), Get Lifetime — $99, and a Compare plans link.

## Files touched

- `frontend/src/content/pricing.ts` — price constants
- `frontend/src/app/integration/entitlement-upsell.ts` — **new** shared helper
- `frontend/src/app/contexts/UpgradePromptContext.tsx` — `post_export` variant, `nextStep` options
- `frontend/src/app/components/UpgradePromptModal.tsx` — context-aware copy, next-step CTA
- `frontend/src/app/pages/CVEditor.tsx` — AI limit catches, job id capture, post-export return prompt
- `frontend/src/app/pages/TailorCV.tsx`, `TailoringFlow.tsx`, `CoverLetterEditor.tsx`, `AIImproving.tsx` — limit catches
- `frontend/src/app/integration/auth-route-guards.tsx`, `pages/SignIn.tsx`, `pages/SignUp.tsx`, `components/PublicHeader.tsx`, `pages/Landing.tsx` — funnel
- `frontend/src/app/integration/post-auth-redirect.ts` (**new**), `components/PostAuthRedirectResumer.tsx` (**new**), `pages/AuthCallback.tsx`, `routes.tsx` — post-signup `/app/create` landing

Verified with `vite build` and the vitest suite (38 tests passing). No backend changes; `billing-entitlements.md`'s "Frontend Upsell Triggers" section is superseded by the matrix above.
