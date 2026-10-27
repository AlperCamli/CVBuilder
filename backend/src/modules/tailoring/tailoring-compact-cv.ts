import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";
import { splitBulletLines } from "../../shared/cv-content/bullet-text";
import {
  HEADER_SECTION_TYPES,
  NARRATIVE_TEXT_FIELDS,
  REFERENCE_SECTION_TYPES,
  SKILLS_SECTION_TYPES,
  SUMMARY_SECTION_TYPES,
  narrativeBulletField,
  normalizeCvTypeKey,
  normalizeNarrativeLists
} from "../../shared/cv-content/narrative-fields";

// Builds the compact, token-lean view of a CV that the tailoring model calls see:
// header/contact data, references, hidden and empty blocks are left out, and block ids are
// replaced by short aliases (b1, b2, ...) that the model cannot mangle.
//
// Blocks are classified by their (normalized) section type and field shape, never by exact
// block type: real CVs use many block types per section (experience/position, education/
// degree, projects/academic_project, ...), so a type allow-list silently made most of them
// read-only. Which field holds an item's narrative is the shared rule in
// shared/cv-content/narrative-fields.ts; list-kind bullets (responsibilities: [...], ...)
// are folded into that text field first (normalizeNarrativeLists, mirrored by the editor
// when it loads a CV), so those blocks are rewritable and the card's "before" text equals
// the editor's block.

const EXCLUDED_SECTION_TYPES = new Set([...HEADER_SECTION_TYPES, ...REFERENCE_SECTION_TYPES]);
const EDUCATION_SECTION_TYPES = new Set(["education", "medical_qualifications"]);

// Narrative content that may also be stored in other fields or arrays (read-only context).
const ITEM_CONTEXT_FIELDS = [...NARRATIVE_TEXT_FIELDS, "bullets", "achievements", "text", "content"];
const SUMMARY_TEXT_FIELDS = ["text", "content", "summary", "description"] as const;

const TITLE_FIELDS = ["role", "job_title", "title", "position", "name", "course", "course_name", "language"];
const SUBTITLE_FIELDS = [
  "company",
  "employer",
  "organization",
  "institution",
  "school",
  "university",
  "issuer",
  "publisher",
  "provider",
  "event",
  "subtitle",
  "proficiency",
  "level"
];

// Sections the structure suggestion may never hide.
export const PROTECTED_SECTION_TYPES = new Set(["summary", "experience", "education", "skills"]);

export type CompactBlockKind = "item" | "summary" | "skills" | "other";

export interface CompactBlockInfo {
  alias: string;
  block_id: string;
  section_id: string;
  section_type: string;
  block_type: string;
  // item / summary / skills blocks are editable; "other" blocks are read-only context.
  kind: CompactBlockKind;
  // The single field tailoring may rewrite (null = read-only context).
  editable_field: string | null;
  title: string;
  subtitle: string;
  text: string;
  skills: string[];
}

export interface CompactSectionInfo {
  alias: string;
  section_id: string;
  type: string;
  title: string;
  block_count: number;
  preview: string;
}

export interface CompactCv {
  blocks: CompactBlockInfo[];
  sections: CompactSectionInfo[];
  alias_to_block_id: Record<string, string>;
  block_id_to_alias: Record<string, string>;
  alias_to_section_id: Record<string, string>;
}

const str = (value: CvJsonValue | undefined): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

const strList = (value: CvJsonValue | undefined): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => str(item as CvJsonValue)).filter(Boolean);
  }
  return [];
};

export const normalizeSectionType = (value: string): string => normalizeCvTypeKey(value);

const sortSections = (content: CvContent): CvSection[] =>
  [...content.sections].sort((left, right) => left.order - right.order);

const sortBlocks = (section: CvSection): CvBlock[] =>
  [...section.blocks].sort((left, right) => left.order - right.order);

export const readSkillsField = (fields: Record<string, CvJsonValue>): string[] => {
  const fromSkills = strList(fields.skills);
  if (fromSkills.length > 0) {
    return fromSkills;
  }
  const fromItems = strList(fields.items);
  if (fromItems.length > 0) {
    return fromItems;
  }
  return str(fields.text)
    .split(/[,;|\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

// The array field a skills block keeps its list in. Only array-backed lists are rewritten:
// a skills card's value is a list, so writing it into a text field would break the block.
export const skillsListField = (fields: Record<string, CvJsonValue>): "skills" | "items" | null => {
  if (Array.isArray(fields.skills) && (strList(fields.skills).length > 0 || !Array.isArray(fields.items))) {
    return "skills";
  }
  if (Array.isArray(fields.items)) {
    return "items";
  }
  return null;
};

const MONTH_OR_STATUS =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|" +
  "ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|oca|şub|nis|haz|tem|ağu|eyl|eki|kas|ara|" +
  "present|current|now|ongoing|today|günümüz|halen|devam ediyor|devam";
const DATE_PART = `(?:(?:\\d{1,2}[./-]){0,2}\\d{4}|\\d{1,2}[./-]\\d{2,4}|(?:${MONTH_OR_STATUS})\\.?(?:\\s*\\d{1,2},?)?(?:\\s*\\d{4})?|\\d{4}\\s*(?:${MONTH_OR_STATUS})\\.?)`;
const DATE_LIKE_RE = new RegExp(`^${DATE_PART}(?:\\s*(?:[–—-]|to|until|/)\\s*${DATE_PART})?$`, "iu");

// Dates (and imports that put a date into the title field) are never titles.
export const isDateLike = (value: string): boolean => DATE_LIKE_RE.test(value.trim());

const firstText = (fields: Record<string, CvJsonValue>, keys: readonly string[], exclude: string[] = []): string => {
  for (const key of keys) {
    const value = str(fields[key]);
    if (value && !isDateLike(value) && !exclude.includes(value)) {
      return value;
    }
  }
  return "";
};

const joinDistinct = (...parts: string[]): string => {
  const kept: string[] = [];
  for (const part of parts) {
    if (part && !kept.some((existing) => existing.toLowerCase() === part.toLowerCase())) kept.push(part);
  }
  return kept.join(", ");
};

const titleOf = (fields: Record<string, CvJsonValue>, sectionType: string): { title: string; subtitle: string } => {
  const study = firstText(fields, ["field_of_study", "study_field", "major"]);
  const degree = firstText(fields, ["degree", "qualification", "program"]);
  let title: string;
  if (EDUCATION_SECTION_TYPES.has(sectionType) || degree || study) {
    title = joinDistinct(degree, study) || firstText(fields, TITLE_FIELDS);
  } else {
    title = firstText(fields, TITLE_FIELDS);
  }
  const subtitle = firstText(fields, SUBTITLE_FIELDS, title ? [title] : []);
  // Imports sometimes put a date in the title slot: the subtitle then names the entry.
  return title ? { title, subtitle } : { title: subtitle, subtitle: "" };
};

const contextText = (fields: Record<string, CvJsonValue>): string => {
  const parts: string[] = [];
  for (const key of ITEM_CONTEXT_FIELDS) {
    const value = fields[key];
    const texts = Array.isArray(value) ? strList(value) : [str(value)];
    for (const text of texts) {
      if (text && !parts.includes(text)) parts.push(text);
    }
  }
  return parts.join("\n").slice(0, 600);
};

type DescribedBlock = Pick<CompactBlockInfo, "kind" | "editable_field" | "title" | "subtitle" | "text" | "skills">;

export const describeBlock = (block: CvBlock, sectionType: string): DescribedBlock => {
  const context = { sectionType, blockType: block.type };
  const fields = normalizeNarrativeLists(block.fields ?? {}, context);
  const type = normalizeSectionType(block.type ?? "");

  if (SKILLS_SECTION_TYPES.has(sectionType) || (type === "skills" && !SUMMARY_SECTION_TYPES.has(sectionType))) {
    const listField = skillsListField(fields);
    const skills = readSkillsField(fields);
    if (listField) {
      return { kind: "skills", editable_field: listField, title: str(fields.category), subtitle: "", text: "", skills };
    }
    // Text-backed lists, one-skill-per-block entries and grouped arrays stay read-only.
    const { title, subtitle } = titleOf(fields, sectionType);
    const grouped = Object.values(fields).flatMap((value) => (Array.isArray(value) ? strList(value) : []));
    return {
      kind: "other",
      editable_field: null,
      title: title || str(fields.category),
      subtitle: subtitle || str(fields.details),
      text: "",
      skills: skills.length > 0 ? skills : grouped.slice(0, 40)
    };
  }

  if (SUMMARY_SECTION_TYPES.has(sectionType) || type === "summary") {
    const field = SUMMARY_TEXT_FIELDS.find((key) => typeof fields[key] === "string" && str(fields[key])) ?? "text";
    return { kind: "summary", editable_field: field, title: "", subtitle: "", text: str(fields[field]), skills: [] };
  }

  const { title, subtitle } = titleOf(fields, sectionType);
  const editableField = narrativeBulletField(fields, context);
  if (editableField) {
    return { kind: "item", editable_field: editableField, title, subtitle, text: str(fields[editableField]), skills: [] };
  }

  // Read-only context: its title and visible narrative, never dates.
  const fallbackTitle =
    title ||
    Object.values(fields)
      .map((value) => str(value))
      .find((value) => value && !isDateLike(value) && value.length <= 120) ||
    "";
  return { kind: "other", editable_field: null, title: fallbackTitle, subtitle, text: contextText(fields), skills: [] };
};

export const isEditableBlock = (block: Pick<CompactBlockInfo, "kind" | "editable_field">): boolean =>
  block.kind !== "other" && block.editable_field !== null;

export const buildCompactCv = (content: CvContent): CompactCv => {
  const blocks: CompactBlockInfo[] = [];
  const sections: CompactSectionInfo[] = [];
  const aliasToBlockId: Record<string, string> = {};
  const blockIdToAlias: Record<string, string> = {};
  const aliasToSectionId: Record<string, string> = {};

  for (const section of sortSections(content)) {
    const sectionType = normalizeSectionType(section.type);
    if (EXCLUDED_SECTION_TYPES.has(sectionType)) {
      continue;
    }

    const sectionBlocks: CompactBlockInfo[] = [];
    for (const block of sortBlocks(section)) {
      if (block.visibility === "hidden") {
        continue;
      }
      const described = describeBlock(block, sectionType);
      const hasContent =
        described.title || described.subtitle || described.text || described.skills.length > 0;
      if (!hasContent) {
        continue;
      }

      const alias = `b${blocks.length + sectionBlocks.length + 1}`;
      sectionBlocks.push({
        alias,
        block_id: block.id,
        section_id: section.id,
        section_type: sectionType,
        block_type: block.type,
        ...described
      });
    }

    if (sectionBlocks.length === 0) {
      continue;
    }

    for (const info of sectionBlocks) {
      aliasToBlockId[info.alias] = info.block_id;
      blockIdToAlias[info.block_id] = info.alias;
      blocks.push(info);
    }

    const sectionAlias = `s${sections.length + 1}`;
    aliasToSectionId[sectionAlias] = section.id;
    const first = sectionBlocks[0];
    sections.push({
      alias: sectionAlias,
      section_id: section.id,
      type: sectionType,
      title: section.title?.trim() || sectionType.replace(/_/g, " "),
      block_count: sectionBlocks.length,
      preview: (first.title || first.text || first.skills.slice(0, 6).join(", ")).slice(0, 120)
    });
  }

  return {
    blocks,
    sections,
    alias_to_block_id: aliasToBlockId,
    block_id_to_alias: blockIdToAlias,
    alias_to_section_id: aliasToSectionId
  };
};

export const isSkillsSectionType = (sectionType: string): boolean => SKILLS_SECTION_TYPES.has(sectionType);

// The analysis input: only the parts a recruiter-style match needs, empty values omitted.
export const toAnalysisCvPayload = (compact: CompactCv): Array<Record<string, unknown>> =>
  compact.blocks.map((block) => {
    const entry: Record<string, unknown> = { id: block.alias, section: block.section_type };
    if (block.title) entry.title = block.title;
    if (block.subtitle) entry.subtitle = block.subtitle;
    if (block.text) entry.text = block.text;
    if (block.skills.length > 0) entry.skills = block.skills;
    return entry;
  });

export const firstLine = (text: string): string => {
  const split = splitBulletLines(text);
  return (split.leadParagraph ?? split.bullets[0] ?? "").slice(0, 160);
};
