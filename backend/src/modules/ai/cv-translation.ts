import { z } from "zod";
import type { CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import { ValidationError } from "../../shared/errors/app-error";
import { detectCvLanguage } from "../../shared/localization/languages";
import type { CvLanguage } from "../cv-languages/cv-languages.repository";

export const translationOutputSchema = z.object({
  translations: z.array(z.object({ path: z.string(), text: z.string().min(1) }).strict()).max(2000),
}).strict();
export type TranslationText = { path: string; text: string };
export type TranslationBlock = { section_type: string; block_type: string; texts: TranslationText[] };
const headerTypes = new Set(["header", "contact", "contact_info", "personal_info"]);
export const isTranslationHeader = (type: string) => headerTypes.has(type.trim().toLowerCase());
const narrativeFields = new Set([
  "text", "description", "summary", "title", "role", "job_title", "degree",
  "field_of_study", "specialization", "qualification", "language", "proficiency",
  "skills", "notes", "position", "responsibilities", "achievements", "bullets",
  "highlights", "items", "tasks", "points",
]);
const escapePath = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const pathParts = (path: string) => path.split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"));

/** Only a block's translatable text is sent to the model, never metadata or fixed fields. */
export function translationBlocks(content: CvContent): TranslationBlock[] {
  const result: TranslationBlock[] = [];
  content.sections.forEach((section, index) => {
    if (isTranslationHeader(section.type)) return;
    section.blocks.forEach((block, blockIndex) => {
      if (isTranslationHeader(block.type)) return;
      const texts: TranslationText[] = [];
      function collect(value: CvJsonValue, path: string) {
        if (typeof value === "string" && value.trim()) texts.push({ path, text: value });
        else if (Array.isArray(value)) value.forEach((item, i) => collect(item, `${path}/${i}`));
        else if (value && typeof value === "object") {
          for (const [key, item] of Object.entries(value)) {
            if (narrativeFields.has(key)) collect(item, `${path}/${escapePath(key)}`);
          }
        }
      }
      for (const [key, value] of Object.entries(block.fields)) {
        if (narrativeFields.has(key)) collect(value, `sections/${index}/blocks/${blockIndex}/fields/${escapePath(key)}`);
      }
      if (texts.length) result.push({ section_type: section.type, block_type: block.type, texts });
    });
  });
  return result;
}

export function translationTexts(content: CvContent): TranslationText[] {
  return translationBlocks(content).flatMap(block => block.texts);
}

export function validateTranslationTexts(expected: TranslationText[], translated: TranslationText[]): void {
  const map = new Map(translated.map(item => [item.path, item.text]));
  if (map.size !== translated.length || map.size !== expected.length || expected.some(item => !map.get(item.path)?.trim())) {
    throw new ValidationError("AI returned an incomplete translation");
  }
  for (const item of expected) {
    const text = map.get(item.path)!;
    // Compare numeric facts as a multiset: word order can change with language.
    const numbers = (value: string) => (value.match(/\d+(?:[.,]\d+)*/g) ?? []).sort();
    if (JSON.stringify(numbers(item.text)) !== JSON.stringify(numbers(text))) {
      throw new ValidationError("Translation changed a numerical fact");
    }
    const links = (value: string) => (value.match(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []).sort();
    if (JSON.stringify(links(item.text)) !== JSON.stringify(links(text))) {
      throw new ValidationError("Translation changed a link or email address");
    }
  }
}

export function validateTranslationLanguage(translated: TranslationText[], language: string): void {
  // Retain the existing English/Turkish check when the result is conclusive.
  // Other document languages have no reliable detector in the current parser.
  const detected = detectCvLanguage(translated.map(item => item.text).join(" "));
  if (["en", "tr"].includes(language) && detected && detected !== language) {
    throw new ValidationError("Translation was not in the requested language");
  }
}

/** Reconstruct from the source and admin labels, never a model-authored CV. */
export function applyTranslation(source: CvContent, translated: TranslationText[], language: CvLanguage): CvContent {
  const expected = translationTexts(source);
  validateTranslationTexts(expected, translated);
  validateTranslationLanguage(translated, language.code);
  const map = new Map(translated.map(item => [item.path, item.text]));
  const next = structuredClone(source);
  for (const item of expected) {
    const parts = pathParts(item.path);
    let target: any = next;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)!] = map.get(item.path)!;
  }
  for (const section of next.sections) {
    if (isTranslationHeader(section.type)) continue;
    const type = section.type.trim().toLowerCase();
    if (Object.hasOwn(language.section_titles, type)) section.title = language.section_titles[type];
  }
  next.language = language.code;
  return next;
}
