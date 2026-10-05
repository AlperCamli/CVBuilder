# Template showcase: three review directions

Open the local design gallery at `/designs`, or jump straight to a section:

| Direction | Review URL | Presentation |
| --- | --- | --- |
| Collection | `/designs/guided-journey/templates/collection#templates` | Seven templates in a colored comparison grid, with a free-start invitation in the final tile. |
| Spotlight | `/designs/guided-journey/templates/spotlight#templates` | One large, tilted preview and a seven-option picker. On phones the paper appears before the picker. |
| Lookbook | `/designs/guided-journey/templates/lookbook#templates` | A layered paper carousel, with previous/next controls, direct selection, arrow keys, and horizontal swiping. No autoplay. |

Each direction uses the existing Guided Journey page. Its section sits after the demo/reassurance content and before pricing. The comparison bar switches directions while preserving edits in the main demo. The selected Lookbook also appears on `/guided-journey` and the combined review page. The original `/` and `/pricing` pages and earlier alternatives remain unchanged.

## Templates and artwork

All directions include the same seven real catalog entries:

- Horizon: `horizon-rail`
- Studio Ocean: `studio-banner-ocean`
- Mosaic Rose: `mosaic-columns-rose`
- Editorial Graphite: `editorial-index-graphite`
- Mosaic Graphite: `mosaic-columns-graphite`
- Ledger: `ledger-split`
- Academic Serif: `latex-academic-serif`

The previews are the first page of actual PDF exports, generated with the existing fictional Alex Morgan fixture and production layout/font definitions. They are not reconstructed illustrations. Seven 1000px-wide WebPs total approximately 560 KB. Images load lazily where appropriate and are shared between each section and its enlarged preview.

To regenerate from the repository root (requires backend dependencies, `pdftoppm`, and `cwebp`):

```sh
backend/node_modules/.bin/tsx backend/scripts/generate-marketing-template-previews.ts
```

## Interaction and scope

- Every template can be enlarged in a keyboard-accessible modal. Escape closes it; focus returns to the opener. The background is locked while it is open.
- The companion has a dedicated `showcase` stop on the left of the template collection, between the demo and pricing. Studio exposes its position, dialogue, and approach timing. Existing version-1 exports gain this stop without changing their other settings. All sizes hide during the preview modal. The full rail requires at least 1360px width and 560px height; smaller viewports use the compact mascot.
- Template browsing is local and independent of the demo's editing state. CTAs use the existing Free signup flow and clear pending paid checkout intent. Visitors select their actual template in the CV editor after signup; this showcase does not claim to apply a template to an account.
- Transitions honor reduced motion. The comparison bar is review UI, separate from the landing-page content.
- Comparison routes are `noindex, nofollow` and use the existing development/review build gate. Default production output excludes their route chunks but includes the seven preview images used by the public Lookbook. A dedicated review build can use `VITE_ENABLE_DESIGN_TOOLS=true`.

## Browser settings versus deployment

Studio's **Use on review pages** action saves settings only in that browser and origin (`127.0.0.1:5174` is separate from the deployed domain). A URL does not contain the settings. The approved pricing welcome is now in source: the delighted (`celebrate`) pose sits beside the left edge of the Pro card, measured responsively rather than with a saved pixel offset. Older browser exports retain the original outer-rail anchor, so saved pixel offsets are not applied twice. Studio now offers both “Beside the Pro card” and “Original outer rail.” An export is still required to reproduce any other custom browser settings exactly. Do not reset or overwrite a local draft while collecting the approved export. The public entry deliberately uses source defaults, not a visitor's draft.

## Responsive behavior

The desktop demo height responds to the viewport; phone editing/preview panels use normal page scrolling. The Lookbook paper size responds to viewport height. Short screens use tighter hero spacing, and dialogue/preview windows stay within the viewport. The Lookbook stays horizontally centered; its mascot uses the outer left margin. The hero keeps its original width-based headline sizing even on short screens, with tighter surrounding spacing.

## Verification

- All 73 tests and the production client/SSR/prerender build pass.
- The public production build includes the Lookbook and real preview assets; comparison routes remain gated.
- Browser checks cover all three directions at 1440, 768, 390, and 320px: section order, no horizontal overflow, all seven selections, full-size previews, Escape/focus restoration, no browser errors, and correct review metadata.
- Interaction checks cover carousel wrapping, keyboard navigation, reduced motion, preserved demo edits while switching directions, and the selected public Lookbook.

- Responsive route checks cover 1440×900, 1366×600, 1440×560, 1440×500, 1280×600, 1024×768, 390×844, 320×568, 844×390, and 667×375. Checks include both scroll directions, return-to-top, preview bounds, parked/repeated dragging, the next-destination release, retained demo edits, and reduced motion.
