import { describe, expect, it } from "vitest";
import { createLanguage, initialWorkspace } from "./language-catalog";
import { CV_SECTION_TITLES, exportCvLanguageCatalog } from "./cv-language-catalog";

describe("admin CV language catalog export", () => {
  it("exports edited headings independently of UI text", () => {
    const workspace = initialWorkspace();
    workspace.languages[1].cvDocument!.sectionTitles.experience = "Deneyimler";
    workspace.languages[1].translations["Work Experience"] = "Another UI label";
    const catalog = exportCvLanguageCatalog(workspace);
    expect(catalog.languages[1]).toMatchObject({ code: "tr", is_active: true, section_titles: { experience: "Deneyimler" } });
    expect(catalog.languages[1]).not.toHaveProperty("translations");
  });
  it("requires complete headings for enabled languages and keeps regional codes", () => {
    const workspace = initialWorkspace();
    const language = createLanguage("pt-BR", "Português");
    workspace.languages.push(language);
    expect(exportCvLanguageCatalog(workspace).languages[2]).toMatchObject({ code: "pt-br", is_active: false });
    language.cvDocument!.enabled = true;
    expect(() => exportCvLanguageCatalog(workspace)).toThrow(/Complete/);
    language.cvDocument!.sectionTitles = { ...CV_SECTION_TITLES };
    expect(exportCvLanguageCatalog(workspace).languages[2].is_active).toBe(true);
  });
});
