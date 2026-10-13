import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { InternalServerError } from "../../shared/errors/app-error";
import { SECTION_TITLES_TR } from "../../shared/localization/languages";
import { standardModule } from "../../shared/cv-modules/standard.module";

/** Document languages are independent of the interface locale registry. */
export const cvLanguageSchema = z.object({
  code: z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/).max(16),
  name: z.string().trim().min(1).max(80),
  direction: z.enum(["ltr", "rtl"]),
  section_titles: z.record(z.string().trim().min(1).max(160)),
});
export type CvLanguage = z.infer<typeof cvLanguageSchema>;

export function documentLanguageKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

export interface CvLanguagesRepository {
  listActive(): Promise<CvLanguage[]>;
}

// Used by isolated service fixtures. Production always reads the database catalog.
export const builtInCvLanguages: CvLanguagesRepository = {
  async listActive() {
    return [
      { code: "en", name: "English", direction: "ltr", section_titles: Object.fromEntries(standardModule.sectionCatalog.map(section => [section.type, section.title])) },
      { code: "tr", name: "Türkçe", direction: "ltr", section_titles: { ...SECTION_TITLES_TR } },
    ];
  },
};

export class SupabaseCvLanguagesRepository implements CvLanguagesRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listActive(): Promise<CvLanguage[]> {
    const { data, error } = await this.db.from("cv_languages")
      .select("code,name,direction,section_titles").eq("is_active", true)
      .order("sort_order").order("code");
    if (error) throw new InternalServerError("Failed to load CV languages", { reason: error.message });
    const parsed = z.array(cvLanguageSchema).safeParse(data ?? []);
    if (!parsed.success) throw new InternalServerError("CV language catalog is invalid");
    return parsed.data;
  }
}
