import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { SimpleCvParser } from "../src/modules/imports/parsers/simple-cv-parser";

const detectMimeType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();

  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".doc":
      return "application/msword";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".rtf":
      return "application/rtf";
    default:
      return "application/octet-stream";
  }
};

const getArgValue = (args: string[], key: string): string | null => {
  const index = args.indexOf(key);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }

  return value;
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const targetPath = args.find((arg) => !arg.startsWith("--"));

  if (!targetPath) {
    console.error("Usage: npm run inspect:import -- <file-path> [--out <json-path>] [--full]");
    process.exit(1);
  }

  const resolvedPath = resolve(targetPath);
  const outPath = getArgValue(args, "--out");
  const includeFull = args.includes("--full");

  const bytes = readFileSync(resolvedPath);
  const parser = new SimpleCvParser();
  const result = await parser.parse({
    originalFilename: basename(resolvedPath),
    mimeType: detectMimeType(resolvedPath),
    sizeBytes: bytes.length,
    bytes: new Uint8Array(bytes)
  });

  const blockCount = result.parsedContent.sections.reduce((sum, section) => sum + section.blocks.length, 0);

  const output = {
    parser_name: result.parserName,
    warnings: result.warnings,
    extraction_stage: result.diagnostics?.final_stage ?? null,
    extraction_attempted_stages: result.diagnostics?.attempted_stages ?? [],
    extraction_confidence: result.diagnostics?.quality.confidence ?? null,
    extraction_score: result.diagnostics?.quality.score ?? null,
    extraction_low_confidence: result.diagnostics?.quality.low_confidence ?? null,
    parsed_language: result.parsedContent.language,
    metadata: result.parsedContent.metadata,
    section_count: result.parsedContent.sections.length,
    block_count: blockCount,
    sections: result.parsedContent.sections.map((section) => ({
      type: section.type,
      title: section.title,
      block_count: section.blocks.length,
      sample_blocks: section.blocks.slice(0, 3).map((block) => ({
        type: block.type,
        fields: block.fields
      }))
    })),
    raw_text_sample: result.rawExtractedText.slice(0, 1500),
    ...(includeFull ? { full_result: result } : {})
  };

  const formatted = JSON.stringify(output, null, 2);
  console.log(formatted);

  if (outPath) {
    writeFileSync(resolve(outPath), formatted, "utf-8");
    console.error(`Saved output to ${resolve(outPath)}`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
