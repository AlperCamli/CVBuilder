import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// PDF.js native imports cannot execute inside Vitest's VM. Read the actual PDF
// in Node, using a temporary file to avoid operating-system argument size limits.
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cv-unicode-pdf-"));
  const filename = join(directory, "document.pdf");
  try {
    await writeFile(filename, bytes);
    const pdfJsUrl = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href;
    const script = `
      import { readFile } from "node:fs/promises";
      const { getDocument } = await import(${JSON.stringify(pdfJsUrl)});
      const document = await getDocument({ data: new Uint8Array(await readFile(process.argv[1])), isEvalSupported: false }).promise;
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        console.log(content.items.map(item => item.str || "").join(" "));
      }
      await document.destroy();
    `;
    return (await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, filename], { maxBuffer: 1024 * 1024 })).stdout;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
