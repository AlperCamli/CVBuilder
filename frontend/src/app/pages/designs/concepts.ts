import {
  ANNUAL_TOTAL_PRICE,
  MONTHLY_TOTAL_PRICE,
  PLAN_VALUE_USD,
  WEEKLY_PRICE,
  type CheckoutTarget,
} from "../../../content/pricing";

export const CONCEPTS = [
  {
    id: "journey",
    number: "01",
    name: "A little guidance",
    label: "Journey",
    description: "A warm welcome. A clear next step.",
    practice: "Mascot-led storytelling",
    details:
      "Ivory, sea green, soft shapes, and a guided story that makes a job search feel a little more human.",
  },
  {
    id: "studio",
    number: "02",
    name: "Show your work",
    label: "Studio",
    description: "Let the product do the talking.",
    practice: "Interactive product demonstration",
    details:
      "Midnight blue, electric lime, and a working sample that puts the tailoring process in your hands.",
  },
  {
    id: "editorial",
    number: "03",
    name: "The next chapter",
    label: "Editorial",
    description: "Your experience deserves a good story.",
    practice: "Editorial storytelling & visible output",
    details:
      "Paper, ink, vermilion, and confident typography. A considered, document-first approach to your next move.",
  },
  {
    id: "companion",
    number: "04",
    name: "Your helpful companion",
    label: "Companion",
    description: "A friendly guide. The real editing experience.",
    practice: "Guided product experience",
    details:
      "Fresh mint, an open layout, and the mascot beside a demo built around the real editor. Monthly Pro takes the lead.",
  },
  {
    id: "canvas",
    number: "05",
    name: "A fresh canvas",
    label: "Canvas",
    description: "A little warmth. A lot less noise.",
    practice: "Warm, focused storytelling",
    details:
      "Butter yellow, confident type, and a spacious product canvas. A short guided tour shows the value before the price.",
  },
  {
    id: "momentum",
    number: "06",
    name: "Keep your momentum",
    label: "Momentum",
    description: "One workspace. Every opportunity.",
    practice: "Product-first, subscription-led",
    details:
      "Deep forest, peach accents, and a prominent live editor. A focused Monthly Pro offer keeps an active search moving.",
  },
] as const;

export type Concept = (typeof CONCEPTS)[number]["id"];
export type NewConcept = "companion" | "canvas" | "momentum";
export const isNewConcept = (concept: Concept): concept is NewConcept =>
  concept === "companion" || concept === "canvas" || concept === "momentum";

export const ANNUAL_SAVINGS_PERCENT = Math.round(
  (1 - PLAN_VALUE_USD.annual / (PLAN_VALUE_USD.monthly * 12)) * 100,
);

export const BILLING: Record<
  CheckoutTarget,
  { label: string; price: string; interval: string; renewal: string }
> = {
  weekly: {
    label: "Weekly",
    price: WEEKLY_PRICE,
    interval: "week",
    renewal: "Renews every week",
  },
  monthly: {
    label: "Monthly",
    price: MONTHLY_TOTAL_PRICE,
    interval: "month",
    renewal: "Renews every month",
  },
  annual: {
    label: "Annual",
    price: ANNUAL_TOTAL_PRICE,
    interval: "year",
    renewal: "Renews every year",
  },
};

export const ORIGINAL_SENTENCE =
  "Created weekly reports in Excel and worked with sales data.";
export const TAILORED_SENTENCE =
  "Prepared weekly Excel reports to track sales performance and highlight trends.";
export const NARROW_SENTENCE = "Created weekly Excel reports using sales data.";
