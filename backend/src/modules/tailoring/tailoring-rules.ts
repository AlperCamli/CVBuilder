import { EXPERIENCE_LIKE_SECTION_TYPES } from "../../shared/cv-content/narrative-fields";
import type { CompactCv } from "./tailoring-compact-cv";
import type {
  RequirementDecision,
  RequirementStatus,
  TailoringAnalysis,
  TailoringAnswer,
  TailoringQuestion,
  TailoringRequirement,
  TailoringScore,
  TailoringSuggestionRecord
} from "./tailoring.types";
import { OPEN_METRIC_QUESTION_ID } from "./tailoring.types";

// Deterministic rules around the tailoring model calls. The model judges; code enforces
// truthfulness and computes the score so the same inputs always give the same result.

// Few, specific questions: a gap question only for a must-have the CV does not show yet,
// aimed at the block whose rewrite the answer changes; a number question only for the most
// job-relevant work blocks, one per block. The open number question is added by code.
export const MAX_GAP_QUESTIONS = 3;
export const MAX_METRIC_QUESTIONS = 2;
// English placeholder; the panel shows its own translated text for this question.
export const OPEN_METRIC_QUESTION_TEXT = "Is there any number you'd like to add to your experience?";

// The open number question is offered when the CV has work the candidate can quantify.
export const hasOpenMetricTargets = (compact: CompactCv): boolean =>
  compact.blocks.some((block) => block.kind === "item" && block.editable_field !== null && EXPERIENCE_LIKE_SECTION_TYPES.has(block.section_type));

export const openMetricQuestion = (): TailoringQuestion => ({
  id: OPEN_METRIC_QUESTION_ID,
  kind: "metric_open",
  text: OPEN_METRIC_QUESTION_TEXT,
  requirement_id: null,
  target_block_id: null
});

const normalizeText = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const containsTerm = (text: string, term: string): boolean => {
  const needle = normalizeText(term);
  if (!needle) {
    return false;
  }
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#])${escapeRegExp(needle)}(?=$|[^\\p{L}\\p{N}+#])`, "u").test(
    normalizeText(text)
  );
};

const uniqueId = (raw: string, used: Set<string>, prefix: string): string => {
  let id = raw.trim();
  let counter = used.size + 1;
  while (!id || used.has(id)) {
    id = `${prefix}${counter}`;
    counter += 1;
  }
  used.add(id);
  return id;
};

// Translates the model's aliases to real block ids and drops anything that does not point
// at the CV the model was given.
export const normalizeAnalysisOutput = (
  output: TailoringAnalysis,
  compact: CompactCv
): TailoringAnalysis => {
  const toBlockId = (alias: string | null): string | null =>
    alias ? compact.alias_to_block_id[alias.trim()] ?? null : null;
  const editableBlockIds = new Set(
    compact.blocks.filter((block) => block.kind === "item" || block.kind === "summary").map((block) => block.block_id)
  );
  const itemBlockIds = new Set(compact.blocks.filter((block) => block.kind === "item").map((block) => block.block_id));

  const usedRequirementIds = new Set<string>();
  const requirementIdMap = new Map<string, string>();
  const requirements: TailoringRequirement[] = output.requirements.map((requirement) => {
    const id = uniqueId(requirement.id, usedRequirementIds, "r");
    // A repeated model id keeps pointing at its first requirement.
    if (!requirementIdMap.has(requirement.id.trim())) {
      requirementIdMap.set(requirement.id.trim(), id);
    }
    return {
      id,
      text: requirement.text.trim(),
      keywords: [...new Set(requirement.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
      importance: requirement.importance,
      weight: Math.min(3, Math.max(1, Math.round(requirement.weight))),
      status: requirement.status,
      confidence: requirement.confidence,
      evidence_block_ids: [
        ...new Set(
          requirement.evidence_block_ids
            .map((alias) => toBlockId(alias))
            .filter((value): value is string => Boolean(value))
        )
      ],
      reason: requirement.reason.trim()
    };
  });

  const usedQuestionIds = new Set<string>([OPEN_METRIC_QUESTION_ID]);
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const gapRequirementIds = new Set<string>();
  const metricBlockIds = new Set<string>();
  const questions: TailoringQuestion[] = [];
  for (const question of output.questions) {
    const requirementId = question.requirement_id
      ? requirementIdMap.get(question.requirement_id.trim()) ?? null
      : null;
    const targetBlockId = toBlockId(question.target_block_id);

    if (question.kind === "gap") {
      // Only a must-have the CV does not already show, once, for a block whose rewrite the
      // answer changes.
      const requirement = requirementId ? requirementById.get(requirementId) : undefined;
      if (
        !requirement ||
        requirement.importance !== "must" ||
        requirement.status === "covered" ||
        !targetBlockId ||
        !editableBlockIds.has(targetBlockId) ||
        gapRequirementIds.has(requirement.id) ||
        gapRequirementIds.size >= MAX_GAP_QUESTIONS
      ) {
        continue;
      }
      gapRequirementIds.add(requirement.id);
    } else if (question.kind === "metric") {
      // About one work block's actual work, at most one per block.
      if (
        !targetBlockId ||
        !itemBlockIds.has(targetBlockId) ||
        metricBlockIds.has(targetBlockId) ||
        metricBlockIds.size >= MAX_METRIC_QUESTIONS
      ) {
        continue;
      }
      metricBlockIds.add(targetBlockId);
    } else {
      continue;
    }

    questions.push({
      id: uniqueId(question.id, usedQuestionIds, "q"),
      kind: question.kind,
      text: question.text.trim(),
      requirement_id: requirementId,
      target_block_id: targetBlockId
    });
  }
  if (hasOpenMetricTargets(compact)) {
    questions.push(openMetricQuestion());
  }

  const seenBriefBlocks = new Set<string>();
  const blockBriefs = output.block_briefs.flatMap((brief) => {
    const blockId = toBlockId(brief.block_id);
    if (!blockId || !editableBlockIds.has(blockId) || seenBriefBlocks.has(blockId)) {
      return [];
    }
    seenBriefBlocks.add(blockId);
    return [
      {
        block_id: blockId,
        requirement_ids: brief.requirement_ids
          .map((id) => requirementIdMap.get(id.trim()))
          .filter((value): value is string => Boolean(value)),
        focus: brief.focus.trim(),
        terms: brief.terms.map((term) => term.trim()).filter(Boolean),
        avoid: brief.avoid.trim()
      }
    ];
  });

  return {
    role_summary: output.role_summary.trim(),
    requirements,
    questions,
    block_briefs: blockBriefs
  };
};

// ---------------------------------------------------------------------------
// Truth guards
// ---------------------------------------------------------------------------

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

const normalizeNumber = (raw: string): string => raw.replace(/,(?=\d{3}\b)/g, "").replace(/,/g, ".");

export const extractNumbers = (text: string): Set<string> =>
  new Set((text.match(NUMBER_RE) ?? []).map(normalizeNumber));

// A number with an optional magnitude word right after it ("1.5K", "2 million", "3 bin").
// Case-sensitive on purpose: a lone "m" or "b" is usually a unit (metres, bytes), so only
// "M" / "B" count as million / billion.
const NUMBER_TOKEN_RE =
  /(\d+(?:[.,]\d+)*)(?:\s?(K|k|M|Mn|mn|MM|B|Bn|bn|thousand|million|billion|bin|milyon|milyar|Mio|Mrd)(?![\p{L}\p{N}]))?/gu;

const MAGNITUDE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  bin: 1e3,
  m: 1e6,
  mn: 1e6,
  mm: 1e6,
  million: 1e6,
  milyon: 1e6,
  mio: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  milyar: 1e9,
  mrd: 1e9
};

const canonicalValue = (value: number): string => String(Math.round(value * 1e6) / 1e6);

// Every value a written number can mean: "1,500" and "1.500" (Turkish/German thousands) are
// 1500, "1.5" / "1,5" (decimal comma) are 1.5; "1.500" is ambiguous and yields both.
const numberReadings = (raw: string): number[] => {
  const separators = raw.match(/[.,]/g) ?? [];
  if (separators.length === 0) return [Number(raw)];
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  if (hasDot && hasComma) {
    // The last separator is the decimal one, the others group thousands.
    const decimal = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    return [Number(raw.split(grouping).join("").replace(decimal, "."))];
  }
  const separator = hasDot ? "." : ",";
  const readings: number[] = [];
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) {
    readings.push(Number(raw.split(separator).join("")));
  }
  if (separators.length === 1) {
    readings.push(Number(raw.replace(separator, ".")));
  }
  return readings.filter((value) => Number.isFinite(value));
};

interface NumberToken {
  // Written form (thousands commas dropped), with its magnitude word when it has one.
  raw: string;
  base_raw: string;
  // Values it means, with and without its magnitude word.
  values: string[];
  base_values: string[];
  scaled: boolean;
}

const numberTokens = (text: string): NumberToken[] =>
  [...text.matchAll(NUMBER_TOKEN_RE)].map((match) => {
    const digits = match[1];
    const suffix = match[2]?.toLowerCase() ?? "";
    const multiplier = suffix ? MAGNITUDE[suffix] ?? 1 : 1;
    const readings = numberReadings(digits);
    const baseRaw = normalizeNumber(digits);
    return {
      raw: `${baseRaw}${suffix}`,
      base_raw: baseRaw,
      values: readings.map((value) => canonicalValue(value * multiplier)),
      base_values: readings.map((value) => canonicalValue(value)),
      scaled: Boolean(suffix)
    };
  });

export interface AllowedNumbers {
  raw: Set<string>;
  values: Set<string>;
}

// Numbers the sources allow, by written form and by value, so the candidate's "1.5K" also
// licenses "1,500", "1.500" (Turkish thousands) licenses "1500" and "%30" licenses "30 %".
// A source number licenses its plain digits too ("1.5K" -> "1.5", as before). Only equal
// values pass: a number whose value is not in the sources is still rejected.
export const allowedNumberSet = (texts: string[]): AllowedNumbers => {
  const raw = new Set<string>();
  const values = new Set<string>();
  for (const token of numberTokens(texts.join("\n"))) {
    raw.add(token.raw);
    raw.add(token.base_raw);
    for (const value of [...token.values, ...token.base_values]) values.add(value);
  }
  return { raw, values };
};

// Numbers in a generated line that the sources do not support. A scaled number ("2K") is
// judged by its scaled value only, so "2" in a source never licenses "2K".
export const unsupportedNumbers = (line: string, allowed: AllowedNumbers): string[] =>
  numberTokens(line)
    .filter((token) => !allowed.raw.has(token.raw) && !token.values.some((value) => allowed.values.has(value)))
    .map((token) => token.raw);

export interface LineGuardContext {
  // Text the candidate already wrote or confirmed; numbers in it are allowed.
  source_texts: string[];
  // Terms the candidate said they do not have; they may not be introduced.
  forbidden_terms: string[];
}

export interface LineGuardResult {
  lines: string[];
  notes: string[];
}

export const guardGeneratedLines = (lines: string[], context: LineGuardContext): LineGuardResult => {
  const allowedNumbers = allowedNumberSet(context.source_texts);
  const sourceText = context.source_texts.join("\n");
  const forbidden = context.forbidden_terms.filter((term) => term && !containsTerm(sourceText, term));
  const kept: string[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const unsupported = unsupportedNumbers(line, allowedNumbers);
    if (unsupported.length > 0) {
      notes.push(`Removed a line with numbers not in your CV or answers (${unsupported.join(", ")}).`);
      continue;
    }

    const forbiddenHit = forbidden.find((term) => containsTerm(line, term));
    if (forbiddenHit) {
      notes.push(`Removed a line mentioning "${forbiddenHit}", which you said you don't have.`);
      continue;
    }

    kept.push(line);
  }

  return { lines: kept, notes };
};

export interface SkillsGuardContext {
  current_skills: string[];
  // Requirement keywords as written in the job description (job language).
  allowed_new_skills: string[];
  cv_text: string;
  forbidden_terms: string[];
  max_skills: number;
}

// A skill from the model. allowed_skill names the allowed_new_skills entry a new skill
// renders, so a correct translation into the CV language is not mistaken for an invention.
export interface GeneratedSkill {
  name: string;
  allowed_skill: string | null;
}

export const guardSkills = (skills: GeneratedSkill[], context: SkillsGuardContext): LineGuardResult => {
  const currentKeys = new Set(context.current_skills.map(normalizeText));
  const allowedKeys = new Set(context.allowed_new_skills.map(normalizeText));
  const forbiddenKeys = new Set(context.forbidden_terms.map(normalizeText));
  // Each allowed entry supports one new skill, so a reference cannot license many inventions.
  const usedAllowed = new Set<string>();
  const seen = new Set<string>();
  const kept: string[] = [];
  const notes: string[] = [];

  for (const item of skills) {
    const skill = item.name.trim();
    const key = normalizeText(skill);
    if (!key || seen.has(key)) continue;

    if (!currentKeys.has(key)) {
      const refKey = item.allowed_skill ? normalizeText(item.allowed_skill) : "";
      if (forbiddenKeys.has(key) || (refKey && forbiddenKeys.has(refKey))) {
        notes.push(`Skipped "${skill}", which you said you don't have.`);
        continue;
      }
      if (refKey && allowedKeys.has(refKey) && !usedAllowed.has(refKey)) {
        usedAllowed.add(refKey);
      } else if (allowedKeys.has(key) && !usedAllowed.has(key)) {
        usedAllowed.add(key);
      } else if (!containsTerm(context.cv_text, skill)) {
        notes.push(`Skipped "${skill}" because nothing in your CV supports it.`);
        continue;
      }
    }

    seen.add(key);
    kept.push(skill);
    if (kept.length >= context.max_skills) break;
  }

  return { lines: kept, notes };
};

// Terms from requirements whose gap question was answered "no".
export const forbiddenTermsFromAnswers = (
  analysis: TailoringAnalysis,
  answers: Record<string, TailoringAnswer>
): string[] => {
  const deniedRequirementIds = new Set(
    analysis.questions
      .filter((question) => question.kind === "gap" && answers[question.id]?.answer === "no")
      .map((question) => question.requirement_id)
      .filter((value): value is string => Boolean(value))
  );

  return analysis.requirements
    .filter((requirement) => deniedRequirementIds.has(requirement.id))
    .flatMap((requirement) => requirement.keywords);
};

export const answerForRequirement = (
  analysis: TailoringAnalysis,
  answers: Record<string, TailoringAnswer>,
  requirementId: string
): TailoringAnswer | null => {
  const question = analysis.questions.find(
    (item) => item.kind === "gap" && item.requirement_id === requirementId
  );
  return question ? answers[question.id] ?? null : null;
};

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const STATUS_VALUE: Record<RequirementStatus, number> = { covered: 1, weak: 0.5, missing: 0 };

const requirementWeight = (requirement: TailoringRequirement): number =>
  requirement.weight * (requirement.importance === "must" ? 2 : 1);

const upgradedStatus = (
  base: RequirementStatus,
  answer: TailoringAnswer | null
): RequirementStatus => {
  if (base === "covered") return "covered";
  if (answer?.answer === "no") return base;
  if (base === "weak") return "covered";
  // A missing requirement is only fully covered when the candidate confirmed it.
  return answer?.answer === "yes" ? "covered" : "weak";
};

const scoreFor = (
  requirements: TailoringRequirement[],
  statusOf: (requirement: TailoringRequirement) => RequirementStatus
): number | null => {
  const totalWeight = requirements.reduce((sum, requirement) => sum + requirementWeight(requirement), 0);
  if (totalWeight === 0) {
    return null;
  }
  const earned = requirements.reduce(
    (sum, requirement) => sum + requirementWeight(requirement) * STATUS_VALUE[statusOf(requirement)],
    0
  );
  return Math.round((100 * earned) / totalWeight);
};

export const computeTailoringScore = (
  analysis: TailoringAnalysis | null,
  decisions: Record<string, RequirementDecision>,
  answers: Record<string, TailoringAnswer>,
  suggestions: Pick<TailoringSuggestionRecord, "status" | "requirement_ids">[]
): TailoringScore => {
  if (!analysis) {
    return { initial: null, current: null, potential: null };
  }

  const relevant = analysis.requirements.filter((requirement) => decisions[requirement.id] !== "not_relevant");
  const addressedBy = (statuses: Set<string>) => {
    const ids = new Set<string>();
    for (const suggestion of suggestions) {
      if (statuses.has(suggestion.status)) {
        for (const id of suggestion.requirement_ids) ids.add(id);
      }
    }
    return ids;
  };
  const applied = addressedBy(new Set(["applied"]));
  const appliedOrPending = addressedBy(new Set(["applied", "pending"]));

  const statusWith = (addressed: Set<string>) => (requirement: TailoringRequirement): RequirementStatus =>
    addressed.has(requirement.id)
      ? upgradedStatus(requirement.status, answerForRequirement(analysis, answers, requirement.id))
      : requirement.status;

  return {
    initial: scoreFor(relevant, (requirement) => requirement.status),
    current: scoreFor(relevant, statusWith(applied)),
    potential: scoreFor(relevant, statusWith(appliedOrPending))
  };
};
