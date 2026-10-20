import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type { ParseCvFileInput } from "./cv-parser";

/** DOCX pagination depends on Word's layout engine; only use its saved count. */
export const readSourcePageCount = async (input: ParseCvFileInput): Promise<number | null> => {
  try {
    if (input.mimeType === "application/pdf" || /\.pdf$/i.test(input.originalFilename)) {
      const pdf = await PDFDocument.load(input.bytes, { updateMetadata: false });
      return pdf.getPageCount() || null;
    }
    if (input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(input.originalFilename)) {
      const archive = await JSZip.loadAsync(input.bytes);
      const properties = await archive.file("docProps/app.xml")?.async("string");
      const count = Number(properties?.match(/<(?:[\w-]+:)?Pages\b[^>]*>\s*(\d+)\s*<\/(?:[\w-]+:)?Pages>/)?.[1]);
      return Number.isSafeInteger(count) && count > 0 ? count : null;
    }
  } catch {
    // A missing page count must never prevent an otherwise valid import.
  }
  return null;
};
