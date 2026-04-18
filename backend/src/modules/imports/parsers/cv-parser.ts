import type { CvContent } from "../../../shared/cv-content/cv-content.types";

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
}

export interface CvParser {
  parse(input: ParseCvFileInput): Promise<ParseCvFileResult>;
}
