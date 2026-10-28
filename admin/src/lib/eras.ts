import { todayUtc } from "./filters";

export interface Era {
  date: string;
  label: string;
  /** Metric (function) names whose numbers change meaning at this date. */
  metrics: string[];
}

/** Data-era cutoffs from the KB (`new_analysis/README.md`, "Era cutoffs"). Never mix eras silently. */
export const ERAS: Era[] = [
  { date: "2026-04-29", label: "AI token counts recorded", metrics: ["ai_cost", "kpi_overview", "ai_tokens_by_model"] },
  {
    date: "2026-06-03",
    label: "Import improve fans out; block suggestions auto-applied",
    metrics: ["ai_cost", "ai_reliability", "tailoring_card_acceptance"],
  },
  {
    date: "2026-10-06",
    label: "Guest upload onboarding and consents",
    metrics: ["signups", "kpi_overview", "activation_funnel", "onboarding_segments", "import_quality", "stickiness"],
  },
  {
    date: "2026-10-12",
    label: "Regional pricing (TRY)",
    metrics: ["revenue", "kpi_overview", "mrr_movement", "plan_mix", "subscriber_ltv"],
  },
  {
    date: "2026-10-24",
    label: "Subscription paywall and trial transition",
    metrics: ["revenue", "kpi_overview", "trial_to_paid", "checkout_funnel", "paywall_denials"],
  },
  {
    date: "2026-10-26",
    label: "Manual-signup onboarding metrics counted",
    metrics: ["activation_funnel", "onboarding_segments"],
  },
  {
    date: "2026-10-27",
    label: "Exact AI cost per run; tailoring v2",
    metrics: ["ai_cost", "kpi_overview", "ai_cost_per_outcome", "ai_wasted_spend", "tailoring_funnel", "tailoring_task_reliability", "tailoring_card_acceptance"],
  },
  {
    date: "2026-10-29",
    label: "Subscription history and invoices tracked",
    metrics: [
      "revenue",
      "kpi_overview",
      "mrr_movement",
      "trial_to_paid",
      "checkout_funnel",
      "subscription_churn",
      "payment_issues",
      "paywall_denials",
      "stickiness",
    ],
  },
];

export const erasFor = (metric: string, eras: Era[] = ERAS) => eras.filter((e) => e.metrics.includes(metric));

export interface EraMarker extends Era {
  /** The chart bucket that contains the era date. */
  bucket: string;
}

/**
 * Eras dated inside the selected range [from, to] (never after today), each pinned to the bucket containing its
 * date. The range, not the bucket bounds, decides: a week or month bucket can start before `from` or run past `to`.
 */
export function eraMarkers(eras: Era[], buckets: string[], range: { from: string; to: string }, now = new Date()): EraMarker[] {
  if (!buckets.length) return [];
  const sorted = [...buckets].sort();
  const today = todayUtc(now);
  const end = range.to < today ? range.to : today;
  return eras.flatMap((era) => {
    if (era.date < range.from || era.date > end) return [];
    const bucket = sorted.filter((b) => b <= era.date).at(-1) ?? sorted[0];
    return [{ ...era, bucket }];
  });
}
