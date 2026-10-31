import { describe, expect, it } from "vitest";
import { checkoutScreen, type CheckoutAction } from "./checkout-screen";
import type { CheckoutTarget } from "../../content/pricing";

const actions = (screen: ReturnType<typeof checkoutScreen>) => [screen.primary, screen.secondary];
const trialStart = (action: CheckoutAction) => action.kind === "checkout" && action.withTrial;

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

  it("speaks to someone who just backed out of the trial instead of pitching it again", () => {
    const screen = checkoutScreen({ outcome: "cancel", plan: "weekly", trial: true, eligibility: true });
    expect(screen.title).toBe("Your free trial is still waiting.");
    expect(screen.offer).toBe("trial");
    expect(trialStart(screen.primary)).toBe(true);
    expect(screen.secondary.kind).toBe("pricing");
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
    expect(checkoutScreen({ ...base, eligibility: true }).secondary.kind).toBe("pricing");
    expect(checkoutScreen({ ...base, eligibility: false, error: true }).secondary.kind).toBe("pricing");
    expect(trialStart(checkoutScreen({ ...base, eligibility: true, error: true }).secondary)).toBe(true);
  });
});
