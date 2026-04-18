import type { RenderingPayload } from "../../rendering/rendering.types";
import type { TemplateSummary } from "../../templates/templates.types";

export interface ExportDocumentTheme {
  heading_color_rgb: [number, number, number];
  accent_color_rgb: [number, number, number];
}

export interface ExportDocumentBlock {
  headline: string | null;
  subheadline: string | null;
  metadata_line: string | null;
  bullets: string[];
  body: string | null;
}

export interface ExportDocumentSection {
  title: string;
  blocks: ExportDocumentBlock[];
}

export interface ExportDocumentModel {
  title: string;
  subtitle: string | null;
  contact_line: string | null;
  sections: ExportDocumentSection[];
  theme: ExportDocumentTheme;
}

const DEFAULT_THEME: ExportDocumentTheme = {
  heading_color_rgb: [28, 28, 33],
  accent_color_rgb: [26, 99, 176]
};

const MINIMAL_THEME: ExportDocumentTheme = {
  heading_color_rgb: [24, 24, 24],
  accent_color_rgb: [91, 91, 91]
};

const toTitleCase = (value: string): string => {
  const words = value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.join(" ");
};

const firstText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeLine = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildMetadataLine = (dateRange: string | null, location: string | null): string | null => {
  const items = [dateRange, location].map((item) => item?.trim()).filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return items.join(" • ");
};

const resolveTheme = (template: TemplateSummary | null): ExportDocumentTheme => {
  const slug = template?.slug ?? "";

  if (slug === "minimal-professional") {
    return MINIMAL_THEME;
  }

  return DEFAULT_THEME;
};

export const mapRenderingPayloadToExportDocument = (
  rendering: RenderingPayload,
  template: TemplateSummary | null
): ExportDocumentModel => {
  const metadata = rendering.document.context;

  const title =
    firstText((rendering.document.context?.full_name as string | undefined) ?? undefined) ??
    firstText((metadata?.full_name as string | undefined) ?? undefined) ??
    firstText((metadata?.name as string | undefined) ?? undefined) ??
    firstText((rendering.document.title as string | undefined) ?? undefined) ??
    "Tailored CV";

  const subtitle =
    firstText((metadata?.headline as string | undefined) ?? undefined) ??
    firstText((metadata?.title as string | undefined) ?? undefined) ??
    null;

  const contactItems = [
    firstText((metadata?.email as string | undefined) ?? undefined),
    firstText((metadata?.phone as string | undefined) ?? undefined),
    firstText((metadata?.location as string | undefined) ?? undefined)
  ].filter(Boolean) as string[];

  const sections: ExportDocumentSection[] = rendering.sections
    .map((section) => {
      const blocks: ExportDocumentBlock[] = section.blocks
        .filter((block) => block.visibility === "visible")
        .map((block) => {
          const body = normalizeLine(block.plain_text);

          return {
            headline: normalizeLine(block.derived.headline),
            subheadline: normalizeLine(block.derived.subheadline),
            metadata_line: buildMetadataLine(block.derived.date_range, block.derived.location),
            bullets: block.derived.bullets.filter((item) => item.trim().length > 0),
            body
          };
        })
        .filter(
          (block) =>
            block.headline !== null ||
            block.subheadline !== null ||
            block.metadata_line !== null ||
            block.bullets.length > 0 ||
            block.body !== null
        );

      return {
        title: normalizeLine(section.title) ?? toTitleCase(section.type),
        blocks
      };
    })
    .filter((section) => section.blocks.length > 0);

  return {
    title,
    subtitle,
    contact_line: contactItems.length > 0 ? contactItems.join(" • ") : null,
    sections,
    theme: resolveTheme(template)
  };
};
