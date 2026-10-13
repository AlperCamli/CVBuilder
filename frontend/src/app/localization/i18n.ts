import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import tr from "./tr.json";
import { DESIGN_TOOLS_ENABLED } from "../design-tools";

export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "tr", name: "Türkçe", flag: "🇹🇷" },
] as const;
export type Locale = (typeof LANGUAGES)[number]["code"];
export function documentLocale(language: string): Locale | null {
  const code = language.toLowerCase().replace(/_/g, "-").split("-")[0];
  return LANGUAGES.some((language) => language.code === code)
    ? (code as Locale)
    : null;
}
export const LOCALE_STORAGE_KEY = "cv-interface-locale";
let reviewLanguage: string | null = null;
let translationObserver: ((key: string, result: string) => void) | null = null;
/** Review frames never persist locale or synchronize it to the account. */
export function setLanguagePreview(
  language: string | null,
  observer: ((key: string, result: string) => void) | null = null,
) {
  if (!DESIGN_TOOLS_ENABLED) return;
  reviewLanguage = language;
  translationObserver = observer;
}
export const isLanguagePreview = () => reviewLanguage !== null;
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng:
    typeof window !== "undefined" &&
    /^\/tr(?:\/|$)/.test(window.location.pathname)
      ? "tr"
      : "en",
  fallbackLng: "en",
  supportedLngs: LANGUAGES.map((l) => l.code),
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
export function readLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return value === "en" || value === "tr" ? value : null;
  } catch {
    return null;
  }
}
export function pendingLocale(): Locale | null {
  if (isLanguagePreview()) return null;
  try {
    return localStorage.getItem("cv-locale-needs-sync") === "1"
      ? readLocale()
      : null;
  } catch {
    return null;
  }
}
export function clearPendingLocale() {
  try {
    localStorage.removeItem("cv-locale-needs-sync");
  } catch {
    /* optional browser storage */
  }
}
export function chooseLocale(locale: Locale, explicit = true) {
  if (isLanguagePreview()) return;
  try {
    if (explicit) localStorage.setItem("cv-locale-needs-sync", "1");
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `cv_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* preference still works for this session */
  }
  void i18n.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("cv-locale-changed", { detail: locale }),
    );
}
export const translate = (
  text: string,
  values?: Record<string, unknown>,
): string => {
  const result = String(i18n.t(text, { ...values, defaultValue: text }));
  translationObserver?.(text, result);
  return result;
};
export function translateInLocale(text: string, locale: Locale): string {
  const result = String(i18n.t(text, { lng: locale, defaultValue: text }));
  translationObserver?.(text, result);
  return result;
}
export const localeCode = () => {
  if (i18n.language === "tr") return "tr-TR";
  if (i18n.language === "en") return "en-US";
  try {
    return Intl.getCanonicalLocales(i18n.language)[0];
  } catch {
    return "en-US";
  }
};
export const publicPath = (
  path: string,
  locale: Locale = i18n.language === "tr" ? "tr" : "en",
) =>
  locale === "tr" && (path === "/" || path === "/pricing")
    ? `/tr${path === "/" ? "" : path}`
    : path;
