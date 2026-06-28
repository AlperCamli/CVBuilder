export type CheckoutTarget = "weekly" | "monthly" | "annual";
export type VisiblePlanCode = "free" | CheckoutTarget;
export type LegacyPaidPlanCode = "pro" | "lifetime";

export const WEEKLY_PRICE = "$5";
export const MONTHLY_TOTAL_PRICE = "$15";
export const MONTHLY_WEEKLY_EQUIVALENT = "$3.46";
export const ANNUAL_TOTAL_PRICE = "$99";
export const ANNUAL_WEEKLY_EQUIVALENT = "$1.90";

export interface PlanCard {
  code: VisiblePlanCode;
  name: string;
  weeklyPrice: string;
  totalPrice: string;
  billingPeriod: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
  savings?: string;
  trialEligible?: boolean;
}

export const PLAN_CARDS: PlanCard[] = [
  {
    code: "free",
    name: "Free",
    weeklyPrice: "$0",
    totalPrice: "$0",
    billingPeriod: "forever",
    description: "Try the basics, no card required.",
    features: [
      "3 customized CVs per month",
      "5 exports per month",
      "20 AI actions per month",
      "25 MB storage"
    ]
  },
  {
    code: "weekly",
    name: "Weekly",
    weeklyPrice: WEEKLY_PRICE,
    totalPrice: "$5 billed weekly",
    billingPeriod: "per week",
    description: "Start with the lowest commitment.",
    badge: "3-day free trial",
    trialEligible: true,
    features: [
      "Unlimited customized CVs",
      "Unlimited exports (PDF + DOCX)",
      "Unlimited AI actions",
      "Cover letters and job tracking",
      "Cancel anytime"
    ]
  },
  {
    code: "monthly",
    name: "Monthly",
    weeklyPrice: MONTHLY_WEEKLY_EQUIVALENT,
    totalPrice: `${MONTHLY_TOTAL_PRICE} billed monthly`,
    billingPeriod: "per week",
    description: "For an active job search month.",
    highlighted: true,
    badge: "Most popular",
    savings: "Save 31% vs weekly",
    features: [
      "Unlimited customized CVs",
      "Unlimited exports (PDF + DOCX)",
      "Unlimited AI actions",
      "Cover letters and job tracking",
      "Cancel anytime"
    ]
  },
  {
    code: "annual",
    name: "Annual",
    weeklyPrice: ANNUAL_WEEKLY_EQUIVALENT,
    totalPrice: `${ANNUAL_TOTAL_PRICE} billed annually`,
    billingPeriod: "per week",
    description: "Best value for a long-term search.",
    badge: "Best value",
    savings: "Save 62% vs weekly",
    features: [
      "Unlimited customized CVs",
      "Unlimited exports (PDF + DOCX)",
      "Unlimited AI actions",
      "Cover letters and job tracking",
      "Lowest weekly price"
    ]
  }
];

export const PAID_PLAN_CARDS = PLAN_CARDS.filter(
  (card): card is PlanCard & { code: CheckoutTarget } => card.code !== "free"
);

export const CHECKOUT_TARGETS: CheckoutTarget[] = ["weekly", "monthly", "annual"];

export const isCheckoutTarget = (value: unknown): value is CheckoutTarget =>
  CHECKOUT_TARGETS.includes(value as CheckoutTarget);

export const isLegacyPaidPlanCode = (value: unknown): value is LegacyPaidPlanCode =>
  value === "pro" || value === "lifetime";

export const isPaidPlanCode = (value: unknown): value is CheckoutTarget | LegacyPaidPlanCode =>
  isCheckoutTarget(value) || isLegacyPaidPlanCode(value);

export const PLAN_VALUE_USD: Record<CheckoutTarget, number> = {
  weekly: 5,
  monthly: 15,
  annual: 99
};
