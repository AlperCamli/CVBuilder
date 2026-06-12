import type { EditorSection } from "../integration/cv-mappers";
import { getModuleManagedSectionDefinition } from "../modules/module-registry";
import type { SectionTypeDefinition } from "../modules/cv-module.types";

export const asTrimmedString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
};

const hasNonEmptyArrayValue = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((item) => asTrimmedString(item).length > 0);
};

const getSectionItems = (section: EditorSection): Record<string, unknown>[] => {
  const data = (section.data ?? {}) as Record<string, unknown>;
  return Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
};

export const matchesBlockReference = (item: Record<string, unknown>, blockReference: string): boolean => {
  const normalizedBlockReference = asTrimmedString(blockReference);
  if (!normalizedBlockReference) {
    return false;
  }

  return (
    asTrimmedString(item.blockId) === normalizedBlockReference ||
    asTrimmedString(item.id) === normalizedBlockReference
  );
};

const getTargetItem = (section: EditorSection, blockReference?: string): Record<string, unknown> | null => {
  const items = getSectionItems(section);
  if (items.length === 0) {
    return null;
  }

  if (typeof blockReference === "undefined") {
    return items[0];
  }

  const matched = items.find((item) => matchesBlockReference(item, blockReference));
  return matched ?? null;
};

// Module-managed items hold their values in rawFields; an item has AI-usable content
// when any schema field (booleans aside) is filled — facts alone are enough, because
// module AI synthesizes the narrative field from them.
const moduleItemHasContent = (
  item: Record<string, unknown>,
  definition: SectionTypeDefinition
): boolean => {
  const rawFields = (item.rawFields ?? {}) as Record<string, unknown>;

  return definition.fieldSchema.some((field) => {
    if (field.kind === "boolean") {
      return false;
    }

    const value = rawFields[field.key];
    return asTrimmedString(value).length > 0 || hasNonEmptyArrayValue(value);
  });
};

export const hasContentForAi = (
  section: EditorSection,
  blockReference?: string,
  moduleType?: string | null
): boolean => {
  const moduleDefinition = getModuleManagedSectionDefinition(moduleType ?? null, section.type);
  if (moduleDefinition) {
    const targetItem = getTargetItem(section, blockReference);
    return targetItem !== null && moduleItemHasContent(targetItem, moduleDefinition);
  }

  const data = (section.data ?? {}) as Record<string, unknown>;

  if (section.type === "summary") {
    return asTrimmedString(data.text).length > 0;
  }

  if (section.type === "skills") {
    return hasNonEmptyArrayValue(data.skills);
  }

  const targetItem = getTargetItem(section, blockReference);
  if (!targetItem) {
    return false;
  }

  const keysBySection: Record<string, string[]> = {
    experience: ["role", "company", "description"],
    education: ["institution", "degree", "fieldOfStudy", "description"],
    languages: ["language", "proficiency", "certificate", "notes"],
    certifications: ["name", "url", "verificationId"],
    courses: ["title", "institution", "description"],
    projects: ["title", "subtitle", "description"],
    volunteer: ["organization", "role", "description"],
    awards: ["name", "issuer", "date", "description"],
    publications: ["title", "publisher", "date", "description"],
    references: ["name", "jobTitle", "organization", "email", "phone"]
  };

  const candidateKeys = keysBySection[section.type] ?? Object.keys(targetItem);
  return candidateKeys.some((key) => asTrimmedString(targetItem[key]).length > 0);
};

export const canUseAiForSectionBlock = (
  section: EditorSection,
  blockReference?: string,
  moduleType?: string | null
): boolean => {
  const moduleDefinition = getModuleManagedSectionDefinition(moduleType ?? null, section.type);
  if (moduleDefinition && !moduleDefinition.aiSuggest) {
    // Fact-only module sections (e.g. medical registration) never get AI.
    return false;
  }

  if (section.type === "skills") {
    // Skills AI should be allowed even when the current skill list is empty.
    return true;
  }

  if (!hasContentForAi(section, blockReference, moduleType)) {
    return false;
  }

  if (section.type !== "experience") {
    return true;
  }

  const targetItem = getTargetItem(section, blockReference);
  if (!targetItem) {
    return false;
  }

  return asTrimmedString(targetItem.description).length > 0;
};

export const resolveCanonicalAiBlockId = (section: EditorSection, blockReference?: string): string | null => {
  const data = (section.data ?? {}) as Record<string, unknown>;
  const sectionBlockId = asTrimmedString(data.blockId);
  const items = getSectionItems(section);

  if (typeof blockReference !== "undefined") {
    if (sectionBlockId && sectionBlockId === asTrimmedString(blockReference)) {
      return sectionBlockId;
    }

    const targetItem = getTargetItem(section, blockReference);
    if (!targetItem) {
      return null;
    }

    const itemBlockId = asTrimmedString(targetItem.blockId);
    return itemBlockId || null;
  }

  if (sectionBlockId) {
    return sectionBlockId;
  }

  const firstItemBlockId = asTrimmedString(items[0]?.blockId);
  return firstItemBlockId || null;
};
