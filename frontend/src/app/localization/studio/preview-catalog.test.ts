import { afterEach, expect, it } from "vitest";
import { i18n, setLanguagePreview, translate } from "../i18n";
import { createLanguage } from "./language-catalog";
import { applyPreviewCatalog } from "./preview-catalog";

afterEach(async () => {
  setLanguagePreview(null);
  await i18n.changeLanguage("en");
});
it("previews a language outside the live registry and falls back for unfinished text", async () => {
  const language = createLanguage("de", "Deutsch");
  language.translations = { Save: "Speichern" };
  await applyPreviewCatalog(language, () => {});
  expect(i18n.language).toBe("de");
  expect(translate("Save")).toBe("Speichern");
  expect(translate("Cancel")).toBe("Cancel");
  language.translations = { Cancel: "Abbrechen" };
  await applyPreviewCatalog(language, () => {});
  expect(translate("Save")).toBe("Save");
  expect(translate("Cancel")).toBe("Abbrechen");
});
it("validates incoming drafts before changing the current preview", async () => {
  const language = createLanguage("fr", "Français");
  language.translations = { Save: "Enregistrer" };
  await applyPreviewCatalog(language, () => {});
  await expect(
    applyPreviewCatalog(
      { ...language, translations: { Save: { invalid: true } } },
      () => {},
    ),
  ).rejects.toThrow();
  expect(translate("Save")).toBe("Enregistrer");
});
