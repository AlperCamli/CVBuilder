import type { CvBlock, CvContent } from "../../shared/cv-content/cv-content.types";

export const SKILLS_POOL_MAX_SIZE = 20;
export const TAILORED_SKILLS_MAX_SIZE = 24;
// Per-CV daily refresh cap for every plan; free plans are additionally gated by the monthly
// AI-action quota.
export const SKILLS_POOL_REAL_REFRESH_DAILY_LIMIT = 5;

export interface SkillsPoolMetadata {
  skill_pool_items: string[];
  skill_pool_last_generated_at: string | null;
  skill_pool_refresh_count_day: string;
  skill_pool_refresh_count_value: number;
}

export interface SkillsPoolWorkExperienceEntry {
  label: string;
  description: string;
}

export interface SkillsPoolEducationEntry {
  institution: string;
  degree: string;
  field_of_study: string;
  description: string;
}

export interface SkillsPoolContext {
  existing_skills: string[];
  current_pool: string[];
  summary: string;
  work_experience: SkillsPoolWorkExperienceEntry[];
  education: SkillsPoolEducationEntry[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asTrimmedString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
};

const asNonNegativeInt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asTrimmedString(item))
    .filter((item) => item.length > 0);
};

const splitSkillCandidate = (value: string): string[] => {
  const withoutLabel = value.replace(
    /^\s*(?:technical\s+skills|skills|tools|technologies)\s*[:\-]\s*/i,
    ""
  );

  return withoutLabel
    .split(/[\n;,|]+/)
    .map((item) => item.replace(/^[-•*]\s*/, "").trim())
    .filter((item) => item.length > 0);
};

const isAtomicSkill = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (/^(?:technical\s+skills|skills|tools|technologies|work\s+experience|experience|education|summary|professional\s+summary)$/i.test(normalized)) {
    return false;
  }

  if (normalized.length > 80) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 6) {
    return false;
  }

  if (/[.!?]$/.test(normalized)) {
    return false;
  }

  return true;
};

const asSkillArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    return splitSkillCandidate(value).filter(isAtomicSkill);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => splitSkillCandidate(asTrimmedString(item)))
    .filter(isAtomicSkill);
};

export const dedupeSkills = (values: string[], maxSize: number = SKILLS_POOL_MAX_SIZE): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    // Collapse surrounding/internal whitespace before comparing so "Machine  Learning" and
    // " Machine Learning" are treated as the same skill (case-insensitive), and store the
    // cleaned value.
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxSize) {
      break;
    }
  }

  return output;
};

export const toUtcDateKey = (now: Date): string => now.toISOString().slice(0, 10);

export const extractSkillsPoolMetadata = (metaInput: unknown): SkillsPoolMetadata => {
  const meta = asRecord(metaInput);

  return {
    skill_pool_items: dedupeSkills(asStringArray(meta.skill_pool_items)),
    skill_pool_last_generated_at: asTrimmedString(meta.skill_pool_last_generated_at) || null,
    skill_pool_refresh_count_day: asTrimmedString(meta.skill_pool_refresh_count_day),
    skill_pool_refresh_count_value: asNonNegativeInt(meta.skill_pool_refresh_count_value)
  };
};

// Case- and whitespace-insensitive key used to compare skills across the pool, the CV list,
// and freshly generated candidates.
export const skillComparisonKey = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

export const filterNewSkills = (candidates: string[], excluded: string[]): string[] => {
  const excludedKeys = new Set(excluded.map((item) => skillComparisonKey(item)));
  return candidates.filter((candidate) => !excludedKeys.has(skillComparisonKey(candidate)));
};

export const extractPoolSkillsFromSuggestedBlock = (suggestedBlock: Record<string, unknown>): string[] => {
  const fields = asRecord(asRecord(suggestedBlock).fields);
  const values = [...asSkillArray(fields.skills), ...asSkillArray(fields.items)];
  return dedupeSkills(values);
};

// Stored content is not guaranteed to use the editor's canonical type names — tailored drafts
// and imports carry variants like "work_experience", so section matching must normalize.
const EXPERIENCE_SECTION_TYPES = new Set([
  "experience",
  "work_experience",
  "professional_experience",
  "employment",
  "employment_history",
  "work_history",
  "career_history"
]);

const PROJECT_SECTION_TYPES = new Set([
  "projects",
  "project",
  "personal_projects",
  "side_projects",
  "key_projects"
]);

const EDUCATION_SECTION_TYPES = new Set([
  "education",
  "education_history",
  "academic_background",
  "academics"
]);

const SUMMARY_SECTION_TYPES = new Set([
  "summary",
  "professional_summary",
  "profile",
  "about",
  "about_me",
  "objective"
]);

const NARRATIVE_STRING_FIELD_KEYS = [
  "description",
  "text",
  "details",
  "summary",
  "achievements",
  "responsibilities",
  "notes"
];

const NARRATIVE_ARRAY_FIELD_KEYS = ["items", "bullets", "duties", "outcomes", "highlights"];

const ROLE_FIELD_KEYS = ["role", "title", "position", "degree"];
const ORGANIZATION_FIELD_KEYS = ["company", "organization", "employer", "institution", "name"];

const normalizeSectionTypeKey = (value: unknown): string =>
  asTrimmedString(value).toLowerCase().replace(/[\s-]+/g, "_");

const firstNonEmptyField = (fields: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = asTrimmedString(fields[key]);
    if (value) {
      return value;
    }
  }
  return "";
};

const collectBlockNarrative = (fieldsInput: unknown): string => {
  const fields = asRecord(fieldsInput);
  const parts: string[] = [];

  const role = firstNonEmptyField(fields, ROLE_FIELD_KEYS);
  const organization = firstNonEmptyField(fields, ORGANIZATION_FIELD_KEYS);
  const headline = [role, organization].filter(Boolean).join(" at ");
  if (headline) {
    parts.push(headline);
  }

  for (const key of NARRATIVE_STRING_FIELD_KEYS) {
    const value = asTrimmedString(fields[key]);
    if (value) {
      parts.push(value);
    }
  }
  for (const key of NARRATIVE_ARRAY_FIELD_KEYS) {
    const values = asStringArray(fields[key]);
    if (values.length > 0) {
      parts.push(values.join("\n"));
    }
  }

  return parts.join("\n").trim();
};

const sortedBlocksOfSections = (content: CvContent, types: Set<string>): CvBlock[] =>
  [...content.sections]
    .filter((section) => types.has(normalizeSectionTypeKey(section.type)))
    .sort((a, b) => a.order - b.order)
    .flatMap((section) => [...section.blocks].sort((a, b) => a.order - b.order));

export const collectSkillsPoolContext = (
  content: CvContent,
  currentBlock: CvBlock,
  currentPool: string[] = []
): SkillsPoolContext => {
  const currentFields = asRecord(currentBlock.fields);
  const existingSkills = dedupeSkills([
    ...asStringArray(currentFields.skills),
    ...asStringArray(currentFields.items)
  ]);

  const experienceEntries = sortedBlocksOfSections(content, EXPERIENCE_SECTION_TYPES)
    .map((block) => collectBlockNarrative(block.fields))
    .filter((item) => item.length > 0)
    .map((description, index) => ({
      label: `work experience ${index + 1}`,
      description
    }));

  const projectEntries = sortedBlocksOfSections(content, PROJECT_SECTION_TYPES)
    .map((block) => collectBlockNarrative(block.fields))
    .filter((item) => item.length > 0)
    .map((description, index) => ({
      label: `project ${index + 1}`,
      description
    }));

  const summary = sortedBlocksOfSections(content, SUMMARY_SECTION_TYPES)
    .map((block) => collectBlockNarrative(block.fields))
    .find((item) => item.length > 0) ?? "";

  const educationEntries = sortedBlocksOfSections(content, EDUCATION_SECTION_TYPES)
    .map((block) => {
      const fields = asRecord(block.fields);
      return {
        institution: asTrimmedString(fields.institution),
        degree: asTrimmedString(fields.degree),
        field_of_study: asTrimmedString(fields.field_of_study),
        description: collectBlockNarrative(fields)
      };
    })
    .filter(
      (item) =>
        item.institution.length > 0 ||
        item.degree.length > 0 ||
        item.field_of_study.length > 0 ||
        item.description.length > 0
    );

  return {
    existing_skills: existingSkills,
    current_pool: dedupeSkills(currentPool),
    summary,
    work_experience: [...experienceEntries, ...projectEntries],
    education: educationEntries
  };
};

export const buildSkillsPoolMetaForGeneration = (
  skills: string[],
  nowIso: string
): SkillsPoolMetadata => ({
  skill_pool_items: dedupeSkills(skills),
  skill_pool_last_generated_at: nowIso,
  skill_pool_refresh_count_day: "",
  skill_pool_refresh_count_value: 0
});

export const buildSkillsPoolMetaForRealRefresh = (
  previous: SkillsPoolMetadata,
  skills: string[],
  nowIso: string,
  utcDayKey: string
): SkillsPoolMetadata => {
  const refreshedCount =
    previous.skill_pool_refresh_count_day === utcDayKey ? previous.skill_pool_refresh_count_value + 1 : 1;

  return {
    skill_pool_items: dedupeSkills(skills),
    skill_pool_last_generated_at: nowIso,
    skill_pool_refresh_count_day: utcDayKey,
    skill_pool_refresh_count_value: refreshedCount
  };
};
