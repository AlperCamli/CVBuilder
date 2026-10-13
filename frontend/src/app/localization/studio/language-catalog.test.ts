import { describe, expect, it } from "vitest";
import {
  catalogKeys,
  createLanguage,
  exportCatalog,
  importLanguageFile,
  initialWorkspace,
  parseWorkspace,
  placeholderProblem,
} from "./language-catalog";

describe("Language Studio catalogs", () => {
  it("round-trips Turkish Unicode and reviewed entries in a workspace", () => {
    const workspace = initialWorkspace();
    const tr = workspace.languages.find((language) => language.code === "tr")!;
    tr.translations.Save = "Değişiklikleri kaydet — ıİğĞşŞöÖüÜçÇ";
    tr.reviewed = ["Save"];
    expect(parseWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(
      workspace,
    );
    expect(exportCatalog(tr).Save).toBe(tr.translations.Save);
  });
  it("imports a flat app catalog into the selected language and preserves source keys", () => {
    const tr = createLanguage("tr", "Türkçe");
    const result = importLanguageFile(
      JSON.stringify({ Save: "Kaydet", Cancel: "Vazgeç" }),
      tr,
    );
    expect(result).toMatchObject({
      code: "tr",
      translations: { Save: "Kaydet", Cancel: "Vazgeç" },
    });
    expect("kind" in result).toBe(false);
    if ("kind" in result) throw new Error("Expected a catalog");
    expect(catalogKeys(result)).toContain("Tailor your CV to any");
    expect(exportCatalog(result)).toEqual({ Save: "Kaydet", Cancel: "Vazgeç" });
  });
  it("creates future languages without registering or changing a production locale", () => {
    const language = createLanguage("pt-br", "Português");
    expect(language.code).toBe("pt-BR");
    expect(language.translations).toEqual({});
    expect(catalogKeys(language).length).toBeGreaterThan(1400);
    expect(createLanguage("ar", "العربية", "rtl").direction).toBe("rtl");
    expect(() => createLanguage("../../secret", "Invalid")).toThrow(
      /language code/,
    );
  });
  it("allows reordered placeholders and rejects missing or invented variables at export", () => {
    const key =
      "Save {{saving}}/week ({{percent}}%) vs Weekly · Rounded equivalents, 52 weeks/year.";
    expect(
      placeholderProblem(key, "%{{percent}} tasarruf: haftada {{saving}}"),
    ).toBeNull();
    expect(placeholderProblem(key, "%{{percent}} tasarruf")).toContain(
      "{{saving}}",
    );
    expect(placeholderProblem(key, "{{price}} tasarruf")).toContain(
      "Unknown {{price}}",
    );
    const language = createLanguage("de", "Deutsch");
    language.translations[key] = "{{price}} sparen";
    expect(() => exportCatalog(language)).toThrow(/placeholder/);
    expect(
      parseWorkspace({
        ...initialWorkspace(),
        languages: [language],
        selectedLanguage: "de",
      }).languages[0].translations[key],
    ).toBe("{{price}} sparen");
  });
  it("omits empty translations so i18next can use English fallback", () => {
    const language = createLanguage("de", "Deutsch");
    language.translations = { Save: "Speichern", Cancel: "   " };
    expect(exportCatalog(language)).toEqual({ Save: "Speichern" });
  });
  it("rejects unsafe, nested, oversized, and invalid JSON imports without touching the current draft", () => {
    const tr = createLanguage("tr", "Türkçe");
    const before = JSON.stringify(tr);
    for (const text of [
      '{"__proto__":"unsafe"}',
      '{"Save":{"nested":"text"}}',
      '{"Save":123}',
      "{invalid}",
      JSON.stringify({ Save: "x".repeat(12001) }),
    ])
      expect(() => importLanguageFile(text, tr)).toThrow();
    expect(JSON.stringify(tr)).toBe(before);
  });
  it("rejects duplicate workspace languages and drops invalid review marks", () => {
    const workspace = initialWorkspace();
    expect(() =>
      parseWorkspace({
        ...workspace,
        languages: [workspace.languages[0], workspace.languages[0]],
      }),
    ).toThrow(/duplicate/);
    workspace.languages[0].reviewed = ["Save", "does not exist", "Save"];
    expect(parseWorkspace(workspace).languages[0].reviewed).toEqual(["Save"]);
  });
});

describe("CV document language configuration", () => {
  it("migrates old workspaces and preserves CV headings through import and export", () => {
    const workspace = initialWorkspace();
    for (const language of workspace.languages) delete language.cvDocument;
    const imported = parseWorkspace(workspace);
    expect(imported.languages[1].cvDocument).toMatchObject({ enabled: true, sectionTitles: { experience: "İş Deneyimi" } });
    imported.languages[1].cvDocument!.sectionTitles.experience = "Deneyimler";
    expect(parseWorkspace(JSON.parse(JSON.stringify(imported)))).toEqual(imported);
  });
  it("rejects unsafe section keys and invalid CV settings", () => {
    const language = createLanguage("tr", "Türkçe");
    for (const cvDocument of [{ enabled: "yes", sectionTitles: {} }, { enabled: true, sectionTitles: JSON.parse('{"__proto__":"X"}') }, { enabled: true, sectionTitles: { experience: "x".repeat(161) } }]) {
      expect(() => importLanguageFile(JSON.stringify({ ...language, cvDocument }), language)).toThrow();
    }
  });
});
