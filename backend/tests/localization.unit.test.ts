import { describe, expect, it } from "vitest";
import { detectCvLanguage, languagePolicy } from "../src/shared/localization/languages";
import { applyTranslation, translationTexts } from "../src/modules/ai/cv-translation";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import { createEmptyCvContent } from "../src/shared/cv-content/cv-content.utils";
import { reviewCv } from "../src/modules/cv-review/cv-review";

const source: CvContent = { version: "v1", language: "en", metadata: { full_name: "Çağrı Işık", email: "cagri@example.com", urls: ["https://example.com"], layout: { scale: 1 } }, sections: [{ id: "experience", type: "experience", title: "Work Experience", order: 0, meta: {}, blocks: [{ id: "role", type: "experience", order: 0, visibility: "hidden", fields: { role: "Analyst", company: "Company Ltd", start_date: "2020-01", description: "Delivered 20 reports." }, meta: { expanded: false } }] }] };
describe("separate interface and CV language", () => {
  it("detects English, Turkish and inconclusive extracted documents", () => {
    expect(detectCvLanguage("Work Experience Education Skills University Professional Summary")).toBe("en");
    expect(detectCvLanguage("İş Deneyimi Eğitim Beceriler Üniversite İletişim Sertifikalar")).toBe("tr");
    expect(detectCvLanguage("Çağrı 2020 Python SQL")).toBeNull();
    expect(detectCvLanguage("experience education skills eğitim beceriler iletişim")).toBeNull();
  });
  it.each([['en', 'en'], ['en', 'tr'], ['tr', 'en'], ['tr', 'tr']])("separates %s document text from %s feedback in configured prompts", (document, feedback) => {
    const policy = languagePolicy({ language_context: { document_language: document, feedback_language: feedback } });
    expect(policy).toContain(`Document text, suggested blocks, skills, summaries and cover letters must be in ${document === 'tr' ? 'Turkish' : 'English'}`);
    expect(policy).toContain(`Questions, explanations, review feedback and generation summaries must be in ${feedback === 'tr' ? 'Turkish' : 'English'}`);
    expect(policy).toContain("Keep JSON keys");
  });
  it("translates only allowed text and preserves structural and contact facts", () => {
    const translated = applyTranslation(source, [{ path: "sections/0/title", text: "İş Deneyimi" }, { path: "sections/0/blocks/0/fields/role", text: "Analist" }, { path: "sections/0/blocks/0/fields/description", text: "20 rapor hazırladı." }], "tr");
    expect(translated.language).toBe("tr");
    expect(translated.metadata).toEqual(source.metadata);
    expect(translated.sections[0].blocks[0]).toMatchObject({ id: "role", visibility: "hidden", fields: { company: "Company Ltd", start_date: "2020-01" }, meta: { expanded: false } });
    expect(source.sections[0].title).toBe("Work Experience");
  });
  it("rejects invented paths, duplicate paths, missing texts and changed numerical facts", () => {
    const texts = translationTexts(source);
    expect(() => applyTranslation(source, [], "tr")).toThrow();
    expect(() => applyTranslation(source, [...texts, texts[0]], "tr")).toThrow();
    expect(() => applyTranslation(source, texts.map(item => ({ ...item, text: item.text.replace("20", "200") })), "tr")).toThrow();
    expect(() => applyTranslation(source, texts.map(item => ({ ...item, path: "metadata/email" })), "tr")).toThrow();
  });
  it("includes canonical bullet aliases and spoken languages without translating fixed names or links", () => {
    const content = structuredClone(source);
    content.sections[0].blocks[0].fields = { job_title: "Analyst", field_of_study: "Computer Science", bullets: ["Delivered 20 reports"], highlights: ["Helped the team"], language: "English", proficiency: "Fluent", name: "Çağrı Işık", url: "https://example.com", company: "Company Ltd" };
    const texts = translationTexts(content);
    expect(texts.map(text => text.path)).toEqual(expect.arrayContaining(["sections/0/blocks/0/fields/job_title", "sections/0/blocks/0/fields/field_of_study", "sections/0/blocks/0/fields/bullets/0", "sections/0/blocks/0/fields/highlights/0", "sections/0/blocks/0/fields/language", "sections/0/blocks/0/fields/proficiency"]));
    expect(texts.some(text => /\/(name|url|company)$/.test(text.path))).toBe(false);
  });
  it("silently omits unsupported Turkish wording checks without a penalty", () => {
    const content = createEmptyCvContent("tr");
    content.sections = structuredClone(source.sections);
    content.sections[0].blocks[0].visibility = "visible";
    content.sections[0].blocks[0].fields.description = "Eğitim ve iş deneyimi sayesinde raporları hazırladım ve ekibin çalışmalarına katkı sağladım.";
    const review = reviewCv({ content });
    expect(review.dimensions.find(d => d.id === "quality")).toMatchObject({ score: null, reason: null, checks: [] });
    expect(JSON.stringify(review)).not.toContain("English CVs only");
  });
});
