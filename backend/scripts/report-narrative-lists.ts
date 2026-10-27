import { createClient } from "@supabase/supabase-js";
import { getConfig } from "../src/shared/config/env";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import {
  comparableNarrativeText,
  convertNarrativeLists,
  narrativeBulletField,
  NARRATIVE_LIST_FIELDS,
  type NarrativeListConversion
} from "../src/shared/cv-content/narrative-fields";

// READ-ONLY. Runs the list-kind bullet converter (normalizeNarrativeLists) over every live
// master CV and reports how many blocks each rule would change, without writing anything
// (there is no backfill: the editor converts a CV when it loads it). Verifies that no list
// item is lost, that a second run changes nothing, and that converted blocks are rewritable.
// Prints counts and section/block types only, never CV content or identities.
//
//   npx tsx scripts/report-narrative-lists.ts

async function main() {
  const app = getConfig();
  const db = createClient(app.supabase.url, app.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const rows: Array<{ id: string; current_content: CvContent | null }> = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("master_cvs")
      .select("id,current_content")
      .eq("is_deleted", false)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`master_cvs select failed: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < pageSize) break;
  }

  const counts: Record<Exclude<NarrativeListConversion, "none">, number> = {
    list_only: 0,
    duplicate_list: 0,
    list_with_extra_items: 0
  };
  const byType = new Map<string, number>();
  const cvsChanged = new Set<string>();
  let blocks = 0;
  let listItems = 0;
  let appendedItems = 0;
  let lostItems = 0;
  let notIdempotent = 0;
  let notRewritable = 0;
  let untouchedArrays = 0;

  for (const row of rows) {
    for (const section of row.current_content?.sections ?? []) {
      for (const block of section.blocks ?? []) {
        blocks += 1;
        const fields = block.fields ?? {};
        const context = { sectionType: section.type, blockType: block.type };
        const result = convertNarrativeLists(fields, context);
        const narrativeArrays = NARRATIVE_LIST_FIELDS.filter((key) => Array.isArray(fields[key]) && (fields[key] as unknown[]).length > 0);
        if (result.conversion === "none") {
          untouchedArrays += narrativeArrays.length;
          continue;
        }

        counts[result.conversion] += 1;
        cvsChanged.add(row.id);
        const typeKey = `${result.conversion} | ${section.type}/${block.type}`;
        byType.set(typeKey, (byType.get(typeKey) ?? 0) + 1);
        appendedItems += result.appended_items.length;

        // Every original list item must still be readable in the converted text.
        const text = comparableNarrativeText(String(result.fields[result.target_field ?? "description"] ?? ""));
        for (const key of narrativeArrays) {
          for (const item of fields[key] as unknown[]) {
            if (typeof item !== "string" && typeof item !== "number") continue;
            listItems += 1;
            const needle = comparableNarrativeText(String(item));
            if (needle && !` ${text} `.includes(` ${needle} `)) lostItems += 1;
          }
        }
        if (convertNarrativeLists(result.fields, context).conversion !== "none") notIdempotent += 1;
        if (narrativeBulletField(result.fields, context) === null) notRewritable += 1;
      }
    }
  }

  console.log(`Master CVs scanned: ${rows.length} (blocks: ${blocks})`);
  console.log(`CVs with at least one converted block: ${cvsChanged.size}`);
  console.log(`Blocks changed — list only: ${counts.list_only}, text + duplicate list: ${counts.duplicate_list}, text + list with extra items: ${counts.list_with_extra_items}`);
  console.log(`List items checked: ${listItems}; appended as new bullets: ${appendedItems}; lost: ${lostItems}`);
  console.log(`Second run changes: ${notIdempotent}; converted blocks without a rewritable narrative field: ${notRewritable}`);
  console.log(`Narrative-named arrays left untouched (non-narrative sections or module lists): ${untouchedArrays}`);
  console.log("By rule and section/block type:");
  for (const [key, value] of [...byType.entries()].sort()) console.log(`  ${value}  ${key}`);
  if (lostItems > 0 || notIdempotent > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Report failed");
  process.exitCode = 1;
});
