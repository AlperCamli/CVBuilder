import { normalizeCvContent } from "../../shared/cv-content/cv-content.utils";
import type { CvJsonValue } from "../../shared/cv-content/cv-content.types";
import type { TemplatesService } from "../templates/templates.service";
import { mapRenderingPayloadToPresentation } from "./rendering-presentation";
import type {
  BlockRenderingContext,
  BuildRenderingInput,
  BuildRenderingResult,
  RenderingBlock,
  RenderingBlockDerived,
  RenderingFieldValue,
  RenderingPreviewRequest,
  RenderingPreviewResponse,
  RenderingSection,
  SectionRenderingContext,
  SessionContext
} from "./rendering.types";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const extractTextItems = (value: CvJsonValue): string[] => {
  if (value === null) {
    return [];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number") {
    return [String(value)];
  }

  if (typeof value === "boolean") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextItems(item));
  }

  return Object.values(value).flatMap((item) => extractTextItems(item));
};

const toPlainText = (items: string[]): string => {
  return items.join(" ").replace(/\s+/g, " ").trim();
};

const keyMatches = (key: string, accepted: string[]): boolean => {
  const normalized = key.toLowerCase();
  return accepted.some((item) => normalized === item || normalized.includes(item));
};

export class RenderingService {
  constructor(private readonly templatesService: TemplatesService) {}

  async buildRendering(input: BuildRenderingInput): Promise<BuildRenderingResult> {
    const fallbackLanguage = input.language?.trim() || "en";
    const normalizedContent = normalizeCvContent(input.current_content, fallbackLanguage);
    const resolvedTemplate = await this.templatesService.resolveTemplateForRendering({
      template_id: input.template_id,
      allow_inactive_selected: input.allow_inactive_selected_template ?? false
    });

    const sortedSections = [...normalizedContent.sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => {
        const blocks = [...section.blocks]
          .sort((a, b) => a.order - b.order)
          .map((block) => this.toRenderingBlock(block));

        return this.toRenderingSection({
          section,
          blocks
        });
      });

    const plainText = sortedSections
      .map((section) => section.plain_text)
      .filter(Boolean)
      .join("\n")
      .trim();

    const renderingPayload = {
      version: "v1" as const,
      document: {
        kind: input.cv_kind,
        id: input.document?.id ?? null,
        title: input.document?.title ?? null,
        language: normalizedContent.language,
        generated_at: new Date().toISOString(),
        updated_at: input.document?.updated_at ?? null,
        context: isPlainObject(input.context) ? input.context : {}
      },
      template: resolvedTemplate,
      sections: sortedSections,
      plain_text: plainText
    };

    const presentation = mapRenderingPayloadToPresentation(
      renderingPayload,
      normalizedContent.metadata,
      resolvedTemplate.template
    );

    return {
      current_content: normalizedContent,
      resolved_template: resolvedTemplate,
      rendering: renderingPayload,
      presentation
    };
  }

  async previewFromRawInput(
    _session: SessionContext,
    input: RenderingPreviewRequest
  ): Promise<RenderingPreviewResponse> {
    return this.buildRendering({
      cv_kind: input.cv_kind,
      current_content: input.current_content,
      template_id: input.template_id,
      language: input.language,
      context: input.context
    });
  }

  private toRenderingSection(context: SectionRenderingContext): RenderingSection {
    const plainText = context.blocks
      .map((block) => block.plain_text)
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      id: context.section.id,
      type: context.section.type,
      title: context.section.title,
      order: context.section.order,
      meta: context.section.meta,
      blocks: context.blocks,
      plain_text: plainText
    };
  }

  private toRenderingBlock(block: BlockRenderingContext["block"]): RenderingBlock {
    const normalizedFields: Record<string, RenderingFieldValue> = {};
    for (const [key, value] of Object.entries(block.fields)) {
      const items = extractTextItems(value);
      normalizedFields[key] = {
        raw: value,
        text_items: items,
        text: toPlainText(items)
      };
    }

    const plainText = Object.values(normalizedFields)
      .flatMap((entry) => entry.text_items)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const derived = this.deriveBlock({
      block,
      normalized_fields: normalizedFields
    });

    return {
      id: block.id,
      type: block.type,
      order: block.order,
      visibility: block.visibility,
      fields: block.fields,
      meta: block.meta,
      normalized_fields: normalizedFields,
      derived,
      plain_text: plainText
    };
  }

  private deriveBlock(context: BlockRenderingContext): RenderingBlockDerived {
    const entries = Object.entries(context.normalized_fields);
    const nonEmpty = entries.filter(([, value]) => Boolean(value.text));

    const pickByKeys = (keys: string[]): string | null => {
      const matched = nonEmpty.find(([key]) => keyMatches(key, keys));
      return matched?.[1].text ?? null;
    };

    const headline =
      pickByKeys(["headline", "title", "position", "role", "name", "summary", "text"]) ??
      nonEmpty[0]?.[1].text ??
      null;

    const subheadline =
      pickByKeys(["company", "institution", "organization", "subtitle", "program", "degree"]) ??
      nonEmpty.find(([, value]) => value.text !== headline)?.[1].text ??
      null;

    const bulletCandidates = nonEmpty.filter(([key, value]) => {
      if (value.text_items.length > 1) {
        return true;
      }

      return keyMatches(key, [
        "bullet",
        "highlights",
        "achievement",
        "responsibility",
        "items",
        "tasks",
        "points"
      ]);
    });
    const bullets = bulletCandidates
      .flatMap(([, value]) => value.text_items)
      .filter((item) => item.length > 0)
      .slice(0, 8);

    const startDate = pickByKeys(["start_date", "start", "from"]);
    const endDate = pickByKeys(["end_date", "end", "to", "until"]);
    const dateRange = startDate
      ? `${startDate} - ${endDate ?? "Present"}`
      : endDate ?? pickByKeys(["date", "period", "duration"]);

    const location = pickByKeys(["location", "city", "country", "region"]);

    return {
      headline,
      subheadline,
      bullets,
      date_range: dateRange || null,
      location
    };
  }
}
