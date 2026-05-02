import { cloneCvContent } from "../../shared/cv-content/cv-content.utils";
import type { CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";

const hasMeaningfulValue = (value: CvJsonValue): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  return Object.values(value).some((item) => hasMeaningfulValue(item));
};

const hasMeaningfulFields = (fields: Record<string, CvJsonValue>): boolean => {
  return Object.values(fields).some((value) => hasMeaningfulValue(value));
};

const cloneFields = (fields: Record<string, CvJsonValue>): Record<string, CvJsonValue> => {
  return JSON.parse(JSON.stringify(fields)) as Record<string, CvJsonValue>;
};

interface RecoveryResult {
  content: CvContent;
  hydrated_block_count: number;
}

const toSortedSections = (content: CvContent): CvSection[] => {
  return [...content.sections].sort((left, right) => left.order - right.order);
};

export const recoverTailoredDraftEmptyFieldsFromMaster = (
  generated: CvContent,
  master: CvContent
): RecoveryResult => {
  const next = cloneCvContent(generated);
  const generatedSections = toSortedSections(next);
  const masterSections = toSortedSections(master);
  const typedSectionCursor = new Map<string, number>();
  let hydratedBlockCount = 0;

  for (const [sectionIndex, generatedSection] of generatedSections.entries()) {
    const sameTypeStart = typedSectionCursor.get(generatedSection.type) ?? 0;
    let matchedMasterSection =
      masterSections
        .filter((section) => section.type === generatedSection.type)
        .slice(sameTypeStart)[0] ?? null;

    if (!matchedMasterSection) {
      matchedMasterSection = masterSections[sectionIndex] ?? null;
    } else {
      typedSectionCursor.set(generatedSection.type, sameTypeStart + 1);
    }

    if (!matchedMasterSection) {
      continue;
    }

    const generatedBlocks = [...generatedSection.blocks].sort((left, right) => left.order - right.order);
    const masterBlocks = [...matchedMasterSection.blocks].sort((left, right) => left.order - right.order);

    for (const [blockIndex, generatedBlock] of generatedBlocks.entries()) {
      if (hasMeaningfulFields(generatedBlock.fields)) {
        continue;
      }

      const masterBlock = masterBlocks[blockIndex] ?? null;
      if (!masterBlock || !hasMeaningfulFields(masterBlock.fields)) {
        continue;
      }

      generatedBlock.fields = cloneFields(masterBlock.fields);
      hydratedBlockCount += 1;
    }
  }

  return {
    content: next,
    hydrated_block_count: hydratedBlockCount
  };
};
