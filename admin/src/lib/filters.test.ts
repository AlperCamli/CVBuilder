import { describe, expect, it } from "vitest";
import { customRange, parseFilters, presetRange, previousPeriod, writeFilters, type GlobalFilters } from "./filters";

const now = new Date("2026-10-28T15:30:00Z");
const parse = (search: string) => parseFilters(new URLSearchParams(search), now);

describe("parseFilters", () => {
  it("applies the contract defaults (rolling 30 days) to an empty URL", () => {
    expect(parse("")).toEqual({
      range: "30d",
      from: "2026-09-29",
      to: "2026-10-28",
      grain: "day",
      currency: "usd",
      include_internal: false,
      filters: {},
    });
  });

  it("resolves rolling presets against today and lets them win over from/to", () => {
    expect(parse("range=7d")).toMatchObject({ range: "7d", from: "2026-10-22", to: "2026-10-28" });
    expect(parse("range=mtd&from=2025-01-01&to=2025-01-31")).toMatchObject({ range: "mtd", from: "2026-10-01" });
  });

  it("treats explicit (including legacy) from/to links as a custom range", () => {
    expect(parse("from=2026-01-01&to=2026-03-31")).toMatchObject({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    expect(parse("from=2026-10-01")).toMatchObject({ range: "custom", from: "2026-10-01", to: "2026-10-28" });
  });

  it("falls back per field on invalid params", () => {
    const parsed = parse("range=1y&grain=hour&currency=eur&include_internal=yes&breakdown=country&filters=%7Bbad");
    expect(parsed).toEqual(parse(""));
  });

  it("accepts 1/0 for include_internal and keeps only valid filter entries", () => {
    const filters = JSON.stringify({
      market: "TR",
      locale: ["en", "tr"],
      bogus: "x",
      plan: { nested: true },
      template: Array.from({ length: 51 }, (_, i) => `t${i}`),
    });
    const parsed = parse(`include_internal=1&breakdown=market&filters=${encodeURIComponent(filters)}`);
    expect(parsed.include_internal).toBe(true);
    expect(parsed.breakdown).toBe("market");
    expect(parsed.filters).toEqual({ market: "TR", locale: ["en", "tr"] });
    expect(parse("include_internal=0").include_internal).toBe(false);
  });

  it("allows spans up to 1096 days and resets inverted or longer ones", () => {
    expect(parse("from=2023-10-28&to=2026-10-28")).toMatchObject({ from: "2023-10-28" }); // 1096 days
    expect(parse("from=2023-10-27&to=2026-10-28")).toMatchObject({ from: "2026-09-29" }); // 1097 days
    expect(parse("from=2026-10-20&to=2026-10-10")).toMatchObject({ from: "2026-09-11", to: "2026-10-10" });
    expect(parse("from=2026-02-30&to=2026-03-31")).toMatchObject({ from: "2026-03-02", to: "2026-03-31" });
  });
});

describe("writeFilters", () => {
  it("writes nothing for the defaults", () => {
    expect(writeFilters(parse("")).toString()).toBe("");
  });

  it("keeps presets rolling and custom ranges explicit", () => {
    expect(writeFilters({ ...parse(""), range: "90d" }).toString()).toBe("range=90d");
    expect(writeFilters({ ...parse(""), ...customRange("2026-01-01", "2026-01-31") }).toString()).toBe(
      "from=2026-01-01&to=2026-01-31",
    );
  });

  it("round-trips every non-default value", () => {
    const filters: GlobalFilters = {
      range: "custom",
      from: "2026-01-01",
      to: "2026-03-31",
      grain: "week",
      currency: "native",
      include_internal: true,
      breakdown: "locale",
      filters: { market: ["TR", "US"], plan: "pro" },
    };
    const params = writeFilters(filters);
    expect(parseFilters(new URLSearchParams(params.toString()), now)).toEqual(filters);
    expect(params.get("filters")).toBe('{"market":["TR","US"],"plan":"pro"}');
  });

  it("keeps unrelated params and drops cleared ones", () => {
    const base = new URLSearchParams("tab=x&breakdown=market&grain=month&from=2026-01-01&to=2026-01-02");
    const params = writeFilters({ ...parse(base.toString()), range: "7d", breakdown: undefined }, base);
    expect(params.toString()).toBe("tab=x&range=7d&grain=month");
  });
});

describe("date presets", () => {
  it("computes ranges in UTC", () => {
    expect(presetRange("7d", now)).toEqual({ from: "2026-10-22", to: "2026-10-28" });
    expect(presetRange("90d", now)).toEqual({ from: "2026-07-31", to: "2026-10-28" });
    expect(presetRange("mtd", now)).toEqual({ from: "2026-10-01", to: "2026-10-28" });
    expect(presetRange("12m", now)).toEqual({ from: "2025-10-29", to: "2026-10-28" });
  });

  it("computes the previous period of the same length", () => {
    expect(previousPeriod("2026-09-29", "2026-10-28")).toEqual({ from: "2026-08-30", to: "2026-09-28" });
  });
});
