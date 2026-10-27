import type { CvBlock, CvContent, CvJsonValue } from "./api-types";
import { BULLET_MARKER, looksLikeBulletAnswer, normalizeToBullets, stripBulletPrefix } from "./bulletText";
import { medicalUkModule } from "../modules/medical-uk.module";

// The one rule for "which field holds this block's bullet narrative" and for turning
// list-kind bullets into the text convention ("• " per line, see bulletText.ts). Used by
// the editor mapping (cv-mappers.ts), the editor's bullet fields, and the "Improve with
// AI" bulletizer, so a block is treated the same everywhere.
//
// MIRROR of backend/src/shared/cv-content/narrative-fields.ts — keep the rules identical:
//
// 1. Section and block types are normalized: trim, lowercase, spaces/hyphens -> "_".
// 2. Non-narrative sections (no bullet field, no conversion): header/contact/personal info,
//    references, summary-like sections, skills-like sections, languages, interests/hobbies
//    (the sets below); also blocks of type "summary" or "skills" in any section.
// 3. Medical module text fields: medical_qualification -> notes, career_gap -> explanation,
//    additional_skill -> context, teaching_activity -> evaluation. By block type (the block's
//    only bullet field; none when it is not a string), else by section type
//    (medical_qualifications, career_gap, additional_skills, teaching) when the block has
//    that field as a string; otherwise rule 4. Medical "bullets"-kind array fields stay
//    arrays and are never converted (by block or section type): clinical_post /
//    clinical_experience .duties, audit_qi_project / audit_qi .outcomes, management_role /
//    management_leadership .description.
// 4. Narrative text field = the first field of NARRATIVE_TEXT_FIELDS (description, summary,
//    details, notes, responsibilities, highlights) holding a non-empty string; else
//    "description" when it is a string (also empty), except in certification sections,
//    and only while no list below still holds narrative.
// 5. List conversion (normalizeNarrativeLists), list fields in this order: description,
//    responsibilities, highlights, achievements, bullets. Only arrays whose items are all
//    strings/numbers with at least one non-blank item are converted; anything else is left
//    untouched. Item text = whitespace collapsed to single spaces, bullet prefix stripped.
//    Target = the narrative text field of rule 4 when it holds a non-empty string, else
//    "description". An item is a duplicate when its comparable text (NFKC, lowercase, every
//    run of non-letter/non-digit characters -> one space, trimmed) appears in the
//    comparable target text (+ items appended so far) on word boundaries, i.e.
//    ` ${text} `.includes(` ${item} `). Missing items are appended as "• item" lines
//    ("\n"-joined; with an empty target the result is just the bullet lines). Every
//    converted list field is then removed. Idempotent; text-only blocks are unchanged.
//
// Block types never decide anything except the medical text-field lookup (rule 3) and the
// summary/skills exclusion: real CVs use experience, position, job, entry, degree, text...

export const normalizeCvTypeKey = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export const HEADER_SECTION_TYPES = new Set([
  "header",
  "contact",
  "contact_info",
  "contact_information",
  "personal_info",
  "personal_information",
  "personal_details"
]);
export const REFERENCE_SECTION_TYPES = new Set(["references", "reference", "referees"]);
export const SUMMARY_SECTION_TYPES = new Set([
  "summary",
  "professional_summary",
  "profile",
  "about",
  "about_me",
  "objective",
  "career_objective",
  "personal_statement"
]);
export const SKILLS_SECTION_TYPES = new Set([
  "skills",
  "technical_skills",
  "soft_skills",
  "key_skills",
  "core_skills",
  "core_competencies",
  "competencies"
]);
// Facts/labels, never bullet narrative.
export const LABEL_SECTION_TYPES = new Set(["languages", "language", "interests", "hobbies"]);
const CERTIFICATION_SECTION_TYPES = new Set(["certifications", "certification", "certificates", "licenses"]);

// Sections whose items are work the candidate did (the open number question targets them).
export const EXPERIENCE_LIKE_SECTION_TYPES = new Set([
  "experience",
  "work_experience",
  "professional_experience",
  "employment",
  "employment_history",
  "work_history",
  "career_history",
  "internships",
  "projects",
  "project",
  "personal_projects",
  "academic_projects",
  "side_projects",
  "key_projects",
  "volunteer",
  "volunteering",
  "volunteer_work",
  "volunteer_experience"
]);

// Text fields an item's bullet narrative may live in, in the renderer's body order.
export const NARRATIVE_TEXT_FIELDS = ["description", "summary", "details", "notes", "responsibilities", "highlights"] as const;
// List-kind bullets that normalizeNarrativeLists folds into the narrative text field.
export const NARRATIVE_LIST_FIELDS = ["description", "responsibilities", "highlights", "achievements", "bullets"] as const;

// Medical module textarea fields that use the "• " convention, by block type / section type.
const MODULE_TEXT_FIELD_BY_TYPE: Record<string, string> = {
  medical_qualification: "notes",
  medical_qualifications: "notes",
  career_gap: "explanation",
  additional_skill: "context",
  additional_skills: "context",
  teaching_activity: "evaluation",
  teaching: "evaluation"
};

// Every key that can hold bullet narrative text somewhere (rendering's bullet detection).
export const NARRATIVE_BULLET_FIELD_KEYS: readonly string[] = [
  ...NARRATIVE_TEXT_FIELDS,
  ...new Set(Object.values(MODULE_TEXT_FIELD_BY_TYPE))
];

// Module "bullets"-kind fields are intentionally arrays (the module editor edits them as
// lists): derived from the module definitions so a new one is protected automatically.
const MODULE_LIST_FIELDS_BY_TYPE: Record<string, Set<string>> = (() => {
  const map: Record<string, Set<string>> = {};
  for (const definition of medicalUkModule.sectionCatalog) {
    const keys = definition.fieldSchema.filter((field) => field.kind === "bullets").map((field) => field.key);
    if (keys.length === 0) continue;
    for (const type of [definition.type, definition.blockType]) {
      const key = normalizeCvTypeKey(type);
      map[key] = new Set([...(map[key] ?? []), ...keys]);
    }
  }
  return map;
})();

export interface NarrativeBlockContext {
  sectionType: string | null | undefined;
  blockType?: string | null;
}

type Fields = Record<string, CvJsonValue>;

const moduleListFields = (context: NarrativeBlockContext): Set<string> => {
  const block = MODULE_LIST_FIELDS_BY_TYPE[normalizeCvTypeKey(context.blockType)];
  const section = MODULE_LIST_FIELDS_BY_TYPE[normalizeCvTypeKey(context.sectionType)];
  return new Set([...(block ?? []), ...(section ?? [])]);
};

// A medical block type names its text field; a section type only when the block has it
// (a standard block placed in a module section keeps the standard rule).
const moduleTextField = (fields: Fields, context: NarrativeBlockContext): string | null | undefined => {
  const byBlock = MODULE_TEXT_FIELD_BY_TYPE[normalizeCvTypeKey(context.blockType)];
  if (byBlock) return typeof fields[byBlock] === "string" ? byBlock : null;
  const bySection = MODULE_TEXT_FIELD_BY_TYPE[normalizeCvTypeKey(context.sectionType)];
  return bySection && typeof fields[bySection] === "string" ? bySection : undefined;
};

// Whether blocks of this section/block type can hold bullet narrative at all.
export const isNarrativeSection = (context: NarrativeBlockContext): boolean => {
  const section = normalizeCvTypeKey(context.sectionType);
  const block = normalizeCvTypeKey(context.blockType);
  if (
    HEADER_SECTION_TYPES.has(section) ||
    REFERENCE_SECTION_TYPES.has(section) ||
    SUMMARY_SECTION_TYPES.has(section) ||
    SKILLS_SECTION_TYPES.has(section) ||
    LABEL_SECTION_TYPES.has(section)
  ) {
    return false;
  }
  return block !== "summary" && block !== "skills";
};

const nonEmptyString = (value: CvJsonValue | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const listItems = (value: CvJsonValue | undefined): string[] | null => {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string" || typeof item === "number")) return null;
  const items = value
    .map((item) => stripBulletPrefix(String(item).replace(/\s+/g, " ")))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
};

// The list fields of this block that normalizeNarrativeLists would convert.
const convertibleListFields = (fields: Fields, context: NarrativeBlockContext): string[] => {
  if (!isNarrativeSection(context)) return [];
  const protectedKeys = moduleListFields(context);
  return NARRATIVE_LIST_FIELDS.filter((key) => !protectedKeys.has(key) && listItems(fields[key]) !== null);
};

// The field holding the block's bullet narrative, or null when the block is not a
// narrative item (summary, skills, labels, references) or keeps its narrative only in
// lists (run normalizeNarrativeLists first to make those blocks rewritable).
export const narrativeBulletField = (fields: Fields, context: NarrativeBlockContext): string | null => {
  if (!isNarrativeSection(context)) return null;
  const moduleField = moduleTextField(fields, context);
  if (moduleField !== undefined) return moduleField;
  const filled = NARRATIVE_TEXT_FIELDS.find((key) => nonEmptyString(fields[key]));
  if (filled) return filled;
  if (convertibleListFields(fields, context).length > 0) return null;
  if (CERTIFICATION_SECTION_TYPES.has(normalizeCvTypeKey(context.sectionType))) return null;
  return typeof fields.description === "string" ? "description" : null;
};

export const isNarrativeItemBlock = (fields: Fields, context: NarrativeBlockContext): boolean =>
  narrativeBulletField(fields, context) !== null;

// Every string field of a narrative item that uses the bullet convention (the bulletizer
// normalizes all of them; usually only the narrative field is filled).
export const narrativeTextFields = (fields: Fields, context: NarrativeBlockContext): string[] => {
  const primary = narrativeBulletField(fields, context);
  if (!primary) return [];
  if (moduleTextField(fields, context)) return [primary];
  return NARRATIVE_TEXT_FIELDS.filter((key) => typeof fields[key] === "string");
};

// ---------------------------------------------------------------------------
// Editor helpers (frontend only; derived from the rules above)
// ---------------------------------------------------------------------------

// Whether an editor text field is edited with the bullet textarea (Enter adds "• ").
// Field-level counterpart of narrativeBulletField for inputs that may still be empty or
// missing: a medical block/section type uses its mapped text field (rule 3), every other
// narrative section its narrative text fields; summary, skills, languages, interests and
// references never do.
export const isNarrativeEditorField = (
  context: NarrativeBlockContext,
  fieldKey: string
): boolean => {
  if (!isNarrativeSection(context)) return false;
  const moduleField =
    MODULE_TEXT_FIELD_BY_TYPE[normalizeCvTypeKey(context.blockType)] ??
    MODULE_TEXT_FIELD_BY_TYPE[normalizeCvTypeKey(context.sectionType)];
  if (moduleField) return fieldKey === moduleField;
  return (NARRATIVE_TEXT_FIELDS as readonly string[]).includes(fieldKey);
};

// Renders a narrative field value as editor text: strings unchanged, string/number lists
// as "• item" lines (never comma-joined), nested values flattened the same way.
export const narrativeTextFromValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const items: string[] = [];
  const collect = (entry: unknown) => {
    if (entry === null || entry === undefined) return;
    if (Array.isArray(entry)) {
      entry.forEach(collect);
      return;
    }
    if (typeof entry === "object") {
      Object.values(entry as Record<string, unknown>).forEach(collect);
      return;
    }
    for (const line of String(entry).split(/\r\n?|\n/)) {
      const text = stripBulletPrefix(line.replace(/\s+/g, " "));
      if (text) items.push(text);
    }
  };
  collect(value);
  return items.map((item) => `${BULLET_MARKER}${item}`).join("\n");
};

// Normalizes AI bullet answers (dashes / numbers / "•" / multi-line) into the "• "
// convention for narrative item blocks; summary and skills blocks are left untouched.
// Mirrors bulletizeNarrativeFields in backend/src/modules/ai/ai.service.ts.
export const bulletizeNarrativeFields = (block: CvBlock, sectionType: string): CvBlock => {
  const narrativeKeys = narrativeTextFields(block.fields, { sectionType, blockType: block.type });
  if (narrativeKeys.length === 0) {
    return block;
  }

  let changed = false;
  const fields = { ...block.fields };
  for (const key of narrativeKeys) {
    const value = fields[key];
    if (typeof value === "string" && looksLikeBulletAnswer(value)) {
      const normalized = normalizeToBullets(value);
      if (normalized !== value) {
        fields[key] = normalized;
        changed = true;
      }
    }
  }

  return changed ? { ...block, fields } : block;
};

// ---------------------------------------------------------------------------
// List-kind bullets -> text
// ---------------------------------------------------------------------------

export const comparableNarrativeText = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const containsComparable = (haystack: string, needle: string): boolean =>
  ` ${haystack} `.includes(` ${needle} `);

export type NarrativeListConversion = "none" | "list_only" | "duplicate_list" | "list_with_extra_items";

export interface NarrativeListResult {
  fields: Fields;
  conversion: NarrativeListConversion;
  target_field: string | null;
  removed_fields: string[];
  appended_items: string[];
}

// Folds list-kind bullets into the narrative text field (see rule 5 above). Returns the
// same fields object when nothing changes.
export const convertNarrativeLists = (fields: Fields, context: NarrativeBlockContext): NarrativeListResult => {
  const listKeys = convertibleListFields(fields, context);
  if (listKeys.length === 0) {
    return { fields, conversion: "none", target_field: null, removed_fields: [], appended_items: [] };
  }

  const textField = NARRATIVE_TEXT_FIELDS.find((key) => nonEmptyString(fields[key])) ?? null;
  const target = textField ?? "description";
  // A non-list, non-string description (e.g. an object) cannot take the text: leave all.
  if (!textField && fields.description !== undefined && fields.description !== null) {
    const description = fields.description;
    if (typeof description !== "string" && !listKeys.includes("description")) {
      return { fields, conversion: "none", target_field: null, removed_fields: [], appended_items: [] };
    }
  }

  const existing = textField ? String(fields[textField]) : "";
  let comparable = comparableNarrativeText(existing);
  const appended: string[] = [];
  for (const key of listKeys) {
    for (const item of listItems(fields[key]) ?? []) {
      const needle = comparableNarrativeText(item);
      if (!needle || containsComparable(comparable, needle)) continue;
      appended.push(item);
      comparable = `${comparable} ${needle}`.trim();
    }
  }

  const bulletLines = appended.map((item) => `${BULLET_MARKER}${item}`).join("\n");
  const nextText = !existing.trim() ? bulletLines : appended.length > 0 ? `${existing.trimEnd()}\n${bulletLines}` : existing;
  const next: Fields = { ...fields };
  for (const key of listKeys) delete next[key];
  next[target] = nextText;

  return {
    fields: next,
    conversion: !existing.trim() ? "list_only" : appended.length > 0 ? "list_with_extra_items" : "duplicate_list",
    target_field: target,
    removed_fields: listKeys.filter((key) => key !== target),
    appended_items: appended
  };
};

export const normalizeNarrativeLists = (fields: Fields, context: NarrativeBlockContext): Fields =>
  convertNarrativeLists(fields, context).fields;

export const normalizeBlockNarrativeLists = (block: CvBlock, sectionType: string): CvBlock => {
  const fields = normalizeNarrativeLists(block.fields ?? {}, { sectionType, blockType: block.type });
  return fields === block.fields ? block : { ...block, fields };
};

// Whole-CV variant; returns the same content object when no block changes.
export const normalizeNarrativeListsInContent = (content: CvContent): CvContent => {
  let changed = false;
  const sections = content.sections.map((section) => {
    let sectionChanged = false;
    const blocks = section.blocks.map((block) => {
      const next = normalizeBlockNarrativeLists(block, section.type);
      if (next !== block) sectionChanged = true;
      return next;
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, blocks };
  });
  return changed ? { ...content, sections } : content;
};
