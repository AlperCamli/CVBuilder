import type { CvContent } from "../../integration/api-types";
import {
  TAILORING_ANSWER_ENTRIES_MAX,
  TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH,
  type TailoringAnswer,
  type TailoringAnswerEntry,
  type TailoringQuestion
} from "../../integration/tailoring-types";
import { listRefinableBlocks, type RefinableBlock } from "./tailoring-labels";

// The open number question ("Is there any number you'd like to add?"): the user adds up to
// five figures, each for one CV item. Pure helpers shared by the panel and the demo backend.

// Sections whose items the question is about, in CV order.
const METRIC_SECTION_KINDS = new Set(["experience", "projects", "volunteer"]);

// Items a figure can belong to: experience, project and volunteering items. A CV without any
// falls back to its other editable items (education, awards, …), never summary or skills.
export const openMetricBlockOptions = (content: CvContent): RefinableBlock[] => {
  const items = listRefinableBlocks(content).filter((block) => block.kind === "item");
  const preferred = items.filter((block) => METRIC_SECTION_KINDS.has(block.sectionKind));
  return preferred.length > 0 ? preferred : items;
};

// The server asks the open number question only when the CV has such an item.
export const hasOpenMetricTargets = (content: CvContent): boolean =>
  listRefinableBlocks(content).some((block) => block.kind === "item" && METRIC_SECTION_KINDS.has(block.sectionKind));

// Every editable item block id (what the server accepts as an entry target).
export const editableItemBlockIds = (content: CvContent): Set<string> =>
  new Set(listRefinableBlocks(content).filter((block) => block.kind === "item").map((block) => block.blockId));

// One row of the form. `key` keeps React rows stable while they are added and removed.
export interface OpenMetricDraft {
  key: string;
  target_block_id: string;
  detail: string;
}

export type OpenMetricProblem = "missing_block" | "unknown_block" | "too_long";

export interface OpenMetricBuildResult {
  entries: TailoringAnswerEntry[];
  // Per draft key; empty when the rows can be saved.
  problems: Record<string, OpenMetricProblem>;
}

const cleanDetail = (value: string): string => value.replace(/\s+/g, " ").trim();

// Rows → the answer's entries. Rows without text are left out (an empty form saves as
// "skipped"); rows with text need an item from `allowedBlockIds` and at most 300 characters.
export const buildOpenMetricEntries = (drafts: OpenMetricDraft[], allowedBlockIds: Iterable<string>): OpenMetricBuildResult => {
  const allowed = new Set(allowedBlockIds);
  const entries: TailoringAnswerEntry[] = [];
  const problems: Record<string, OpenMetricProblem> = {};
  for (const draft of drafts) {
    const detail = cleanDetail(draft.detail);
    if (!detail) continue;
    if (!draft.target_block_id) problems[draft.key] = "missing_block";
    else if (!allowed.has(draft.target_block_id)) problems[draft.key] = "unknown_block";
    else if (detail.length > TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH) problems[draft.key] = "too_long";
    else entries.push({ target_block_id: draft.target_block_id, detail });
  }
  return { entries: entries.slice(0, TAILORING_ANSWER_ENTRIES_MAX), problems };
};

// Validation of a request body's `entries` (mirrors the server; the demo backend uses it).
// Returns the normalized entries, or the 400 message.
export const validateAnswerEntries = (
  raw: unknown,
  editableBlockIds: Set<string>
): { entries: TailoringAnswerEntry[]; error: null } | { entries: null; error: string } => {
  if (!Array.isArray(raw)) return { entries: null, error: "entries must be a list." };
  if (raw.length > TAILORING_ANSWER_ENTRIES_MAX) {
    return { entries: null, error: `Add at most ${TAILORING_ANSWER_ENTRIES_MAX} numbers.` };
  }
  const entries: TailoringAnswerEntry[] = [];
  for (const item of raw) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const detail = typeof record.detail === "string" ? cleanDetail(record.detail) : "";
    const target = typeof record.target_block_id === "string" ? record.target_block_id : "";
    if (!detail || detail.length > TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH) {
      return { entries: null, error: `Each number needs a short description (1-${TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH} characters).` };
    }
    if (!editableBlockIds.has(target)) return { entries: null, error: "Each number must belong to an entry of your CV." };
    entries.push({ target_block_id: target, detail });
  }
  return { entries, error: null };
};

const entryKey = (entry: TailoringAnswerEntry) => `${entry.target_block_id}\u0000${entry.detail}`;

export const sameAnswerEntries = (left: TailoringAnswerEntry[] | undefined, right: TailoringAnswerEntry[] | undefined): boolean => {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((entry, index) => entryKey(entry) === entryKey(b[index]));
};

// Blocks whose figures differ between two answers (their rewrites must run again).
export const changedEntryBlockIds = (
  previous: TailoringAnswerEntry[] | undefined,
  next: TailoringAnswerEntry[] | undefined
): string[] => {
  const byBlock = (entries: TailoringAnswerEntry[] | undefined) => {
    const map = new Map<string, string[]>();
    for (const entry of entries ?? []) map.set(entry.target_block_id, [...(map.get(entry.target_block_id) ?? []), entry.detail]);
    return map;
  };
  const before = byBlock(previous);
  const after = byBlock(next);
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => (before.get(id) ?? []).join("\u0000") !== (after.get(id) ?? []).join("\u0000"));
};

// Figures the user gave for one block (open question entries).
export const entryDetailsForBlock = (answers: Record<string, TailoringAnswer>, blockId: string): string[] =>
  Object.values(answers).flatMap((answer) =>
    (answer.entries ?? []).filter((entry) => entry.target_block_id === blockId).map((entry) => entry.detail)
  );

// Yes/no questions first, then specific numbers, then the open number question.
const KIND_ORDER: Record<TailoringQuestion["kind"], number> = { gap: 0, metric: 1, metric_open: 2 };

export const orderTailoringQuestions = (questions: TailoringQuestion[]): TailoringQuestion[] =>
  questions
    .map((question, index) => ({ question, index }))
    .sort((left, right) => (KIND_ORDER[left.question.kind] ?? 1) - (KIND_ORDER[right.question.kind] ?? 1) || left.index - right.index)
    .map(({ question }) => question);

// A question counts as skipped when its saved answer carries nothing.
export const isSkippedAnswer = (question: TailoringQuestion, answer: TailoringAnswer | undefined): boolean => {
  if (!answer) return false;
  if (question.kind === "metric_open") return (answer.entries ?? []).length === 0;
  if (question.kind === "metric") return !answer.detail?.trim();
  return false;
};
