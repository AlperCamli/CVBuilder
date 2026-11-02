import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOnboardingTemplate, checkoutPath, checkoutSource, hasAppAccess, hasBillingIssue, pricingPath, readOnboardingTemplate, rememberOnboardingTemplate, resolveReturnPath, safeReturnPath } from "./subscription-flow";
import type { BackendApi } from "./backend-api";

beforeEach(() => {
  const rows = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("subscription journeys", () => {
  it("preserves each score action, import, language and destination in the payment round trip", () => {
    for (const action of ["editor", "tailor", "improve"]) {
      const next = `/app/cv-score?source=guest&import=owned-import&language=tr&action=${action}`;
      const url = new URL(checkoutPath({ with_trial: true, return_path: next }), "https://app.example");
      expect(url.searchParams.get("next")).toBe(next);
      expect(url.searchParams.get("trial")).toBe("1");
    }
  });
  it("keeps all paid billing periods explicit and skips onboarding until after payment", () => {
    for (const plan of ["weekly", "monthly", "annual"] as const) {
      const url = new URL(checkoutPath({ plan_code: plan, with_trial: false, auto: true }), "https://app.example");
      expect(url.pathname).toBe("/app/checkout");
      expect(url.searchParams.get("plan")).toBe(plan);
      expect(url.searchParams.get("trial")).toBe("0");
      expect(url.searchParams.get("next")).toBe("/onboarding?step=upload");
    }
  });
  it("carries the paywall source through checkout and pricing and drops unknown ones", () => {
    const next = "/app/cv/123?export=pdf";
    const url = new URL(checkoutPath({ with_trial: true, return_path: next, source: "export" }), "https://app.example");
    expect([url.searchParams.get("trial"), url.searchParams.get("source"), url.searchParams.get("next")]).toEqual(["1", "export", next]);
    expect(new URL(checkoutPath({ source: "bogus" as never }), "https://app.example").searchParams.has("source")).toBe(false);
    expect(checkoutSource("cover_letter")).toBe("cover_letter");
    expect(checkoutSource("<script>")).toBeNull();
    const pricing = new URL(pricingPath({ return_path: next, source: "ai" }), "https://app.example");
    expect([pricing.pathname, pricing.searchParams.get("next"), pricing.searchParams.get("source")]).toEqual(["/app/pricing", next, "ai"]);
    expect(pricingPath()).toBe("/app/pricing");
    expect(new URL(pricingPath({ return_path: "https://evil.example" }), "https://app.example").searchParams.get("next")).toBe("/onboarding?step=upload");
  });
  it("returns onboarded accounts to the app instead of the upload step, and keeps explicit next steps", () => {
    const onboarded = { user: { entry_onboarding_completed_at: "2026-11-01T00:00:00Z" } } as never;
    const fresh = { user: { entry_onboarding_completed_at: null } } as never;
    expect(resolveReturnPath("/onboarding?step=upload", onboarded)).toBe("/app");
    expect(resolveReturnPath("/onboarding?step=upload", fresh)).toBe("/onboarding?step=upload");
    expect(resolveReturnPath("/onboarding?step=upload", null)).toBe("/onboarding?step=upload");
    expect(resolveReturnPath("/app/cv-score?action=editor", onboarded)).toBe("/app/cv-score?action=editor");
  });
  it("recognises a failed renewal only for an existing Stripe subscription", () => {
    const plan = (subscription_status: string, provider_subscription_id: string | null) => ({ subscription_status, provider: { provider: "stripe", provider_customer_id: "cus", provider_subscription_id } });
    expect(hasBillingIssue(plan("past_due", "sub_1"))).toBe(true);
    expect(hasBillingIssue(plan("unpaid", "sub_1"))).toBe(true);
    expect(hasBillingIssue(plan("past_due", null))).toBe(false);
    expect(hasBillingIssue(plan("trialing", "sub_1"))).toBe(false);
    expect(hasBillingIssue(null)).toBe(false);
  });
  it.each(["https://other.example", "//other.example", "/app/checkout?auto=1", "/app\\other", "/application", "/signin", "/app\n/other"])("rejects unsafe or looping returns: %s", path => {
    expect(safeReturnPath(path)).toBe("/onboarding?step=upload");
  });
  it("only grants application access for a verified active/trial plan", () => {
    for (const subscription_status of ["inactive", "canceled", "past_due", "unpaid", "paused"]) expect(hasAppAccess({ plan_code: "weekly", subscription_status })).toBe(false);
    expect(hasAppAccess({ plan_code: "weekly", subscription_status: "trialing" })).toBe(true);
    expect(hasAppAccess({ plan_code: "monthly", subscription_status: "active" })).toBe(true);
    expect(hasAppAccess({ plan_code: "free", subscription_status: "active" })).toBe(false);
  });
  it("restores and applies the selected real catalog template to the converted CV", async () => {
    rememberOnboardingTemplate("mosaic-columns-rose");
    expect(readOnboardingTemplate()).toBe("mosaic-columns-rose");
    const api = {
      listTemplates: vi.fn(async () => ({ templates: [{ id: "rose-id", slug: "mosaic-columns-rose", status: "active" }] })),
      patchMasterCvTemplate: vi.fn(async () => ({}))
    };
    await applyOnboardingTemplate(api as unknown as BackendApi, "imported-cv");
    expect(api.patchMasterCvTemplate).toHaveBeenCalledWith("imported-cv", "rose-id");
  });
  it("keeps an unavailable template choice for retry instead of silently using another design", async () => {
    rememberOnboardingTemplate("mosaic-columns-rose");
    const api = { listTemplates: vi.fn(async () => ({ templates: [] })), patchMasterCvTemplate: vi.fn() };
    await expect(applyOnboardingTemplate(api as unknown as BackendApi, "cv")).rejects.toThrow("unavailable");
    expect(api.patchMasterCvTemplate).not.toHaveBeenCalled();
    expect(readOnboardingTemplate()).toBe("mosaic-columns-rose");
  });
});
