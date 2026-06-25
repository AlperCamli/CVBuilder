import { splitBulletLines } from "../../shared/cv-content/bullet-text";
import type { CvJsonValue } from "../../shared/cv-content/cv-content.types";
import { buildCvFontFamily, type CvFontAssetKey } from "../../shared/cv-fonts/cv-font-catalog";
import type { TemplateSummary } from "../templates/templates.types";
import type { RenderingBlock, RenderingPayload, RenderingSection } from "./rendering.types";

export type PresentationTemplateLayout =
  | "modern-clean"
  | "minimal-professional"
  | "executive-timeline"
  | "creative-portfolio"
  | "academic-classic"
  | "tech-compact"
  | "two-column-modern";

export type PresentationLayoutMode =
  | "classic-single-column"
  | "compact-single-column"
  | "timeline-split"
  | "portfolio-two-column";

export interface PresentationStyleTokens {
  font_family: string;
  font_asset_key?: CvFontAssetKey;
  header_alignment?: "left" | "center";
  header_photo_size?: number;
  header_photo_position?: PhotoPosition;
  section_heading_style?: "plain" | "ruled";
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
  photo_shape: PhotoShape;
  photo_position: PhotoPosition;
  contact_items: string[];
  social_links: PresentationSocialLink[];
}

export type PhotoShape = "circle" | "square";
export type PhotoPosition = "left" | "center" | "right";

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

type SkillsDisplay = "inline" | "bulleted";

interface TemplateProfile {
  layout: PresentationTemplateLayout;
  mode: PresentationLayoutMode;
  tokens: PresentationStyleTokens;
  // How the skills section renders: a comma-separated line ("inline", default) or one
  // bullet per skill ("bulleted"). Used by templates that present skills as a list.
  skills_display?: SkillsDisplay;
}

const DEFAULT_PROFILE: TemplateProfile = {
  layout: "modern-clean",
  mode: "classic-single-column",
  tokens: {
    font_family: buildCvFontFamily("source-serif-4"),
    font_asset_key: "source-serif-4",
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
      font_family: buildCvFontFamily("noto-sans"),
      font_asset_key: "noto-sans",
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
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("new-computer-modern"),
      font_asset_key: "new-computer-modern",
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
      font_family: buildCvFontFamily("ibm-plex-sans"),
      font_asset_key: "ibm-plex-sans",
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
  },
  "academic-classic": {
    layout: "academic-classic",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("libertinus-serif"),
      font_asset_key: "libertinus-serif",
      heading_color_hex: "#111827",
      accent_color_hex: "#334155",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 16,
      block_spacing: 12,
      body_text_size: 12,
      compact_density: true
    }
  },
  "latex-academic-serif": {
    layout: "academic-classic",
    mode: "classic-single-column",
    tokens: {
      font_family: buildCvFontFamily("latin-modern-roman"),
      font_asset_key: "latin-modern-roman",
      header_alignment: "center",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#111111",
      accent_color_hex: "#111111",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 11,
      compact_density: true
    }
  },
  "latex-research-cv": {
    layout: "academic-classic",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("new-computer-modern"),
      font_asset_key: "new-computer-modern",
      header_alignment: "center",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#1f2937",
      body_color_hex: "#1f2937",
      muted_color_hex: "#3f3f46",
      page_background_hex: "#ffffff",
      section_spacing: 11,
      block_spacing: 7,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "latex-scholar": {
    layout: "academic-classic",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("latin-modern-roman"),
      font_asset_key: "latin-modern-roman",
      header_alignment: "center",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#111111",
      accent_color_hex: "#111111",
      body_color_hex: "#1f2937",
      muted_color_hex: "#3f3f46",
      page_background_hex: "#ffffff",
      section_spacing: 11,
      block_spacing: 7,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "latex-two-column": {
    layout: "two-column-modern",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("libertinus-serif"),
      font_asset_key: "libertinus-serif",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#111111",
      accent_color_hex: "#111111",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "latex-modern-brief": {
    layout: "minimal-professional",
    mode: "compact-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("latin-modern-roman"),
      font_asset_key: "latin-modern-roman",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#111111",
      accent_color_hex: "#334155",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 10,
      block_spacing: 7,
      body_text_size: 10.6,
      compact_density: true
    }
  },
  "latex-editorial-sidebar": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("libertinus-serif"),
      font_asset_key: "libertinus-serif",
      header_photo_size: 84,
      section_heading_style: "ruled",
      heading_color_hex: "#1c1917",
      accent_color_hex: "#7c2d12",
      body_color_hex: "#292524",
      muted_color_hex: "#57534e",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 10.9,
      compact_density: true
    }
  },
  "latex-photo-statement": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("new-computer-modern"),
      font_asset_key: "new-computer-modern",
      header_alignment: "center",
      header_photo_size: 108,
      header_photo_position: "center",
      section_heading_style: "ruled",
      heading_color_hex: "#111827",
      accent_color_hex: "#4338ca",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 14,
      block_spacing: 10,
      body_text_size: 11,
      compact_density: true
    }
  },
  "latex-grant-timeline": {
    layout: "executive-timeline",
    mode: "timeline-split",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("source-serif-4"),
      font_asset_key: "source-serif-4",
      header_photo_size: 76,
      section_heading_style: "ruled",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#0e7490",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "latex-technical-grid": {
    layout: "two-column-modern",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("ibm-plex-sans"),
      font_asset_key: "ibm-plex-sans",
      header_photo_size: 80,
      section_heading_style: "ruled",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#2563eb",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 10.6,
      compact_density: true
    }
  },
  "latex-two-tone-creative": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("source-sans-3"),
      font_asset_key: "source-sans-3",
      header_photo_size: 92,
      section_heading_style: "ruled",
      heading_color_hex: "#111827",
      accent_color_hex: "#a21caf",
      body_color_hex: "#1f2937",
      muted_color_hex: "#52525b",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 10.9,
      compact_density: true
    }
  },
  "academic-serif-color": {
    layout: "academic-classic",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("source-serif-4"),
      font_asset_key: "source-serif-4",
      header_photo_size: 72,
      section_heading_style: "ruled",
      heading_color_hex: "#102a43",
      accent_color_hex: "#1d4ed8",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 11.2,
      compact_density: true
    }
  },
  "academic-timeline": {
    layout: "executive-timeline",
    mode: "timeline-split",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("new-computer-modern"),
      font_asset_key: "new-computer-modern",
      header_photo_size: 72,
      heading_color_hex: "#0f172a",
      accent_color_hex: "#2563eb",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "creative-color-block": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("ibm-plex-sans"),
      font_asset_key: "ibm-plex-sans",
      header_photo_size: 80,
      heading_color_hex: "#0f172a",
      accent_color_hex: "#0f766e",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 11,
      compact_density: true
    }
  },
  "creative-photo-hero": {
    layout: "creative-portfolio",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("source-sans-3"),
      font_asset_key: "source-sans-3",
      header_photo_size: 104,
      heading_color_hex: "#111827",
      accent_color_hex: "#be123c",
      body_color_hex: "#1f2937",
      muted_color_hex: "#52525b",
      page_background_hex: "#ffffff",
      section_spacing: 14,
      block_spacing: 10,
      body_text_size: 11,
      compact_density: true
    }
  },
  "portfolio-modern": {
    layout: "two-column-modern",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("ibm-plex-sans"),
      font_asset_key: "ibm-plex-sans",
      header_photo_size: 80,
      heading_color_hex: "#0f172a",
      accent_color_hex: "#4f46e5",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 11,
      compact_density: true
    }
  },
  "classic-monochrome": {
    layout: "minimal-professional",
    mode: "compact-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("latin-modern-roman"),
      font_asset_key: "latin-modern-roman",
      header_photo_size: 72,
      heading_color_hex: "#111111",
      accent_color_hex: "#3f3f46",
      body_color_hex: "#1f2937",
      muted_color_hex: "#52525b",
      page_background_hex: "#ffffff",
      section_spacing: 11,
      block_spacing: 7,
      body_text_size: 10.8,
      compact_density: true
    }
  },
  "tech-compact": {
    layout: "tech-compact",
    mode: "compact-single-column",
    tokens: {
      font_family: buildCvFontFamily("source-sans-3"),
      font_asset_key: "source-sans-3",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#0d9488",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 11,
      block_spacing: 8,
      body_text_size: 10.5,
      compact_density: true
    }
  },
  "two-column-modern": {
    layout: "two-column-modern",
    mode: "portfolio-two-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("noto-sans"),
      font_asset_key: "noto-sans",
      heading_color_hex: "#0f172a",
      accent_color_hex: "#0f766e",
      body_color_hex: "#1f2937",
      muted_color_hex: "#475569",
      page_background_hex: "#ffffff",
      section_spacing: 13,
      block_spacing: 9,
      body_text_size: 11,
      compact_density: true
    }
  },
  // medical_uk module templates: conservative single-column layouts (no photo region,
  // no graphics) reusing existing layout modes so preview/export render paths are
  // already supported. See backend/docs/cv-modules-implementation-guide.md.
  "medical-classic": {
    layout: "academic-classic",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("libertinus-serif"),
      font_asset_key: "libertinus-serif",
      heading_color_hex: "#111111",
      accent_color_hex: "#1f2937",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 18,
      block_spacing: 12,
      body_text_size: 11.5,
      compact_density: true
    }
  },
  "medical-professional": {
    layout: "minimal-professional",
    mode: "classic-single-column",
    skills_display: "bulleted",
    tokens: {
      font_family: buildCvFontFamily("noto-sans"),
      font_asset_key: "noto-sans",
      heading_color_hex: "#1e3a5f",
      accent_color_hex: "#1e3a5f",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 15,
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
  references: "References",
  // medical_uk module section types
  medical_registration: "Professional Registration",
  medical_qualifications: "Medical Qualifications",
  clinical_experience: "Clinical Experience",
  career_gap: "Career Gaps",
  clinical_skills: "Clinical Skills & Procedures",
  additional_skills: "Additional Skills",
  audit_qi: "Clinical Audit & Quality Improvement",
  teaching: "Teaching Experience",
  management_leadership: "Management & Leadership",
  courses_training: "Courses & Mandatory Training",
  memberships: "Professional Memberships",
  interests: "Interests"
};

const GENERIC_SECTION_TYPE_PATTERN = /^section[_-]?\d+$/i;

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

const normalizePhotoPosition = (
  value: string | null | undefined,
  fallback: PhotoPosition = "left"
): PhotoPosition => {
  if (value === "center" || value === "right" || value === "left") {
    return value;
  }

  return fallback;
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
      // If this narrative field holds a "• "-marked bullet list, those lines render as
      // bullets (via derived.bullets); keep only the lead paragraph here so the body does
      // not duplicate the bullet text.
      const raw = block.fields[key];
      if (typeof raw === "string") {
        const split = splitBulletLines(raw);
        if (split.bullets.length > 0) {
          return normalizeLine(split.leadParagraph);
        }
      }
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

const buildJoinedLine = (items: Array<string | null>): string | null => {
  const normalized = items.filter((item): item is string => Boolean(normalizeLine(item)));
  return normalized.length > 0 ? normalized.join(" • ") : null;
};

const titleizeValue = (value: string | null): string | null => {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const textItemsByKey = (block: RenderingBlock, keys: string[]): string[] => {
  for (const key of keys) {
    const direct = block.normalized_fields[key]?.text_items ?? [];
    if (direct.length > 0) {
      return dedupeText(direct);
    }

    const match = Object.entries(block.normalized_fields).find(([fieldKey]) => keyMatches(fieldKey, [key]));
    const matched = match?.[1].text_items ?? [];
    if (matched.length > 0) {
      return dedupeText(matched);
    }
  }

  return [];
};

const combineExperienceHeading = (
  headline: string | null,
  subheadline: string | null
): { title: string | null; subtitle: string | null } => {
  if (!headline && !subheadline) {
    return { title: null, subtitle: null };
  }

  if (!headline) {
    return { title: subheadline, subtitle: null };
  }

  if (!subheadline) {
    return { title: headline, subtitle: null };
  }

  if (collapseForCompare(headline) === collapseForCompare(subheadline)) {
    return { title: headline, subtitle: null };
  }

  return {
    title: `${headline}, ${subheadline}`,
    subtitle: null
  };
};

const getSectionTitle = (sectionType: string, moduleType?: string | null): string => {
  if (moduleType === "medical_uk" && sectionType === "volunteer") {
    return "Extracurricular Activities";
  }

  if (sectionType.toLowerCase() === "custom" || GENERIC_SECTION_TYPE_PATTERN.test(sectionType)) {
    return "Additional Information";
  }

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

// Decodes percent-escapes (e.g. %C3%B6 -> ö) for display while leaving reserved characters and
// malformed input untouched, so a handle like "/in/yunusemregökbudak" is shown readably instead
// of "/in/yunusemreg%C3%B6kbudak" that the URL API produces for non-ASCII path segments.
const decodeUriForDisplay = (value: string): string => {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
};

const toPreviewSocialLabel = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = toPreviewLinkHref(trimmed);

  try {
    const parsed = new URL(normalized);
    // Self-describing "host + path" label (e.g. "github.com/alpercamli") so the platform is clear
    // without an icon — exports are icon-free for ATS and the preview is rendered iconless to match.
    const host = parsed.hostname.replace(/^www\./i, "");
    const cleanedPath = decodeUriForDisplay(parsed.pathname).replace(/\/+$/, "");

    return cleanedPath && cleanedPath !== "/" ? `${host}${cleanedPath}` : host;
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

const exactText = (block: RenderingBlock, key: string): string | null =>
  normalizeLine(block.normalized_fields[key]?.text ?? null);

// Splits a narrative textarea field (which may use the "• " bullet convention) into a
// lead paragraph and bullet entries, so bullet-edited text renders as a real list.
const narrativeParts = (
  block: RenderingBlock,
  key: string
): { body: string | null; bullets: string[] } => {
  const raw = block.fields[key];
  const text = typeof raw === "string" ? raw : (block.normalized_fields[key]?.text ?? "");

  if (!text.trim()) {
    return { body: null, bullets: [] };
  }

  const split = splitBulletLines(text);
  return { body: normalizeLine(split.leadParagraph), bullets: dedupeText(split.bullets) };
};

const isEmptyPresentationItem = (item: PresentationItem): boolean =>
  !item.title &&
  !item.subtitle &&
  !item.date_range &&
  !item.location &&
  !item.metadata_line &&
  !item.body &&
  item.bullets.length === 0;

// Maps medical_uk module blocks onto presentation items field by field. The generic
// key-guessing in deriveBlock does not know these schemas and used to dump every field
// into one unlabeled body line. Returns null for non-medical blocks; callers fall back
// to the generic mapping (also when the mapped item ends up empty, so imported blocks
// with unexpected keys keep rendering through the generic path).
const medicalBlockToPresentationItem = (
  sectionType: string,
  block: RenderingBlock
): PresentationItem | null => {
  if (sectionType === "medical_registration" || block.type === "medical_registration") {
    const gmcNumber = textByKey(block, ["gmc_number", "gmc"]);
    const licenceStatus = exactText(block, "licence_status");
    const registrationDate = exactText(block, "registration_date");
    const ntn = exactText(block, "ntn");
    const visaStatus = exactText(block, "visa_status");
    const additional = narrativeParts(block, "additional_registrations");

    const bodyLines = [
      ntn ? `National Training Number: ${ntn}` : null,
      visaStatus ? `Right to Work: ${visaStatus}` : null,
      additional.body
    ].filter((line): line is string => Boolean(line));

    return {
      id: block.id,
      title: gmcNumber ? `GMC Number: ${gmcNumber}` : null,
      subtitle: buildJoinedLine([
        licenceStatus,
        registrationDate ? `Registered ${registrationDate}` : null
      ]),
      date_range: null,
      location: null,
      metadata_line: null,
      body: bodyLines.length > 0 ? bodyLines.join("\n") : null,
      bullets: additional.bullets
    };
  }

  if (sectionType === "medical_qualifications" || block.type === "medical_qualification") {
    const qualification = exactText(block, "qualification") ?? textByKey(block, ["title", "name"]);
    const institution = textByKey(block, ["institution", "awarding_body"]);
    const year = exactText(block, "year") ?? exactText(block, "date");
    const notes = narrativeParts(block, "notes");
    // qualification_type is kept off the CV; it stays in the block fields as AI context.

    return {
      id: block.id,
      title: qualification,
      subtitle: institution,
      date_range: year,
      location: null,
      metadata_line: year,
      body: notes.body,
      bullets: notes.bullets
    };
  }

  if (sectionType === "clinical_experience" || block.type === "clinical_post") {
    const jobTitle = textByKey(block, ["job_title", "position"]);
    const grade = exactText(block, "grade");
    const specialty = exactText(block, "specialty");
    const hospital = textByKey(block, ["hospital", "trust"]);
    const department = exactText(block, "department");
    const startDate = exactText(block, "start_date");
    const endDate = exactText(block, "end_date");
    const isCurrent =
      block.fields.is_current === true || exactText(block, "is_current")?.toLowerCase() === "true";
    const duties = textItemsByKey(block, ["duties", "responsibilities"]);
    const onCall = textByKey(block, ["on_call_frequency", "on_call"]);
    const demographics = exactText(block, "patient_demographics");

    const title =
      jobTitle && grade && !collapseForCompare(jobTitle).includes(collapseForCompare(grade))
        ? `${jobTitle} (${grade})`
        : (jobTitle ?? grade);
    const dateRange = startDate
      ? `${startDate} - ${isCurrent ? "Present" : (endDate ?? "Present")}`
      : endDate;

    const bodyLines = [
      onCall ? `On-call: ${onCall}` : null,
      demographics ? `Setting: ${demographics}` : null
    ].filter((line): line is string => Boolean(line));

    return {
      id: block.id,
      title,
      subtitle: buildJoinedLine([specialty, department, hospital]),
      date_range: dateRange ?? null,
      location: null,
      metadata_line: dateRange ?? null,
      body: bodyLines.length > 0 ? bodyLines.join("\n") : null,
      bullets: duties
    };
  }

  if (sectionType === "career_gap" || block.type === "career_gap") {
    const startDate = exactText(block, "start_date");
    const endDate = exactText(block, "end_date");
    const explanation = narrativeParts(block, "explanation");
    const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : (startDate ?? endDate);

    return {
      id: block.id,
      title: null,
      subtitle: null,
      date_range: dateRange,
      location: null,
      metadata_line: dateRange,
      body: explanation.body,
      bullets: explanation.bullets
    };
  }

  if (sectionType === "additional_skills" || block.type === "additional_skill") {
    const skill = exactText(block, "skill") ?? textByKey(block, ["title", "name"]);
    const context = narrativeParts(block, "context");

    return {
      id: block.id,
      title: skill,
      subtitle: null,
      date_range: null,
      location: null,
      metadata_line: null,
      body: context.body,
      bullets: context.bullets
    };
  }

  if (sectionType === "teaching" || block.type === "teaching_activity") {
    const topic = textByKey(block, ["topic", "programme", "title"]);
    const format = titleizeValue(exactText(block, "format"));
    const setting = exactText(block, "setting");
    const audience = exactText(block, "audience");
    const frequency = exactText(block, "frequency");
    const evaluation = narrativeParts(block, "evaluation");
    // audience_size is kept off the CV; it stays in the block fields as AI context.

    return {
      id: block.id,
      title: topic,
      subtitle: buildJoinedLine([format, setting, audience]),
      date_range: null,
      location: null,
      metadata_line: frequency,
      body: evaluation.body,
      bullets: evaluation.bullets
    };
  }

  if (sectionType === "management_leadership" || block.type === "management_role") {
    const role = textByKey(block, ["role", "title", "position"]);
    const organization = textByKey(block, ["organization", "organisation", "department"]);
    const dates = exactText(block, "dates") ?? exactText(block, "date");
    const description = Array.isArray(block.fields.description)
      ? { body: null, bullets: textItemsByKey(block, ["description"]) }
      : narrativeParts(block, "description");

    return {
      id: block.id,
      title: role,
      subtitle: organization,
      date_range: dates,
      location: null,
      metadata_line: dates,
      body: description.body,
      bullets: description.bullets
    };
  }

  if (sectionType === "courses_training" || block.type === "course_entry") {
    const name = textByKey(block, ["name", "course", "title"]);
    const provider = exactText(block, "provider");
    const date = exactText(block, "date");
    const expiryDate = exactText(block, "expiry_date");

    return {
      id: block.id,
      title: name,
      subtitle: provider,
      date_range: date,
      location: null,
      metadata_line: buildJoinedLine([date, expiryDate ? `Valid until ${expiryDate}` : null]),
      body: null,
      bullets: []
    };
  }

  if (sectionType === "memberships" || block.type === "membership") {
    const organization = textByKey(block, ["organization", "organisation", "name"]);
    const status = textByKey(block, ["membership_status", "status"]);
    const postNominals = exactText(block, "post_nominals");
    const memberSince = textByKey(block, ["member_since", "since"]);

    return {
      id: block.id,
      title:
        organization && postNominals
          ? `${organization} (${postNominals})`
          : (organization ?? postNominals),
      subtitle: status,
      date_range: memberSince,
      location: null,
      metadata_line: memberSince ? `Member since ${memberSince}` : null,
      body: null,
      bullets: []
    };
  }

  if (sectionType === "interests" || block.type === "interests") {
    const fromDescription = narrativeParts(block, "description");
    const parts =
      fromDescription.body || fromDescription.bullets.length > 0
        ? fromDescription
        : narrativeParts(block, "text");
    const body =
      parts.body ?? (parts.bullets.length === 0 ? normalizeLine(block.plain_text) : null);

    return {
      id: block.id,
      title: null,
      subtitle: null,
      date_range: null,
      location: null,
      metadata_line: null,
      body,
      bullets: parts.bullets
    };
  }

  if (sectionType === "clinical_skills" || block.type === "clinical_skill") {
    const title = textByKey(block, ["skill", "procedure", "title", "name"]);
    const subtitle = buildJoinedLine([
      titleizeValue(textByKey(block, ["competency_level"])),
      textByKey(block, ["frequency"]),
      textByKey(block, ["context"])
    ]);

    return {
      id: block.id,
      title,
      subtitle,
      date_range: null,
      location: null,
      metadata_line: null,
      body: null,
      bullets: []
    };
  }

  if (sectionType === "audit_qi" || block.type === "audit_qi_project") {
    const title = textByKey(block, ["title", "project"]);
    const projectType = titleizeValue(textByKey(block, ["project_type"]));
    const role = textByKey(block, ["role"]);
    const setting = textByKey(block, ["setting"]);
    const dates = textByKey(block, ["dates", "date"]);
    const standardAudited = textByKey(block, ["standard_audited"]);
    const presentedAt = textByKey(block, ["presented_at"]);
    const loopClosed = block.fields.loop_closed === true || textByKey(block, ["loop_closed"])?.toLowerCase() === "true";
    const outcomes = textItemsByKey(block, ["outcomes"]);

    const bodyLines = [
      standardAudited ? `Standard audited: ${standardAudited}` : null,
      presentedAt ? `Presented at: ${presentedAt}` : null
    ].filter((line): line is string => Boolean(line));

    return {
      id: block.id,
      title,
      subtitle: buildJoinedLine([projectType, role, setting]),
      date_range: dates,
      location: null,
      metadata_line: dates,
      body: bodyLines.length > 0 ? bodyLines.join("\n") : null,
      bullets: loopClosed ? dedupeText([...outcomes, "Audit loop closed"]) : outcomes
    };
  }

  return null;
};

const blockToPresentationItem = (sectionType: string, block: RenderingBlock): PresentationItem | null => {
  if (block.visibility !== "visible") {
    return null;
  }

  // An empty medical mapping falls through to the generic path instead of dropping the
  // block, so imported blocks with unexpected field keys still render their content.
  const medicalItem = medicalBlockToPresentationItem(sectionType, block);
  if (medicalItem && !isEmptyPresentationItem(medicalItem)) {
    return medicalItem;
  }

  const headline = normalizeLine(block.derived.headline);
  let subheadline = normalizeLine(block.derived.subheadline);
  const dateRange = normalizeLine(block.derived.date_range);
  const location = normalizeLine(block.derived.location);
  const metadataLine = buildMetadataLine(dateRange, location);
  const bullets = dedupeText(block.derived.bullets);

  let body = pickBodyText(sectionType, block);

  // Drop a subtitle that merely repeats the title or the body. The derived headline/subheadline
  // fallbacks can resolve to the same field (e.g. a course with no title where both land on
  // "institution"), or promote the description into the subtitle when the real subtitle field is
  // empty — either way the text would otherwise be emitted twice in exports.
  if (subheadline && headline && collapseForCompare(subheadline) === collapseForCompare(headline)) {
    subheadline = null;
  }
  if (subheadline && body && collapseForCompare(subheadline) === collapseForCompare(body)) {
    subheadline = null;
  }

  const mergedHeading = [headline, subheadline].filter(Boolean).join(" ");
  const headingValues =
    sectionType === "experience"
      ? combineExperienceHeading(headline, subheadline)
      : { title: headline, subtitle: subheadline };

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
    title: sectionType === "summary" ? null : headingValues.title,
    subtitle: sectionType === "summary" ? null : headingValues.subtitle,
    date_range: dateRange,
    location,
    metadata_line: sectionType === "summary" ? null : metadataLine,
    body,
    bullets,
  };

  if (isEmptyPresentationItem(item)) {
    return null;
  }

  return item;
};

const collectSkillsList = (section: RenderingSection): string[] => {
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

  return dedupeText(skills);
};

const collectSkillsInlineText = (section: RenderingSection): string | null => {
  const deduped = collectSkillsList(section);
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

const mapSection = (
  section: RenderingSection,
  skillsDisplay: SkillsDisplay = "inline",
  moduleType?: string | null
): PresentationSection | null => {
  const type = section.type;
  const title = getSectionTitle(type, moduleType);
  const normalizedType = type.toLowerCase();

  if (normalizedType === "header") {
    return null;
  }

  if (!SECTION_TITLE_OVERRIDES[normalizedType]) {
    const fieldKeys = new Set<string>();
    for (const block of section.blocks) {
      if (block.visibility !== "visible") {
        continue;
      }
      for (const key of Object.keys(block.normalized_fields)) {
        fieldKeys.add(key.toLowerCase());
      }
    }

    const isHeaderLike =
      fieldKeys.has("full_name") ||
      fieldKeys.has("name") ||
      fieldKeys.has("social_links") ||
      ((fieldKeys.has("email") || fieldKeys.has("phone")) && fieldKeys.has("location"));

    if (isHeaderLike) {
      return null;
    }
  }

  if (type === "skills") {
    const skills = collectSkillsList(section);
    if (skills.length === 0) {
      return null;
    }

    if (skillsDisplay === "bulleted") {
      return {
        id: section.id,
        type,
        title,
        inline_text: null,
        items: [
          {
            id: `${section.id}-skills`,
            title: null,
            subtitle: null,
            date_range: null,
            location: null,
            metadata_line: null,
            body: null,
            bullets: skills
          }
        ]
      };
    }

    return {
      id: section.id,
      type,
      title,
      inline_text: skills.join(", "),
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

  if (type === "awards" || type === "publications") {
    const items = section.blocks
      .filter((block) => block.visibility === "visible")
      .map((block) => {
        const titleValue =
          type === "awards"
            ? textByKey(block, ["name", "title", "award"]) || normalizeLine(block.derived.headline)
            : textByKey(block, ["title", "name"]) || normalizeLine(block.derived.headline);
        const rawSubtitle =
          type === "awards"
            ? textByKey(block, ["issuer", "organization", "institution"])
            : textByKey(block, ["publisher", "journal", "issuer", "organization", "institution"]);
        const dateRange =
          textByKey(block, ["date", "awarded_on", "published_on"]) || normalizeLine(block.derived.date_range);
        const description = textByKey(block, ["description", "details", "notes"]);

        // Keep the subtitle/description out of the title slot. With no title, titleValue falls
        // back to derived.headline, which can resolve to the publisher or the description and
        // emit the same text twice. Mirrors the Education dedup above.
        const isTitleDuplicate = (value: string | null): boolean =>
          Boolean(value && titleValue && collapseForCompare(value) === collapseForCompare(titleValue));
        const subtitle = isTitleDuplicate(rawSubtitle) ? null : rawSubtitle;
        const body = isTitleDuplicate(description) ? null : description;

        const item: PresentationItem = {
          id: block.id,
          title: titleValue,
          subtitle,
          date_range: dateRange,
          location: null,
          metadata_line: dateRange,
          body,
          bullets: []
        };

        if (!item.title && !item.subtitle && !item.date_range && !item.metadata_line && !item.body) {
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

  if (type === "references") {
    const items = section.blocks
      .filter((block) => block.visibility === "visible")
      .map((block) => {
        const name = textByKey(block, ["name", "full_name", "reference"]);
        const jobTitle = textByKey(block, ["job_title", "title", "role", "position"]);
        const organization = textByKey(block, ["organization", "company", "institution"]);
        const email = textByKey(block, ["email"]);
        const phone = textByKey(block, ["phone", "telephone", "mobile"]);

        const subtitleParts = [jobTitle, organization]
          .filter((value): value is string => Boolean(value))
          .filter((value, index, values) => values.findIndex((item) => collapseForCompare(item) === collapseForCompare(value)) === index);

        const bodyParts = [email, phone].filter((value): value is string => Boolean(value));

        const item: PresentationItem = {
          id: block.id,
          title: name || normalizeLine(block.derived.headline),
          subtitle: subtitleParts.length > 0 ? subtitleParts.join(" • ") : null,
          date_range: null,
          location: null,
          metadata_line: null,
          body: bodyParts.length > 0 ? bodyParts.join("\n") : null,
          bullets: []
        };

        if (!item.title && !item.subtitle && !item.body) {
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

const findHeaderSections = (rendering: RenderingPayload): RenderingSection[] => {
  return rendering.sections.filter((section) => section.type.toLowerCase() === "header");
};

const getHeaderFallbackField = (
  headerSections: RenderingSection[],
  keys: string[]
): string | null => {
  const blocks = headerSections
    .flatMap((section) => section.blocks)
    .filter((block) => block.visibility === "visible")
    .sort((a, b) => a.order - b.order);

  for (const block of blocks) {
    const value = textByKey(block, keys);
    if (value) {
      return value;
    }
  }

  return null;
};

const collectHeaderUrls = (headerSections: RenderingSection[]): string[] => {
  const blocks = headerSections
    .flatMap((section) => section.blocks)
    .filter((block) => block.visibility === "visible");

  const urls: string[] = [];

  for (const block of blocks) {
    for (const [fieldKey, fieldValue] of Object.entries(block.normalized_fields)) {
      if (!keyMatches(fieldKey, ["url", "urls", "linkedin", "github", "gitlab", "website"])) {
        continue;
      }

      urls.push(...fieldValue.text_items);
    }
  }

  return dedupeText(urls);
};

export const mapRenderingPayloadToPresentation = (
  rendering: RenderingPayload,
  metadata: Record<string, CvJsonValue>,
  template: TemplateSummary | null
): RenderingPresentation => {
  const theme = resolveTemplateProfile(template);
  const skillsDisplay =
    (TEMPLATE_PROFILES[template?.slug ?? "modern-clean"] ?? DEFAULT_PROFILE).skills_display ?? "inline";
  const moduleType = template?.module_type ?? null;
  const headerSections = findHeaderSections(rendering);

  const metadataUrls = metadata.urls ? extractTextItems(metadata.urls) : [];
  const headerUrls = collectHeaderUrls(headerSections);
  const mergedMetadataForLinks: Record<string, CvJsonValue> = {
    ...metadata,
    urls: [...new Set([...metadataUrls, ...headerUrls])]
  };

  const header: PresentationHeader = {
    name: toMetadataString(metadata.full_name) ?? getHeaderFallbackField(headerSections, ["full_name", "name"]),
    title: toMetadataString(metadata.headline) ?? getHeaderFallbackField(headerSections, ["headline", "title"]),
    email: toMetadataString(metadata.email) ?? getHeaderFallbackField(headerSections, ["email"]),
    phone: toMetadataString(metadata.phone) ?? getHeaderFallbackField(headerSections, ["phone"]),
    location: toMetadataString(metadata.location) ?? getHeaderFallbackField(headerSections, ["location", "city", "country"]),
    photo: toMetadataString(metadata.photo) ?? null,
    photo_shape: toMetadataString(metadata.photo_shape) === "square" ? "square" : "circle",
    photo_position: normalizePhotoPosition(
      toMetadataString(metadata.photo_position),
      normalizePhotoPosition(theme.tokens.header_photo_position)
    ),
    contact_items: [
      toMetadataString(metadata.email) ?? getHeaderFallbackField(headerSections, ["email"]),
      toMetadataString(metadata.phone) ?? getHeaderFallbackField(headerSections, ["phone"]),
      toMetadataString(metadata.location) ?? getHeaderFallbackField(headerSections, ["location", "city", "country"])
    ].filter((item): item is string => Boolean(item)),
    social_links: extractSocialLinks(mergedMetadataForLinks)
  };

  const sections = rendering.sections
    .sort((a, b) => a.order - b.order)
    .map((section) => mapSection(section, skillsDisplay, moduleType))
    .filter((section): section is PresentationSection => section !== null);

  return {
    version: "v1",
    document_title: normalizeLine(rendering.document.title) ?? null,
    theme,
    header,
    sections
  };
};
