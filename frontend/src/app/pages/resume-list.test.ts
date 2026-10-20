import { describe, expect, it } from "vitest";
import { prioritizeMasterLanguages } from "./resume-list";

describe("initial main CV selection", () => {
  it("shows one English and one other language ahead of older duplicates", () => {
    const rows = ["en", "en-US", "tr", "en", "tr"].map((language, id) => ({ id, language }));
    const result = prioritizeMasterLanguages(rows);
    expect(result.initialCount).toBe(2);
    expect(result.items.map(row => row.id)).toEqual([0, 2, 1, 3, 4]);
    expect(result.items.slice(0, result.initialCount + 2).map(row => row.id)).toEqual([0, 2, 1, 3]);
  });

  it("puts English first even when the newest CV uses another language", () => {
    const rows = ["tr", "tr", "en-GB", "fr"].map((language, id) => ({ id, language }));
    expect(prioritizeMasterLanguages(rows).items.map(row => row.id)).toEqual([2, 0, 1, 3]);
  });

  it("shows only one version initially when all main CVs share a language", () => {
    const rows = [{ language: "en" }, { language: "en-US" }];
    expect(prioritizeMasterLanguages(rows)).toEqual({ items: rows, initialCount: 1 });
  });

  it("handles empty lists and accounts without English CVs", () => {
    expect(prioritizeMasterLanguages([])).toEqual({ items: [], initialCount: 0 });
    const rows = ["tr", "tr-TR", "de"].map((language, id) => ({ id, language }));
    const result = prioritizeMasterLanguages(rows);
    expect(result.initialCount).toBe(2);
    expect(result.items.map(row => row.id)).toEqual([0, 2, 1]);
  });
});
