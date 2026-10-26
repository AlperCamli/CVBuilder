import type { CvBlock, CvContent, CvJsonValue, CvSection } from "./api-types";
import type { TailoringSuggestion } from "./tailoring-types";

// The editor is the only writer of CV content: tailoring suggestions are applied (and
// reverted) here on the editor's content, then saved by the normal autosave.

const HEADER_TYPES = new Set(["header", "contact", "contact_info", "personal_info"]);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sortedSections = (content: CvContent): CvSection[] =>
  [...content.sections].sort((left, right) => left.order - right.order);

const isHeader = (section: CvSection): boolean => HEADER_TYPES.has(section.type.trim().toLowerCase());

const reindex = (sections: CvSection[]): CvSection[] =>
  sections.map((section, index) => ({ ...section, order: index }));

const findBlock = (content: CvContent, blockId: string): CvBlock | null => {
  for (const section of content.sections) {
    const block = section.blocks.find((item) => item.id === blockId);
    if (block) return block;
  }
  return null;
};

// Whitespace and bullet glyph differences are not real edits.
const comparable = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => comparable(item)).join("|");
  }
  return String(value ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*·-]+/, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
};

const fieldOf = (suggestion: TailoringSuggestion): string =>
  String(suggestion.suggested.field ?? suggestion.before?.field ?? "");

// Reorders the given section ids into the positions they currently occupy, leaving every
// other section where it is.
const reorderSections = (content: CvContent, order: string[]): CvContent | null => {
  const sections = sortedSections(content);
  const ids = new Set(order);
  const positions = sections.map((section, index) => (ids.has(section.id) ? index : -1)).filter((index) => index >= 0);
  const present = order.filter((id) => sections.some((section) => section.id === id));
  if (present.length < 2 || positions.length !== present.length) {
    return null;
  }

  const next = [...sections];
  present.forEach((id, slot) => {
    next[positions[slot]] = sections.find((section) => section.id === id)!;
  });
  return { ...content, sections: reindex(next) };
};

const setSectionHidden = (content: CvContent, sectionId: string, hidden: boolean): CvContent | null => {
  if (!content.sections.some((section) => section.id === sectionId)) {
    return null;
  }
  return {
    ...content,
    sections: content.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const { visibility: _visibility, ...meta } = section.meta;
      return {
        ...section,
        meta: hidden ? { ...meta, visibility: "hidden" } : meta,
        blocks: section.blocks.map((block) => ({ ...block, visibility: hidden ? "hidden" : "visible" }))
      };
    })
  };
};

const sectionOf = (suggestion: TailoringSuggestion): CvSection | null => {
  const section = suggestion.suggested.section as CvSection | undefined;
  return section && typeof section === "object" && Array.isArray(section.blocks) ? section : null;
};

// A new skills section accepted with an edited (or stored edited) skill list.
const withSkillsOverride = (section: CvSection, value: unknown): CvSection => {
  if (!Array.isArray(value) || section.blocks.length === 0) return section;
  const [first, ...rest] = section.blocks;
  const field = Array.isArray(first.fields.skills) ? "skills" : Array.isArray(first.fields.items) ? "items" : null;
  if (!field) return section;
  return { ...section, blocks: [{ ...first, fields: { ...first.fields, [field]: value.map((item) => String(item)) } }, ...rest] };
};

// Skills a "skills" or new skills-section suggestion would write (edited values win).
export const tailoringSuggestedSkills = (suggestion: TailoringSuggestion): string[] | null => {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)) : []);
  if (suggestion.kind === "skills") return list(suggestion.suggested.value);
  if (suggestion.kind !== "new_section") return null;
  const section = sectionOf(suggestion);
  if (!section || section.type !== "skills") return null;
  if (Array.isArray(suggestion.suggested.value)) return list(suggestion.suggested.value);
  const fields = section.blocks[0]?.fields;
  return list(Array.isArray(fields?.skills) ? fields?.skills : fields?.items);
};

// Returns the new content, or null when the suggestion's target no longer exists.
export const applyTailoringSuggestion = (
  content: CvContent,
  suggestion: TailoringSuggestion,
  valueOverride?: CvJsonValue
): CvContent | null => {
  switch (suggestion.kind) {
    case "rewrite":
    case "skills": {
      if (!suggestion.block_id || !findBlock(content, suggestion.block_id)) return null;
      const field = fieldOf(suggestion);
      const value = (valueOverride ?? suggestion.suggested.value) as CvJsonValue;
      return {
        ...content,
        sections: content.sections.map((section) => ({
          ...section,
          blocks: section.blocks.map((block) =>
            block.id === suggestion.block_id ? { ...block, fields: { ...block.fields, [field]: value } } : block
          )
        }))
      };
    }
    case "new_section": {
      const section = sectionOf(suggestion);
      if (!section || content.sections.some((item) => item.id === section.id)) return null;
      const sections = sortedSections(content);
      const headerCount = sections.filter(isHeader).length;
      const insertAt = suggestion.suggested.position === "first" ? headerCount : sections.length;
      const inserted = withSkillsOverride(clone(section), valueOverride ?? suggestion.suggested.value);
      const next = [...sections];
      next.splice(insertAt, 0, inserted);
      return { ...content, sections: reindex(next) };
    }
    case "reorder":
      return reorderSections(content, (suggestion.suggested.section_order as string[] | undefined) ?? []);
    case "hide_section":
      return setSectionHidden(content, String(suggestion.suggested.section_id ?? ""), true);
    default:
      return null;
  }
};

// Undo of an applied suggestion. Returns null when the content changed since it was applied
// (undoing would silently discard the user's later edits).
export const revertTailoringSuggestion = (content: CvContent, suggestion: TailoringSuggestion): CvContent | null => {
  switch (suggestion.kind) {
    case "rewrite":
    case "skills": {
      if (!suggestion.block_id) return null;
      const block = findBlock(content, suggestion.block_id);
      const field = fieldOf(suggestion);
      if (!block || comparable(block.fields[field]) !== comparable(suggestion.suggested.value)) return null;
      return applyTailoringSuggestion(content, suggestion, (suggestion.before?.value ?? "") as CvJsonValue);
    }
    case "new_section": {
      const section = sectionOf(suggestion);
      if (!section || !content.sections.some((item) => item.id === section.id)) return null;
      return { ...content, sections: reindex(sortedSections(content).filter((item) => item.id !== section.id)) };
    }
    case "reorder":
      return reorderSections(content, (suggestion.before?.section_order as string[] | undefined) ?? []);
    case "hide_section":
      return setSectionHidden(content, String(suggestion.suggested.section_id ?? ""), false);
    default:
      return null;
  }
};

// A pending rewrite is stale when the block was edited after the suggestion was generated.
export const isTailoringSuggestionStale = (content: CvContent, suggestion: TailoringSuggestion): boolean => {
  if (suggestion.status !== "pending" || (suggestion.kind !== "rewrite" && suggestion.kind !== "skills")) {
    return false;
  }
  const block = suggestion.block_id ? findBlock(content, suggestion.block_id) : null;
  if (!block) return true;
  return comparable(block.fields[fieldOf(suggestion)]) !== comparable(suggestion.before?.value);
};

// Section ids (and block ids) the suggestion touches, for preview highlighting.
export const tailoringSuggestionTargets = (suggestion: TailoringSuggestion): string[] => {
  if (suggestion.block_id) return [suggestion.block_id];
  if (suggestion.kind === "new_section") {
    const section = sectionOf(suggestion);
    return section ? [section.id, ...section.blocks.map((block) => block.id)] : [];
  }
  if (suggestion.kind === "hide_section") return [String(suggestion.suggested.section_id ?? "")];
  if (suggestion.kind === "reorder") return (suggestion.suggested.section_order as string[] | undefined) ?? [];
  return [];
};

// Undo of an applied suggestion is blocked when the user edited that part afterwards.
export const isTailoringUndoBlocked = (content: CvContent, suggestion: TailoringSuggestion): boolean =>
  suggestion.status === "applied" && revertTailoringSuggestion(content, suggestion) === null;

// Which pending suggestions auto-apply may accept, in order. A suggestion is skipped when
// the user edited its target after it was generated (stale) or it no longer applies; each
// one is checked against the content as it will be after the earlier ones are applied.
export const planTailoringAutoApply = (
  content: CvContent,
  suggestions: TailoringSuggestion[]
): { accept: TailoringSuggestion[]; skipped: TailoringSuggestion[] } => {
  const accept: TailoringSuggestion[] = [];
  const skipped: TailoringSuggestion[] = [];
  const seen = new Set<string>();
  let working = content;
  for (const suggestion of suggestions) {
    if (suggestion.status !== "pending" || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    const next = isTailoringSuggestionStale(working, suggestion) ? null : applyTailoringSuggestion(working, suggestion);
    if (next) {
      accept.push(suggestion);
      working = next;
    } else {
      skipped.push(suggestion);
    }
  }
  return { accept, skipped };
};
