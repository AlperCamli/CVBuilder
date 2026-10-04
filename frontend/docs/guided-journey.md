# Guided Journey: Journey + Companion

Public alternatives are available at `/guided-journey` and `/guided-journey/pricing`. The original `/` and `/pricing` retain their existing designs. In local development, review `/designs/guided-journey` and its pricing page; the gallery features this combined direction above the six preserved explorations.

## Companion configuration

In local development, open `/designs/guided-journey/editor` to tune the responsive rail, speech bubbles, dialogue, poses, and natural motion. Drafts save locally and can be exported/imported as JSON. The public pages always use the committed defaults; applying a Studio draft affects only review pages. See [Companion Studio](./companion-studio.md) for controls and saving behavior.

## Design and behavior

Journey's ivory, sage, forest green, soft shapes, and warm illustrations surround Companion's exact centered hero copy and demo using the production CV renderer. The demo is the first substantial section, followed by the reassurance strip. The closing copy and buttons are preserved verbatim; the illustration uses Journey's 380px desktop height, rounded crop, and 36% horizontal image positioning.

One character travels along an invisible track: hero left → demo left → pricing right → closing right. Scrolling reverses the route. After visiting the demo, returning to the top brings the mascot beside the header's Start free button with a new upward-pointing pose. Desktop positions use measured section and button geometry, a ResizeObserver, and one requestAnimationFrame callback per scroll frame to update character and bubble transforms. The page does not rerender on each scroll frame.

At 1360px and wider, the demo reserves a 224px left gutter and pricing keeps its original geometry. Below 1360px, a small floating character opens its bubble on tap. Typing collapses and hides the compact guide; dialogs and mobile navigation hide it at all sizes. Messages can be dismissed and reopened without losing demo state. Section changes never advance the demo, move focus, or scroll automatically. Only explicit buttons navigate or scroll.

The compact bubble follows the current demo panel: experience-backed keywords, live edits, and templates, then Free/Pro, the existing Weekly trial dialog, and free signup. Successful actions briefly switch to a star-eyed delighted pose; edits wait for a 600ms pause in typing, and each action type reacts once until the demo is reset. Reactions return to idle after 2.6 seconds. Tapping the visible character elicits a brief greeting. Reduced motion removes hops, crossfades, and smooth scrolling, and snaps the track between anchors.

Journey's original pricing component is reused: the Free card remains left, Pro right, with the same width, radius, padding, and component order. Pro benefits gain bolder, outcome-oriented language in the existing feature rows. Monthly is the default and recommended period. The three-day Weekly Pro trial is a secondary choice in the existing footnote area; its dialog states the card requirement, eligibility, renewal charge, and cancellation timing before signup.

The approved Pro selections show weekly prices: Weekly $4.99, Monthly $3.46/week equivalent, and Annual $1.92/week equivalent. Full billing totals and renewal periods remain below ($14.99 monthly / $99.90 annually). Equivalents use 52 weeks/year; savings compare the displayed cent-rounded rates, matching public pricing. Monthly saves $1.53/week (31%); Annual saves $3.07/week (62%) versus Weekly. Only the Monthly selector carries a savings badge; the selected-plan caption explains either discount. This supersedes the earlier four-week comparison and 25% badge. Older alternatives retain their original period-based display. Billing prices and backend behavior are unchanged.

Release preparation and later promotion to the primary URLs are documented in [Marketing migration plan](./marketing-migration-plan.md). The separate public URLs are prerendered with route CSS, accurate billing metadata, and social previews. They remain `noindex, follow` and outside the sitemap until promotion; the existing primary pages remain indexed. Review routes and editor code are excluded from default production builds.

## Checkout behavior

- Free clears pending checkout intent and opens the existing signup flow toward `/app/create`.
- Paid plan buttons preserve their selected period. Paid Weekly explicitly uses `with_trial: false`.
- The trial choice explicitly records `{ plan_code: "weekly", with_trial: true }`. Trial eligibility and final terms are confirmed by the existing checkout flow.
- The interactive sample runs locally; it does not upload documents, call AI services, create accounts, or generate document downloads.

## Verification

Production build (client, SSR, and prerender) and all 70 current tests pass, including weekly-pricing comparisons and public-route metadata/assets. Browser checks cover landing and pricing at 1440, 1360, 1359, 768, 390, and 320 pixels, plus a 1920 × 1400 first-visit hero. Verified the route in both directions, return-to-header pointing, reserved desktop gutters, short contextual bubbles, editing debounce and reaction recovery, dismissal/reopening, mobile typing and modal collapse, reduced motion, and preserved demo edits/template selections. Weekly-price updates were rechecked at 1440, 768, 390, and 320 pixels, including all billing selections and unchanged signup/trial intents.

Pricing checks cover the Monthly default, weekly equivalents and rounded savings, Annual selector badge removal, all three paid signup intents, explicit Weekly trial intent/terms, and Free clearing pending paid/trial intent. Closing text is compared verbatim against the previous combined page. Pricing widths, horizontal positions, corner radii, and padding match the recorded baseline and the original Journey page. Earlier alternatives, original public pages, and the gallery load without browser runtime errors. No account creation or payment was performed.

A continuous route check samples 156 positions in each direction at 20px scroll intervals. It verifies smooth joins, no overlap with editing controls, retained keyboard focus, and return-to-header pointing. Resizing between desktop, tablet, and phone confirms responsive remeasurement and keyboard collapse.

## Mascot assets and prompts

Created with the built-in `image_gen` tool. Existing `frontend/public/images/designs/mascot/guide.webp` remains the welcoming pose. Final reaction assets are `frontend/public/images/designs/mascot/thinking.png` / `thinking.webp`, `frontend/public/images/designs/mascot/celebrate.png` / `celebrate.webp`, and the new `frontend/public/images/designs/mascot/point.png` / `point.webp`. The reaction poses use a pure-white background with CSS multiply blending on the character layer against Journey's pale surfaces, avoiding visible rectangular backgrounds. The dialogue bubble is a separate opaque layer, so text beneath it never shows through. The original transparent guide is unchanged. WebP files are used by the page; PNG files preserve the source artwork.

Thinking pose generation prompt:

> Use case: illustration-story. The attached image is the identity and rendering-style reference. Create a matching full-body reaction pose of this exact adorable turquoise furry mascot: two antennae with teal balls, dark striped small horns, big friendly eyes, peach cheeks, two tiny fangs, dark teal zip hoodie over white shirt, turquoise feet. Preserve identity, proportions, materials, colors, 3D editorial rendering. Portrait 2:3 composition, full character entirely visible with generous margin, positioned centered at same scale as reference. Actual transparent alpha background, no glow, no environment, no floor, no lettering or symbols or extra characters. Pose: thinking with friendly curiosity, head slightly tilted, one hand touching chin, the other holding the cream CV clipboard against the body. Gentle small smile, eyes looking slightly toward the viewer's left as if helping review a document. Cute, attentive, reassuring.

Star-eyed success reaction generation prompt (references: existing guide and user-selected before/after illustration):

> Use case: illustration-story. Create a transparent standalone full-body website mascot reaction. Reference image 1 is the mascot identity, clothing, proportions, and soft 3D rendering reference. Reference image 2 is the EXACT reaction reference: delighted wide eyes with golden four-point star highlights in the pupils, happy open smile with two tiny white fangs, peach cheeks, both little hands tucked just under the chin in excited admiration. Match that reaction closely. Same turquoise fluffy monster, two antennae with teal balls, small dark teal striped horns, dark teal zip hoodie over white T-shirt, turquoise feet. No clipboard. Character alone, full body with generous margin, centered at same scale as reference 1, portrait 2:3. Actual transparent alpha background. No backdrop, glow, floor, text, documents, panels, external sparkles, or additional characters. Preserve exact mascot identity. The star shapes are inside the eyes only.

Final pointing pose prompt (reference: existing guide identity):

> Use case: illustration-story. Create one new full-body pose of the EXACT mascot in the attached identity/style reference. Same turquoise fur, ball-tipped antennae, striped small horns, peach cheeks, two little white fangs, enormous friendly eyes, dark teal zip hoodie over white T-shirt, turquoise feet. Pose: standing, turning eyes and head upward toward the viewer's RIGHT, rightmost arm raised diagonally to point upward-right with one finger, as if pointing at a website button above him. Other hand relaxed against body. Cute eager smile. No clipboard. Entire body visible, centered, portrait 2:3 with generous margins. Match reference proportions, colors and polished soft 3D illustration. Completely flat pure WHITE #FFFFFF background, opaque studio cutout. NO checkerboard, NO gradient, NO glow, NO shadow, NO scenery, NO text, NO symbols. Preserve mascot identity.
