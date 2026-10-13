import { detectCvLanguage } from "../../shared/localization/languages";
import { z } from "zod";
import type {
  CvContent,
  CvJsonValue,
} from "../../shared/cv-content/cv-content.types";
import { ValidationError } from "../../shared/errors/app-error";

export const translationOutputSchema = z
  .object({
    translations: z
      .array(z.object({ path: z.string(), text: z.string() }).strict())
      .max(2000),
  })
  .strict();
export type TranslationText = { path: string; text: string };
const narrativeFields = new Set([
  "text",
  "description",
  "summary",
  "title",
  "role",
  "job_title",
  "degree",
  "field_of_study",
  "specialization",
  "qualification",
  "language",
  "proficiency",
  "skills",
  "notes",
  "headline",
  "position",
  "responsibilities",
  "achievements",
  "bullets",
  "highlights",
  "items",
  "tasks",
  "points",
]);

export function translationTexts(content: CvContent): TranslationText[] {
  const result: TranslationText[] = [];
  function collect(value: CvJsonValue, path: string) {
    if (typeof value === "string" && value.trim())
      result.push({ path, text: value });
    else if (Array.isArray(value))
      value.forEach((item, index) => collect(item, `${path}/${index}`));
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        if (narrativeFields.has(key)) collect(item, `${path}/${key}`);
  }
  if (typeof content.metadata.headline === "string")
    collect(content.metadata.headline, "metadata/headline");
  content.sections.forEach((section, index) => {
    if (section.title)
      result.push({ path: `sections/${index}/title`, text: section.title });
    section.blocks.forEach((block, blockIndex) => {
      for (const [key, value] of Object.entries(block.fields))
        if (narrativeFields.has(key))
          collect(
            value,
            `sections/${index}/blocks/${blockIndex}/fields/${key}`,
          );
    });
  });
  return result;
}

/** Reconstruct from the source, never from a model-authored CV or model-authored paths. */
export function applyTranslation(
  source: CvContent,
  translated: TranslationText[],
  language: "en" | "tr",
): CvContent {
  const expected = translationTexts(source);
  const map = new Map(translated.map((item) => [item.path, item.text]));
  if (
    map.size !== translated.length ||
    map.size !== expected.length ||
    expected.some((item) => !map.get(item.path)?.trim())
  )
    throw new ValidationError("AI returned an incomplete translation");
  const next = structuredClone(source);
  for (const item of expected) {
    const text = map.get(item.path)!;
    // Numeric facts must survive translation exactly.
    const numbers = (value: string) => value.match(/\d+(?:[.,]\d+)*/g) ?? [];
    if (JSON.stringify(numbers(item.text)) !== JSON.stringify(numbers(text)))
      throw new ValidationError("Translation changed a numerical fact");
    const parts = item.path.split("/");
    let target: any = next;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)!] = text;
  }
  const detected = detectCvLanguage(
    translated.map((item) => item.text).join(" "),
  );
  if (detected && detected !== language)
    throw new ValidationError("Translation was not in the requested language");
  next.language = language;
  return next;
}
