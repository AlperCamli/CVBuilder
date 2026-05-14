import { describe, expect, it } from "vitest";
import {
  buildSkillsPoolBlockMetaPatch,
  clampSkillsPoolItems,
  parseSkillsPoolItemsFromSuggestedContent,
  parseSkillsPoolMetadata,
  parseSkillsPoolMetadataFromBlockMeta,
  SKILLS_POOL_MAX_SIZE
} from "./cv-editor-skills-pool";

describe("cv-editor-skills-pool", () => {
  it("parses metadata from section data shape", () => {
    const parsed = parseSkillsPoolMetadata({
      skillPoolItems: ["TypeScript", "typescript", " React "],
      skillPoolLastGeneratedAt: "2026-05-14T00:00:00.000Z",
      skillPoolRefreshCountDay: "2026-05-14",
      skillPoolRefreshCountValue: "2",
      skillPoolShuffleUsed: "true"
    });

    expect(parsed.items).toEqual(["TypeScript", "React"]);
    expect(parsed.lastGeneratedAt).toBe("2026-05-14T00:00:00.000Z");
    expect(parsed.refreshCountDay).toBe("2026-05-14");
    expect(parsed.refreshCountValue).toBe(2);
    expect(parsed.shuffleUsed).toBe(true);
  });

  it("parses metadata from block meta snake_case shape", () => {
    const parsed = parseSkillsPoolMetadataFromBlockMeta({
      skill_pool_items: ["Node.js", "node.js", "GraphQL"],
      skill_pool_last_generated_at: "2026-05-13T00:00:00.000Z",
      skill_pool_refresh_count_day: "2026-05-13",
      skill_pool_refresh_count_value: 1,
      skill_pool_shuffle_used: false
    });

    expect(parsed.items).toEqual(["Node.js", "GraphQL"]);
    expect(parsed.refreshCountValue).toBe(1);
  });

  it("extracts skill items from suggested content fields", () => {
    const items = parseSkillsPoolItemsFromSuggestedContent({
      fields: {
        skills: ["AWS", "aws", "Docker"],
        items: ["Kubernetes"]
      }
    });

    expect(items).toEqual(["AWS", "Docker", "Kubernetes"]);
  });

  it("builds block meta patch with snake_case keys", () => {
    const patch = buildSkillsPoolBlockMetaPatch({
      items: ["Go", "Rust"],
      lastGeneratedAt: "2026-05-14T10:00:00.000Z",
      refreshCountDay: "2026-05-14",
      refreshCountValue: 2,
      shuffleUsed: true
    });

    expect(patch.skill_pool_items).toEqual(["Go", "Rust"]);
    expect(patch.skill_pool_shuffle_used).toBe(true);
  });

  it("clamps pool item count to max size", () => {
    const inputs = Array.from({ length: SKILLS_POOL_MAX_SIZE + 10 }).map((_, index) => `Skill ${index}`);
    const clamped = clampSkillsPoolItems(inputs);
    expect(clamped).toHaveLength(SKILLS_POOL_MAX_SIZE);
  });
});
