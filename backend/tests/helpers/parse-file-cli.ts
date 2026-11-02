import { readFile } from "node:fs/promises";
import { SimpleCvParser } from "../../src/modules/imports/parsers/simple-cv-parser";

// Runs the real parser in plain Node, where PDF.js can load (it cannot inside Vitest's VM).
// Usage: node --import tsx tests/helpers/parse-file-cli.ts <file> <mime type>
const [file, mimeType] = process.argv.slice(2);
void (async () => {
  const bytes = new Uint8Array(await readFile(file));
  const result = await new SimpleCvParser().parse({ originalFilename: file, mimeType, sizeBytes: bytes.length, bytes });
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
})();
