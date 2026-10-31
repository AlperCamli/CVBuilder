import type { CheckoutTarget } from "../../content/pricing";

// Decides what the checkout page says and offers before and after Stripe. Copy is
// returned as translation keys; the component translates and fills {{plan}}/{{price}}.
// Every "checkout" action opens Stripe directly, so no state routes through a second
// confirmation page.

export interface CheckoutChoice { plan: CheckoutTarget; withTrial: boolean }
export const checkoutKey = (choice: CheckoutChoice) => `${choice.plan}:${choice.withTrial}`;

export type CheckoutAction =
  | ({ kind: "checkout"; label: string } & CheckoutChoice)
  | { kind: "pricing"; label: string };

export type CheckoutMascot = "guide" | "point" | "celebrate" | "thinking";

export interface CheckoutScreen {
  mascot: CheckoutMascot;
  eyebrow: string;
  title: string;
  lead: string;
  /** "trial" shows the 3-day offer at zero today; "plan" shows offerPlan at its list price. */
  offer: "trial" | "plan";
  offerPlan: CheckoutTarget;
  primary: CheckoutAction;
  secondary: CheckoutAction;
}

export interface CheckoutScreenInput {
  outcome: "start" | "cancel";
  plan: CheckoutTarget;
  trial: boolean;
  /** null while the trial check runs or when it failed. */
  eligibility: boolean | null;
  error?: boolean;
}

const SEE_PLANS: CheckoutAction = { kind: "pricing", label: "See Pro plans" };
const START_TRIAL: CheckoutAction = { kind: "checkout", plan: "weekly", withTrial: true, label: "Start my 3-day free trial" };
const PAID_WEEKLY: CheckoutAction = { kind: "checkout", plan: "weekly", withTrial: false, label: "Continue with Weekly · {{price}}" };
const RETRY_LABEL: Record<CheckoutTarget, string> = {
  weekly: "Try weekly checkout again",
  monthly: "Try monthly checkout again",
  annual: "Try annual checkout again",
};

export function checkoutScreen({ outcome, plan, trial, eligibility, error = false }: CheckoutScreenInput): CheckoutScreen {
  const used = eligibility === false;
  const paid = (label: string): CheckoutAction => ({ kind: "checkout", plan, withTrial: false, label });

  if (trial && used) {
    return {
      mascot: "thinking", eyebrow: "YOUR NEXT STEP",
      title: outcome === "cancel" ? "Let’s pick up where you left off." : "You’ve already used your free trial",
      lead: "Your next step is saved. Choose a Pro plan to keep going.",
      offer: "plan", offerPlan: "weekly", primary: SEE_PLANS, secondary: PAID_WEEKLY,
    };
  }
  if (trial) {
    return outcome === "cancel"
      ? { mascot: "guide", eyebrow: "NOTHING TO PAY TODAY", title: "Your free trial is still waiting.",
          lead: "Nothing is charged today. Cancel before the 3 days end and you won’t pay a thing.",
          offer: "trial", offerPlan: "weekly", primary: START_TRIAL, secondary: SEE_PLANS }
      : { mascot: "celebrate", eyebrow: "3 DAYS OF PRO, FREE", title: "Activate your 3-day free trial",
          lead: "Your CV and selected next step are saved. We will take you back automatically after activation.",
          offer: "trial", offerPlan: "weekly", primary: START_TRIAL, secondary: SEE_PLANS };
  }
  if (outcome === "cancel") {
    return eligibility === true
      ? { mascot: "guide", eyebrow: "GIVE PRO A TRY", title: "Why don’t you try the free trial first?",
          lead: "A little time to see what Pro can do. All the features. Three days to explore.",
          offer: "trial", offerPlan: "weekly", primary: START_TRIAL, secondary: paid("Continue with {{plan}} · {{price}}") }
      : { mascot: "guide", eyebrow: "YOUR NEXT STEP", title: "Let’s pick up where you left off.",
          lead: "Your next step is saved. You can retry your purchase or explore the Pro plans.",
          offer: "plan", offerPlan: plan, primary: paid(RETRY_LABEL[plan]), secondary: SEE_PLANS };
  }
  return {
    mascot: "point", eyebrow: "ALMOST THERE", title: "Complete your Pro purchase",
    lead: "Your CV and selected next step are saved. We will take you back automatically after activation.",
    offer: "plan", offerPlan: plan, primary: paid("Continue to secure checkout"),
    // A failed paid checkout may still go through as a trial.
    secondary: error && eligibility === true ? { ...START_TRIAL, label: "Try 3 days free instead" } : SEE_PLANS,
  };
}
