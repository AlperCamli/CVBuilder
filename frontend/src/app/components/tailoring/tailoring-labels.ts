import { translate as t } from "../../localization/i18n";
import type { CvContent, CvJsonValue } from "../../integration/api-types";
import type { TailoringTask } from "../../integration/tailoring-types";

const text = (value: CvJsonValue | undefined): string => (typeof value === "string" ? value.trim() : "");

const TITLE_FIELDS: Record<string, [string, string]> = {
  experience_item: ["role", "company"],
  volunteer_item: ["role", "organization"],
  project_item: ["title", "subtitle"],
  education_item: ["degree", "institution"],
  award_item: ["name", "issuer"],
  publication_item: ["title", "publisher"],
  course_item: ["title", "institution"]
};

// Human label for a CV block, e.g. "Backend Engineer · Acme".
export const describeBlock = (content: CvContent, blockId: string | null): string => {
  if (!blockId) return "";
  for (const section of content.sections) {
    const block = section.blocks.find((item) => item.id === blockId);
    if (!block) continue;
    if (section.type === "summary" || block.type === "summary") return t("Professional summary");
    if (section.type === "skills" || block.type === "skills") return t("Skills");
    // Known block types first, then the common title/subtitle field pairs.
    const candidates = [TITLE_FIELDS[block.type], ...Object.values(TITLE_FIELDS)].filter(Boolean) as Array<[string, string]>;
    for (const [primary, secondary] of candidates) {
      const label = [text(block.fields[primary]), text(block.fields[secondary])].filter(Boolean).join(" · ");
      if (label) return label;
    }
    return section.title || t("CV entry");
  }
  return t("CV entry");
};

export const sectionTitle = (content: CvContent, sectionId: string): string => {
  const section = content.sections.find((item) => item.id === sectionId);
  return section?.title?.trim() || (section ? section.type.replace(/_/g, " ") : t("Section"));
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
