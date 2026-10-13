import en from "../en.json";
import tr from "../tr.json";
import { defaultCvLanguageDraft, type CvLanguageDraft } from "./cv-language-catalog";

export const LANGUAGE_DRAFT_KEY = "cv-language-studio-v1";
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export interface LanguageConfiguration {
  version: 1;
  code: string;
  name: string;
  direction: "ltr" | "rtl";
  translations: Record<string, string>;
  reviewed: string[];
  cvDocument?: CvLanguageDraft;
}
export interface LanguageWorkspace {
  version: 1;
  kind: "cv-language-workspace";
  languages: LanguageConfiguration[];
  selectedLanguage: string;
}
export const BUILT_IN_CATALOGS: Record<string, Record<string, string>> = {
  en,
  tr,
};
export const SOURCE_CATALOG: Record<string, string> = en;
export const SOURCE_KEYS = Array.from(
  new Set([...Object.keys(en), ...Object.keys(tr)]),
);
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

export function languageCode(value: string): string {
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value))
    throw new Error("Use a language code such as tr, de, fr, ar, or pt-BR.");
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    throw new Error("This language code is not valid.");
  }
}
export function createLanguage(
  code: string,
  name: string,
  direction: "ltr" | "rtl" = "ltr",
): LanguageConfiguration {
  return {
    version: 1,
    code: languageCode(code),
    name: name.trim(),
    direction,
    translations: { ...(BUILT_IN_CATALOGS[code] ?? {}) },
    reviewed: [],
    cvDocument: defaultCvLanguageDraft(code),
  };
}
export function initialWorkspace(): LanguageWorkspace {
  return {
    version: 1,
    kind: "cv-language-workspace",
    languages: [
      createLanguage("en", "English"),
      createLanguage("tr", "Türkçe"),
    ],
    selectedLanguage: "tr",
  };
}
export function catalogKeys(config: LanguageConfiguration): string[] {
  return Array.from(
    new Set([...SOURCE_KEYS, ...Object.keys(config.translations)]),
  );
}
export function placeholders(text: string): string[] {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\{\{\s*-?\s*([^{}]+?)\s*\}\}/g), (match) =>
        match[1].trim(),
      ),
    ),
  ).sort();
}
export function placeholderProblem(key: string, text: string): string | null {
  if (!text.trim()) return null;
  const expected = placeholders(SOURCE_CATALOG[key] ?? key);
  const actual = placeholders(text);
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  if (!missing.length && !extra.length) return null;
  return [
    missing.length
      ? `Missing ${missing.map((value) => `{{${value}}}`).join(", ")}`
      : "",
    extra.length
      ? `Unknown ${extra.map((value) => `{{${value}}}`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function exportCatalog(
  config: LanguageConfiguration,
): Record<string, string> {
  const entries = Object.entries(config.translations).filter(([, value]) =>
    value.trim(),
  );
  if (entries.some(([key, value]) => placeholderProblem(key, value)))
    throw new Error(
      "Fix the placeholder warnings before exporting the catalog. Export workspace can back up unfinished work.",
    );
  return Object.fromEntries(entries);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseTranslations(value: unknown): Record<string, string> {
  if (!object(value) || Object.keys(value).length > 10000)
    throw new Error("Choose a flat JSON catalog containing text values.");
  for (const [key, text] of Object.entries(value)) {
    if (
      !key ||
      key.length > 4000 ||
      forbiddenKeys.has(key) ||
      typeof text !== "string" ||
      text.length > 12000
    )
      throw new Error(
        "Catalog keys and translations must be text. Nested objects and unsafe keys are not supported.",
      );
  }
  return Object.fromEntries(Object.entries(value)) as Record<string, string>;
}
export function parseLanguage(value: unknown): LanguageConfiguration {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.code !== "string" ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !["ltr", "rtl"].includes(String(value.direction))
  )
    throw new Error("Choose a Language Studio configuration (version 1).");
  const translations = parseTranslations(value.translations);
  let cvDocument = defaultCvLanguageDraft(value.code);
  if (value.cvDocument !== undefined) {
    if (!object(value.cvDocument) || typeof value.cvDocument.enabled !== "boolean") throw new Error("Invalid CV language settings.");
    const sectionTitles = parseTranslations(value.cvDocument.sectionTitles);
    if (Object.entries(sectionTitles).some(([type, title]) => !/^[a-z][a-z0-9_]{0,63}$/.test(type) || title.length > 160)) throw new Error("CV section headings must use section types and at most 160 characters.");
    cvDocument = { enabled: value.cvDocument.enabled, sectionTitles };
  }
  const reviewed = Array.isArray(value.reviewed)
    ? value.reviewed.filter(
        (key): key is string =>
          typeof key === "string" && Object.hasOwn(translations, key),
      )
    : [];
  return {
    version: 1,
    code: languageCode(value.code),
    name: value.name.trim(),
    direction: value.direction as "ltr" | "rtl",
    translations,
    reviewed: Array.from(new Set(reviewed)),
    cvDocument,
  };
}
export function parseWorkspace(value: unknown): LanguageWorkspace {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== "cv-language-workspace" ||
    !Array.isArray(value.languages) ||
    !value.languages.length ||
    value.languages.length > 40
  )
    throw new Error("Choose a Language Studio workspace (version 1).");
  const languages = value.languages.map(parseLanguage);
  if (
    new Set(languages.map((language) => language.code)).size !==
    languages.length
  )
    throw new Error("The workspace contains duplicate language codes.");
  return {
    version: 1,
    kind: "cv-language-workspace",
    languages,
    selectedLanguage:
      typeof value.selectedLanguage === "string" &&
      languages.some((language) => language.code === value.selectedLanguage)
        ? value.selectedLanguage
        : languages[0].code,
  };
}
export function importLanguageFile(
  text: string,
  current: LanguageConfiguration,
): LanguageConfiguration | LanguageWorkspace {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error("Choose a JSON file smaller than 2 MB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (object(value) && value.kind === "cv-language-workspace")
    return parseWorkspace(value);
  if (object(value) && value.version === 1 && object(value.translations))
    return parseLanguage(value);
  return { ...current, translations: parseTranslations(value), reviewed: [] };
}
