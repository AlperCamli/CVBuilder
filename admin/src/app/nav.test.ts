import { describe, expect, it } from "vitest";
import { NAV, pageFor } from "./nav";

describe("nav", () => {
  it("maps sub-pages to their section and flags people pages", () => {
    expect(pageFor("/users/3f2b6c1e-8a4d-4f7e-9b2a-1c3d5e7f9a0b")?.label).toBe("Users");
    expect(pageFor("/users")?.people).toBe(true);
    expect(pageFor("/")?.people).toBeUndefined();
    expect(pageFor("/usersx")).toBeUndefined();
  });

  it("builds section pages from their metric lists", () => {
    const monetization = pageFor("/monetization")!;
    expect(monetization.ready).toBe(true);
    expect(monetization.metrics).toHaveLength(10);
    expect(monetization.metrics).toContain("checkout_funnel");
    expect(pageFor("/ai-cost")!.metrics).toHaveLength(8);
    expect(NAV.filter((n) => n.sections).map((n) => n.label)).toEqual(["Monetization", "AI cost", "Engagement", "Tailoring", "Acquisition"]);
    expect(pageFor("/alerts")!.ready).toBeUndefined();
  });
});
