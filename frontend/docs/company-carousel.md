# Landing page company carousel

The Guided Journey landing pages (`/`, `/tr`, `/guided-journey` and the design review previews) show a company carousel between the hero and demo. Pricing pages omit it. The companies are Amazon, Accenture, Coca-Cola, Jotform, Trendyol, QNB and Akbank.

## Regional company lists

The carousel uses the same `/billing/prices` response as the landing page pricing cards, with one shared request. Pricing market `TR` shows all seven companies, including Trendyol, QNB and Akbank. `GLOBAL` shows Amazon, Accenture, Coca-Cola and Jotform. While the market is loading, or if pricing cannot load, the international list is used. Interface language and URL do not select the company list: an English page can show Turkey's companies, and a Turkish page can show the international companies. Language Studio's pricing-market selector also controls the carousel.

Regional lists are configured in `company-carousel-data.ts`. Prerendered HTML uses the international list and updates to the returned pricing market after hydration.

## Employment claims

On 2026-10-24 the owner confirmed that they hold employment evidence for all five companies and asked to proceed without supplying those documents. The committed public heading is **Employees from Best Companies uses jobspecificCV:**, followed by **People who built their CVs with JobSpecificCV now work at these companies.** The evidence records explicitly reference that owner confirmation. The underlying documents were not independently reviewed, and no private customer documents are stored here.

The owner subsequently requested QNB and Akbank for the Turkey employment carousel. Their metadata records that request separately from the original five-company evidence confirmation; no additional documents were supplied or independently reviewed.

The heading and employment sentence are translated in both language catalogs. They render only when every company displayed has an `employmentEvidence` record in `src/app/pages/designs/company-carousel-data.ts`. For future companies, confirm a real customer used JobSpecificCV before joining the company, confirm the employment outcome, and record an evidence reference and review date. Keep private customer material outside this repository; use an internal reference. Evidence references are never rendered in page markup.

Adding a company with missing evidence automatically returns the entire carousel to neutral copy: **Make your next move count.** and **Tailor your CV for opportunities at companies like these.** The code requires nonempty evidence metadata; it cannot independently establish the truth of a record. Logo provenance does not establish an employment outcome or company endorsement.

## Logo provenance

Artwork was retrieved from company-controlled sources on 2026-10-24 and is served locally from `public/images/companies/`. At the owner's request, the SVG fills use a consistent neutral gray (`#747a7e`). Logo proportions are preserved, and the carousel has no per-logo frames or card backgrounds. Jotform's solid background rectangle is removed and its viewBox fits the visible wordmark.

QNB uses the bank's original transparent PNG, presented in neutral gray with a CSS filter. Akbank uses the official SVG with gray fills.

| Company | Official source | Notes |
| --- | --- | --- |
| Amazon | [Official asset](https://assets.aboutamazon.com/59/21/d658597b447d97f8bc9aef3362e0/logo-inverse-1.svg), [press center](https://press.aboutamazon.com/logos) | Wordmark and smile use gray on a transparent background. |
| Accenture | [Official homepage](https://www.accenture.com/us-en) | Static header SVG paths and compact greater-than transform, with gray fills. No animated footer asset is used. |
| Coca-Cola | [Official asset](https://www.coca-cola.com/content/dam/onexp/global/icons/Coke-company-logo-black.svg) | The Coca-Cola Company wordmark. |
| Jotform | [Brand resources](https://www.jotform.com/resources/), [official SVG](https://cdn.jotfor.ms/assets/resources/svg/jotform-logo-dark.svg) | Gray wordmark with transparent background. |
| Trendyol | [Official CDN SVG](https://cdn.dsmcdn.com/web/logo/ty-web.svg), [company page](https://www.trendyol.com/en/s/meet-us) | Gray wordmark. |
| QNB | [Official Türkiye logo](https://www.qnb.com.tr/_assets/img/logo.png) | Transparent PNG, gray CSS presentation. Turkey only. |
| Akbank | [Official SVG](https://www.akbank.com/SiteAssets/img/logo.svg) | Gray wordmark. Turkey only. |

Authenticity has been checked against official sources. This does not establish permission for a particular marketing use. Review applicable brand-use permissions before publishing an employment endorsement section. No publication or deployment was performed as part of this change.

## Language and mascot configuration

All public strings, including the mascot dialogue, are in `en.json` and `tr.json`. They are editable in Language Studio under **Landing & mascot**. Company names remain brand names in both languages. Other interface languages follow the activation process in [Language Studio](./language-studio.md).

Companion Studio has a **Company carousel** stop and a **Celebrating your next chapter** dialogue. The default uses the existing celebrating artwork and **Try the demo** action. The existing single guide moves to this stop; no duplicate mascot is added. The stop is unavailable in the pricing preview. Older version-1 Studio exports receive defaults for this stop while retaining their saved settings.

Desktop rail geometry, compact tap-to-open guidance, dismissal, modal/typing suppression, visitor dragging, inward facing and reduced motion use the existing companion behavior. Public pages use committed defaults; local Studio drafts remain review-only.

## Motion and accessibility

The repeating logo groups move at a steady speed. Hovering pauses the animation in place; moving the pointer away resumes it from the same position. There is no pause button. Keyboard users can focus the carousel to pause it and tab away to resume. Mouse clicks do not hold the animation after the pointer leaves. The duplicate group is hidden from assistive technology. Reduced motion displays one static, wrapping group containing every company. Image failures fall back to the company name.

Run `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, and `npm --prefix frontend run build`. For browser checks, start the frontend development server and run `node frontend/scripts/verify-company-carousel.mjs`.
