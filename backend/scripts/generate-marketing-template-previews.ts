/** From repo root: backend/node_modules/.bin/tsx backend/scripts/generate-marketing-template-previews.ts
 * Requires pdftoppm and cwebp. Creates marketing previews from real PDF exports,
 * using the shared fictional fixture. No customer data or backend API calls.
 */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { signaturePresentation } from "../tests/fixtures/signature-presentation";
import { generatePdfDocument } from "../src/modules/exports/generators/pdf-generator";
import { mapPresentationToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";

async function main() {
  const output = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/src/assets/template-showcase");
  const temp = await mkdtemp(join(tmpdir(), "cv-template-showcase-"));
  await mkdir(output, { recursive: true });
  try {
    for (const slug of ["horizon-rail", "studio-banner-ocean", "mosaic-columns-rose", "editorial-index-graphite", "mosaic-columns-graphite", "ledger-split", "latex-academic-serif"]) {
      const presentation = signaturePresentation(slug);
      if (slug === "latex-academic-serif") presentation.theme.template_name = "Academic Serif";
      const stem = join(temp, slug);
      await writeFile(`${stem}.pdf`, await generatePdfDocument(mapPresentationToExportDocument(presentation)));
      execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to-x", "1000", "-scale-to-y", "-1", "-png", `${stem}.pdf`, stem]);
      execFileSync("cwebp", ["-quiet", "-q", "90", "-m", "6", `${stem}.png`, "-o", join(output, `${slug}.webp`)]);
      console.log(`Rendered ${slug}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
void main();
