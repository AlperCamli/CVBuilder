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

// Deterministic rules around the tailoring model calls. The model judges; code enforces
// truthfulness and computes the score so the same inputs always give the same result.

const MAX_GAP_QUESTIONS = 6;
const MAX_METRIC_QUESTIONS = 3;

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

  const usedQuestionIds = new Set<string>();
  let gapCount = 0;
  let metricCount = 0;
  const questions: TailoringQuestion[] = [];
  for (const question of output.questions) {
    const requirementId = question.requirement_id
      ? requirementIdMap.get(question.requirement_id.trim()) ?? null
      : null;
    const targetBlockId = toBlockId(question.target_block_id);

    if (question.kind === "gap") {
      if (!requirementId || gapCount >= MAX_GAP_QUESTIONS) continue;
      gapCount += 1;
    } else {
      if (!targetBlockId || metricCount >= MAX_METRIC_QUESTIONS) continue;
      metricCount += 1;
    }

    questions.push({
      id: uniqueId(question.id, usedQuestionIds, "q"),
      kind: question.kind,
      text: question.text.trim(),
      requirement_id: requirementId,
      target_block_id: targetBlockId && editableBlockIds.has(targetBlockId) ? targetBlockId : null
    });
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
  const allowedNumbers = extractNumbers(context.source_texts.join("\n"));
  const sourceText = context.source_texts.join("\n");
  const forbidden = context.forbidden_terms.filter((term) => term && !containsTerm(sourceText, term));
  const kept: string[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const unsupported = [...extractNumbers(line)].filter((number) => !allowedNumbers.has(number));
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
