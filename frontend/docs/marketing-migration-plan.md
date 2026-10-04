# Guided Journey release and migration plan

Status: approved separate-route release. `/guided-journey` and `/guided-journey/pricing` are public alternatives. The existing `/` and `/pricing` retain their original components. The current committed mascot defaults are approved; no configuration import is required for this release.

## Implemented release preparation

- Public navigation stays within `/guided-journey` and its pricing page. Signup, sign-in, and resources use the existing application routes. Review controls and gallery links are absent.
- The public entry passes committed `DEFAULT_MASCOT_CONFIG` directly to the page. Browser-local Studio drafts, applied settings, and preview messages cannot change it. The editor bridge is imported only by the review entry.
- `/designs/*`, including Companion Studio, remains available in local development. Default production builds exclude those routes and chunks. `VITE_ENABLE_DESIGN_TOOLS=true` enables a dedicated review build; leave it unset or false for production. The build removes unused review artwork from `dist` while keeping the four runtime mascot WebPs. Source artwork remains in Git.
- Both public alternatives are prerendered with their headline, demo, plans, and FAQ. The server resolves the public lazy component before rendering; Vite's manifest supplies route CSS and preload links so the HTML is styled before JavaScript runs. Billing query parameters apply after hydration and preserve the selected checkout intent.
- Both alternatives have titles, descriptions, self-referencing canonicals, social metadata, and structured data matching their visible FAQ. They use `noindex, follow` and stay out of the sitemap while `/` and `/pricing` remain the primary search pages.
- Existing site structured offers now describe Free, Weekly ($4.99), Monthly ($14.99), and Annual ($99.90), with full-period prices and billing durations. The original pricing page's metadata no longer advertises retired Lifetime pricing or a Monthly trial. The eligible three-day trial belongs to Weekly Pro.
- No backend, authentication, billing-price, or API changes are included.

## Pricing presentation

| Selection | Weekly comparison | Actual recurring charge | Rounded savings vs Weekly |
| --- | --- | --- | --- |
| Weekly | $4.99/week | $4.99 every week | — |
| Monthly (default, recommended) | $3.46/week equivalent | $14.99 every month | 31% |
| Annual | $1.92/week equivalent | $99.90 every year | 62% |

Equivalents use 52 weeks/year: Monthly is `14.99 × 12 / 52`; Annual is `99.90 / 52`. Savings compare the displayed cent-rounded rates, matching the current public pricing presentation. Monthly saves $1.53/week; Annual saves $3.07/week. Only the Monthly selector carries a savings badge; the selected-plan caption explains either discount. Full billing totals and renewal periods remain immediately below the headline price.

The former Monthly 25% badge compared four weekly payments. The approved 31% uses the new weekly equivalent. Older alternatives retain their original period-based presentation. Backend prices, billing intervals, and signup/trial intents are unchanged.

## What to keep

Keep the alternatives and Companion Studio in Git and available in local/review builds. Their routes, modules, and unused artwork are excluded from the default production artifact. Do not ignore this source code; it is included in the release checkpoint.

`.gitignore` applies to intentionally untracked files; it does not affect tracked files or serve as a production bundle switch. Use it for scratch exports and generated output. Keep the approved mascot configuration tracked. See the [Git documentation](https://git-scm.com/docs/gitignore).

Studio is a local tuning tool. To publish future changes, export JSON, validate it with the existing parser, update the shared defaults in `src/app/pages/designs/mascot-config.ts`, then review and commit. Applying a draft in the browser does not publish anything. If remote tuning is useful, use a separate protected review deployment with the explicit build flag enabled. Maintain the artwork allowlist in `vite.config.ts` when adding runtime poses.

## Later promotion to the primary pages

This is a future change, not part of this release:

1. Create a migration branch and identify the current production revision for rollback. If mascot settings change again, validate and commit the exported configuration.
2. Move reusable marketing components/styles out of the `designs` source directory as a maintainability cleanup. Map the public entry to `/` and `/pricing`, preserving signup, billing, and trial behavior. Keep the sample demo local and independent of customer data.
3. Keep review tools excluded from production. Update prerender resolution and route asset metadata for the primary paths; verify full HTML and hydration.
4. Enable indexing at the primary URLs, retain their canonical URLs and sitemap entries, and redirect the separate alternative URLs when appropriate. Keep structured offers based on actual billing totals.
5. Review a production preview at the final URLs. Check responsive layouts, mascot dragging and destinations, keyboard use, reduced motion, dialogs, demo persistence, billing queries, and signup/trial handoffs.
6. Deploy the reviewed revision, smoke-test public URLs, and monitor errors and the signup/checkout funnel. Retain the prior deployment for rollback. No database migration is required.

## Verification for this release

The production client/SSR/prerender build and 70 tests pass. Static checks verify full new-page HTML, route CSS/preload links, matching metadata, sitemap exclusion, and absence of editor chunks and unused artwork. Browser checks cover pricing at 1440, 768, 390, and 320 pixels, all billing query/reload combinations, paid and Weekly-trial signup intents, and unchanged original public pages. No account or payment is created during verification.

The built preview also passes styled rendering with JavaScript disabled, matching hydration with no console errors, public navigation, Free clearing a pending paid intent, and isolation from locally applied Studio drafts. Mascot checks cover repeat drags, parking through small scrolls, release at the next destination, return-to-header pointing, editing/template reactions, retained demo state, compact keyboard collapse, and reduced motion. Local Studio checks cover numeric and drag controls, undo/redo, export/import, draft application/restoration, responsive preview, and playback.
