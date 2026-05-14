const SKILL_POOL_MAX_ITEMS = 20;

export interface SkillsPoolMetadata {
  items: string[];
  lastGeneratedAt: string | null;
  refreshCountDay: string;
  refreshCountValue: number;
  shuffleUsed: boolean;
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

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asTrimmedString(item))
    .filter((item) => item.length > 0);
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

const dedupeSkills = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(value);
    if (output.length >= SKILL_POOL_MAX_ITEMS) {
      break;
    }
  }

  return output;
};

export const clampSkillsPoolItems = (items: string[]): string[] => dedupeSkills(items);

export const parseSkillsPoolMetadata = (value: unknown): SkillsPoolMetadata => {
  const data = asRecord(value);
  const items = clampSkillsPoolItems(asStringArray(data.skillPoolItems));
  const lastGeneratedAt = asTrimmedString(data.skillPoolLastGeneratedAt) || null;
  const refreshCountDay = asTrimmedString(data.skillPoolRefreshCountDay);
  const refreshCountValue = asNonNegativeInt(data.skillPoolRefreshCountValue);
  const shuffleUsed = asBoolean(data.skillPoolShuffleUsed);

  return {
    items,
    lastGeneratedAt,
    refreshCountDay,
    refreshCountValue,
    shuffleUsed
  };
};

export const parseSkillsPoolMetadataFromBlockMeta = (value: unknown): SkillsPoolMetadata => {
  const meta = asRecord(value);
  const items = clampSkillsPoolItems(asStringArray(meta.skill_pool_items));
  const lastGeneratedAt = asTrimmedString(meta.skill_pool_last_generated_at) || null;
  const refreshCountDay = asTrimmedString(meta.skill_pool_refresh_count_day);
  const refreshCountValue = asNonNegativeInt(meta.skill_pool_refresh_count_value);
  const shuffleUsed = asBoolean(meta.skill_pool_shuffle_used);

  return {
    items,
    lastGeneratedAt,
    refreshCountDay,
    refreshCountValue,
    shuffleUsed
  };
};

export const buildSkillsPoolDataPatch = (meta: SkillsPoolMetadata): Record<string, unknown> => ({
  skillPoolItems: clampSkillsPoolItems(meta.items),
  skillPoolLastGeneratedAt: meta.lastGeneratedAt,
  skillPoolRefreshCountDay: meta.refreshCountDay,
  skillPoolRefreshCountValue: Math.max(0, Math.floor(meta.refreshCountValue)),
  skillPoolShuffleUsed: Boolean(meta.shuffleUsed)
});

export const buildSkillsPoolBlockMetaPatch = (meta: SkillsPoolMetadata): Record<string, unknown> => ({
  skill_pool_items: clampSkillsPoolItems(meta.items),
  skill_pool_last_generated_at: meta.lastGeneratedAt,
  skill_pool_refresh_count_day: meta.refreshCountDay,
  skill_pool_refresh_count_value: Math.max(0, Math.floor(meta.refreshCountValue)),
  skill_pool_shuffle_used: Boolean(meta.shuffleUsed)
});

export const parseSkillsPoolItemsFromSuggestedContent = (content: Record<string, unknown>): string[] => {
  const suggested = asRecord(content);
  const fields = asRecord(suggested.fields);
  const candidates = [...asStringArray(fields.skills), ...asStringArray(fields.items)];

  if (candidates.length === 0) {
    return [];
  }

  return clampSkillsPoolItems(candidates);
};

export const shuffleSkillsPoolItems = (items: string[]): string[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const rand = Math.floor(Math.random() * (index + 1));
    [next[index], next[rand]] = [next[rand], next[index]];
  }
  return next;
};

export const SKILLS_POOL_MAX_SIZE = SKILL_POOL_MAX_ITEMS;
