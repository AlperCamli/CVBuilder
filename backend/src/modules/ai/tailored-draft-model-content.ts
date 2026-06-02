import { randomUUID } from "node:crypto";
import { cloneCvContent, normalizeCvJsonRecord } from "../../shared/cv-content/cv-content.utils";
import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";

interface TailoredDraftAliasMap {
  section_alias_to_id: Record<string, string>;
  block_alias_to_id: Record<string, string>;
}

export interface TailoredDraftModelContentContext {
  model_content: Record<string, unknown>;
  alias_map: TailoredDraftAliasMap;
}

const HEADER_SECTION_TYPES = new Set(["header", "contact", "contact_info", "personal_info"]);
const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isEmptyValue = (value: CvJsonValue): boolean => {
  if (value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0 || UUID_LIKE_PATTERN.test(value.trim());
  }
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isEmptyValue(item));
  }

  return Object.keys(removeEmptyFields(value)).length === 0;
};

const removeEmptyFields = (fields: Record<string, CvJsonValue>): Record<string, CvJsonValue> => {
  const next: Record<string, CvJsonValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === "id" || key.endsWith("_id")) {
      continue;
    }
    if (isEmptyValue(value)) {
      continue;
    }
    if (Array.isArray(value)) {
      const filtered = value.filter((item) => !isEmptyValue(item));
      if (filtered.length > 0) {
        next[key] = filtered;
      }
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const nested = removeEmptyFields(value);
      if (Object.keys(nested).length > 0) {
        next[key] = nested;
      }
      continue;
    }
    next[key] = value;
  }

  return next;
};

const toSortedSections = (content: CvContent): CvSection[] =>
  [...content.sections].sort((left, right) => left.order - right.order);

const toSortedBlocks = (section: CvSection): CvBlock[] =>
  [...section.blocks].sort((left, right) => left.order - right.order);

const isHeaderSection = (section: Pick<CvSection, "type">): boolean =>
  HEADER_SECTION_TYPES.has(section.type.trim().toLowerCase());

const aliasFor = (type: string, index: number, suffix: string): string => {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "section";
  return `${normalized}_${index}${suffix}`;
};

export const buildTailoredDraftModelContent = (
  masterContent: CvContent
): TailoredDraftModelContentContext => {
  const aliasMap: TailoredDraftAliasMap = {
    section_alias_to_id: {},
    block_alias_to_id: {}
  };
  const sectionCounters = new Map<string, number>();
  const blockCounters = new Map<string, number>();
  const modelSections: Record<string, unknown>[] = [];

  for (const section of toSortedSections(masterContent)) {
    if (isHeaderSection(section)) {
      continue;
    }

    const sectionType = section.type.trim() || "custom";
    const sectionIndex = (sectionCounters.get(sectionType) ?? 0) + 1;
    sectionCounters.set(sectionType, sectionIndex);
    const sectionAlias = aliasFor(sectionType, sectionIndex, "_section");
    aliasMap.section_alias_to_id[sectionAlias] = section.id;

    const modelBlocks: Record<string, unknown>[] = [];
    for (const block of toSortedBlocks(section)) {
      const fields = removeEmptyFields(block.fields);
      if (Object.keys(fields).length === 0) {
        continue;
      }

      const blockType = block.type.trim() || sectionType;
      const blockIndex = (blockCounters.get(sectionType) ?? 0) + 1;
      blockCounters.set(sectionType, blockIndex);
      const blockAlias = aliasFor(sectionType, blockIndex, "");
      aliasMap.block_alias_to_id[blockAlias] = block.id;

      modelBlocks.push({
        id: blockAlias,
        type: blockType,
        order: modelBlocks.length,
        visibility: block.visibility,
        fields
      });
    }

    if (modelBlocks.length === 0) {
      continue;
    }

    modelSections.push({
      id: sectionAlias,
      type: sectionType,
      title: section.title ?? undefined,
      order: modelSections.length,
      blocks: modelBlocks
    });
  }

  return {
    model_content: {
      sections: modelSections
    },
    alias_map: aliasMap
  };
};

const toGeneratedSectionId = (section: CvSection, aliasMap: TailoredDraftAliasMap): string => {
  const mapped = aliasMap.section_alias_to_id[section.id];
  if (mapped) {
    return mapped;
  }
  const generatedId = `${section.type || "section"}-${randomUUID()}`;
  aliasMap.section_alias_to_id[section.id] = generatedId;
  return generatedId;
};

const toGeneratedBlockId = (block: CvBlock, aliasMap: TailoredDraftAliasMap): string => {
  const mapped = aliasMap.block_alias_to_id[block.id];
  if (mapped) {
    return mapped;
  }
  const generatedId = `${block.type || "block"}-${randomUUID()}`;
  aliasMap.block_alias_to_id[block.id] = generatedId;
  return generatedId;
};

export const resolveTailoredDraftModelContent = (
  generatedContent: CvContent,
  masterContent: CvContent,
  aliasMap: TailoredDraftAliasMap
): CvContent => {
  const master = cloneCvContent(masterContent);
  const masterHeaderSections = toSortedSections(master).filter(isHeaderSection);
  const bodySections = toSortedSections(generatedContent)
    .filter((section) => !isHeaderSection(section))
    .map((section) => {
      const nextSection: CvSection = {
        ...cloneJson(section),
        id: toGeneratedSectionId(section, aliasMap),
        meta: normalizeCvJsonRecord(section.meta),
        blocks: toSortedBlocks(section).map((block, blockIndex) => ({
          ...cloneJson(block),
          id: toGeneratedBlockId(block, aliasMap),
          order: blockIndex,
          meta: normalizeCvJsonRecord(block.meta)
        }))
      };
      return nextSection;
    });

  const sections = [...masterHeaderSections, ...bodySections].map((section, index) => ({
    ...section,
    order: index
  }));

  return {
    version: "v1",
    language: master.language,
    metadata: cloneJson(master.metadata),
    sections
  };
};
