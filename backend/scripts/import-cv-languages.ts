import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { cvLanguageSchema } from "../src/modules/cv-languages/cv-languages.repository";
import { standardModule } from "../src/shared/cv-modules/standard.module";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run languages:import -- /path/to/cv-languages.json");
const catalog = z.object({
  version: z.literal(1), kind: z.literal("cv-language-catalog"),
  languages: z.array(cvLanguageSchema.extend({ is_active: z.boolean(), sort_order: z.number().int().min(0) }).strict()).min(1).max(40),
}).strict().parse(JSON.parse(await readFile(file, "utf8")));
if (new Set(catalog.languages.map(language => language.code)).size !== catalog.languages.length) throw new Error("Duplicate CV language codes");
for (const language of catalog.languages.filter(language => language.is_active)) {
  if (standardModule.sectionCatalog.some(section => !language.section_titles[section.type]?.trim())) throw new Error(`Complete all section headings for ${language.code} before enabling it`);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
// An atomic upsert preserves unlisted languages and all existing CVs.
const { error } = await db.from("cv_languages").upsert(catalog.languages, { onConflict: "code" });
if (error) throw new Error("Failed to save CV language catalog");
console.log(`Saved ${catalog.languages.length} CV language configurations.`);
