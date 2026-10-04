import { describe, expect, it } from "vitest";
import { injectRouteAssets } from "../../scripts/route-assets.mjs";

describe("prerendered lazy route assets", () => {
  it("loads shared CSS before route CSS, avoids duplicates, and preloads its entry", () => {
    const html =
      '<head><link rel="stylesheet" href="/assets/base.css" /></head>';
    const result = injectRouteAssets(
      html,
      { clientEntry: "page" },
      {
        page: {
          file: "assets/page.js",
          css: ["assets/page.css"],
          imports: ["shared"],
        },
        shared: {
          file: "assets/shared.js",
          css: ["assets/base.css", "assets/shared.css"],
        },
      },
    );
    expect(result.match(/href="\/assets\/base.css"/g)).toHaveLength(1);
    expect(result.indexOf("assets/shared.css")).toBeLessThan(
      result.indexOf("assets/page.css"),
    );
    expect(result).toContain(
      'rel="modulepreload" crossorigin href="/assets/page.js"',
    );
  });
  it("fails on missing manifest entries instead of publishing an unstyled route", () => {
    expect(() =>
      injectRouteAssets("<head></head>", { clientEntry: "missing" }, {}),
    ).toThrow(/Missing build manifest entry/);
  });
  it("leaves existing eager routes alone", () => {
    expect(injectRouteAssets("<head></head>", {}, {})).toBe("<head></head>");
  });
});
