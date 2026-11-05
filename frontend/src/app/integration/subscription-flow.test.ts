import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOnboardingTemplate, checkoutChoice, checkoutPath, checkoutSource, restartCheckoutPath, hasAppAccess, hasBillingIssue, pricingPath, readOnboardingTemplate, rememberOnboardingTemplate, resolveReturnPath, safeReturnPath } from "./subscription-flow";
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
      expect(url.searchParams.get("plan")).toBe("monthly");
    }
  });
  it.each([
    // No trial choice: a trial only without a plan or for the trial plan itself.
    [{}, "monthly", "1"],
    [{ plan_code: "monthly" }, "monthly", "1"],
    [{ plan_code: "annual" }, "annual", "0"],
    [{ plan_code: "weekly" }, "weekly", "0"],
    // An explicit trial is the trial plan's ("trial wins"), including an old weekly-trial intent.
    [{ with_trial: true }, "monthly", "1"],
    [{ plan_code: "weekly", with_trial: true }, "monthly", "1"],
    [{ plan_code: "annual", with_trial: true }, "monthly", "1"],
    [{ plan_code: "monthly", with_trial: true }, "monthly", "1"],
    // Paid: the plan as named; without one, Monthly (not Weekly).
    [{ with_trial: false }, "monthly", "0"],
    [{ plan_code: "weekly", with_trial: false }, "weekly", "0"],
    [{ plan_code: "monthly", with_trial: false }, "monthly", "0"],
    [{ plan_code: "annual", with_trial: false }, "annual", "0"],
  ] as const)("checkoutPath(%j) opens plan=%s&trial=%s", (options, plan, trial) => {
    const params = new URL(checkoutPath(options), "https://app.example").searchParams;
    expect([params.get("plan"), params.get("trial")]).toEqual([plan, trial]);
  });
  it("resumes stored intents through the signup spread: a pre-switch weekly trial becomes the Monthly trial", () => {
    // auth-route-guards.tsx and SignUp.tsx call checkoutPath({ ...readPendingCheckout(), auto: true }).
    const resume = (pending: Parameters<typeof checkoutPath>[0]) => new URL(checkoutPath({ ...pending, auto: true }), "https://app.example").searchParams;
    expect([resume({ plan_code: "monthly", with_trial: true }).get("plan"), resume({ plan_code: "monthly", with_trial: true }).get("trial")]).toEqual(["monthly", "1"]);
    expect([resume({ plan_code: "weekly", with_trial: true }).get("plan"), resume({ plan_code: "weekly", with_trial: true }).get("trial")]).toEqual(["monthly", "1"]);
    expect([resume({ plan_code: "weekly", with_trial: false }).get("plan"), resume({ plan_code: "weekly", with_trial: false }).get("trial")]).toEqual(["weekly", "0"]);
    expect([resume({ plan_code: "annual", with_trial: false, return_path: "/app" }).get("plan"), resume({ plan_code: "annual", with_trial: false }).get("auto")]).toEqual(["annual", "1"]);
  });
  it.each([
    ["plan=weekly&trial=1", "monthly", true],
    ["plan=annual&trial=1", "monthly", true],
    ["plan=monthly&trial=1", "monthly", true],
    ["trial=1&source=export", "monthly", true],
    ["", "monthly", true],
    ["plan=monthly", "monthly", true],
    ["plan=bogus&trial=1", "monthly", true],
    ["plan=weekly&trial=0", "weekly", false],
    ["plan=monthly&trial=0", "monthly", false],
    ["plan=annual&trial=0", "annual", false],
    ["plan=annual", "annual", false],
    ["plan=weekly", "weekly", false],
    ["trial=0", "monthly", false],
  ] as const)("reads checkout?%s as %s with trial %s", (query, plan, withTrial) => {
    expect(checkoutChoice(new URLSearchParams(query))).toEqual({ plan, withTrial });
  });
  it("restarts a checkout without a Stripe customer through the trial screen while the account can start a trial", () => {
    const open = (options: Parameters<typeof restartCheckoutPath>[0]) => new URL(restartCheckoutPath(options), "https://app.example").searchParams;
    const eligible = open({ trial_eligible: true, plan_code: "annual", return_path: "/app/cv/1", source: "export" });
    // The trial screen, not an automatic paid Stripe session.
    expect([eligible.get("plan"), eligible.get("trial"), eligible.get("auto"), eligible.get("next"), eligible.get("source")]).toEqual(["monthly", "1", null, "/app/cv/1", "export"]);
    const paid = open({ trial_eligible: false, plan_code: "annual", return_path: "/app/cv/1" });
    expect([paid.get("plan"), paid.get("trial"), paid.get("auto")]).toEqual(["annual", "0", "1"]);
    const unknown = open({ trial_eligible: false, plan_code: null });
    expect([unknown.get("plan"), unknown.get("trial"), unknown.get("auto")]).toEqual(["monthly", "0", "1"]);
  });
  it("round-trips every checkout path through the checkout page", () => {
    for (const plan_code of ["weekly", "monthly", "annual"] as const) for (const with_trial of [true, false]) {
      const choice = checkoutChoice(new URL(checkoutPath({ plan_code, with_trial }), "https://app.example").searchParams);
      expect(choice).toEqual(with_trial ? { plan: "monthly", withTrial: true } : { plan: plan_code, withTrial: false });
    }
    for (const plan_code of ["weekly", "monthly", "annual"] as const) {
      const choice = checkoutChoice(new URL(checkoutPath({ plan_code }), "https://app.example").searchParams);
      expect(choice).toEqual({ plan: plan_code, withTrial: plan_code === "monthly" });
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
