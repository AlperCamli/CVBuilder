import type { CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";

export interface TailoredDraftSemanticStats {
  section_count: number;
  block_count: number;
  visible_block_count: number;
  meaningful_block_count: number;
}

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

export const evaluateTailoredDraftSemanticContent = (content: CvContent): {
  is_valid: boolean;
  stats: TailoredDraftSemanticStats;
} => {
  let blockCount = 0;
  let visibleBlockCount = 0;
  let meaningfulBlockCount = 0;

  for (const section of content.sections) {
    for (const block of section.blocks) {
      blockCount += 1;
      if (block.visibility === "hidden") {
        continue;
      }
      visibleBlockCount += 1;

      if (hasMeaningfulValue(block.fields)) {
        meaningfulBlockCount += 1;
      }
    }
  }

  const stats: TailoredDraftSemanticStats = {
    section_count: content.sections.length,
    block_count: blockCount,
    visible_block_count: visibleBlockCount,
    meaningful_block_count: meaningfulBlockCount
  };

  return {
    is_valid: meaningfulBlockCount > 0,
    stats
  };
};
