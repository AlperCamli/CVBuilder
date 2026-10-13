import type { LanguageConfiguration, LanguageWorkspace } from "./language-catalog";

export const CV_SECTION_TITLES: Record<string, string> = {
  summary: "Professional Summary", experience: "Work Experience", education: "Education",
  skills: "Skills", languages: "Languages", certifications: "Certifications", courses: "Courses",
  projects: "Projects", volunteer: "Volunteer Work", awards: "Awards", publications: "Publications", references: "References",
};
const TURKISH_TITLES: Record<string, string> = {
  summary: "Profesyonel Özet", experience: "İş Deneyimi", education: "Eğitim",
  skills: "Beceriler", languages: "Diller", certifications: "Sertifikalar", courses: "Kurslar",
  projects: "Projeler", volunteer: "Gönüllülük", awards: "Ödüller", publications: "Yayınlar", references: "Referanslar",
};
export interface CvLanguageDraft { enabled: boolean; sectionTitles: Record<string, string>; }
export function defaultCvLanguageDraft(code: string): CvLanguageDraft {
  return { enabled: code === "en" || code === "tr", sectionTitles: { ...(code === "en" ? CV_SECTION_TITLES : code === "tr" ? TURKISH_TITLES : {}) } };
}
export function exportCvLanguageCatalog(workspace: LanguageWorkspace) {
  const languages = workspace.languages.map((language: LanguageConfiguration, index) => {
    const draft = language.cvDocument ?? defaultCvLanguageDraft(language.code);
    if (draft.enabled && Object.keys(CV_SECTION_TITLES).some(type => !draft.sectionTitles[type]?.trim())) {
      throw new Error(`Complete every CV section heading for ${language.name} before enabling translation.`);
    }
    return { code: language.code.toLowerCase(), name: language.name, direction: language.direction,
      section_titles: Object.fromEntries(Object.entries(draft.sectionTitles).filter(([, title]) => title.trim()).map(([type, title]) => [type, title.trim()])),
      is_active: draft.enabled, sort_order: index };
  });
  if (!languages.some(language => language.is_active)) throw new Error("Enable at least one CV language.");
  return { version: 1, kind: "cv-language-catalog", languages };
}
