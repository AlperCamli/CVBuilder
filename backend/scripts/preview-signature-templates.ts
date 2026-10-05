import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePdfDocument } from "../src/modules/exports/generators/pdf-generator";
import { mapPresentationToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";
import { signaturePresentation, signatureTemplates } from "../tests/fixtures/signature-presentation";

async function main() {
  const output = resolve(process.argv[2] ?? "../artifacts/cv-templates");
  await mkdir(output, { recursive: true });
  for (const { slug, name } of signatureTemplates) {
    const presentation = signaturePresentation(slug);
    await writeFile(resolve(output, `${name.toLowerCase().replaceAll(" ", "-")}.pdf`), await generatePdfDocument(mapPresentationToExportDocument(presentation)));
    await writeFile(resolve(output, `${slug}.json`), JSON.stringify(presentation, null, 2));
  }
  console.log(`Generated ${signatureTemplates.length} sample PDFs and preview data in ${output}`);
}
void main();
