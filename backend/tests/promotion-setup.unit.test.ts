import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignCohorts,
  assignmentOpen,
  cancelFlowPromotionRow,
  countByCohortAndLocale,
  couponMismatches,
  couponName,
  couponTerms,
  isCancelFlowConfig,
  isEligibleAccount,
  parseCampaign,
  parseCancelFlowCampaign,
  promotionRow,
  stratumOf,
} from "../scripts/promotions/campaign";

const raw = JSON.parse(readFileSync(join(__dirname, "../../promotions/flash50-2026-11/campaign.json"), "utf-8"));
const campaign = parseCampaign(raw);
const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index).padStart(4, "0")}`);

describe("campaign config", () => {
  it("parses the first campaign", () => {
    expect(campaign).toMatchObject({ slug: "flash50-2026-11", percent_off: 50, plan_codes: ["monthly"], duration: "once", replaces_trial: true });
    expect(campaign.cohorts.map(cohort => [cohort.key, cohort.starts_at, cohort.ends_at])).toEqual([
      ["A", "2026-11-04T07:00:00.000Z", "2026-11-05T07:00:00.000Z"],
      ["B", "2026-11-04T15:00:00.000Z", "2026-11-05T15:00:00.000Z"],
    ]);
  });

  it.each([
    [{ duration: "repeating" }, "duration_in_months"],
    [{ duration_in_months: 3 }, "duration_in_months"],
    [{ plan_codes: ["lifetime"] }, "plan_codes"],
    [{ plan_codes: [] }, "plan_codes"],
    [{ percent_off: 0 }, "percent_off"],
    [{ site_url: "https://jobspecificcv.com/pricing" }, "site_url"],
    [{ utm: { source: "e mail" } }, "utm.source"],
    [{ cohorts: [{ key: "A", starts_at: "2026-11-04T07:00:00Z", ends_at: "2026-11-04T07:00:00Z" }] }, "ends_at"],
    [{ cohorts: [raw.cohorts[0], raw.cohorts[0]] }, "unique"],
    [{ assignment: { ...raw.assignment, stratify_by: ["email"] } }, "stratify_by"],
    [{ audience: "everyone" }, "audience"],
  ])("rejects %j", (change, message) => {
    expect(() => parseCampaign({ ...raw, ...change })).toThrow(message);
  });

  it("builds the promotions row and only sets archived_at when the config does", () => {
    expect(promotionRow(campaign, "coupon_1")).toEqual({
      slug: "flash50-2026-11", name: raw.name, percent_off: 50, plan_codes: ["monthly"], duration: "once", duration_in_months: null,
      replaces_trial: true, stripe_coupon_id: "coupon_1", site_url: "https://jobspecificcv.com", utm: raw.utm,
    });
    expect(promotionRow(parseCampaign({ ...raw, archived_at: "2026-11-06T00:00:00Z" }), "c").archived_at).toBe("2026-11-06T00:00:00.000Z");
    expect(promotionRow(parseCampaign({ ...raw, archived_at: null }), "c")).toHaveProperty("archived_at", null);
    expect(parseCampaign({ ...raw, site_url: "https://example.invalid/" }).site_url).toBe("https://example.invalid");
  });

  it("closes assignment when the first cohort starts", () => {
    expect(assignmentOpen(campaign, new Date("2026-11-04T06:59:59Z"))).toBe(true);
    expect(assignmentOpen(campaign, new Date("2026-11-04T07:00:00Z"))).toBe(false);
  });
});

describe("Stripe coupon terms", () => {
  it("covers the plan products once, with a name Stripe accepts", () => {
    const terms = couponTerms(campaign, ["prod_Monthly", "prod_Monthly", "prod_A"]);
    expect(terms).toEqual({
      percent_off: 50, duration: "once", applies_to: { products: ["prod_A", "prod_Monthly"] },
      name: "50% off first payment", metadata: { promotion_slug: "flash50-2026-11" },
    });
    expect(couponName(parseCampaign({ ...raw, name: "Short name" }))).toBe("Short name");
    expect(couponName(parseCampaign({ ...raw, coupon_name: "Flash 50" }))).toBe("Flash 50");
    expect(couponTerms(parseCampaign({ ...raw, duration: "repeating", duration_in_months: 3 }), ["prod_A"])).toMatchObject({ duration_in_months: 3, name: "50% off for 3 months" });
  });

  it("reports an existing coupon whose immutable terms differ", () => {
    const terms = couponTerms(campaign, ["prod_Monthly"]);
    const matching = { id: "c", percent_off: 50, duration: "once", duration_in_months: null, valid: true, applies_to: { products: ["prod_Monthly"] } };
    expect(couponMismatches(matching, terms)).toEqual([]);
    expect(couponMismatches({ ...matching, percent_off: 40, applies_to: null, valid: false }, terms)).toEqual([
      "percent_off is 40", "it applies to every product", "it is no longer valid",
    ]);
  });
});

describe("audience", () => {
  const account = { id: "u1", locale: "en", is_internal: false, deletion_requested_at: null, processing_restricted_at: null };
  it("keeps non-paying accounts and applies the queue view's exclusions", () => {
    expect(isEligibleAccount(account, new Set(), new Set())).toBe(true);
    expect(isEligibleAccount({ ...account, is_internal: true }, new Set(), new Set())).toBe(false);
    expect(isEligibleAccount({ ...account, deletion_requested_at: "2026-11-01" }, new Set(), new Set())).toBe(false);
    expect(isEligibleAccount({ ...account, processing_restricted_at: "2026-11-01" }, new Set(), new Set())).toBe(false);
    expect(isEligibleAccount(account, new Set(["u1"]), new Set())).toBe(false);
    expect(isEligibleAccount(account, new Set(), new Set(["u1"]))).toBe(false);
  });

  it("stratifies by locale", () => {
    expect(stratumOf(campaign, { locale: "tr" })).toBe("locale=tr");
    expect(stratumOf(parseCampaign({ ...raw, assignment: { ...raw.assignment, stratify_by: [] } }), { locale: "tr" })).toBe("all");
  });
});

describe("assignCohorts", () => {
  const candidates = [...ids("en", 101).map(userId => ({ userId, stratum: "locale=en" })), ...ids("tr", 40).map(userId => ({ userId, stratum: "locale=tr" }))];
  const base = { seed: "flash50-2026-11", cohortKeys: ["A", "B"], candidates, existing: [] };

  it("is deterministic for a seed and balanced within each stratum", () => {
    const first = assignCohorts(base);
    expect([...assignCohorts({ ...base, candidates: [...candidates].reverse() })].sort()).toEqual([...first].sort());
    const counts = countByCohortAndLocale(candidates.map(row => ({ cohortKey: first.get(row.userId)!, locale: row.stratum })));
    expect(counts["A"]["locale=tr"]).toBe(20);
    expect(counts["B"]["locale=tr"]).toBe(20);
    expect(Math.abs(counts["A"]["locale=en"] - counts["B"]["locale=en"])).toBe(1);
  });

  it("shuffles by seed rather than by id order", () => {
    const first = assignCohorts(base);
    const other = assignCohorts({ ...base, seed: "another-seed" });
    expect([...first].filter(([userId, key]) => other.get(userId) !== key).length).toBeGreaterThan(20);
    const ordered = ids("en", 101).map(userId => first.get(userId));
    expect(ordered.slice(0, 20).join("")).not.toMatch(/^(AB)+$|^(BA)+$/);
  });

  it("keeps existing assignments and balances new accounts against them", () => {
    const existing = ids("tr", 10).map(userId => ({ userId, stratum: "locale=tr", cohortKey: "A" }));
    const result = assignCohorts({ ...base, candidates: candidates.filter(row => row.stratum === "locale=tr"), existing });
    expect(ids("tr", 10).some(userId => result.has(userId))).toBe(false);
    const added = [...result.values()];
    expect(added).toHaveLength(30);
    expect(added.filter(key => key === "B")).toHaveLength(20);
    expect(added.filter(key => key === "A")).toHaveLength(10);
  });

  it("ignores duplicate candidates and requires a cohort", () => {
    expect(assignCohorts({ ...base, candidates: [candidates[0], candidates[0]] }).size).toBe(1);
    expect(() => assignCohorts({ ...base, cohortKeys: [] })).toThrow("cohort");
  });
});

describe("cancel-flow campaign config", () => {
  const cancelRaw = JSON.parse(readFileSync(join(__dirname, "../../promotions/trial-cancel-save50/campaign.json"), "utf-8"));

  it("parses the trial-cancel offer and builds its promotion row and coupon", () => {
    expect(isCancelFlowConfig(cancelRaw)).toBe(true);
    expect(isCancelFlowConfig(raw)).toBe(false);
    const cancel = parseCancelFlowCampaign(cancelRaw);
    // The trial is kept: accepting only discounts the first charge after it.
    expect(cancelFlowPromotionRow(cancel, "coupon_x")).toEqual({
      slug: "trial-cancel-save50", name: cancel.name, channel: "cancel_flow", cancel_audience: "trial", percent_off: 50, plan_codes: ["monthly"], duration: "once",
      duration_in_months: null, replaces_trial: false, stripe_coupon_id: "coupon_x", site_url: "https://jobspecificcv.com", utm: {}
    });
    expect(couponTerms(cancel, ["prod_monthly"])).toEqual({
      percent_off: 50, duration: "once", applies_to: { products: ["prod_monthly"] }, name: "50% off your first month", metadata: { promotion_slug: "trial-cancel-save50" }
    });
  });

  it.each([
    ["two plans", { plan_codes: ["monthly", "annual"] }],
    ["no plan", { plan_codes: [] }],
    ["email-only fields", { cohorts: [] }],
    ["repeating without months", { duration: "repeating" }]
  ])("rejects %s", (_label, change) => {
    expect(() => parseCancelFlowCampaign({ ...cancelRaw, ...change })).toThrow(/Invalid campaign config/);
  });

  it("parses the paid-weekly and monthly offers", () => {
    const read = (slug: string) => parseCancelFlowCampaign(JSON.parse(readFileSync(join(__dirname, `../../promotions/${slug}/campaign.json`), "utf-8")));
    expect(cancelFlowPromotionRow(read("weekly-cancel-save50"), "c")).toMatchObject({ cancel_audience: "weekly", plan_codes: ["monthly"], percent_off: 50, duration: "once" });
    expect(cancelFlowPromotionRow(read("monthly-cancel-save50"), "c")).toMatchObject({ cancel_audience: "monthly", plan_codes: ["monthly"], percent_off: 50, duration: "once" });
  });

  it.each([
    ["a paid-weekly offer that stays weekly", { audience: "weekly", plan_codes: ["weekly"] }],
    ["a monthly offer for another plan", { audience: "monthly", plan_codes: ["annual"] }],
    ["an annual offer for another plan", { audience: "annual", plan_codes: ["monthly"] }],
    ["no audience", { audience: undefined }]
  ])("rejects %s", (_label, change) => {
    expect(() => parseCancelFlowCampaign({ ...cancelRaw, ...change })).toThrow(/Invalid campaign config/);
  });

  it("is never parsed as an email campaign", () => {
    expect(() => parseCampaign(cancelRaw)).toThrow(/cancel_flow/);
  });
});
