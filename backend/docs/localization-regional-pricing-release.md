# Localization and regional pricing release

The interface locale, document language, and billing market are independent. `/` and `/pricing` use the guided journey in English; `/tr` and `/tr/pricing` are prerendered in Turkish. Authentication and `/app/*` routes stay stable. Career advice stays English, and existing UK medical documents remain available.

## Configuration

Set the following **server environment variables** separately for Preview and Production. Never expose a signing secret as a `VITE_*` variable. Generate distinct random secrets of at least 32 characters and keep them in the deployment secret store.

| Variable | Frontend Vercel project | Backend Vercel project |
| --- | --- | --- |
| `BILLING_GEO_SECRET` | Required for the routing middleware | Required; identical to frontend for that environment |
| `BILLING_QUOTE_SECRET` | — | Required; different from the geo secret |
| `STRIPE_WEEKLY_PRODUCT_ID`, `STRIPE_MONTHLY_PRODUCT_ID`, `STRIPE_ANNUAL_PRODUCT_ID` | — | Existing product for each billing plan; each holds that plan's USD and TRY prices |
| `STRIPE_PRODUCT_ID` | — | Optional common-product fallback if all plans use one product; leave blank for three products |
| `STRIPE_WEEKLY_PRICE_ID`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID` | — | Retain existing USD prices |
| `STRIPE_TRY_WEEKLY_PRICE_ID`, `STRIPE_TRY_MONTHLY_PRICE_ID`, `STRIPE_TRY_ANNUAL_PRICE_ID` | — | New TRY prices on their corresponding weekly/monthly/annual products |
| `STRIPE_USD_PORTAL_CONFIGURATION_ID` | — | USD-only customer portal configuration |
| `STRIPE_TRY_PORTAL_CONFIGURATION_ID` | — | TRY-only customer portal configuration |
| `STRIPE_HISTORICAL_PRICES` | — | JSON mapping of retired Price IDs to `weekly`, `monthly`, or `annual`; default `{}` |

Keep existing Stripe keys, webhook secret, trial-day setting, and legacy Pro/lifetime IDs. All three prices in each market must be active recurring prices with a positive integer amount, the configured product for their plan, and exactly one week/month/year respectively. Existing separate weekly/monthly/annual products are supported; add a TRY price to each and retain all USD IDs. Amounts come from Stripe; there are no invented TRY defaults. See [the Stripe setup walkthrough](stripe-regional-setup.md) for every variable and the portal creation command.

Create separate portal configurations in each Stripe environment. If subscription updates are enabled, their product/price whitelist must contain all three current prices for that market and no prices from another market. Cancellation-only configurations are supported. Configure the USD catalog and portal before release so existing English paid checkout continues working. Missing or invalid TRY configuration disables TRY paid checkout; it never falls back to USD. Currency does not change plan entitlements.

Production clients always call the same-origin `/api/v1` proxy. `frontend/vercel.json` must continue rewriting to the intended backend deployment. Vercel routing middleware strips incoming custom geo headers and signs platform country data for pricing and checkout. The backend rejects production/staging pricing and checkout requests without a matching signature, including direct backend calls. Configure `APP_ENV=production` in production and `APP_ENV=staging` for deployed previews. Local development/test uses the backend-only `BILLING_DEVELOPMENT_COUNTRY` fixture (`TR`, `US`, or an unrecognized value for the unknown-country fallback). Browser parameters cannot change it.

Use the approved application origin in `FRONTEND_APP_URL`, the checkout success/cancel URLs, and the portal return URL. Additional approved preview origins can be included in `CORS_ALLOWED_ORIGINS`; this permits API access but does not change return-URL permissions. Each supplied checkout/portal return URL must match the origin of its corresponding server-configured default URL. Configure those defaults for each preview environment. Set `PDF_OCR_LANGUAGES=eng+tur` for English and Turkish scanned imports.

Vercel configuration references: [Routing Middleware](https://vercel.com/docs/routing-middleware), [platform country headers](https://vercel.com/docs/headers/request-headers), and [sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

## Database and authentication email rollout

1. Back up the database and retain the current deployments for rollback.
2. Apply `supabase/migrations/20261012120000_localization_and_regional_billing.sql` after the existing migrations. It adds protected billing markets, pending-checkout reservations, cover-letter language, translation prompts, atomic master-language enforcement, and import/document revisions. Existing duplicate masters and relationships are retained. Existing billed accounts are assigned their original GLOBAL/USD market; subscriptions and Stripe amounts are untouched.
3. Deploy backend support with the configured USD prices/portal and secrets. Check health and authenticated legacy document access. Deploy the localized frontend immediately afterward: older clients do not send pricing quotes, so the new backend deliberately rejects their checkout attempts. This coordinated rollout may briefly interrupt new checkouts; existing subscriptions continue.
4. Install `supabase/templates/confirmation.html` and `supabase/templates/recovery.html` as the Supabase confirmation/reset email bodies. They select English or Turkish using `.Data.locale`, populated during signup and remembered-language account sync. Bilingual subjects can be `Confirm your email / E-posta adresini doğrula` and `Reset your password / Şifreni sıfırla`. These files do not automatically update the hosted Supabase configuration; see [Supabase email template configuration](https://supabase.com/docs/guides/auth/auth-email-templates). Retain the existing redirect allowlist and test both languages' verification/reset links.
5. Enable TRY checkout only after all three TRY prices and its portal configuration pass runtime validation. A failed catalog returns `available: false` with no quote or paid plans; the UI offers retry and keeps Free available.

Billing market is locked atomically at the first valid checkout initiation. Later travel, UI language changes, browser storage, and request payloads cannot change it. Support may review a market correction using backend administrative access; no public market-change endpoint exists. This protects against browser manipulation; country detection does not prove residency or stop a VPN before the first checkout.

## Document and AI behavior

Standard masters are limited to one per supported language on every plan. Legacy duplicates remain visible and require an explicit update target. The database serializes concurrent creation, import, duplication, and translation application. Scratch creation asks for language; import detection reads source content independently of UI language, with manual confirmation when uncertain. Selecting source language corrects detection and does not translate text.

Same-language import updates the chosen existing ID after review/confirmation and saves a full document revision. Tailored documents remain linked. Revisions can be restored while retaining another snapshot of the current content. No import/create path deletes an old master automatically.

Translation creates an AI run first and uses the existing execute/poll mechanism. Review precedes application. Applying a completed owned run rechecks language availability, and an existing target opens without replacement. The translated document is independent. Translation output uses a strict path/text schema, reconstructs from the source, preserves structure and fixed fields, and validates numerical facts. Completion and the single AI-action charge happen in one backend-only transaction, with a locked counter and another allowance check to handle concurrent requests. Provider failures, invalid output, or failed persistence create no master and charge no action. Provider execution uses existing Vercel request-duration limits; unfinished runs remain visible through polling.

Every AI call appends a language policy after its configured/fallback prompt: CV content follows document language, while questions/explanations follow interface language. Canonical JSON keys/action identifiers stay English. Cover letters keep their own language, defaulting to their linked CV; existing letters default to English. PDF letters embed Unicode Noto Sans. Turkish review omits unsupported English wording checks and removes that dimension from score normalization.

CV translation now uses a separate admin-managed document catalog and parallel block requests; see [CV translation](cv-translation.md). For additional interface locales and import detection, extend backend `shared/localization/languages.ts`, frontend `app/localization/i18n.ts` and catalogs, detector/parser aliases, OCR configuration, localized SEO routes, and the supported-language database guard. New billing markets require a server catalog entry, prices, portal configuration, and database market constraint; they are independent of language additions.

## Verification and release checks

Local automated checks:

```sh
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix backend test
npm --prefix frontend test
npm --prefix backend run test:privacy-sql
npm --prefix backend run build
npm --prefix frontend run build
```

The SQL check starts an isolated temporary PostgreSQL database, applies all migrations, and exercises privacy protections, master conflicts/revisions, immutable market locking, and checkout reservations. It does not modify the hosted database.

Local validation on 2026-10-13: 131 frontend and 573 backend tests pass; both type checks and production builds pass. SQL checks include translation completion/allowance atomicity. Native PDF extraction and DOCX XML checks verify Turkish characters and dotted-İ headings. Browser checks cover Turkish prerendering without JavaScript, hydration, remembered preference, preserved demo/authentication drafts when switching, and unclipped controls at 320/390/768 pixels. Language Studio app previews use isolated sample accounts/data without authentication; browser checks verify all app scenes, state selectors, pricing presets, navigation, form preservation and network/storage isolation. Studio and demo modules are excluded from normal production builds. Browser pricing uses sample catalogs; their amounts do not configure Stripe. Hosted authentication callback/email delivery, real AI providers, deployment geo forwarding, and live Stripe checkout/webhook smoke checks still require the configured preview environment.

Before production enablement, use Stripe **test mode** on a preview deployment to verify TR/non-TR/unknown country routing, invalid signatures and direct backend requests, quote expiry/change confirmation, signup handoff, saved-market travel behavior, monthly/annual/weekly purchases, trial reuse rules, concurrent checkout attempts, cancellation, and both regional portals. Replay USD/TRY and historical-price webhooks and verify identical entitlements. These live-provider checks require configured test prices, portals, and deployment secrets; mocked gateway tests do not replace them.

Check first visit/remembered choice, switching during editing, authentication callbacks, all UI/CV-language combinations, translation review/conflicts, same-language imports/revision restore, Turkish PDF/DOCX uploads, Unicode exports, and desktop/mobile mascot behavior. Verify prerendered Turkish HTML with JavaScript disabled and canonical/hreflang/sitemap entries. Production builds must omit Studio and review tooling.

Monitor pricing availability/request failures, failed translation runs, quota changes, signup-to-checkout completion, and webhook reconciliation using existing operational logs/analytics. Do not log secrets, raw geo envelopes, CV content, or authentication URLs. Keep backend and frontend rollback deployments as a pair; the additive migration may remain applied. An older backend will not enforce regional quote/market rules, so disable new paid checkout before rolling back to it. No live migration, deployment, email-template installation, or Stripe purchase is performed by the local implementation checks.
