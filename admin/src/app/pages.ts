import type { ComponentProps } from "react";
import type { MetricChartCard } from "@/components/MetricChartCard";
import { aiCostBadges, aiCostFootnote, fxBadges, revenueFootnote } from "@/components/metricExtras";
import type { Shape } from "@/lib/shapes";

type CardOptions = Pick<
  ComponentProps<typeof MetricChartCard>,
  "measure" | "native" | "sampleMeasure" | "footnote" | "badges" | "variant" | "topN"
>;

/**
 * One chart on a page. Only `name` is required by the renderer; `title` labels the card until the catalog has the
 * metric, and `shape` (from metrics-plan.md) sizes it before the catalog loads. The catalog's shape wins.
 */
export interface PageMetric extends CardOptions {
  name: string;
  title: string;
  shape: Shape;
}

export interface PageSection {
  title: string;
  metrics: PageMetric[];
}

const ai = (name: string, title: string, shape: Shape, extra: CardOptions = {}): PageMetric => ({
  name,
  title,
  shape,
  native: "usd",
  badges: aiCostBadges,
  ...extra,
});

export const MONETIZATION: PageSection[] = [
  {
    title: "Revenue and MRR",
    metrics: [
      { name: "mrr_movement", title: "MRR movement", shape: "timeseries", native: "split", badges: fxBadges },
      {
        name: "revenue",
        title: "Revenue",
        shape: "timeseries",
        measure: "revenue",
        native: "split",
        sampleMeasure: "invoices",
        footnote: revenueFootnote,
      },
      { name: "plan_mix", title: "Plan mix", shape: "breakdown" },
      { name: "subscriber_ltv", title: "Subscriber LTV", shape: "breakdown", badges: fxBadges },
    ],
  },
  {
    title: "Conversion",
    metrics: [
      { name: "trial_to_paid", title: "Trial → paid", shape: "timeseries" },
      { name: "paywall_denials", title: "Paywall denials", shape: "timeseries" },
      { name: "checkout_funnel", title: "Checkout funnel", shape: "funnel" },
    ],
  },
  {
    title: "Churn and payment issues",
    metrics: [
      { name: "subscription_churn", title: "Subscription churn", shape: "timeseries" },
      { name: "payment_issues", title: "Payment issues", shape: "timeseries", badges: fxBadges },
      { name: "cancellation_reasons", title: "Cancellation reasons", shape: "breakdown" },
    ],
  },
];

export const AI_COST: PageSection[] = [
  {
    title: "Spend",
    metrics: [
      ai("ai_cost", "AI cost", "timeseries", { measure: "cost", sampleMeasure: "runs", footnote: aiCostFootnote }),
      ai("ai_cost_anomalies", "Daily cost anomalies", "timeseries"),
      ai("ai_tokens_by_model", "Tokens by model", "timeseries"),
    ],
  },
  {
    title: "Unit economics",
    metrics: [
      ai("ai_cost_per_outcome", "Cost per outcome", "breakdown"),
      ai("ai_cost_by_plan", "Cost by plan", "breakdown"),
      ai("ai_cost_concentration", "Cost concentration", "breakdown"),
      ai("ai_wasted_spend", "Wasted spend", "timeseries"),
    ],
  },
  {
    title: "Reliability",
    metrics: [ai("ai_reliability", "AI reliability", "timeseries")],
  },
];

export const ENGAGEMENT: PageSection[] = [
  {
    title: "Activity",
    metrics: [
      { name: "active_users", title: "Active users", shape: "timeseries" },
      { name: "stickiness", title: "Stickiness", shape: "timeseries" },
    ],
  },
  {
    title: "Retention and growth",
    metrics: [
      { name: "cohort_retention", title: "Cohort retention", shape: "cohort" },
      { name: "growth_accounting", title: "Growth accounting", shape: "timeseries" },
    ],
  },
  {
    title: "Features",
    metrics: [{ name: "feature_adoption", title: "Feature adoption", shape: "breakdown" }],
  },
];

export const TAILORING: PageSection[] = [
  {
    title: "Sessions",
    metrics: [
      { name: "tailoring_task_reliability", title: "Task reliability", shape: "timeseries" },
      { name: "tailoring_funnel", title: "Tailoring funnel", shape: "funnel" },
    ],
  },
  {
    title: "Suggestions",
    metrics: [
      { name: "tailoring_card_acceptance", title: "Card acceptance", shape: "breakdown" },
      { name: "tailoring_questions", title: "Question engagement", shape: "breakdown" },
    ],
  },
];

export const ACQUISITION: PageSection[] = [
  {
    title: "Signups and activation",
    metrics: [
      { name: "signups", title: "Signups", shape: "timeseries" },
      { name: "activation_funnel", title: "Activation funnel", shape: "funnel" },
      { name: "onboarding_segments", title: "Onboarding segments", shape: "breakdown" },
    ],
  },
  {
    title: "Imports and languages",
    metrics: [
      { name: "import_quality", title: "Import quality", shape: "breakdown" },
      { name: "language_adoption", title: "Language adoption", shape: "breakdown" },
    ],
  },
];

export const metricsOf = (sections: PageSection[]) => sections.flatMap((s) => s.metrics.map((m) => m.name));
