export type CheckoutTarget = "pro" | "lifetime";

export const PRO_MONTHLY_PRICE = "$10";
export const LIFETIME_PRICE = "$99";

export interface PlanCard {
  code: "free" | "pro" | "lifetime";
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
}

export const PLAN_CARDS: PlanCard[] = [
  {
    code: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try the basics, no card required.",
    features: [
      "3 customized CVs per month",
      "5 exports per month",
      "20 AI actions per month",
      "25 MB storage"
    ]
  },
  {
    code: "pro",
    name: "Monthly Pro",
    price: PRO_MONTHLY_PRICE,
    period: "per month",
    description: "Everything you need for an active job search.",
    highlighted: true,
    badge: "3-day free trial",
    features: [
      "Unlimited customized CVs",
      "Unlimited exports (PDF + DOCX)",
      "Unlimited AI actions",
      "Unlimited storage",
      "Cancel anytime"
    ]
  },
  {
    code: "lifetime",
    name: "Lifetime Pro",
    price: LIFETIME_PRICE,
    period: "one-time",
    description: "Pay once. Use forever.",
    badge: "Best value",
    features: [
      "Everything in Monthly Pro",
      "No recurring charges",
      "Lifetime access to future updates",
      "Best long-term value"
    ]
  }
];
