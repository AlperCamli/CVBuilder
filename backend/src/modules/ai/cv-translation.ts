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
export interface TranslationNumberIssue {
  path: string;
  original_text: string;
  translated_text: string;
  original_numbers: string[];
  translated_numbers: string[];
  section_title?: string;
  block_title?: string;
  field_label?: string;
}
export const NUMBER_VERIFICATION_MESSAGE = "Some numbers could not be verified. Review the affected text below.";
export class TranslationNumberError extends ValidationError {
  constructor(public readonly issues: TranslationNumberIssue[]) {
    super(NUMBER_VERIFICATION_MESSAGE, { reason: "translation_numbers_unverified" });
  }
}
const numberTokens = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) ?? [];

/** The model translates wording; the backend retains the actual numeric literals. */
export function protectTranslationNumbers(expected: TranslationText[]) {
  const replacements = new Map<string, Array<{ marker: string; number: string }>>();
  const prefixes = new Map<string, string>();
  const markerId = (index: number): string => {
    let id = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) id = String.fromCharCode(65 + (n - 1) % 26) + id;
    return id;
  };
  const texts = expected.map(item => {
    let prefix = "[[CV_NUMBER_";
    while (item.text.includes(prefix)) prefix += "X";
    prefixes.set(item.path, prefix);
    const entries: Array<{ marker: string; number: string }> = [];
    const text = item.text.replace(/\d+(?:[.,]\d+)*/g, number => {
      const marker = `${prefix}${markerId(entries.length)}]]`;
      entries.push({ marker, number });
      return marker;
    });
    replacements.set(item.path, entries);
    return { path: item.path, text };
  });
  return {
    texts,
    restore(translated: TranslationText[]): TranslationText[] {
      return translated.map(item => {
        let text = item.text;
        for (const entry of replacements.get(item.path) ?? []) text = text.split(entry.marker).join(entry.number);
        const prefix = prefixes.get(item.path);
        if (prefix) {
          const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // Unknown markers cannot appear as implementation details in the preview.
          text = text.replace(new RegExp(`${escaped}[A-Z]+\\]\\]`, "g"), "?");
        }
        return { path: item.path, text };
      });
    },
  };
}

export function describeTranslationNumberIssues(source: CvContent, issues: TranslationNumberIssue[]): TranslationNumberIssue[] {
  const labels: Record<string, string> = { text: "Summary", description: "Description", role: "Job Title", job_title: "Job Title", degree: "Degree", skills: "Skills", notes: "Notes", title: "Title" };
  return issues.map(issue => {
    const parts = pathParts(issue.path);
    const section = source.sections[Number(parts[1])];
    const block = section?.blocks[Number(parts[3])];
    const title = block && ["role", "job_title", "title", "name", "degree"].map(key => block.fields[key]).find(value => typeof value === "string" && value.trim());
    return { ...issue, section_title: section?.title ?? section?.type, block_title: typeof title === "string" ? title : undefined, field_label: labels[parts[5]] ?? "Content" };
  });
}
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
  const issues: TranslationNumberIssue[] = [];
  for (const item of expected) {
    const text = map.get(item.path)!;
    // Compare numeric facts as a multiset: word order can change with language.
    const numbers = (value: string) => [...numberTokens(value)].sort();
    if (JSON.stringify(numbers(item.text)) !== JSON.stringify(numbers(text))) {
      issues.push({ path: item.path, original_text: item.text, translated_text: text, original_numbers: numberTokens(item.text), translated_numbers: numberTokens(text) });
    }
    const links = (value: string) => (value.match(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []).sort();
    if (JSON.stringify(links(item.text)) !== JSON.stringify(links(text))) {
      throw new ValidationError("Translation changed a link or email address");
    }
  }
  if (issues.length) throw new TranslationNumberError(issues);
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
