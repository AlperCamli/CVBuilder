import type { CvContent } from "../../../shared/cv-content/cv-content.types";

export type ParserExtractionStage =
  | "text_decode"
  | "pdfjs_text"
  | "docx_xml_text"
  | "pdf_ocr_tesseract"
  | "pdf_token_heuristic"
  | "utf8_decode";

export type ParserExtractionConfidence = "high" | "medium" | "low";

/**
 * What PDF.js found in a PDF it could open: usable text, too little or garbled text ("poor"),
 * or no text at all ("missing"). Absent for DOCX/text files and for PDFs PDF.js could not open.
 */
export type PdfTextLayer = "ok" | "poor" | "missing";

/** Why OCR did or did not supply the final text of a PDF that needed it. */
export type PdfOcrOutcome = "recovered" | "no_text" | "failed" | "timed_out" | "disabled" | "skipped_large";

export interface ParseCvFileDiagnostics {
  mime_type: string;
  attempted_stages: ParserExtractionStage[];
  final_stage: ParserExtractionStage;
  /** PDF page count reported by PDF.js. */
  page_count?: number | null;
  text_layer?: PdfTextLayer;
  /**
   * A PDF that PDF.js opened but whose text layer is not usable: a picture of text, often a
   * design-tool export. Decided before OCR, so it never depends on OCR succeeding.
   */
  image_based?: boolean;
  /** Set when OCR was needed; "recovered" means the final text came from OCR. */
  ocr?: PdfOcrOutcome;
  quality: {
    score: number;
    confidence: ParserExtractionConfidence;
    low_confidence: boolean;
    natural_language_ratio: number;
    symbol_ratio: number;
    repeated_token_ratio: number;
    entropy_ratio: number;
  };
}

// Module-provided section hints (free-form section types). Merged ahead of the
// built-in section definitions during heuristic parsing; absent for standard CVs.
export interface ExtraSectionDefinition {
  type: string;
  title: string;
  aliases: string[];
  keywords: string[];
}

export interface ParseCvFileInput {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  extraSectionDefinitions?: ExtraSectionDefinition[];
}

export interface ParseCvFileResult {
  parserName: string;
  rawExtractedText: string;
  parsedContent: CvContent;
  warnings: string[];
  diagnostics?: ParseCvFileDiagnostics;
}

export interface ExtractCvRawTextResult {
  parserName: string;
  rawExtractedText: string;
  warnings: string[];
  diagnostics?: ParseCvFileDiagnostics;
}

export interface CvParser {
  parse(input: ParseCvFileInput): Promise<ParseCvFileResult>;
  extractRawText?(input: ParseCvFileInput): Promise<ExtractCvRawTextResult>;
}
