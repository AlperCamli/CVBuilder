import { randomUUID } from "node:crypto";
import { ValidationError, NotFoundError } from "../errors/app-error";
import { formatZodError } from "../validation/format-zod-error";
import { cvContentInputSchema } from "./cv-content.schemas";
import type {
  CvBlock,
  CvBlockLookupResult,
  CvBlockPatch,
  CvBlockUpdateResult,
  CvContent,
  CvJsonValue,
  CvPreview,
  CvSection
} from "./cv-content.types";

const toSectionId = (type: string): string => `${type}-${randomUUID()}`;
const toBlockId = (type: string): string => `${type}-${randomUUID()}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const normalizeCvJsonValue = (value: unknown): CvJsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCvJsonValue(item));
  }

  if (isPlainObject(value)) {
    const next: Record<string, CvJsonValue> = {};

    for (const [key, item] of Object.entries(value)) {
      next[key] = normalizeCvJsonValue(item);
    }

    return next;
  }

  return String(value);
};

export const normalizeCvJsonRecord = (value: unknown): Record<string, CvJsonValue> => {
  if (!isPlainObject(value)) {
    return {};
  }

  const next: Record<string, CvJsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    next[key] = normalizeCvJsonValue(item);
  }

  return next;
};

const uniqueId = (candidate: string, seen: Set<string>, fallback: () => string): string => {
  let next = candidate;

  while (seen.has(next)) {
    next = fallback();
  }

  seen.add(next);
  return next;
};

const extractText = (value: CvJsonValue): string[] => {
  if (value === null) {
    return [];
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractText(item));
  }

  return Object.values(value).flatMap((item) => extractText(item));
};

export const cloneCvContent = (content: CvContent): CvContent => {
  return JSON.parse(JSON.stringify(content)) as CvContent;
};

export const createEmptyCvContent = (language: string): CvContent => {
  const normalizedLanguage = language.trim() || "en";

  const summarySectionId = toSectionId("summary");
  const experienceSectionId = toSectionId("experience");
  const educationSectionId = toSectionId("education");
  const skillsSectionId = toSectionId("skills");

  return {
    version: "v1",
    language: normalizedLanguage,
    metadata: {
      full_name: "",
      headline: "",
      email: "",
      phone: "",
      location: ""
    },
    sections: [
      {
        id: summarySectionId,
        type: "summary",
        title: "Summary",
        order: 0,
        meta: {},
        blocks: [
          {
            id: toBlockId("summary"),
            type: "summary",
            order: 0,
            visibility: "visible",
            fields: {
              text: ""
            },
            meta: {
              revision_anchor: null,
              ai_suggestion_state: "none"
            }
          }
        ]
      },
      {
        id: experienceSectionId,
        type: "experience",
        title: "Experience",
        order: 1,
        meta: {},
        blocks: []
      },
      {
        id: educationSectionId,
        type: "education",
        title: "Education",
        order: 2,
        meta: {},
        blocks: []
      },
      {
        id: skillsSectionId,
        type: "skills",
        title: "Skills",
        order: 3,
        meta: {},
        blocks: []
      }
    ]
  };
};

export const normalizeCvContent = (input: unknown, fallbackLanguage: string): CvContent => {
  const parsed = cvContentInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError("Invalid CV content", formatZodError(parsed.error));
  }

  const source = parsed.data;
  const sectionIds = new Set<string>();
  const blockIds = new Set<string>();

  const sections: CvSection[] = (source.sections ?? []).map((section, sectionIndex) => {
    const sectionType = section.type?.trim() || "custom";
    const sectionId = uniqueId(section.id?.trim() || toSectionId(sectionType), sectionIds, () =>
      toSectionId(sectionType)
    );

    const blocks: CvBlock[] = (section.blocks ?? []).map((block, blockIndex) => {
      const blockType = block.type?.trim() || "text";
      const blockId = uniqueId(block.id?.trim() || toBlockId(blockType), blockIds, () =>
        toBlockId(blockType)
      );

      return {
        id: blockId,
        type: blockType,
        order: Number.isInteger(block.order) && block.order !== undefined ? block.order : blockIndex,
        visibility: block.visibility ?? "visible",
        fields: normalizeCvJsonRecord(block.fields),
        meta: normalizeCvJsonRecord(block.meta)
      };
    });

    return {
      id: sectionId,
      type: sectionType,
      title: section.title ?? null,
      order:
        Number.isInteger(section.order) && section.order !== undefined ? section.order : sectionIndex,
      blocks,
      meta: normalizeCvJsonRecord(section.meta)
    };
  });

  return {
    version: "v1",
    language: source.language?.trim() || fallbackLanguage || "en",
    metadata: normalizeCvJsonRecord(source.metadata),
    sections
  };
};

export const buildCvPreview = (content: CvContent): CvPreview => {
  const sortedSections = [...content.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      ...section,
      blocks: [...section.blocks].sort((a, b) => a.order - b.order)
    }));

  const plainText = sortedSections
    .flatMap((section) => section.blocks)
    .flatMap((block) => Object.values(block.fields))
    .flatMap((value) => extractText(value))
    .join("\n")
    .trim();

  return {
    version: "v1",
    language: content.language,
    generated_at: new Date().toISOString(),
    plain_text: plainText,
    sections: sortedSections
  };
};

export const buildCvSummaryText = (content: CvContent, maxLength = 320): string | null => {
  const preview = buildCvPreview(content);

  if (!preview.plain_text) {
    return null;
  }

  if (preview.plain_text.length <= maxLength) {
    return preview.plain_text;
  }

  return `${preview.plain_text.slice(0, maxLength - 3)}...`;
};

export const updateBlockInCvContent = (
  content: CvContent,
  blockId: string,
  patch: CvBlockPatch
): CvBlockUpdateResult => {
  const cloned = cloneCvContent(content);

  for (const section of cloned.sections) {
    const index = section.blocks.findIndex((block) => block.id === blockId);

    if (index === -1) {
      continue;
    }

    const current = section.blocks[index];
    const nextFields =
      patch.fields === undefined
        ? current.fields
        : patch.replace_fields
          ? normalizeCvJsonRecord(patch.fields)
          : {
              ...current.fields,
              ...normalizeCvJsonRecord(patch.fields)
            };

    const nextMeta =
      patch.meta === undefined
        ? current.meta
        : {
            ...current.meta,
            ...normalizeCvJsonRecord(patch.meta)
          };

    const updated: CvBlock = {
      ...current,
      type: patch.type ?? current.type,
      order: patch.order ?? current.order,
      visibility: patch.visibility ?? current.visibility,
      fields: nextFields,
      meta: nextMeta
    };

    section.blocks[index] = updated;

    return {
      content: cloned,
      updated_block: updated,
      section_id: section.id
    };
  }

  throw new NotFoundError("CV block was not found", { block_id: blockId });
};

export const findBlockInCvContent = (content: CvContent, blockId: string): CvBlockLookupResult => {
  for (const section of content.sections) {
    const block = section.blocks.find((item) => item.id === blockId);

    if (block) {
      return {
        block,
        section_id: section.id
      };
    }
  }

  throw new NotFoundError("CV block was not found", { block_id: blockId });
};

export const normalizeCvBlock = (input: unknown, fallback: CvBlock): CvBlock => {
  const candidate = isPlainObject(input) ? input : {};
  const nextType =
    typeof candidate.type === "string" && candidate.type.trim() ? candidate.type.trim() : fallback.type;
  const nextOrder = Number.isInteger(candidate.order) ? Number(candidate.order) : fallback.order;
  const nextVisibility =
    candidate.visibility === "visible" || candidate.visibility === "hidden"
      ? candidate.visibility
      : fallback.visibility;

  return {
    id: fallback.id,
    type: nextType,
    order: nextOrder,
    visibility: nextVisibility,
    fields: candidate.fields === undefined ? fallback.fields : normalizeCvJsonRecord(candidate.fields),
    meta: candidate.meta === undefined ? fallback.meta : normalizeCvJsonRecord(candidate.meta)
  };
};

export const replaceBlockInCvContent = (
  content: CvContent,
  blockId: string,
  replacement: CvBlock
): CvBlockUpdateResult => {
  const cloned = cloneCvContent(content);

  for (const section of cloned.sections) {
    const index = section.blocks.findIndex((block) => block.id === blockId);

    if (index === -1) {
      continue;
    }

    const normalized = normalizeCvBlock(replacement, section.blocks[index]);
    section.blocks[index] = normalized;

    return {
      content: cloned,
      updated_block: normalized,
      section_id: section.id
    };
  }

  throw new NotFoundError("CV block was not found", { block_id: blockId });
};
