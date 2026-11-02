import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics, ParseCvFileResult } from "../src/modules/imports/parsers/cv-parser";
import type { CvReviewAiOutput } from "../src/modules/ai/flows/flow-contracts";
import {
  AI_REVIEW_CRITERIA,
  IMAGE_BASED_HEADLINE,
  IMAGE_BASED_IMPROVEMENT,
  IMAGE_BASED_NO_TEXT_SCORE,
  IMAGE_BASED_SCORE_CAP,
  buildAiReviewInput,
  reviewCv,
  scoreAiReview
} from "../src/modules/cv-review/cv-review";
import {
  MIN_TEXT_LAYER_WORDS,
  __private,
  classifyPdfTextLayer
} from "../src/modules/imports/parsers/simple-cv-parser";

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const CV_LINES = [
  "Alex Smith", "alex@example.com", "Experience",
  "Senior software engineer at Example Ltd from 2020 to 2025.",
  "Built Python services for 200 internal users and reduced hosting costs by 30 percent.",
  "Delivered reliable SQL reporting tools for the operations department and its regional managers.",
  "Mentored four junior engineers and introduced code review practices across two product teams.",
  "Education", "Computer Science degree, Example University, 2016 to 2020.",
  "Skills", "Python, SQL, PostgreSQL, Docker, Kubernetes, testing, mentoring, technical writing."
];
const words = (count: number) => Array.from({ length: count }, (_, index) => `word${String.fromCharCode(97 + (index % 26))}${index}`).join(" ").replace(/\d/g, "");

async function imagePdf(pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(PNG_1PX);
  for (let i = 0; i < pages; i++) pdf.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  return pdf.save();
}

async function textPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  CV_LINES.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 18, size: 9, font }));
  return pdf.save();
}

// PDF.js cannot load inside Vitest's VM, so the real parser runs in a Node child process.
async function parseInNode(bytes: Uint8Array, env: Record<string, string> = {}): Promise<ParseCvFileResult> {
  const directory = await mkdtemp(join(tmpdir(), "cv-image-pdf-"));
  const file = join(directory, "cv.pdf");
  try {
    await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", join(__dirname, "helpers/parse-file-cli.ts"), file, "application/pdf"], {
      cwd: join(__dirname, ".."), env: { ...process.env, NODE_ENV: "test", PDF_OCR_ENABLED: "false", ...env }, maxBuffer: 4 * 1024 * 1024
    });
    return JSON.parse(stdout) as ParseCvFileResult;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("image-based PDF detection", () => {
  it("classifies the PDF.js text layer without OCR", () => {
    const candidate = (text: string) => __private.createCandidate("pdfjs_text", text);
    expect(classifyPdfTextLayer(null, 1)).toBe("missing");
    expect(classifyPdfTextLayer(candidate("12 3"), 1)).toBe("missing");
    expect(classifyPdfTextLayer(candidate("Alex Smith Product Designer"), 1)).toBe("poor");
    // Glyphs without a Unicode mapping come out as symbols and private-use characters.
    expect(classifyPdfTextLayer(candidate("\uE001\uE002 $%&' ()*+ ,-./ Ab 0123 \uE010\uE011 :;<= >?@[ cd\n".repeat(30)), 1)).toBe("poor");
    expect(classifyPdfTextLayer(candidate(CV_LINES.join("\n")), 1)).toBe("ok");
    // Thin text spread across many pages (a name on each image page) is not a usable text layer.
    expect(classifyPdfTextLayer(candidate(words(MIN_TEXT_LAYER_WORDS + 10)), 1)).toBe("ok");
    expect(classifyPdfTextLayer(candidate(words(MIN_TEXT_LAYER_WORDS + 10)), 4)).toBe("poor");
  });

  it("flags a PDF of images, keeps no binary noise and works with OCR disabled", async () => {
    const result = await parseInNode(await imagePdf(2));
    expect(result.diagnostics).toMatchObject({ final_stage: expect.any(String), page_count: 2, text_layer: "missing", image_based: true, ocr: "disabled" });
    expect(result.rawExtractedText).toBe("");
    expect(result.parsedContent.sections).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/No readable text was extracted/);
  }, 30_000);

  it("leaves a text PDF unflagged", async () => {
    const result = await parseInNode(await textPdf());
    expect(result.diagnostics).toMatchObject({ final_stage: "pdfjs_text", page_count: 1, text_layer: "ok", image_based: false });
    expect(result.diagnostics?.ocr).toBeUndefined();
    expect(result.rawExtractedText).toContain("Built Python services");
  }, 30_000);

  it("never flags DOCX or PDFs that PDF.js cannot open", async () => {
    const { SimpleCvParser } = await import("../src/modules/imports/parsers/simple-cv-parser");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", `<w:document><w:body>${CV_LINES.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
    const docx = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const parsed = await new SimpleCvParser().parse({ originalFilename: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: docx.length, bytes: docx });
    expect(parsed.diagnostics?.final_stage).toBe("docx_xml_text");
    expect(parsed.diagnostics?.image_based).toBeUndefined();
    const corrupt = new Uint8Array(Buffer.from("%PDF-1.7\nnot really a pdf"));
    const unreadable = await new SimpleCvParser().parse({ originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: corrupt.length, bytes: corrupt });
    expect(unreadable.diagnostics?.image_based).toBeUndefined();
  });
});

const section = (type: string, fields: Record<string, string | string[]>): CvSection => ({ id: type, type, title: type, order: 0, meta: {}, blocks: [{ id: `${type}-block`, type, order: 0, visibility: "visible", fields, meta: {} }] });
const cv = (): CvContent => ({ version: "v1", language: "en", metadata: {}, sections: [
  section("header", { full_name: "Alex Smith", email: "alex@example.com" }),
  section("experience", { role: "Software engineer", company: "Example Ltd", start_date: "2020", end_date: "2025", description: ["Built Python services for 200 users and reduced costs by 30%.", "Delivered reliable SQL reporting tools for the operations department."] }),
  section("education", { degree: "Computer Science", institution: "Example University" }),
  section("skills", { skills: ["Python", "SQL"] })
] });
const rawText = "Alex Smith Software engineer at Example Ltd built Python services for 200 users and reduced costs by 30%.";
const quality = { score: 100, confidence: "high" as const, low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 };
const textPdfDiagnostics = (): ParseCvFileDiagnostics => ({ mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text", quality });
const ocrDiagnostics = (): ParseCvFileDiagnostics => ({
  mime_type: "application/pdf", attempted_stages: ["pdfjs_text", "pdf_token_heuristic", "pdf_ocr_tesseract"], final_stage: "pdf_ocr_tesseract",
  page_count: 1, text_layer: "missing", image_based: true, ocr: "recovered", quality
});
const noTextDiagnostics = (ocr: ParseCvFileDiagnostics["ocr"]): ParseCvFileDiagnostics => ({
  mime_type: "application/pdf", attempted_stages: ["pdfjs_text", "pdf_token_heuristic"], final_stage: "pdf_token_heuristic",
  page_count: 1, text_layer: "missing", image_based: true, ocr, quality: { ...quality, score: 55, confidence: "medium" }
});
const ratings = (level: number): CvReviewAiOutput => ({
  criteria: AI_REVIEW_CRITERIA.map(id => ({ id, level, assessment: `${id} assessment.`, strength: `${id} strength.`, issue: level === 4 ? null : `${id} issue.`, quote: null, fix: level === 4 ? null : `${id} fix.` }))
});
const dim = (review: ReturnType<typeof reviewCv>, id: string) => review.dimensions.find(d => d.id === id)!;

describe("image-based CV review", () => {
  it("gives an image without usable text a fixed low score, not a failure", () => {
    for (const ocr of ["disabled", "failed", "timed_out", "no_text", "skipped_large"] as const) {
      const input = { content: { version: "v1", language: "en", metadata: {}, sections: [] } as CvContent, import_status: "parsed", raw_text: "", diagnostics: noTextDiagnostics(ocr) };
      expect(buildAiReviewInput(input)).toBeNull();
      const review = reviewCv(input);
      expect(review).toMatchObject({ method: "basic", status: "partial", score: IMAGE_BASED_NO_TEXT_SCORE, assessed_weight: 5, ats_blocker: "image_based", strengths: [] });
      expect(review.summary.startsWith(`${IMAGE_BASED_HEADLINE}.`)).toBe(true);
      expect(review.improvements[0]).toBe(IMAGE_BASED_IMPROVEMENT);
      expect(dim(review, "ats")).toMatchObject({ score: 0 });
      expect(dim(review, "ats").reason).toMatch(/can't read it/);
      expect(review.dimensions.filter(d => d.id !== "ats").every(d => d.score === null && d.reason)).toBe(true);
    }
  });

  it("scores recovered OCR content as usual, then sets ATS to 0 and caps the total", () => {
    const input = { content: cv(), import_status: "parsed", raw_text: rawText, diagnostics: ocrDiagnostics() };
    const asText = { ...input, diagnostics: textPdfDiagnostics() };
    const excellent = scoreAiReview(input, ratings(4));
    expect(scoreAiReview(asText, ratings(4)).score).toBe(100);
    expect(excellent).toMatchObject({ method: "ai", score: IMAGE_BASED_SCORE_CAP, ats_blocker: "image_based" });
    expect(dim(excellent, "ats")).toMatchObject({ score: 0 });
    for (const id of AI_REVIEW_CRITERIA) expect(dim(excellent, id).score).toBe(100);
    expect(excellent.improvements[0]).toBe(IMAGE_BASED_IMPROVEMENT);
    expect(excellent.summary.startsWith(`${IMAGE_BASED_HEADLINE}.`)).toBe(true);
    expect(excellent.summary).toContain("Needs significant work.");
    // A total already below the cap is kept, with the ATS points removed.
    const weak = scoreAiReview(input, ratings(0));
    expect(weak.score).toBeLessThan(IMAGE_BASED_SCORE_CAP);
    expect(weak.score).toBeLessThan(scoreAiReview(asText, ratings(0)).score!);

    const basic = reviewCv(input);
    const basicAsText = reviewCv(asText);
    expect(basic).toMatchObject({ method: "basic", ats_blocker: "image_based" });
    expect(basic.score).toBeLessThanOrEqual(IMAGE_BASED_SCORE_CAP);
    expect(dim(basic, "impact")).toEqual(dim(basicAsText, "impact"));
    expect(dim(basic, "structure")).toEqual(dim(basicAsText, "structure"));
    expect(basic.improvements[0]).toBe(IMAGE_BASED_IMPROVEMENT);
    expect(buildAiReviewInput(input)).toEqual(buildAiReviewInput(asText));
  });

  it("leaves text PDFs and old uploads exactly as before", () => {
    const plain = { content: cv(), import_status: "parsed", raw_text: rawText, diagnostics: textPdfDiagnostics() };
    const withLayer = { ...plain, diagnostics: { ...textPdfDiagnostics(), page_count: 1, text_layer: "ok" as const, image_based: false } };
    expect(reviewCv(withLayer)).toEqual(reviewCv(plain));
    expect(scoreAiReview(withLayer, ratings(3))).toEqual(scoreAiReview(plain, ratings(3)));
    expect(reviewCv(plain).ats_blocker).toBeUndefined();
    // OCR text that is not from an image-based upload stays unscorable, as before.
    const legacyOcr = { ...plain, diagnostics: { ...ocrDiagnostics(), image_based: undefined, ocr: undefined } };
    expect(reviewCv(legacyOcr).status).toBe("unscorable");
    // A failed import is never scored, image-based or not.
    expect(reviewCv({ ...plain, import_status: "failed", diagnostics: noTextDiagnostics("disabled") }).status).toBe("unscorable");
  });
});
