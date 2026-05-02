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

interface StabilizeResult {
  content: CvContent;
  overlayed_section_count: number;
  overlayed_block_count: number;
  hydrated_block_count: number;
}

const GENERIC_SECTION_TYPE_PATTERN = /^section[_-]?\d+$/i;

const isGenericSectionType = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized === "custom" || GENERIC_SECTION_TYPE_PATTERN.test(normalized);
};

const cloneJson = <T,>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

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

export const stabilizeTailoredDraftFromMaster = (
  generated: CvContent,
  master: CvContent
): StabilizeResult => {
  const baseline = cloneCvContent(master);
  const baselineSections = toSortedSections(baseline);
  const generatedSections = toSortedSections(generated);

  const baselineSectionIndexById = new Map<string, number>();
  const baselineSectionIndexesByType = new Map<string, number[]>();
  const sectionTypeCursor = new Map<string, number>();

  baselineSections.forEach((section, sectionIndex) => {
    baselineSectionIndexById.set(section.id, sectionIndex);
    const list = baselineSectionIndexesByType.get(section.type) ?? [];
    list.push(sectionIndex);
    baselineSectionIndexesByType.set(section.type, list);
  });

  let overlayedSectionCount = 0;
  let overlayedBlockCount = 0;
  let hydratedBlockCount = 0;

  for (const generatedSection of generatedSections) {
    const generatedType = generatedSection.type.trim().toLowerCase();

    let targetSectionIndex: number | null =
      baselineSectionIndexById.get(generatedSection.id) ?? null;

    if (targetSectionIndex === null && !isGenericSectionType(generatedType)) {
      const sectionIndexes = baselineSectionIndexesByType.get(generatedType) ?? [];
      const cursor = sectionTypeCursor.get(generatedType) ?? 0;
      if (cursor < sectionIndexes.length) {
        targetSectionIndex = sectionIndexes[cursor] ?? null;
        sectionTypeCursor.set(generatedType, cursor + 1);
      }
    }

    if (targetSectionIndex === null) {
      continue;
    }

    const targetSection = baselineSections[targetSectionIndex];
    if (!targetSection) {
      continue;
    }

    overlayedSectionCount += 1;
    const generatedTitle = generatedSection.title?.trim() ?? "";
    if (generatedTitle && !/^section\s+\d+$/i.test(generatedTitle)) {
      targetSection.title = generatedTitle;
    }

    const targetBlocks = [...targetSection.blocks].sort((left, right) => left.order - right.order);
    const targetBlockIndexById = new Map<string, number>();
    targetBlocks.forEach((block, blockIndex) => {
      targetBlockIndexById.set(block.id, blockIndex);
    });

    const generatedBlocks = [...generatedSection.blocks].sort((left, right) => left.order - right.order);
    generatedBlocks.forEach((generatedBlock, generatedBlockIndex) => {
      const targetBlockIndex =
        targetBlockIndexById.get(generatedBlock.id) ?? generatedBlockIndex;
      const targetBlock = targetBlocks[targetBlockIndex];

      if (!targetBlock) {
        if (!hasMeaningfulFields(generatedBlock.fields)) {
          return;
        }

        const nextOrder =
          targetSection.blocks.reduce((max, block) => Math.max(max, block.order), -1) + 1;
        targetSection.blocks.push({
          ...cloneJson(generatedBlock),
          order: nextOrder
        });
        overlayedBlockCount += 1;
        return;
      }

      if (typeof generatedBlock.type === "string" && generatedBlock.type.trim()) {
        targetBlock.type = generatedBlock.type;
      }
      targetBlock.visibility = generatedBlock.visibility;

      if (hasMeaningfulFields(generatedBlock.fields)) {
        targetBlock.fields = cloneFields(generatedBlock.fields);
        overlayedBlockCount += 1;
      } else if (!hasMeaningfulFields(targetBlock.fields)) {
        const matchedMasterBlock = targetBlocks[targetBlockIndex];
        if (matchedMasterBlock && hasMeaningfulFields(matchedMasterBlock.fields)) {
          targetBlock.fields = cloneFields(matchedMasterBlock.fields);
          hydratedBlockCount += 1;
        }
      }

      if (Object.keys(generatedBlock.meta).length > 0) {
        targetBlock.meta = {
          ...targetBlock.meta,
          ...cloneFields(generatedBlock.meta)
        };
      }
    });
  }

  return {
    content: baseline,
    overlayed_section_count: overlayedSectionCount,
    overlayed_block_count: overlayedBlockCount,
    hydrated_block_count: hydratedBlockCount
  };
};
