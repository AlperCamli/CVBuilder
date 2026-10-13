import type { CvContent } from "./api-types";

export const resolveScaleFromMetadata = (
  content: CvContent | null | undefined,
  key: string,
  clamp: (value: number) => number,
): number => {
  const rawValue = content?.metadata?.[key];
  const value = typeof rawValue === "string" ? Number.parseFloat(rawValue) : rawValue;
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : 1;
};
