import { describe, expect, it } from "vitest";
import { ERAS, eraMarkers, erasFor } from "./eras";

describe("eras", () => {
  it("are sorted and tag the Phase 1 metrics", () => {
    expect(ERAS.map((e) => e.date)).toEqual([...ERAS.map((e) => e.date)].sort());
    expect(erasFor("revenue").map((e) => e.date)).toEqual(["2026-10-12", "2026-10-24", "2026-10-29"]);
    expect(erasFor("ai_cost").map((e) => e.date)).toContain("2026-10-27");
  });

  it("keeps eras inside the selected range, pinned to their bucket", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const days = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
    expect(eraMarkers(erasFor("revenue"), days, { from: "2026-10-10", to: "2026-10-13" }, now).map((m) => [m.date, m.bucket])).toEqual([
      ["2026-10-12", "2026-10-12"],
    ]);

    // Weekly buckets run past `to` (the last week ends Nov 1), but the Oct 29 cutoff is after the range and after today.
    const weeks = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
    expect(eraMarkers(erasFor("revenue"), weeks, { from: "2026-10-08", to: "2026-10-28" }, now).map((m) => [m.date, m.bucket])).toEqual([
      ["2026-10-12", "2026-10-12"],
      ["2026-10-24", "2026-10-19"],
    ]);
    // Never future-dated, even when the range reaches past today.
    expect(eraMarkers(erasFor("revenue"), weeks, { from: "2026-10-08", to: "2026-11-01" }, now).map((m) => m.date)).not.toContain("2026-10-29");

    // An era inside the first bucket but before `from` is left out.
    const months = ["2026-10-01"];
    expect(eraMarkers(erasFor("revenue"), months, { from: "2026-10-15", to: "2026-10-28" }, now).map((m) => m.date)).toEqual(["2026-10-24"]);

    expect(eraMarkers(erasFor("revenue"), ["2026-09-01"], { from: "2026-09-01", to: "2026-09-30" }, now)).toEqual([]);
    expect(eraMarkers(erasFor("revenue"), [], { from: "2026-10-01", to: "2026-10-28" }, now)).toEqual([]);
  });
});
