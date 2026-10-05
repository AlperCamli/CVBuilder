# Landing and pricing design explorations

In local development, start at `/designs`. The current `/` and `/pricing` pages are preserved. The approved combined version also has public routes at `/guided-journey` and `/guided-journey/pricing`.

The gallery, earlier alternatives, and Companion Studio are kept in Git but excluded from default production builds. To enable them in a dedicated review build, set `VITE_ENABLE_DESIGN_TOOLS=true`.

The latest review adds [three template showcase directions](./template-showcase-explorations.md): Collection, Spotlight, and Lookbook. Each inserts seven real CV template examples between Guided Journey's demo and pricing, with a comparison switcher and enlarged previews.

The latest combined direction is at `/designs/guided-journey`, with matching `/pricing`. It merges Journey's visuals and pricing layout with Companion's actual-renderer demo and a reactive mascot tour. See [Guided Journey notes](./guided-journey.md) for behavior, trial handling, assets, prompts, and verification.

| Direction | Landing | Pricing | Approach |
| --- | --- | --- | --- |
| Journey — A little guidance | `/designs/journey` | `/designs/journey/pricing` | Warm ivory and green, existing mascot artwork, illustrated process, reassurance and applicant control. |
| Studio — Show your work | `/designs/studio` | `/designs/studio/pricing` | Midnight and lime, interactive sample workspace, visible keyword selection, product demonstration. |
| Editorial — The next chapter | `/designs/editorial` | `/designs/editorial/pricing` | Paper, vermilion and forest green, large serif/sans typography, document composition, sequential editorial story. |
| Companion — Your helpful companion | `/designs/companion` | `/designs/companion/pricing` | Airy mint, centered original landing copy, a small mascot guide, and a prominent live editor. |
| Canvas — A fresh canvas | `/designs/canvas` | `/designs/canvas/pricing` | Warm butter and cream, expressive serif type, larger mascot illustration, and paper-like surfaces. |
| Momentum — Keep your momentum | `/designs/momentum` | `/designs/momentum/pricing` | Deep forest and peach, light typography, a circular mascot composition, and a bright product workspace. |

Each page has a review bar for switching directions. Pricing-to-pricing switching preserves the selected billing query. Routes are marked `noindex, nofollow`, excluded from the sitemap, and are unlisted review pages rather than access-controlled pages.

## Interactive review

- In each Round 01 before/after example, toggle the experience confirmation to see the rewrite narrow to supported evidence.
- In Studio, switch among the experience, opportunity, and tailoring steps. Toggle keyword chips and mark the sample reviewed. This is a local illustrative demo; it does not upload documents or call AI services.
- On pricing, switch Weekly / Monthly / Annual. Prices use the existing shared catalog; annual savings are calculated against twelve monthly payments. The selected period survives refresh and is passed to the existing pending-checkout mechanism before signup.
- Free CTAs clear any pending paid intent and use the existing signup route with `/app/create` as the destination.
- Weekly Pro explicitly selects the paid weekly plan without a trial. The existing live pricing page and its trial behavior are unchanged.
- FAQ accordions, mobile navigation, cross-page section links, and reduced-motion styles are implemented.

## Round 02

The three new directions combine mascot guidance and an interactive product tour. They reuse the original landing page's core supporting copy, shorten the page to a hero, demo, three benefits, subscription, and three collapsed FAQs, and retain all three earlier alternatives.

The demo uses the production `CVPresentationPreview` component with actual Modern Clean, Minimal Professional, and LaTeX Two Column template tokens. Its surrounding interface follows the application's sidebar, editable section cards, toolbar, preview pane, template controls, and export dialog. The production editor is unchanged.

- Edit the summary or work experience to update the CV immediately; hide and restore the summary.
- Choose supported job keywords, apply the sample choices, or try a clearly labeled sample AI suggestion.
- Switch among three real CV templates and adjust the font size.
- On mobile, switch between Edit and Live preview.
- Explore the PDF/DOCX export dialog. Exporting a real document starts with the existing free signup flow. The sample neither calls AI services nor creates a downloadable document.
- Follow the mascot's changing guidance beneath the demo; reset returns to the initial sample.
- Monthly Pro is selected by default and always labeled Recommended. The Pro card leads with unlimited tailoring, AI actions, and exports; the Free card remains available. Billing periods use the existing price catalog and pending-checkout flow.

All six gallery previews are screenshots of the implemented pages, not concept mockups.

## Scope

The supplied redesign plan is design research for these alternatives. Signup redesign, analytics rollout, policy creation, new product functionality, and production deployment are outside this implementation. Existing prices and entitlements are retained. Testimonials, hiring statistics, and guarantees have not been invented.

The CV and job samples use a fictional applicant. Round 01 text previews are illustrative; Round 02 uses production CV templates. Locally hosted fonts and existing mascot artwork are reused, with one new mascot pose created for Round 02.

All new CSS is scoped under `.cv-concept`, and the review module is lazy loaded. The current landing and pricing components are unchanged.

## Local review

From `frontend`, run `npm run dev -- --host 127.0.0.1 --port 5174` and open `http://127.0.0.1:5174/designs`.

Round 01 validation: production build and prerender; all 54 existing tests; browser checks of its six pages at 1440, 768, 390, and 320 pixels; nine plan-to-signup handoffs; free-intent reset; illustrative demo controls; anchor navigation; reduced motion; page metadata and gallery images. No accounts were created and no payment was initiated during verification.

Round 02 validation: production build and prerender; all 54 existing tests; its six landing/pricing pages at 1440, 768, 390, and 320 pixels with no horizontal overflow or broken images; all three demos' editing, summary visibility, sample suggestion, keyword choices, template switching, font scaling, export dialogs, Escape dismissal, and reset; nine paid-plan signup handoffs and free-intent resets; mobile editor/preview controls and navigation; all six gallery images; preserved original pages and first-round alternatives; no browser runtime errors. The sample dialogs and signup handoffs were checked without creating accounts or initiating payments.

## New mascot asset

Created with the built-in `image_gen` tool, using `public/images/cover-tailor-resume.webp` as an identity/style reference. The generated transparent PNG is saved at `frontend/public/images/designs/mascot/guide.png`; the web-optimized version used by the pages is `frontend/public/images/designs/mascot/guide.webp` (1024 × 1536, approximately 122 KB). Alpha is preserved.

Final generation prompt:

> Use case: illustration-story. Create a new transparent-background website mascot illustration using the attached image as an identity and style reference ONLY. Same adorable turquoise furry monster, two antennae with teal balls, dark teal striped small horns, huge friendly eyes, tiny white fangs, warm peach cheeks, dark teal zip-up jacket over white T-shirt, turquoise feet. Full-body three-quarter standing pose, smiling gently, one hand holds a slim cream CV clipboard against its body, the other hand gestures open-palmed toward the viewer's right as a friendly product tour guide. Clean polished soft 3D/editorial illustration matching the reference, restrained soft shadows, warm friendly professional feel. Entire character fits with generous margin, simple silhouette legible at 160px, portrait 2:3 composition, no environment, no floor, no text or lettering, no decorative sparkles, no extra characters, actual transparent alpha background. Preserve this exact mascot identity, do not redesign it.
