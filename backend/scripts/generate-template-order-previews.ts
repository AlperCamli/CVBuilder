/** From the repository root:
 * backend/node_modules/.bin/tsx backend/scripts/generate-template-order-previews.ts
 * Creates review thumbnails from real PDF exports using fictional sample content.
 * Requires pdftoppm and cwebp. No account or customer data is used.
 */
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { standardModule } from "../src/shared/cv-modules/standard.module";
import { signaturePresentation, signatureTemplates } from "../tests/fixtures/signature-presentation";
import { generatePdfDocument } from "../src/modules/exports/generators/pdf-generator";
import { mapPresentationToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const seed = await readFile(join(root, "backend/supabase/seed.sql"), "utf8");
  const names = new Map([...seed.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'active'/g)].map(match => [match[2], match[1]]));
  const output = join(root, "frontend/public/images/designs/template-order");
  const temp = await mkdtemp(join(tmpdir(), "cv-template-order-"));
  await mkdir(output, { recursive: true });
  try {
    const templates = standardModule.templateSlugs.map(slug => {
      const name = names.get(slug);
      if (!name) throw new Error(`Missing seeded template: ${slug}`);
      const signature = signatureTemplates.find(template => template.slug === slug);
      return { slug, name, family: signature?.layout ?? null, signature: Boolean(signature), base: signature?.isBase ?? false };
    }).sort((a, b) => {
      if (a.signature !== b.signature) return a.signature ? -1 : 1;
      if (a.signature && a.base !== b.base) return a.base ? -1 : 1;
      if (a.slug.startsWith("latex-") !== b.slug.startsWith("latex-")) return a.slug.startsWith("latex-") ? -1 : 1;
      return a.name.localeCompare(b.name, "en");
    });
    for (const template of templates) {
      const presentation = signaturePresentation(template.slug);
      presentation.theme.template_name = template.name;
      // The fixture bypasses item mapping. Mirror the Academic Serif employer/role layout.
      if (presentation.theme.tokens.academic_entry_style) {
        for (const section of presentation.sections.filter(section => section.type === "experience"))
          for (const item of section.items) [item.title, item.subtitle] = [item.subtitle, item.title];
      }
      const stem = join(temp, template.slug);
      await writeFile(`${stem}.pdf`, await generatePdfDocument(mapPresentationToExportDocument(presentation)));
      execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1100", "-png", `${stem}.pdf`, stem], { stdio: ["ignore", "ignore", "pipe"] });
      execFileSync("cwebp", ["-quiet", "-q", "87", `${stem}.png`, "-o", join(output, `${template.slug}.webp`)]);
    }
    await writeFile(join(root, "frontend/src/app/pages/designs/template-order-catalog.json"), JSON.stringify(templates.map(({slug,name})=>({slug,name})), null, 2) + "\n");
    console.log(`Generated ${templates.length} template previews.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
void main();
