import type { CvJsonValue } from "../../shared/cv-content/cv-content.types";
import type { TemplateSummary } from "../templates/templates.types";
import type { RenderingBlock, RenderingPayload, RenderingSection } from "./rendering.types";

export type PresentationTemplateLayout =
  | "modern-clean"
  | "minimal-professional"
  | "executive-timeline"
  | "creative-portfolio";

export type PresentationLayoutMode =
  | "classic-single-column"
  | "compact-single-column"
  | "timeline-split"
  | "portfolio-two-column";

export interface PresentationStyleTokens {
  font_family: string;
  heading_color_hex: string;
  accent_color_hex: string;
  body_color_hex: string;
  muted_color_hex: string;
  page_background_hex: string;
  section_spacing: number;
  block_spacing: number;
  body_text_size: number;
  compact_density: true;
}

export interface PresentationTheme {
  layout: PresentationTemplateLayout;
  mode: PresentationLayoutMode;
  template_slug: string;
  template_name: string;
  tokens: PresentationStyleTokens;
}

export interface PresentationSocialLink {
  id: string;
  type: string;
  url: string;
  label: string;
}

export interface PresentationHeader {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  photo: string | null;
  contact_items: string[];
  social_links: PresentationSocialLink[];
}

export interface PresentationItem {
  id: string;
  title: string | null;
  subtitle: string | null;
  date_range: string | null;
  location: string | null;
  metadata_line: string | null;
  body: string | null;
  bullets: string[];
}

export interface PresentationSection {
  id: string;
  type: string;
  title: string;
  inline_text: string | null;
  items: PresentationItem[];
}

export interface RenderingPresentation {
  version: "v1";
  document_title: string | null;
  theme: PresentationTheme;
  header: PresentationHeader;
  sections: PresentationSection[];
}

interface TemplateProfile {
  layout: PresentationTemplateLayout;
  mode: PresentationLayoutMode;
  tokens: PresentationStyleTokens;
}

const DEFAULT_PROFILE: TemplateProfile = {
  layout: "modern-clean",
  mode: "classic-single-column",
  tokens: {
    font_family: "Georgia, serif",
    heading_color_hex: "#111827",
    accent_color_hex: "#0f5ea6",
    body_color_hex: "#1f2937",
    muted_color_hex: "#4b5563",
    page_background_hex: "#ffffff",
    section_spacing: 16,
    block_spacing: 12,
    body_text_size: 12,
    compact_density: true
  }
};

const TEMPLATE_PROFILES: Record<string, TemplateProfile> = {
  "modern-clean": DEFAULT_PROFILE,
  "minimal-professional": {
    layout: "minimal-professional",
    mode: "compact-single-column",
    tokens: {
      font_family: "Helvetica, Arial, sans-serif",
      heading_color_hex: "#121212",
      accent_color_hex: "#4b5563",
      body_color_hex: "#1f1f1f",
      muted_color_hex: "#606060",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 11,
      compact_density: true
    }
  },
  "executive-timeline": {
    layout: "executive-timeline",
    mode: "timeline-split",
    tokens: {
      font_family: "Cambria, Georgia, serif",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#1d4ed8",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 14,
      block_spacing: 10,
      body_text_size: 11,
      compact_density: true
    }
  },
  "creative-portfolio": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    tokens: {
      font_family: "Trebuchet MS, Verdana, sans-serif",
      heading_color_hex: "#111827",
      accent_color_hex: "#0f766e",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 14,
      block_spacing: 10,
      body_text_size: 11,
      compact_density: true
    }
  }
};

const SECTION_TITLE_OVERRIDES: Record<string, string> = {
  summary: "Professional Summary",
  experience: "Work Experience",
  education: "Education",
  skills: "Skills",
  languages: "Languages",
  certifications: "Certifications",
  courses: "Courses",
  projects: "Projects",
  volunteer: "Volunteer Work",
  awards: "Awards",
  publications: "Publications",
  references: "References"
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const asString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
};

const normalizeLine = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const keyMatches = (key: string, accepted: string[]): boolean => {
  const normalized = key.toLowerCase();
  return accepted.some((value) => normalized === value || normalized.includes(value));
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const collapseForCompare = (value: string): string => collapseWhitespace(value).toLowerCase();

const dedupeText = (items: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = collapseWhitespace(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
};

const extractTextItems = (value: CvJsonValue): string[] => {
  if (value === null) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = collapseWhitespace(value);
    return normalized ? [normalized] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextItems(item));
  }

  return Object.values(value).flatMap((item) => extractTextItems(item));
};

const textByKey = (block: RenderingBlock, keys: string[]): string | null => {
  for (const key of keys) {
    const direct = normalizeLine(block.normalized_fields[key]?.text ?? null);
    if (direct) {
      return direct;
    }

    const match = Object.entries(block.normalized_fields).find(([fieldKey]) => keyMatches(fieldKey, [key]));
    const matched = normalizeLine(match?.[1].text ?? null);
    if (matched) {
      return matched;
    }
  }

  return null;
};

const pickBodyText = (sectionType: string, block: RenderingBlock): string | null => {
  const preferredKeys = ["description", "summary", "details", "notes", "responsibilities", "highlights"];

  for (const key of preferredKeys) {
    const value = normalizeLine(block.normalized_fields[key]?.text ?? null);
    if (value) {
      return value;
    }
  }

  const allowTextFallback = ["experience", "volunteer", "projects", "awards", "publications", "references", "custom"].includes(
    sectionType
  );
  if (allowTextFallback) {
    const textValue = normalizeLine(block.normalized_fields.text?.text ?? null);
    if (textValue) {
      return textValue;
    }
  }

  const allowPlainTextFallback = ![
    "summary",
    "experience",
    "education",
    "skills",
    "languages",
    "certifications",
    "courses",
    "projects",
    "volunteer",
    "awards",
    "publications",
    "references"
  ].includes(sectionType);

  if (!allowPlainTextFallback) {
    return null;
  }

  return normalizeLine(block.plain_text);
};

const buildMetadataLine = (dateRange: string | null, location: string | null): string | null => {
  const items = [dateRange, location].filter((item): item is string => Boolean(item));
  if (items.length === 0) {
    return null;
  }

  return items.join(" • ");
};

const getSectionTitle = (sectionType: string): string => {
  if (SECTION_TITLE_OVERRIDES[sectionType]) {
    return SECTION_TITLE_OVERRIDES[sectionType];
  }

  return sectionType
    .replace(/[\-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const toPreviewLinkHref = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

const toPreviewSocialLabel = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = toPreviewLinkHref(trimmed);

  try {
    const parsed = new URL(normalized);
    const cleanedPath = parsed.pathname.replace(/\/+$/, "");

    if (cleanedPath && cleanedPath !== "/") {
      return cleanedPath;
    }

    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
};

const detectSocialType = (url: string): string => {
  const value = url.toLowerCase();

  if (value.includes("linkedin.com")) {
    return "linkedin";
  }

  if (value.includes("github.com")) {
    return "github";
  }

  if (value.includes("gitlab.com")) {
    return "gitlab";
  }

  return "website";
};

const resolveTemplateProfile = (template: TemplateSummary | null): PresentationTheme => {
  const slug = template?.slug ?? "modern-clean";
  const profile = TEMPLATE_PROFILES[slug] ?? DEFAULT_PROFILE;

  return {
    layout: profile.layout,
    mode: profile.mode,
    template_slug: slug,
    template_name: template?.name ?? "Default",
    tokens: profile.tokens
  };
};

const blockToPresentationItem = (sectionType: string, block: RenderingBlock): PresentationItem | null => {
  if (block.visibility !== "visible") {
    return null;
  }

  const headline = normalizeLine(block.derived.headline);
  const subheadline = normalizeLine(block.derived.subheadline);
  const dateRange = normalizeLine(block.derived.date_range);
  const location = normalizeLine(block.derived.location);
  const metadataLine = buildMetadataLine(dateRange, location);
  const bullets = dedupeText(block.derived.bullets);

  let body = pickBodyText(sectionType, block);
  const mergedHeading = [headline, subheadline].filter(Boolean).join(" ");

  if (
    body &&
    sectionType !== "summary" &&
    mergedHeading &&
    !metadataLine &&
    bullets.length === 0 &&
    collapseForCompare(body) === collapseForCompare(mergedHeading)
  ) {
    body = null;
  }

  if (
    body &&
    sectionType !== "summary" &&
    headline &&
    !subheadline &&
    !metadataLine &&
    bullets.length === 0 &&
    collapseForCompare(body) === collapseForCompare(headline)
  ) {
    body = null;
  }

  const item: PresentationItem = {
    id: block.id,
    title: sectionType === "summary" ? null : headline,
    subtitle: sectionType === "summary" ? null : subheadline,
    date_range: dateRange,
    location,
    metadata_line: sectionType === "summary" ? null : metadataLine,
    body,
    bullets,
  };

  if (
    !item.title &&
    !item.subtitle &&
    !item.date_range &&
    !item.location &&
    !item.metadata_line &&
    !item.body &&
    item.bullets.length === 0
  ) {
    return null;
  }

  return item;
};

const collectSkillsInlineText = (section: RenderingSection): string | null => {
  const skills: string[] = [];

  for (const block of section.blocks) {
    if (block.visibility !== "visible") {
      continue;
    }

    for (const [key, value] of Object.entries(block.normalized_fields)) {
      if (!keyMatches(key, ["skill", "tools", "technology", "tech", "stack", "items"])) {
        continue;
      }

      skills.push(...value.text_items);
    }

    if (skills.length === 0) {
      const text = normalizeLine(block.normalized_fields.text?.text ?? null);
      if (text) {
        const bySeparator = text
          .split(/[\n,•]+/)
          .map((item) => collapseWhitespace(item))
          .filter((item) => item.length > 0);
        skills.push(...bySeparator);
      }
    }
  }

  const deduped = dedupeText(skills);
  return deduped.length > 0 ? deduped.join(", ") : null;
};

const formatLanguageLine = (
  language: string,
  proficiency: string,
  certificate: string,
  notes: string
): string => {
  const value = collapseWhitespace(language);
  const detailParts = [collapseWhitespace(proficiency), collapseWhitespace(certificate), collapseWhitespace(notes)].filter(
    (part) => part.length > 0
  );

  if (!value) {
    return detailParts.join(" • ");
  }

  if (detailParts.length === 0) {
    return value;
  }

  return `${value} (${detailParts.join(" • ")})`;
};

const collectLanguagesInlineText = (section: RenderingSection): string | null => {
  const lines: string[] = [];

  for (const block of section.blocks) {
    if (block.visibility !== "visible") {
      continue;
    }

    const language = collapseWhitespace(block.normalized_fields.language?.text ?? "");
    const proficiency = collapseWhitespace(
      block.normalized_fields.proficiency?.text ?? block.normalized_fields.level?.text ?? ""
    );
    const certificate = collapseWhitespace(
      block.normalized_fields.certificate?.text ?? block.normalized_fields.score?.text ?? ""
    );
    const notes = collapseWhitespace(block.normalized_fields.notes?.text ?? "");

    if (language || proficiency || certificate || notes) {
      lines.push(formatLanguageLine(language, proficiency, certificate, notes));
      continue;
    }

    const text = normalizeLine(block.normalized_fields.text?.text ?? null);
    if (!text) {
      continue;
    }

    const parsed = text
      .split(/[,;\n]+/)
      .map((item) => collapseWhitespace(item))
      .filter((item) => item.length > 0);

    lines.push(...parsed);
  }

  const deduped = dedupeText(lines);
  return deduped.length > 0 ? deduped.join(", ") : null;
};

const mapSection = (section: RenderingSection): PresentationSection | null => {
  const type = section.type;
  const title = getSectionTitle(type);

  if (type === "skills") {
    const inlineText = collectSkillsInlineText(section);
    if (!inlineText) {
      return null;
    }

    return {
      id: section.id,
      type,
      title,
      inline_text: inlineText,
      items: []
    };
  }

  if (type === "languages") {
    const inlineText = collectLanguagesInlineText(section);
    if (!inlineText) {
      return null;
    }

    return {
      id: section.id,
      type,
      title,
      inline_text: inlineText,
      items: []
    };
  }

  if (type === "summary") {
    const summaryParts = section.blocks
      .filter((block) => block.visibility === "visible")
      .map((block) => pickBodyText(type, block) ?? normalizeLine(block.derived.headline))
      .filter((value): value is string => Boolean(value));

    const deduped = dedupeText(summaryParts);
    const body = deduped.join("\n");

    if (!body) {
      return null;
    }

    return {
      id: section.id,
      type,
      title,
      inline_text: null,
      items: [
        {
          id: `${section.id}-summary`,
          title: null,
          subtitle: null,
          date_range: null,
          location: null,
          metadata_line: null,
          body,
          bullets: []
        }
      ]
    };
  }

  if (type === "education") {
    const items = section.blocks
      .filter((block) => block.visibility === "visible")
      .map((block) => {
        const institution = textByKey(block, ["institution", "school", "university"]);
        const degree = textByKey(block, ["degree", "title"]);
        const fieldOfStudy = textByKey(block, ["field_of_study", "major", "program"]);
        const gpa = textByKey(block, ["gpa"]);
        const startDate = textByKey(block, ["start_date", "start"]);
        const endDate = textByKey(block, ["end_date", "end"]);
        const description = textByKey(block, ["description", "notes", "details"]);

        const dateRange =
          startDate && endDate
            ? `${startDate} - ${endDate}`
            : startDate || endDate || normalizeLine(block.derived.date_range);

        const titleValue = degree || institution || normalizeLine(block.derived.headline);
        const subtitleParts = [institution, fieldOfStudy]
          .filter((value): value is string => Boolean(value))
          .filter((value, index, values) => values.findIndex((item) => collapseForCompare(item) === collapseForCompare(value)) === index)
          .filter((value) => !titleValue || collapseForCompare(value) !== collapseForCompare(titleValue));

        const bodyParts: string[] = [];
        if (gpa) {
          bodyParts.push(`GPA: ${gpa}`);
        }
        if (description) {
          bodyParts.push(description);
        }

        const metadataLine = buildMetadataLine(dateRange, null);

        const item: PresentationItem = {
          id: block.id,
          title: titleValue,
          subtitle: subtitleParts.length > 0 ? subtitleParts.join(" • ") : null,
          date_range: dateRange,
          location: null,
          metadata_line: metadataLine,
          body: bodyParts.length > 0 ? bodyParts.join("\n") : null,
          bullets: []
        };

        if (
          !item.title &&
          !item.subtitle &&
          !item.date_range &&
          !item.metadata_line &&
          !item.body
        ) {
          return null;
        }

        return item;
      })
      .filter((item): item is PresentationItem => item !== null);

    if (items.length === 0) {
      return null;
    }

    return {
      id: section.id,
      type,
      title,
      inline_text: null,
      items
    };
  }

  const items = section.blocks
    .map((block) => blockToPresentationItem(type, block))
    .filter((item): item is PresentationItem => item !== null);

  if (items.length === 0) {
    return null;
  }

  return {
    id: section.id,
    type,
    title,
    inline_text: null,
    items
  };
};

const extractSocialLinks = (metadata: Record<string, CvJsonValue>): PresentationSocialLink[] => {
  const socialArray = Array.isArray(metadata.social_links) ? metadata.social_links : [];
  const urlsArray = Array.isArray(metadata.urls) ? metadata.urls : [];

  const merged: Array<{ id: string; type: string; url: string }> = [];

  for (const entry of socialArray) {
    const record = asRecord(entry);
    const url = toPreviewLinkHref(asString(record.url));
    if (!url) {
      continue;
    }

    merged.push({
      id: collapseWhitespace(asString(record.id)) || `social-${merged.length + 1}`,
      type: collapseWhitespace(asString(record.type)) || detectSocialType(url),
      url
    });
  }

  for (const entry of urlsArray) {
    const url = toPreviewLinkHref(asString(entry));
    if (!url) {
      continue;
    }

    merged.push({
      id: `url-${merged.length + 1}`,
      type: detectSocialType(url),
      url
    });
  }

  const dedupedByUrl = new Map<string, { id: string; type: string; url: string }>();
  for (const entry of merged) {
    const key = entry.url.toLowerCase();
    if (!dedupedByUrl.has(key)) {
      dedupedByUrl.set(key, entry);
    }
  }

  return [...dedupedByUrl.values()].map((entry) => ({
    id: entry.id,
    type: entry.type,
    url: entry.url,
    label: toPreviewSocialLabel(entry.url) || entry.url
  }));
};

const toMetadataString = (value: CvJsonValue | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  const items = extractTextItems(value);
  if (items.length === 0) {
    return null;
  }

  return collapseWhitespace(items.join(" "));
};

export const mapRenderingPayloadToPresentation = (
  rendering: RenderingPayload,
  metadata: Record<string, CvJsonValue>,
  template: TemplateSummary | null
): RenderingPresentation => {
  const theme = resolveTemplateProfile(template);

  const header: PresentationHeader = {
    name: toMetadataString(metadata.full_name) ?? null,
    title: toMetadataString(metadata.headline) ?? null,
    email: toMetadataString(metadata.email) ?? null,
    phone: toMetadataString(metadata.phone) ?? null,
    location: toMetadataString(metadata.location) ?? null,
    photo: toMetadataString(metadata.photo) ?? null,
    contact_items: [
      toMetadataString(metadata.email),
      toMetadataString(metadata.phone),
      toMetadataString(metadata.location)
    ].filter((item): item is string => Boolean(item)),
    social_links: extractSocialLinks(metadata)
  };

  const sections = rendering.sections
    .sort((a, b) => a.order - b.order)
    .map((section) => mapSection(section))
    .filter((section): section is PresentationSection => section !== null);

  return {
    version: "v1",
    document_title: normalizeLine(rendering.document.title) ?? null,
    theme,
    header,
    sections
  };
};
