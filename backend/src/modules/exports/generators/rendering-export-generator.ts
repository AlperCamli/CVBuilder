import { ExportGenerationFailedError } from "../../../shared/errors/app-error";
import type { ExportFormat } from "../../../shared/types/domain";
import type { RenderingPayload } from "../../rendering/rendering.types";
import type { TemplateSummary } from "../../templates/templates.types";
import { generateDocxDocument } from "./docx-generator";
import { generatePdfDocument } from "./pdf-generator";
import { mapRenderingPayloadToExportDocument } from "./rendering-document.mapper";

export interface RenderingExportGenerator {
  generate(format: ExportFormat, rendering: RenderingPayload, template: TemplateSummary | null): Promise<Uint8Array>;
}

export class DefaultRenderingExportGenerator implements RenderingExportGenerator {
  async generate(
    format: ExportFormat,
    rendering: RenderingPayload,
    template: TemplateSummary | null
  ): Promise<Uint8Array> {
    const documentModel = mapRenderingPayloadToExportDocument(rendering, template);

    try {
      if (format === "pdf") {
        return await generatePdfDocument(documentModel);
      }

      if (format === "docx") {
        return await generateDocxDocument(documentModel);
      }

      throw new ExportGenerationFailedError("Unsupported export format", {
        format
      });
    } catch (error) {
      if (error instanceof ExportGenerationFailedError) {
        throw error;
      }

      throw new ExportGenerationFailedError("Failed to generate export document", {
        format,
        reason: error instanceof Error ? error.message : "unknown_generation_error"
      });
    }
  }
}
