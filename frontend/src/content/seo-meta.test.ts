import { describe, expect, it } from "vitest";
import { PLAN_VALUE_USD } from "./pricing";
import {
  buildSeoRoutes,
  WEB_APPLICATION_JSON_LD,
  GUIDED_JOURNEY_FAQ_ITEMS,
} from "./seo-meta.mjs";

const routes = buildSeoRoutes({ categories: [], articles: [] });

describe("public and guided journey SEO", () => {
  it("describes the real full-period charges, not weekly equivalents or retired plans", () => {
    const offers = WEB_APPLICATION_JSON_LD.offers as any[];
    expect(offers.map((offer) => offer.name)).toEqual([
      "Free",
      "Weekly Pro",
      "Monthly Pro",
      "Annual Pro",
    ]);
    for (const [index, code, duration] of [
      [1, "weekly", "P1W"],
      [2, "monthly", "P1M"],
      [3, "annual", "P1Y"],
    ] as const) {
      expect(Number(offers[index].price)).toBe(PLAN_VALUE_USD[code]);
      expect(offers[index].priceSpecification.billingDuration).toBe(duration);
      expect(offers[index].priceSpecification.price).toBe(offers[index].price);
    }
  });
  it("keeps primary pages indexed while correcting the Weekly trial descriptions", () => {
    const home = routes.find((route) => route.path === "/")!;
    const pricing = routes.find((route) => route.path === "/pricing")!;
    expect(home.includeInSitemap).toBe(true);
    expect(pricing.includeInSitemap).toBe(true);
    expect(pricing.description).toContain("Weekly Pro free for 3 days");
    expect(JSON.stringify(pricing)).not.toMatch(/Lifetime|\"price\":\"10\"/);
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
