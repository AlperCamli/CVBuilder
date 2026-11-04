import { Badge } from "@/components/Badge";
import type { FootnoteContext } from "@/components/MetricChartCard";
import { measureOf, useMetric, type MetricMeta } from "@/lib/api";
import { AI_SEGMENTS, type AiSegment, type Currency } from "@/lib/filters";
import { formatValue } from "@/lib/format";
import { sumColumn } from "@/lib/kpi";

/** Card extras shared by the pages that show revenue and AI cost (Overview, Monetization, AI cost). */

type Row = Record<string, unknown>;

const count = new Intl.NumberFormat("en-US");
const share = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

export const fxBadge = <Badge title="Some months use a provisional FX rate; converted amounts may still change.">FX provisional</Badge>;

export const AI_SEGMENT_LABELS: Record<AiSegment, string> = {
  external: "External",
  internal: "Admin",
  guest: "Guest",
  restricted: "Restricted / pending deletion",
  script: "Scripts and tests",
  unattributed: "Unattributed attempts",
};

/**
 * Cost per AI segment for the card's range and filters, fetched with every segment so the card can say what its
 * total leaves out: with all segments it lists what the total is made of, otherwise what was excluded.
 */
export function AiSegmentTotals({ card, currency }: { card: FootnoteContext; currency: Currency }) {
  const { ai_segment: shown, ...others } = card.params.filters;
  const all = useMetric(card.name, { ...card.filters, all_ai_costs: true, breakdown: "ai_segment", filters: others }, { enabled: shown !== undefined });
  // Only metrics that take the segment filter get one; before their migration there is nothing to split.
  if (shown === undefined || !all.meta?.breakdowns.includes("ai_segment") || !all.data) return null;
  const included = new Set((Array.isArray(shown) ? shown : [shown]).map(String));
  const totals = AI_SEGMENTS.map((segment) => ({
    segment,
    cost: sumColumn(all.data.rows.filter((r) => r.dimension === segment), "cost"),
  })).filter((t) => t.cost > 0);
  const everything = AI_SEGMENTS.every((segment) => included.has(segment));
  const listed = everything ? totals : totals.filter((t) => !included.has(t.segment));
  const parts = listed.map((t) => `${AI_SEGMENT_LABELS[t.segment]} ${formatValue(t.cost, "currency", currency)}`);
  if (!everything && !parts.length) return <p>Nothing excluded: other segments had no cost in this range.</p>;
  return parts.length ? <p>{everything ? "By segment: " : "Not included: "}{parts.join(" · ")}</p> : null;
}

export function aiCostFootnote(rows: Row[], meta: MetricMeta | undefined, currency: Currency, card: FootnoteContext) {
  const cost = sumColumn(rows, "cost");
  const unpriced = sumColumn(rows, "unpriced_runs");
  const exact = rows.reduce((total, r) => total + (Number(r.exact_share) || 0) * (Number(r.cost) || 0), 0);
  const stored = measureOf(meta, "exact_share");
  return (
    <>
      <p>
        {measureOf(meta, "unpriced_runs").label}: {count.format(unpriced)}
        {cost > 0 && (
          <>
            {" · "}
            <span title={stored.description ?? "Share of the shown cost stored when the run ran; not coverage of the provider bill."}>
              {stored.label}: {share.format(exact / cost)}
            </span>
          </>
        )}
      </p>
      <AiSegmentTotals card={card} currency={currency} />
    </>
  );
}

/** AI spend (ledger): attempts that add no cost, then the segment split. */
export function aiSpendFootnote(rows: Row[], meta: MetricMeta | undefined, currency: Currency, card: FootnoteContext) {
  const notes = [
    ["unpriced_attempts", sumColumn(rows, "unpriced_attempts")],
    ["no_usage_attempts", sumColumn(rows, "no_usage_attempts")],
  ] as const;
  const preLedger = sumColumn(rows, "pre_ledger_cost");
  return (
    <>
      <p>
        {notes.map(([key, n]) => `${measureOf(meta, key).label}: ${count.format(n)}`).join(" · ")}
        {preLedger > 0 && ` · ${measureOf(meta, "pre_ledger_cost").label}: ${formatValue(preLedger, "currency", currency)}`}
      </p>
      <AiSegmentTotals card={card} currency={currency} />
    </>
  );
}

export const aiCostBadges = (rows: Row[], _meta: MetricMeta | undefined, currency: Currency) =>
  currency === "try" && rows.some((r) => r.fx_provisional === true) ? fxBadge : null;

export const revenueFootnote = (rows: Row[], _meta: MetricMeta | undefined, currency: Currency) =>
  currency !== "native" && rows.some((r) => r.fx_provisional === true)
    ? "Includes months with a provisional FX rate; converted amounts may still change."
    : null;

/** Converted-currency charts flag provisional FX the same way everywhere. */
export const fxBadges = (rows: Row[], _meta: MetricMeta | undefined, currency: Currency) =>
  currency !== "native" && rows.some((r) => r.fx_provisional === true) ? fxBadge : null;
