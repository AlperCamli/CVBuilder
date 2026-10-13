import { i18n, setLanguagePreview } from "../i18n";
import { parseLanguage, SOURCE_CATALOG } from "./language-catalog";

export async function applyPreviewCatalog(
  value: unknown,
  observer: (key: string, result: string) => void,
) {
  const configuration = parseLanguage(value);
  setLanguagePreview(configuration.code, observer);
  // The language resolver retains this array; extend it without replacing it.
  const supported = i18n.options.supportedLngs;
  if (Array.isArray(supported) && !supported.includes(configuration.code))
    supported.push(configuration.code);
  const translations = Object.fromEntries(
    Object.entries(configuration.translations).filter(([, text]) =>
      text.trim(),
    ),
  );
  i18n.removeResourceBundle(configuration.code, "translation");
  i18n.addResourceBundle(
    configuration.code,
    "translation",
    { ...SOURCE_CATALOG, ...translations },
    false,
    true,
  );
  await i18n.changeLanguage(configuration.code);
  return configuration;
}
