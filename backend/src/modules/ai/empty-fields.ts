import type { CvJsonValue } from "../../shared/cv-content/cv-content.types";

// Shared empty-field stripping for AI model payloads: drops id/_id keys, blank or
// UUID-like strings, non-finite numbers, and empty arrays/objects (recursively) so
// the model only sees meaningful content. Booleans are always kept.

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isEmptyValue = (value: CvJsonValue): boolean => {
  if (value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0 || UUID_LIKE_PATTERN.test(value.trim());
  }
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isEmptyValue(item));
  }

  return Object.keys(removeEmptyFields(value)).length === 0;
};

export const removeEmptyFields = (fields: Record<string, CvJsonValue>): Record<string, CvJsonValue> => {
  const next: Record<string, CvJsonValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (key === "id" || key.endsWith("_id")) {
      continue;
    }
    if (isEmptyValue(value)) {
      continue;
    }
    if (Array.isArray(value)) {
      const filtered = value.filter((item) => !isEmptyValue(item));
      if (filtered.length > 0) {
        next[key] = filtered;
      }
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const nested = removeEmptyFields(value);
      if (Object.keys(nested).length > 0) {
        next[key] = nested;
      }
      continue;
    }
    next[key] = value;
  }

  return next;
};
