import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";

export interface TailoredDraftDivergenceStats {
  section_count: number;
  master_section_count: number;
  differing_block_count: number;
  added_block_count: number;
  removed_block_count: number;
  added_section_count: number;
  removed_section_count: number;
  fields_changed_block_count: number;
  title_changed_section_count: number;
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(",")}}`;
};

const fieldsEqual = (
  left: Record<string, CvJsonValue>,
  right: Record<string, CvJsonValue>
): boolean => {
  return stableStringify(left) === stableStringify(right);
};

const sortedBlocks = (section: CvSection): CvBlock[] => {
  return [...section.blocks].sort((a, b) => a.order - b.order);
};

const sortedSections = (content: CvContent): CvSection[] => {
  return [...content.sections].sort((a, b) => a.order - b.order);
};

const normalizeTitle = (value: string | null | undefined): string => {
  return (value ?? "").trim().toLowerCase();
};

/**
 * Determines whether a tailored draft differs from the master CV in any way
 * the end user would perceive. Compares section/block structure and block
 * field content, ignoring identifiers and order numbers (order is captured
 * by the sort, not the numeric value).
 *
 * The check exists because Gemini flash variants can silently return the
 * master content verbatim under a tailored_draft prompt, which previously
 * stored as a "successful" run with a tailored CV identical to the master.
 */
export const evaluateTailoredDraftMasterDivergence = (
  tailored: CvContent,
  master: CvContent
): {
  diverges: boolean;
  stats: TailoredDraftDivergenceStats;
} => {
  const tailoredSections = sortedSections(tailored);
  const masterSections = sortedSections(master);

  let differingBlockCount = 0;
  let addedBlockCount = 0;
  let removedBlockCount = 0;
  let addedSectionCount = 0;
  let removedSectionCount = 0;
  let fieldsChangedBlockCount = 0;
  let titleChangedSectionCount = 0;

  const masterCursorByType = new Map<string, number>();
  const matchedMasterIndexes = new Set<number>();

  tailoredSections.forEach((tailoredSection, sectionIndex) => {
    const sectionType = tailoredSection.type;

    let masterIndex = masterSections.findIndex(
      (candidate, index) => candidate.id === tailoredSection.id && !matchedMasterIndexes.has(index)
    );

    if (masterIndex < 0) {
      const cursor = masterCursorByType.get(sectionType) ?? 0;
      masterIndex = masterSections.findIndex(
        (candidate, index) =>
          candidate.type === sectionType && index >= cursor && !matchedMasterIndexes.has(index)
      );

      if (masterIndex >= 0) {
        masterCursorByType.set(sectionType, masterIndex + 1);
      }
    }

    if (masterIndex < 0) {
      addedSectionCount += 1;
      addedBlockCount += tailoredSection.blocks.length;
      return;
    }

    matchedMasterIndexes.add(masterIndex);
    const masterSection = masterSections[masterIndex];

    if (normalizeTitle(tailoredSection.title) !== normalizeTitle(masterSection.title)) {
      titleChangedSectionCount += 1;
    }

    const tailoredBlocks = sortedBlocks(tailoredSection);
    const masterBlocks = sortedBlocks(masterSection);
    const matchedMasterBlockIndexes = new Set<number>();

    tailoredBlocks.forEach((tailoredBlock, blockIndex) => {
      let masterBlockIndex = masterBlocks.findIndex(
        (candidate, index) =>
          candidate.id === tailoredBlock.id && !matchedMasterBlockIndexes.has(index)
      );

      if (masterBlockIndex < 0 && blockIndex < masterBlocks.length) {
        if (!matchedMasterBlockIndexes.has(blockIndex)) {
          masterBlockIndex = blockIndex;
        }
      }

      if (masterBlockIndex < 0) {
        addedBlockCount += 1;
        differingBlockCount += 1;
        return;
      }

      matchedMasterBlockIndexes.add(masterBlockIndex);
      const masterBlock = masterBlocks[masterBlockIndex];

      if (!fieldsEqual(tailoredBlock.fields, masterBlock.fields)) {
        fieldsChangedBlockCount += 1;
        differingBlockCount += 1;
      }
    });

    removedBlockCount += masterBlocks.length - matchedMasterBlockIndexes.size;
  });

  removedSectionCount += masterSections.length - matchedMasterIndexes.size;

  const stats: TailoredDraftDivergenceStats = {
    section_count: tailoredSections.length,
    master_section_count: masterSections.length,
    differing_block_count: differingBlockCount,
    added_block_count: addedBlockCount,
    removed_block_count: removedBlockCount,
    added_section_count: addedSectionCount,
    removed_section_count: removedSectionCount,
    fields_changed_block_count: fieldsChangedBlockCount,
    title_changed_section_count: titleChangedSectionCount
  };

  const diverges =
    fieldsChangedBlockCount > 0 ||
    addedBlockCount > 0 ||
    addedSectionCount > 0 ||
    titleChangedSectionCount > 0;

  return { diverges, stats };
};
