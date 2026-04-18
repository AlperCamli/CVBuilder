import type { CvContent } from "../../../shared/cv-content/cv-content.types";

export type ParserExtractionStage =
  | "text_decode"
  | "pdfjs_text"
  | "docx_xml_text"
  | "pdf_token_heuristic"
  | "utf8_decode";

export type ParserExtractionConfidence = "high" | "medium" | "low";

export interface ParseCvFileDiagnostics {
  mime_type: string;
  attempted_stages: ParserExtractionStage[];
  final_stage: ParserExtractionStage;
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

export interface ParseCvFileInput {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface ParseCvFileResult {
  parserName: string;
  rawExtractedText: string;
  parsedContent: CvContent;
  warnings: string[];
  diagnostics?: ParseCvFileDiagnostics;
}

export interface CvParser {
  parse(input: ParseCvFileInput): Promise<ParseCvFileResult>;
}
