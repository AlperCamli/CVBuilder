import { NotFoundError, ValidationError } from "../../shared/errors/app-error";
import type { CvTemplateRecord } from "../../shared/types/domain";
import type { TemplatesRepository } from "./templates.repository";
import type {
  ListTemplatesResponse,
  ResolvedTemplateSummary,
  SessionContext,
  TemplateDetail,
  TemplateSummary
} from "./templates.types";

interface ResolveTemplateForRenderingOptions {
  template_id?: string | null;
  allow_inactive_selected?: boolean;
}

export class TemplatesService {
  constructor(private readonly templatesRepository: TemplatesRepository) {}

  async listTemplates(_session: SessionContext): Promise<ListTemplatesResponse> {
    const rows = await this.templatesRepository.listActive();
    return {
      templates: rows.map((row) => this.toSummary(row))
    };
  }

  async getTemplate(_session: SessionContext, templateId: string): Promise<TemplateDetail> {
    const template = await this.templatesRepository.findById(templateId);

    if (!template) {
      throw new NotFoundError("Template was not found");
    }

    return {
      template: this.toSummary(template)
    };
  }

  async validateAssignableTemplateId(templateId: string | null): Promise<string | null> {
    if (templateId === null) {
      return null;
    }

    const template = await this.templatesRepository.findById(templateId);

    if (!template) {
      throw new NotFoundError("Template was not found");
    }

    if (template.status !== "active") {
      throw new ValidationError("Template is not assignable", {
        template_id: templateId,
        status: template.status
      });
    }

    return template.id;
  }

  async resolveTemplateForRendering(
    options: ResolveTemplateForRenderingOptions
  ): Promise<ResolvedTemplateSummary> {
    const templateId = options.template_id;

    if (templateId) {
      const template = await this.templatesRepository.findById(templateId);

      if (!template) {
        throw new NotFoundError("Template was not found", {
          template_id: templateId
        });
      }

      const allowInactive = options.allow_inactive_selected ?? false;
      if (!allowInactive && template.status !== "active") {
        throw new ValidationError("Template is not available for rendering", {
          template_id: templateId,
          status: template.status
        });
      }

      return {
        resolution: "selected",
        template: this.toSummary(template)
      };
    }

    const defaultTemplate = await this.templatesRepository.findDefaultActive();

    if (!defaultTemplate) {
      return {
        resolution: "none",
        template: null
      };
    }

    return {
      resolution: "default_active",
      template: this.toSummary(defaultTemplate)
    };
  }

  private toSummary(row: CvTemplateRecord): TemplateSummary {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      preview_config: row.preview_config,
      export_config: row.export_config,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
