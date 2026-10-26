import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";
import { splitBulletLines } from "../../shared/cv-content/bullet-text";

// Builds the compact, token-lean view of a CV that the tailoring model calls see:
// header/contact data, references, hidden and empty blocks are left out, and block ids are
// replaced by short aliases (b1, b2, ...) that the model cannot mangle.

const EXCLUDED_SECTION_TYPES = new Set(["header", "contact", "contact_info", "personal_info", "references"]);
const ITEM_BLOCK_TYPES = new Set([
  "experience_item",
  "project_item",
  "volunteer_item",
  "education_item",
  "award_item",
  "publication_item",
  "course_item"
]);
// Sections the structure suggestion may never hide.
export const PROTECTED_SECTION_TYPES = new Set(["summary", "experience", "education", "skills"]);

export type CompactBlockKind = "item" | "summary" | "skills" | "other";

export interface CompactBlockInfo {
  alias: string;
  block_id: string;
  section_id: string;
  section_type: string;
  block_type: string;
  kind: CompactBlockKind;
  // The single field tailoring may rewrite (null = read-only context).
  editable_field: "description" | "text" | "skills" | null;
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

export const normalizeSectionType = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

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

const joinParts = (...parts: string[]): string => parts.filter(Boolean).join(", ");

const describeBlock = (
  block: CvBlock,
  sectionType: string
): Pick<CompactBlockInfo, "kind" | "editable_field" | "title" | "subtitle" | "text" | "skills"> => {
  const fields = block.fields;
  const type = block.type;

  if (sectionType === "skills" || type === "skills") {
    return { kind: "skills", editable_field: "skills", title: "", subtitle: "", text: "", skills: readSkillsField(fields) };
  }

  if (sectionType === "summary" || type === "summary") {
    return { kind: "summary", editable_field: "text", title: "", subtitle: "", text: str(fields.text), skills: [] };
  }

  const description = str(fields.description);
  switch (type) {
    case "experience_item":
      return { kind: "item", editable_field: "description", title: str(fields.role), subtitle: str(fields.company), text: description, skills: [] };
    case "volunteer_item":
      return { kind: "item", editable_field: "description", title: str(fields.role), subtitle: str(fields.organization), text: description, skills: [] };
    case "project_item":
      return { kind: "item", editable_field: "description", title: str(fields.title), subtitle: str(fields.subtitle), text: description, skills: [] };
    case "education_item":
      return {
        kind: "item",
        editable_field: "description",
        title: joinParts(str(fields.degree), str(fields.field_of_study)),
        subtitle: str(fields.institution),
        text: description,
        skills: []
      };
    case "award_item":
      return { kind: "item", editable_field: "description", title: str(fields.name), subtitle: str(fields.issuer), text: description, skills: [] };
    case "publication_item":
      return { kind: "item", editable_field: "description", title: str(fields.title), subtitle: str(fields.publisher), text: description, skills: [] };
    case "course_item":
      return { kind: "item", editable_field: "description", title: str(fields.title), subtitle: str(fields.institution), text: description, skills: [] };
    case "certification_item":
      return { kind: "other", editable_field: null, title: str(fields.name), subtitle: "", text: "", skills: [] };
    case "language_item":
      return { kind: "other", editable_field: null, title: str(fields.language), subtitle: str(fields.proficiency), text: "", skills: [] };
    default: {
      // Unknown/module block types are read-only context: keep their visible text.
      const values = Object.values(fields).flatMap((value) =>
        Array.isArray(value) ? strList(value) : [str(value)]
      ).filter(Boolean);
      return {
        kind: ITEM_BLOCK_TYPES.has(type) ? "item" : "other",
        editable_field: null,
        title: values[0] ?? "",
        subtitle: values[1] ?? "",
        text: values.slice(2).join(" ").slice(0, 600),
        skills: []
      };
    }
  }
};

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
