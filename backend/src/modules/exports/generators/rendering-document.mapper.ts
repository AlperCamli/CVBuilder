import type {
  PresentationItem,
  RenderingPresentation,
  PresentationSocialLink
} from "../../rendering/rendering-presentation";

export interface ExportDocumentTheme {
  layout:
    | "modern-clean"
    | "minimal-professional"
    | "executive-timeline"
    | "creative-portfolio"
    | "academic-classic"
    | "tech-compact"
    | "two-column-modern";
  mode: "classic-single-column" | "compact-single-column" | "timeline-split" | "portfolio-two-column";
  heading_color_hex: string;
  accent_color_hex: string;
  body_color_hex: string;
  muted_color_hex: string;
  page_background_hex: string;
  body_text_size: number;
  section_spacing: number;
  block_spacing: number;
  font_family: string;
}

export interface ExportDocumentSocialLink {
  label: string;
  url: string;
  type: string;
}

export interface ExportDocumentBlock {
  headline: string | null;
  subheadline: string | null;
  metadata_line: string | null;
  bullets: string[];
  body: string | null;
}

export interface ExportDocumentSection {
  type: string;
  title: string;
  inline_text: string | null;
  blocks: ExportDocumentBlock[];
}

export interface ExportDocumentModel {
  title: string;
  subtitle: string | null;
  contact_line: string | null;
  contact_items: string[];
  social_links: ExportDocumentSocialLink[];
  photo_data_uri: string | null;
  sections: ExportDocumentSection[];
  theme: ExportDocumentTheme;
}

const normalizeLine = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const mapItemToBlock = (item: PresentationItem): ExportDocumentBlock => {
  return {
    headline: normalizeLine(item.title),
    subheadline: normalizeLine(item.subtitle),
    metadata_line: normalizeLine(item.metadata_line),
    bullets: item.bullets.map((bullet) => bullet.trim()).filter((bullet) => bullet.length > 0),
    body: normalizeLine(item.body)
  };
};

const mapSocialLinks = (links: PresentationSocialLink[]): ExportDocumentSocialLink[] => {
  return links.map((link) => ({
    label: normalizeLine(link.label) ?? "Link",
    url: link.url,
    type: link.type
  }));
};

const toTheme = (presentation: RenderingPresentation): ExportDocumentTheme => {
  return {
    layout: presentation.theme.layout,
    mode: presentation.theme.mode,
    heading_color_hex: presentation.theme.tokens.heading_color_hex,
    accent_color_hex: presentation.theme.tokens.accent_color_hex,
    body_color_hex: presentation.theme.tokens.body_color_hex,
    muted_color_hex: presentation.theme.tokens.muted_color_hex,
    page_background_hex: presentation.theme.tokens.page_background_hex,
    body_text_size: presentation.theme.tokens.body_text_size,
    section_spacing: presentation.theme.tokens.section_spacing,
    block_spacing: presentation.theme.tokens.block_spacing,
    font_family: presentation.theme.tokens.font_family
  };
};

const isDataUriImage = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  return /^data:image\/(png|jpeg|jpg);base64,/i.test(value);
};

export const mapPresentationToExportDocument = (
  presentation: RenderingPresentation
): ExportDocumentModel => {
  const header = presentation.header;
  const title =
    normalizeLine(header.name) ?? normalizeLine(presentation.document_title) ?? "CV";
  const subtitle = normalizeLine(header.title);

  const contactItems = header.contact_items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const sections = presentation.sections
    .map((section) => ({
      type: section.type,
      title: section.title,
      inline_text: normalizeLine(section.inline_text),
      blocks: section.items.map((item) => mapItemToBlock(item)).filter((block) => {
        return (
          block.headline !== null ||
          block.subheadline !== null ||
          block.metadata_line !== null ||
          block.bullets.length > 0 ||
          block.body !== null
        );
      })
    }))
    .filter((section) => section.inline_text !== null || section.blocks.length > 0);

  return {
    title,
    subtitle,
    contact_line: contactItems.length > 0 ? contactItems.join(" • ") : null,
    contact_items: contactItems,
    social_links: mapSocialLinks(header.social_links),
    photo_data_uri: isDataUriImage(header.photo) ? header.photo : null,
    sections,
    theme: toTheme(presentation)
  };
};
