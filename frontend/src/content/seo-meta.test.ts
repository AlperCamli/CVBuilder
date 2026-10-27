import { describe, expect, it } from "vitest";
import { PLAN_VALUE_USD } from "./pricing";
import {
  buildSeoRoutes,
  WEB_APPLICATION_JSON_LD,
  GUIDED_JOURNEY_FAQ_ITEMS,
} from "./seo-meta.mjs";

const routes = buildSeoRoutes({ categories: [], articles: [] });

describe("public and guided journey SEO", () => {
  it("does not advertise fixed prices before the visitor's server-resolved market is known", () => {
    expect(WEB_APPLICATION_JSON_LD.offers).toBeUndefined();
  });
  it("keeps primary pages indexed while correcting the Weekly trial descriptions", () => {
    const home = routes.find((route) => route.path === "/")!;
    const pricing = routes.find((route) => route.path === "/pricing")!;
    expect(home.includeInSitemap).toBe(true);
    expect(pricing.includeInSitemap).toBe(true);
    expect(pricing.description).toContain("prices for your region");
    expect(JSON.stringify(pricing)).not.toMatch(/Lifetime|\"price\":\"10\"/);
  });
  it("indexes Turkish routes with reciprocal language links and shared guided assets", () => {
    for (const path of ["/tr", "/tr/pricing"]) {
      const route = routes.find(route => route.path === path)!;
      expect(route.language).toBe("tr");
      expect(route.includeInSitemap).toBe(true);
      expect(route.alternates?.tr).toBe(route.canonical);
      expect(route.alternates?.en).toContain(path.endsWith("pricing") ? "/pricing" : "/");
      expect(route.clientEntry).toBe("src/app/pages/GuidedJourneyPage.tsx");
    }
  });
  it.each(["/guided-journey", "/guided-journey/pricing"])(
    "prerenders %s as a non-indexed public alternative",
    (path) => {
      const route = routes.find((route) => route.path === path)!;
      expect(route.canonical).toBe(`https://jobspecificcv.com${path}`);
      expect(route.robots).toBe("noindex, follow");
      expect(route.includeInSitemap).toBe(false);
      expect(route.clientEntry).toBe("src/app/pages/GuidedJourneyPage.tsx");
      const faq = route.jsonLd.find((item) => item["@type"] === "FAQPage")!;
      expect(faq.mainEntity).toHaveLength(GUIDED_JOURNEY_FAQ_ITEMS.length);
    },
  );
});
