import { describe, expect, it } from "vitest";
import { checkoutScreen, planDate, trialEndDate, welcomeContinueLabel, type CheckoutAction } from "./checkout-screen";
import type { CheckoutTarget } from "../../content/pricing";

const actions = (screen: ReturnType<typeof checkoutScreen>) => [screen.primary, screen.secondary].filter((action): action is CheckoutAction => action !== null);
const trialStart = (action: CheckoutAction | null) => action?.kind === "checkout" && action.withTrial;

describe("checkout screens", () => {
  it("starts the trial at Stripe from the cancel page, without a second confirmation page", () => {
    for (const plan of ["weekly", "monthly", "annual"] as CheckoutTarget[]) {
      const screen = checkoutScreen({ outcome: "cancel", plan, trial: false, eligibility: true });
      expect(screen.title).toBe("Why don’t you try the free trial first?");
      expect(screen.primary).toEqual(expect.objectContaining({ kind: "checkout", plan: "weekly", withTrial: true }));
      // The plan they backed out of stays one click away, with its price in the label.
      expect(screen.secondary).toEqual({ kind: "checkout", plan, withTrial: false, label: "Continue with {{plan}} · {{price}}" });
    }
  });

  it("keeps the emailed discount first after a cancel, with the trial below it only when eligible", () => {
    const eligible = checkoutScreen({ outcome: "cancel", plan: "monthly", trial: false, eligibility: true, promotion: true });
    expect(eligible.title).toBe("Your discount is still waiting.");
    expect(eligible.primary).toEqual({ kind: "checkout", plan: "monthly", withTrial: false, label: "Claim my discount" });
    expect(eligible.secondary).toEqual({ kind: "checkout", plan: "weekly", withTrial: true, label: "Try for free" });

    const used = checkoutScreen({ outcome: "cancel", plan: "monthly", trial: false, eligibility: false, promotion: true });
    expect(used.primary).toEqual(expect.objectContaining({ plan: "monthly", withTrial: false }));
    expect(used.secondary).toEqual(expect.objectContaining({ kind: "pricing" }));
  });

  it("speaks to someone who just backed out of the trial instead of pitching it again", () => {
    const screen = checkoutScreen({ outcome: "cancel", plan: "weekly", trial: true, eligibility: true });
    expect(screen.title).toBe("Your free trial is still waiting.");
    expect(screen.offer).toBe("trial");
    expect(trialStart(screen.primary)).toBe(true);
    expect(screen.secondary?.kind).toBe("pricing");
  });

  it("offers one plans link and the paid weekly plan once the trial is used", () => {
    for (const outcome of ["cancel", "start"] as const) {
      const screen = checkoutScreen({ outcome, plan: "weekly", trial: true, eligibility: false });
      expect(screen.mascot).toBe("thinking");
      expect(screen.offerPlan).toBe("weekly");
      expect(actions(screen).filter(action => action.kind === "pricing")).toHaveLength(1);
      expect(screen.secondary).toEqual(expect.objectContaining({ kind: "checkout", plan: "weekly", withTrial: false }));
      expect(actions(screen).some(trialStart)).toBe(false);
    }
  });

  it("shows the chosen plan's price after a paid cancel without a trial", () => {
    const screen = checkoutScreen({ outcome: "cancel", plan: "annual", trial: false, eligibility: false });
    expect(screen).toEqual(expect.objectContaining({ offer: "plan", offerPlan: "annual", title: "Let’s pick up where you left off." }));
    expect(screen.primary).toEqual({ kind: "checkout", plan: "annual", withTrial: false, label: "Try annual checkout again" });
  });

  it("confirms a deliberate trial start with the mascot and opens Stripe from it", () => {
    const screen = checkoutScreen({ outcome: "start", plan: "weekly", trial: true, eligibility: true });
    expect(screen).toEqual(expect.objectContaining({ mascot: "celebrate", offer: "trial", title: "Activate your 3-day free trial" }));
    expect(trialStart(screen.primary)).toBe(true);
  });

  it("falls back to the trial only when a paid checkout failed for an eligible account", () => {
    const base = { outcome: "start", plan: "monthly", trial: false } as const;
    expect(checkoutScreen({ ...base, eligibility: true }).secondary?.kind).toBe("pricing");
    expect(checkoutScreen({ ...base, eligibility: false, error: true }).secondary?.kind).toBe("pricing");
    expect(trialStart(checkoutScreen({ ...base, eligibility: true, error: true }).secondary)).toBe(true);
  });

  it("speaks to the paywall that opened the trial and keeps the default headline otherwise", () => {
    const start = { outcome: "start", plan: "weekly", trial: true, eligibility: true } as const;
    expect(checkoutScreen({ ...start, source: "export" }).title).toBe("Your tailored CV is ready to download");
    expect(checkoutScreen({ ...start, source: "ai" }).title).toBe("Unlock every AI feature");
    expect(checkoutScreen({ ...start, source: "tailoring" }).title).toBe("Tailor your CV for every job");
    expect(checkoutScreen(start).title).toBe("Activate your 3-day free trial");
    // The source never changes the used-trial, cancel or paid screens.
    expect(checkoutScreen({ ...start, eligibility: false, source: "export" }).title).toBe("You’ve already used your free trial");
    expect(checkoutScreen({ ...start, outcome: "cancel", source: "export" }).title).toBe("Your free trial is still waiting.");
    expect(checkoutScreen({ ...start, trial: false, source: "export" }).title).toBe("Complete your Pro purchase");
  });

  it("sends an existing subscriber to the billing portal instead of another checkout", () => {
    for (const trial of [true, false]) {
      const payment = checkoutScreen({ outcome: "start", plan: "weekly", trial, eligibility: false, portal: "payment" });
      expect(payment).toEqual(expect.objectContaining({ offer: "none", title: "Your last payment didn’t go through", secondary: null }));
      expect(payment.primary).toEqual({ kind: "portal", label: "Update payment method" });
      const manage = checkoutScreen({ outcome: "cancel", plan: "monthly", trial, eligibility: true, portal: "manage" });
      expect(manage.primary).toEqual({ kind: "portal", label: "Manage subscription" });
    }
  });

  it("dates the end of the trial in the user's language", () => {
    const now = new Date(2026, 10, 2, 12).getTime();
    expect(trialEndDate(3, "en-US", now)).toBe("November 5");
    expect(trialEndDate(3, "tr-TR", now)).toBe("5 Kasım");
  });
});

describe("welcome after checkout", () => {
  it("names the interrupted task, else the app", () => {
    expect(welcomeContinueLabel("export", "/app/cv/1?resume=export")).toBe("Download your CV");
    expect(welcomeContinueLabel("tailoring", "/app/cv/1?tailor=1")).toBe("Continue tailoring");
    expect(welcomeContinueLabel("ai", "/app/cv/1")).toBe("Continue with AI");
    expect(welcomeContinueLabel("cover_letter", "/app/cover-letters")).toBe("Write your cover letter");
    expect(welcomeContinueLabel(null, "/app")).toBe("Go to my CVs");
    expect(welcomeContinueLabel(null, "/app/resumes")).toBe("Go to my CVs");
    expect(welcomeContinueLabel(null, "/onboarding?step=upload")).toBe("Continue");
  });

  it("formats the period end like the trial date, and ignores missing or broken dates", () => {
    expect(planDate("2026-11-05T12:00:00Z", "en-US")).toBe("November 5");
    expect(planDate("2026-11-05T12:00:00Z", "tr-TR")).toBe("5 Kasım");
    expect(planDate(null, "en-US")).toBeNull();
    expect(planDate("not a date", "en-US")).toBeNull();
  });
});
