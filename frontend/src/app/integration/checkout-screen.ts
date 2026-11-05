import { TRIAL_PLAN, type CheckoutTarget } from "../../content/pricing";
import type { CheckoutSource } from "./subscription-flow";
import type { PromotionUnavailableDetail } from "./promotion-offer";

// Decides what the checkout page says and offers before and after Stripe. Copy is
// returned as translation keys; the component translates and fills {{plan}}/{{price}}.
// Every "checkout" action opens Stripe directly, so no state routes through a second
// confirmation page. The trial is always the trial plan's (Monthly); Weekly is sold without one.

export interface CheckoutChoice { plan: CheckoutTarget; withTrial: boolean }
export const checkoutKey = (choice: CheckoutChoice) => `${choice.plan}:${choice.withTrial}`;

export type CheckoutAction =
  | ({ kind: "checkout"; label: string } & CheckoutChoice)
  | { kind: "pricing"; label: string }
  | { kind: "portal"; label: string }
  | { kind: "switch_account"; label: string };

export type CheckoutMascot = "guide" | "point" | "celebrate" | "thinking";

export interface CheckoutScreen {
  mascot: CheckoutMascot;
  eyebrow: string;
  title: string;
  lead: string;
  /** "trial" shows the 3-day offer at zero today (offerPlan: the trial plan); "plan" shows offerPlan at its list price; "none" only the actions. */
  offer: "trial" | "plan" | "none";
  offerPlan: CheckoutTarget;
  primary: CheckoutAction;
  secondary: CheckoutAction | null;
}

export interface CheckoutScreenInput {
  outcome: "start" | "cancel";
  plan: CheckoutTarget;
  trial: boolean;
  /** null while the trial check runs or when it failed. */
  eligibility: boolean | null;
  error?: boolean;
  /** The paywall that sent the user here, for the trial headline. */
  source?: CheckoutSource | null;
  /** The account already has a Stripe subscription: "payment" when its renewal failed. */
  portal?: "payment" | "manage" | null;
  /** Checkout refused the emailed offer (409 promotion_unavailable). */
  promotionIssue?: PromotionUnavailableDetail | null;
  /** An active emailed offer discounts this plan: no trial pitch in its place. */
  promotion?: boolean;
}

const SEE_PLANS: CheckoutAction = { kind: "pricing", label: "See Pro plans" };
const START_TRIAL: CheckoutAction = { kind: "checkout", plan: TRIAL_PLAN, withTrial: true, label: "Start my 3-day free trial" };
// After a used trial: the plan the trial would have become, paid now at its price.
const PAID_TRIAL_PLAN: CheckoutAction = { kind: "checkout", plan: TRIAL_PLAN, withTrial: false, label: "Continue with {{plan}} · {{price}}" };
const REGULAR_PRICE_LABEL = "Continue at the regular price · {{price}}";
const PROMOTION_ISSUE: Record<PromotionUnavailableDetail, { title: string; lead: string }> = {
  ended: { title: "This offer has ended", lead: "The discount is no longer available, but you can still get Pro at the regular price. Your CV and next step are saved." },
  upcoming: { title: "Your offer hasn’t started yet", lead: "The discount opens at the time in your email. You can come back then, or continue at the regular price now." },
  wrong_account: { title: "This offer belongs to another account", lead: "The discount is linked to the email address we sent it to. Sign in with that account to use it, or continue here at the regular price." },
  plan_not_eligible: { title: "The offer doesn’t cover this plan", lead: "Your discount applies to one plan only. You can continue with this plan at the regular price or compare the plans." },
  redeemed: { title: "You’ve already used this offer", lead: "The discount can be used once per account. You can still continue at the regular price." },
  invalid: { title: "We couldn’t verify this offer", lead: "The offer link may be incomplete or out of date. You can still continue at the regular price." },
};

const RETRY_LABEL: Record<CheckoutTarget, string> = {
  weekly: "Try weekly checkout again",
  monthly: "Try monthly checkout again",
  annual: "Try annual checkout again",
};

const TRIAL_HEADLINE: Record<CheckoutSource, { title: string; lead: string }> = {
  export: { title: "Your tailored CV is ready to download", lead: "Start your free trial to download it as PDF or DOCX. Nothing to pay today." },
  ai: { title: "Unlock every AI feature", lead: "Improve, rewrite and tailor with AI, free for 3 days. Nothing to pay today." },
  tailoring: { title: "Tailor your CV for every job", lead: "Create a tailored CV for each application, free for 3 days. Nothing to pay today." },
  cover_letter: { title: "Write a cover letter for every job", lead: "Create a matching cover letter for each application, free for 3 days. Nothing to pay today." },
};

/** The trial end as the user reads it in their own time zone, e.g. "November 5". */
export function trialEndDate(days: number, locale: string, now = Date.now()): string {
  return new Date(now + days * 86_400_000).toLocaleDateString(locale, { month: "long", day: "numeric" });
}

/** A billing period end (trial end or renewal) in the same "November 5" form; null when unknown. */
export function planDate(iso: string | null, locale: string): string | null {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale, { month: "long", day: "numeric" }) : null;
}

const CONTINUE_LABEL: Record<CheckoutSource, string> = {
  export: "Download your CV",
  tailoring: "Continue tailoring",
  ai: "Continue with AI",
  cover_letter: "Write your cover letter",
};

/** The welcome button names the task the paywall interrupted; without one it opens the app. */
export function welcomeContinueLabel(source: CheckoutSource | null, destination: string): string {
  if (source) return CONTINUE_LABEL[source];
  return /^\/app(\/resumes)?\/?$/.test(destination) ? "Go to my CVs" : "Continue";
}

export function checkoutScreen({ outcome, plan, trial, eligibility, error = false, source = null, portal = null, promotionIssue = null, promotion = false }: CheckoutScreenInput): CheckoutScreen {
  const used = eligibility === false;
  const paid = (label: string): CheckoutAction => ({ kind: "checkout", plan, withTrial: false, label });

  if (portal) {
    return portal === "payment"
      ? { mascot: "thinking", eyebrow: "PAYMENT NEEDED", title: "Your last payment didn’t go through",
          lead: "Update your payment method to keep your Pro subscription. Your CVs and next step are saved.",
          offer: "none", offerPlan: plan, primary: { kind: "portal", label: "Update payment method" }, secondary: null }
      : { mascot: "point", eyebrow: "YOUR NEXT STEP", title: "You already have a subscription",
          lead: "Manage it in the billing portal. Your CVs and next step are saved.",
          offer: "none", offerPlan: plan, primary: { kind: "portal", label: "Manage subscription" }, secondary: null };
  }

  // Never a silent fallback to full price: say why, then offer the regular price.
  if (promotionIssue) {
    const copy = PROMOTION_ISSUE[promotionIssue];
    return {
      mascot: "thinking", eyebrow: "ABOUT YOUR OFFER", title: copy.title, lead: copy.lead,
      offer: "plan", offerPlan: plan,
      primary: promotionIssue === "wrong_account" ? { kind: "switch_account", label: "Sign in with the emailed account" } : paid(REGULAR_PRICE_LABEL),
      secondary: promotionIssue === "wrong_account" ? paid(REGULAR_PRICE_LABEL) : SEE_PLANS,
    };
  }

  if (trial && used) {
    return {
      mascot: "thinking", eyebrow: "YOUR NEXT STEP",
      title: outcome === "cancel" ? "Let’s pick up where you left off." : "You’ve already used your free trial",
      lead: "Your next step is saved. Choose a Pro plan to keep going.",
      offer: "plan", offerPlan: TRIAL_PLAN, primary: SEE_PLANS, secondary: PAID_TRIAL_PLAN,
    };
  }
  if (trial) {
    return outcome === "cancel"
      ? { mascot: "guide", eyebrow: "NOTHING TO PAY TODAY", title: "Your free trial is still waiting.",
          lead: "Nothing is charged today. Cancel before the 3 days end and you won’t pay a thing.",
          offer: "trial", offerPlan: TRIAL_PLAN, primary: START_TRIAL, secondary: SEE_PLANS }
      : { mascot: "celebrate", eyebrow: "3 DAYS OF PRO, FREE",
          title: source ? TRIAL_HEADLINE[source].title : "Activate your 3-day free trial",
          lead: source ? TRIAL_HEADLINE[source].lead : "Your CV and selected next step are saved. We will take you back automatically after activation.",
          offer: "trial", offerPlan: TRIAL_PLAN, primary: START_TRIAL, secondary: SEE_PLANS };
  }
  if (outcome === "cancel" && promotion) {
    // Back from Stripe with the offer still on: the discount stays first, the trial is the way to try before paying.
    return { mascot: "guide", eyebrow: "YOUR OFFER IS STILL ON", title: "Your discount is still waiting.",
      lead: eligibility === true
        ? "Your discounted first month is saved. Not ready to pay? Try Pro free for 3 days instead. Cancel before it ends and you pay nothing."
        : "Your discounted first month is saved. You can pick it up now or explore the Pro plans.",
      offer: "plan", offerPlan: plan, primary: paid("Claim my discount"),
      secondary: eligibility === true ? { ...START_TRIAL, label: "Try for free" } : SEE_PLANS };
  }
  if (outcome === "cancel") {
    return eligibility === true && !promotion
      ? { mascot: "guide", eyebrow: "GIVE PRO A TRY", title: "Why don’t you try the free trial first?",
          lead: "A little time to see what Pro can do. All the features. Three days to explore.",
          offer: "trial", offerPlan: TRIAL_PLAN, primary: START_TRIAL, secondary: paid("Continue with {{plan}} · {{price}}") }
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
