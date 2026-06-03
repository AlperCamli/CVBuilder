import type { CvBlock, CvContent } from "../../shared/cv-content/cv-content.types";

export const SKILLS_POOL_MAX_SIZE = 20;
export const SKILLS_POOL_REAL_REFRESH_DAILY_LIMIT = 2;

export interface SkillsPoolMetadata {
  skill_pool_items: string[];
  skill_pool_last_generated_at: string | null;
  skill_pool_refresh_count_day: string;
  skill_pool_refresh_count_value: number;
  skill_pool_shuffle_used: boolean;
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

const asBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
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

export const dedupeSkills = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(value);
    if (output.length >= SKILLS_POOL_MAX_SIZE) {
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
    skill_pool_refresh_count_value: asNonNegativeInt(meta.skill_pool_refresh_count_value),
    skill_pool_shuffle_used: asBoolean(meta.skill_pool_shuffle_used)
  };
};

export const extractPoolSkillsFromSuggestedBlock = (suggestedBlock: Record<string, unknown>): string[] => {
  const fields = asRecord(asRecord(suggestedBlock).fields);
  const values = [...asSkillArray(fields.skills), ...asSkillArray(fields.items)];
  return dedupeSkills(values);
};

export const collectSkillsPoolContext = (content: CvContent, currentBlock: CvBlock): SkillsPoolContext => {
  const currentFields = asRecord(currentBlock.fields);
  const existingSkills = dedupeSkills([
    ...asStringArray(currentFields.skills),
    ...asStringArray(currentFields.items)
  ]);

  const workExperienceDescriptions = content.sections
    .filter((section) => section.type === "experience")
    .flatMap((section) => [...section.blocks].sort((a, b) => a.order - b.order))
    .map((block) => asTrimmedString(asRecord(block.fields).description))
    .filter((item) => item.length > 0)
    .map((description, index) => ({
      label: `work experience ${index + 1}`,
      description
    }));

  const educationEntries = content.sections
    .filter((section) => section.type === "education")
    .flatMap((section) => [...section.blocks].sort((a, b) => a.order - b.order))
    .map((block) => {
      const fields = asRecord(block.fields);
      return {
        institution: asTrimmedString(fields.institution),
        degree: asTrimmedString(fields.degree),
        field_of_study: asTrimmedString(fields.field_of_study),
        description: asTrimmedString(fields.description)
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
    work_experience: workExperienceDescriptions,
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
  skill_pool_refresh_count_value: 0,
  skill_pool_shuffle_used: false
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
    skill_pool_refresh_count_value: refreshedCount,
    skill_pool_shuffle_used: true
  };
};
