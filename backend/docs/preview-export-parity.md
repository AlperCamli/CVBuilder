# Preview / Export Parity

Status: implemented (2026-05).

## Why this exists

Preview and the exported PDF used to be rendered by two unrelated pipelines:

- **Preview** — React HTML/CSS in `frontend/src/app/components/CVPresentationPreview.tsx`, sliced into pages by measuring total DOM height and dividing by page height.
- **Export PDF** — backend `pdf-lib` generator in `backend/src/modules/exports/generators/pdf-generator.ts`, drawing text directly with its own font metrics, fixed `PAGE_MARGIN = 42`, and a separate `ensureSpace`-based page-break algorithm. The three preview scale knobs (`font_scale`, `spacing_scale`, `layout_scale`) were either ignored or applied via a different formula.

Symptoms users hit:

- Preview claimed "22 pages" while the export was 1 page (or vice-versa).
- Templates that fit on the preview blew past the page edge in the export.
- Changing `font_scale` etc. in the editor didn't propagate to the PDF in any predictable way.

## How they're aligned now

Both renderers now share the same math:

1. Identical page geometry — 595 × 842 (A4 in PDF points) and the same `padX` / `padY` formula keyed by `theme.mode`.
2. Identical font and photo sizes (12/13/14/23/etc., scaled by `font_scale`).
3. Identical spacings — `tokens.section_spacing` and `tokens.block_spacing` multiplied by `spacing_scale`.
4. The same atomic-block pagination algorithm: each section title / item is one indivisible `Block`; section titles carry `keepWithNext` so they can't be orphaned at the bottom of a page; no item is ever split mid-content.
5. The PDF generator now receives raw scales (`{ font_scale, spacing_scale, layout_scale }`) as a third argument to `RenderingExportGenerator.generate(...)` instead of getting pre-multiplied tokens.

DOCX behavior is intentionally **unchanged**: it still receives the pre-scaled tokens (the legacy formula) so existing DOCX layouts don't shift.

## Shared constants table

| Aspect | Value used by both renderers |
|---|---|
| Page size | 595 × 842 (A4 in PDF points) |
| Page margins | `padY = (compact: 38 / default: 46) × layoutScale`, `padX = (compact: 34 / default: 38) × layoutScale` |
| Header name | 23 px (21 in compact) × `fontScale` |
| Header subtitle | 14 × `fontScale` |
| Header contact / social | 11 × `fontScale` |
| Photo size | 58 × `fontScale`, gap 16 |
| Section title | 14 × `fontScale`, marginBottom 8 |
| Item title / subtitle / metadata / body / bullets | 13 / 12 / 11 / 12 / 12 × `fontScale` |
| Section / block spacing | `tokens.* × spacingScale` (sidebar variant uses `max(10, … − 3)` and `max(6, … − 3)`) |
| Sidebar column | 170 × `fontScale` outer width, 12 inner padding, accent-tinted card |
| Two-column gap | 20 |
| Pagination | Atomic blocks, `keepWithNext` for section titles, no mid-item splits |

## Caveats — full pixel parity is not possible today

- The preview uses the theme's web font (Helvetica, Georgia, Trebuchet, etc.); the PDF embeds Noto Sans for Unicode coverage. Different font metrics mean slightly different line breaks even when widths and sizes match. Page count and structure align; per-line glyph positions don't.
- The PDF baseline placement uses an `ASCENT_RATIO = 0.8` approximation (Noto Sans). This is a per-font convention; minor vertical drift between blocks is expected.

If full glyph-level parity is ever needed, the path is to embed the same font on both sides (or switch the PDF pipeline to a headless-Chrome HTML render).

## Files involved

- `backend/src/modules/exports/generators/pdf-generator.ts` — block builders, pagination, drawing.
- `backend/src/modules/exports/generators/rendering-export-generator.ts` — `ExportScales` type and routing.
- `backend/src/modules/exports/exports.service.ts` — passes raw scales for PDF, pre-scaled tokens for DOCX.
- `frontend/src/app/components/CVPresentationPreview.tsx` — 2-pass measurement + atomic-block pagination.
- `backend/tests/pdf-generator.unit.test.ts` and `backend/tests/exports.service.integration.test.ts` — regression coverage for the scale contract.

## Extending this

When adding a new section type, template mode, or block kind:

1. Update `CVPresentationPreview.tsx` first — the preview is the source of truth for layout.
2. Mirror the change in `pdf-generator.ts`: add a builder that produces a `PdfBlock` with the same `width`, `lineHeight`, and `keepWithNext` semantics as the preview block.
3. Use the existing scaling helpers (`* fontScale`, `* spacingScale`, `* layoutScale`) — do not hardcode unscaled constants.
4. If the new layout introduces a new column model (e.g. three-column), extend `paginateBlocks` to take additional per-column `availableHeights` arrays the way two-column mode already does.
