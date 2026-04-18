import type { ExportFormat } from "../../../shared/types/domain";
import type { ExportDocumentModel } from "./rendering-document.mapper";

export interface GenerateDocumentInput {
  format: ExportFormat;
  document: ExportDocumentModel;
}

export interface DocumentGenerator {
  generate(input: GenerateDocumentInput): Promise<Uint8Array>;
}
