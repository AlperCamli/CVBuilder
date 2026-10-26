import { translate as t } from "../../localization/i18n";
import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../integration/api-types";
import type { TailoringTask } from "../../integration/tailoring-types";

// Labels and classification of CV blocks for the Tailor panel. Real CVs use many block types
// (experience, position, job, work, entry, experience_entry, degree, text, …), so blocks are
// classified by their section type and fields, never by a fixed list of block types.

const text = (value: CvJsonValue | undefined): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "";

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

// Section (or block) type → canonical section kind.
const SECTION_ALIASES: Record<string, string> = {
  summary: "summary",
  profile: "summary",
  professional_summary: "summary",
  personal_profile: "summary",
  about: "summary",
  about_me: "summary",
  summary_text: "summary",
  objective: "summary",
  experience: "experience",
  experiences: "experience",
  work: "experience",
  work_experience: "experience",
  work_history: "experience",
  employment: "experience",
  employment_history: "experience",
  professional_experience: "experience",
  career: "experience",
  position: "experience",
  positions: "experience",
  job: "experience",
  jobs: "experience",
  internship: "experience",
  internships: "experience",
  education: "education",
  degree: "education",
  degrees: "education",
  school: "education",
  academic: "education",
  project: "projects",
  projects: "projects",
  volunteer: "volunteer",
  volunteering: "volunteer",
  volunteer_work: "volunteer",
  volunteer_experience: "volunteer",
  award: "awards",
  awards: "awards",
  honors: "awards",
  publication: "publications",
  publications: "publications",
  course: "courses",
  courses: "courses",
  skills: "skills",
  skill: "skills",
  technical_skills: "skills",
  core_skills: "skills",
  competencies: "skills",
  header: "header",
  contact: "header",
  contacts: "header",
  contact_info: "header",
  personal_info: "header",
  references: "references",
  reference: "references"
};

// Sections whose items have a narrative description the AI may rewrite.
const NARRATIVE_KINDS = new Set(["experience", "education", "projects", "volunteer", "awards", "publications", "courses"]);

const kindOf = (type: string): string | null => {
  const normalized = normalize(type);
  if (SECTION_ALIASES[normalized]) return SECTION_ALIASES[normalized];
  // experience_item, experience_entry, education_items, …
  const stem = normalized.replace(/_(items?|entry|entries|block|section)$/, "");
  return SECTION_ALIASES[stem] ?? null;
};

// Title and subtitle fields, in order of preference. Dates are never used as titles.
const TITLE_FIELDS = ["role", "position", "title", "job_title", "degree", "name", "headline", "course", "project", "award", "publication"];
const SUBTITLE_FIELDS = ["company", "organization", "employer", "institution", "school", "university", "issuer", "publisher", "journal", "provider", "subtitle"];

const firstField = (block: CvBlock, keys: string[]): string => {
  for (const key of keys) {
    const value = text(block.fields[key]);
    if (value) return value;
  }
  return "";
};

export type RefinableBlockKind = "item" | "summary" | "skills";

export interface RefinableBlock {
  blockId: string;
  sectionId: string;
  kind: RefinableBlockKind;
  // Canonical section kind, e.g. "experience".
  sectionKind: string;
  sectionTitle: string;
  title: string;
  subtitle: string;
}

// Legacy blocks that hold a whole section as an `items` array are not single items.
const isListBlock = (block: CvBlock): boolean => Array.isArray(block.fields.items) && !text(block.fields.description);

const hasSkills = (block: CvBlock): boolean =>
  Array.isArray(block.fields.skills) || Array.isArray(block.fields.items) || Boolean(text(block.fields.text));

const classify = (section: CvSection, block: CvBlock): RefinableBlockKind | null => {
  const sectionKind = kindOf(section.type);
  const blockKind = kindOf(block.type);
  if (sectionKind === "header" || sectionKind === "references" || blockKind === "header") return null;
  if (sectionKind === "skills" || (!sectionKind && blockKind === "skills")) return hasSkills(block) ? "skills" : null;
  if (sectionKind === "summary" || (!sectionKind && blockKind === "summary")) return "summary";
  const narrative = NARRATIVE_KINDS.has(sectionKind ?? "") || (!sectionKind && NARRATIVE_KINDS.has(blockKind ?? ""));
  if (!narrative || isListBlock(block)) return null;
  // An item: it has a description to rewrite, or at least a title the AI can describe.
  return typeof block.fields.description === "string" || firstField(block, TITLE_FIELDS) ? "item" : null;
};

const sortedSections = (content: CvContent): CvSection[] => [...content.sections].sort((left, right) => left.order - right.order);
const sortedBlocks = (section: CvSection): CvBlock[] => [...section.blocks].sort((left, right) => left.order - right.order);

const DEFAULT_SECTION_TITLES: Record<string, string> = {
  summary: "Professional summary",
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  volunteer: "Volunteering",
  awards: "Awards",
  publications: "Publications",
  courses: "Courses",
  skills: "Skills"
};

const titleOfSection = (section: CvSection): string => {
  const kind = kindOf(section.type);
  return section.title?.trim() || (kind && DEFAULT_SECTION_TITLES[kind] ? t(DEFAULT_SECTION_TITLES[kind]) : section.type.replace(/_/g, " "));
};

const describeItem = (block: CvBlock): { title: string; subtitle: string } => {
  let title = firstField(block, TITLE_FIELDS);
  const fieldOfStudy = text(block.fields.field_of_study) || text(block.fields.major);
  if (fieldOfStudy && text(block.fields.degree) && title === text(block.fields.degree)) title = `${title}, ${fieldOfStudy}`;
  const subtitle = firstField(block, SUBTITLE_FIELDS);
  return { title: title || subtitle, subtitle: title ? subtitle : "" };
};

// The CV's editable blocks (each narrative item, the summary, the skills block), in CV order.
// Hidden blocks are left out: they are not in the tailored CV the user sends.
export const listRefinableBlocks = (content: CvContent): RefinableBlock[] => {
  const blocks: RefinableBlock[] = [];
  for (const section of sortedSections(content)) {
    if (normalize(String(section.meta?.visibility ?? "")) === "hidden") continue;
    for (const block of sortedBlocks(section)) {
      if (block.visibility === "hidden") continue;
      const kind = classify(section, block);
      if (!kind) continue;
      const sectionKind = kindOf(section.type) ?? kindOf(block.type) ?? normalize(section.type);
      const sectionLabel = titleOfSection(section);
      const { title, subtitle } =
        kind === "item"
          ? describeItem(block)
          : { title: kind === "summary" ? t("Professional summary") : t("Skills"), subtitle: "" };
      blocks.push({
        blockId: block.id,
        sectionId: section.id,
        kind,
        sectionKind,
        sectionTitle: sectionLabel,
        title: title || sectionLabel,
        subtitle
      });
    }
  }
  return blocks;
};

const findBlock = (content: CvContent, blockId: string): { section: CvSection; block: CvBlock } | null => {
  for (const section of content.sections) {
    const block = section.blocks.find((item) => item.id === blockId);
    if (block) return { section, block };
  }
  return null;
};

// Kind of a CV block (summary / item / skills), or null when it isn't editable here.
export const refinableBlockKind = (content: CvContent, blockId: string | null): RefinableBlockKind | null => {
  const found = blockId ? findBlock(content, blockId) : null;
  return found ? classify(found.section, found.block) : null;
};

// How a rewrite card shows its text: summary blocks are a paragraph, item blocks bullets.
// The card's field name (description, summary, highlights, text, …) is only a fallback for
// blocks that are no longer in the CV.
export const rewriteDisplay = (
  content: CvContent,
  suggestion: { block_id: string | null; suggested: Record<string, unknown> }
): "bullets" | "paragraph" => {
  const found = suggestion.block_id ? findBlock(content, suggestion.block_id) : null;
  if (found) {
    const sectionKind = kindOf(found.section.type) ?? kindOf(found.block.type);
    if (sectionKind === "summary") return "paragraph";
    if (classify(found.section, found.block) === "item") return "bullets";
  }
  return suggestion.suggested.field === "text" ? "paragraph" : "bullets";
};

// Human label for a CV block, e.g. "Backend Engineer · Acme".
export const describeBlock = (content: CvContent, blockId: string | null): string => {
  if (!blockId) return "";
  const found = findBlock(content, blockId);
  if (!found) return t("CV entry");
  const { section, block } = found;
  const sectionKind = kindOf(section.type) ?? kindOf(block.type);
  if (sectionKind === "summary") return t("Professional summary");
  if (sectionKind === "skills") return t("Skills");
  const { title, subtitle } = describeItem(block);
  const label = [title, subtitle].filter(Boolean).join(" · ");
  return label || titleOfSection(section) || t("CV entry");
};

export const sectionTitle = (content: CvContent, sectionId: string): string => {
  const section = content.sections.find((item) => item.id === sectionId);
  return section ? titleOfSection(section) : t("Section");
};

export const describeTask = (content: CvContent, task: TailoringTask): string => {
  switch (task.kind) {
    case "summary":
      return task.block_id ? t("Rewriting your summary") : t("Writing a professional summary");
    case "skills":
      return t("Updating your skills");
    case "structure":
      return t("Checking the section order");
    default:
      return `${t("Rewriting")}: ${describeBlock(content, task.block_id)}`;
  }
};

// Section id that holds a block, for markers on sections without per-item preview chunks.
export const sectionIdForBlock = (content: CvContent, blockId: string): string | null =>
  content.sections.find((section) => section.blocks.some((block) => block.id === blockId))?.id ?? null;
