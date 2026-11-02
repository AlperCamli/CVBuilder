import type { CvBlock, CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import {
  HEADER_SECTION_TYPES,
  REFERENCE_SECTION_TYPES,
  SUMMARY_SECTION_TYPES,
  normalizeCvTypeKey,
  normalizeNarrativeListsInContent
} from "../../shared/cv-content/narrative-fields";
import { removeEmptyFields } from "./empty-fields";

// Read-only background for summary block suggestions. A summary describes the whole CV, so
// the model gets the candidate's other visible sections and can follow instructions like
// "mention my leadership at Acme" or write a summary from scratch. Nothing here is written
// back: enforceStandardBlockAiPolicy only takes the summary block's own narrative fields.

export interface SummaryProfileContextSection {
  section: string;
  entries: Record<string, CvJsonValue>[];
}

export interface SummaryProfileContext {
  headline?: string;
  sections: SummaryProfileContextSection[];
}

const MAX_ENTRIES_PER_SECTION = 15;
const MAX_ARRAY_ITEMS = 40;
const MAX_STRING_LENGTH = 1000;
// Rough cap on the serialized context so one long CV cannot blow up the prompt; sections
// keep CV order and later entries are dropped once the budget is spent.
const MAX_CONTEXT_CHARS = 12000;

// Contact details and links are never needed to write a summary.
const CONTACT_FIELD_PATTERN =
  /(^|_)(email|e_mail|phone|mobile|telephone|address|postcode|zip|url|urls|link|links|website|linkedin|github|portfolio|photo|avatar|image)($|_)/i;
const URL_VALUE_PATTERN = /^(https?:\/\/|www\.)\S+$/i;

export const SUMMARY_PROFILE_CONTEXT_RULE =
  "PROFILE CONTEXT (set by the system): input_payload.profile_context holds the candidate's other CV sections as read-only background. Use it to ground the summary: when user_instruction refers to a role, employer, project, qualification, or achievement, take the details from the matching profile_context entry. If the summary is empty, write a new one from profile_context. Every fact in the summary must come from block or profile_context; never invent employers, titles, dates, metrics, tools, or achievements, and do not include contact details. Rewrite only the summary's editable fields and never return profile_context or other sections.";

export const isSummaryBlock = (block: Pick<CvBlock, "type">, sectionType: string): boolean =>
  SUMMARY_SECTION_TYPES.has(normalizeCvTypeKey(sectionType)) || normalizeCvTypeKey(block.type) === "summary";

const trimContextValue = (value: CvJsonValue): CvJsonValue | undefined => {
  if (typeof value === "string") {
    const text = value.trim();
    if (URL_VALUE_PATTERN.test(text)) return undefined;
    return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH).trimEnd()}…` : text;
  }
  if (typeof value === "boolean") {
    // false flags (e.g. current_role: false) carry no information for a summary.
    return value ? true : undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(trimContextValue)
      .filter((item): item is CvJsonValue => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const record = trimContextRecord(value);
    return Object.keys(record).length > 0 ? record : undefined;
  }
  return value;
};

const trimContextRecord = (fields: Record<string, CvJsonValue>): Record<string, CvJsonValue> => {
  const next: Record<string, CvJsonValue> = {};
  for (const [key, value] of Object.entries(removeEmptyFields(fields))) {
    if (CONTACT_FIELD_PATTERN.test(key)) continue;
    const trimmed = trimContextValue(value);
    if (trimmed !== undefined) next[key] = trimmed;
  }
  return next;
};

const isHidden = (meta: Record<string, CvJsonValue>, visibility?: string): boolean =>
  visibility === "hidden" || meta.visibility === "hidden";

export const collectSummaryProfileContext = (
  rawContent: CvContent,
  summaryBlockId: string
): SummaryProfileContext => {
  // Lists that duplicate a description would be sent twice: fold them into the text first.
  const content = normalizeNarrativeListsInContent(rawContent);
  const headline = typeof content.metadata.headline === "string" ? content.metadata.headline.trim() : "";

  const sections: SummaryProfileContextSection[] = [];
  let budget = MAX_CONTEXT_CHARS - headline.length;

  const sortedSections = [...content.sections].sort((left, right) => left.order - right.order);
  for (const section of sortedSections) {
    const sectionType = normalizeCvTypeKey(section.type);
    if (
      HEADER_SECTION_TYPES.has(sectionType) ||
      REFERENCE_SECTION_TYPES.has(sectionType) ||
      isHidden(section.meta) ||
      section.blocks.some((block) => block.id === summaryBlockId)
    ) {
      continue;
    }

    const entries: Record<string, CvJsonValue>[] = [];
    const sortedBlocks = [...section.blocks].sort((left, right) => left.order - right.order);
    for (const block of sortedBlocks) {
      if (entries.length >= MAX_ENTRIES_PER_SECTION || budget <= 0) break;
      if (isHidden(block.meta, block.visibility)) continue;
      const entry = trimContextRecord(block.fields);
      if (Object.keys(entry).length === 0) continue;
      budget -= JSON.stringify(entry).length;
      if (budget < 0) break;
      entries.push(entry);
    }

    if (entries.length > 0) {
      sections.push({ section: section.title?.trim() || section.type, entries });
    }
    if (budget <= 0) break;
  }

  return {
    ...(headline ? { headline } : {}),
    sections
  };
};
