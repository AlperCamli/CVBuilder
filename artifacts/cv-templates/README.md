# Signature CV collection

Six compositions, each in three coordinated palettes: **18 PDF templates**.
Open **index.html** to compare them, filter by family, and download PDFs.

| Layout | Base palette | Variations |
| --- | --- | --- |
| Studio | Teal | Ocean, Terracotta |
| Editorial | Plum | Forest, Graphite |
| Horizon | Navy | Forest, Plum |
| Mosaic | Ocean | Rose, Graphite |
| Ledger | Terracotta | Teal, Plum |
| Contour | Rose | Cobalt, Forest |

All examples use the same fictional CV content and the application's PDF exporter.
The section names match the system, including **Skills**. Some layouts display skills
inline; others display them as bullets. The PNGs show the exported PDFs.
`six-layouts-review.png` shows the six base layouts in the actual React preview.

Regenerate from the backend directory:

```sh
npx tsx scripts/preview-signature-templates.ts
npx tsx scripts/render-signature-gallery.mts
```

Deploy both renderers and apply the Signature migrations in order:

- `20261005120000_signature_cv_templates.sql`
- `20261005130000_signature_layouts_and_palettes.sql`

The migrations have not been applied to the deployed database by this task.
