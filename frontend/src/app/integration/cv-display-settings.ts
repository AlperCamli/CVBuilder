import type { CvContent } from "./api-types";

export const FONT_SCALE_MIN = 0.5;
export const FONT_SCALE_MAX = 1.15;
export const SPACING_SCALE_MIN = 0.2;
export const SPACING_SCALE_MAX = 1.4;
export const LAYOUT_SCALE_MIN = 0.2;
export const LAYOUT_SCALE_MAX = 1.3;

interface DisplayScales {
  fontScale: number;
  spacingScale: number;
  layoutScale: number;
}

// Reduce whitespace before text size. Integer rounding avoids slider drift.
export const nextCompactScales = (current: DisplayScales, fontFirst = false): DisplayScales | null => {
  const adjustments = [
    ["spacingScale", SPACING_SCALE_MIN, 0.08],
    ["layoutScale", LAYOUT_SCALE_MIN, 0.08],
    ["fontScale", FONT_SCALE_MIN, 0.02],
  ] as const;
  const ordered = fontFirst ? [adjustments[2], adjustments[0], adjustments[1]] : adjustments;
  for (const [key, min, step] of ordered) {
    if (current[key] > min) {
      return { ...current, [key]: Math.max(min, Math.round((current[key] - step) * 100) / 100) };
    }
  }
  return null;
};

export const resolveSourcePageCount = (content: CvContent | null | undefined): number | null => {
  const raw = content?.metadata?.source_page_count;
  const count = typeof raw === "string" ? Number(raw) : raw;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : null;
};

export const resolveScaleFromMetadata = (
  content: CvContent | null | undefined,
  key: string,
  clamp: (value: number) => number,
): number => {
  const rawValue = content?.metadata?.[key];
  const value = typeof rawValue === "string" ? Number.parseFloat(rawValue) : rawValue;
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : 1;
};
