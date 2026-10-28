import { Badge } from "@/components/Badge";
import { measureOf, type MetricMeta } from "@/lib/api";
import type { Currency } from "@/lib/filters";
import { sumColumn } from "@/lib/kpi";

/** Card extras shared by the pages that show revenue and AI cost (Overview, Monetization, AI cost). */

type Row = Record<string, unknown>;

const count = new Intl.NumberFormat("en-US");
const share = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

export const fxBadge = <Badge title="Some months use a provisional FX rate; converted amounts may still change.">FX provisional</Badge>;

export function aiCostFootnote(rows: Row[], meta: MetricMeta | undefined) {
  const cost = sumColumn(rows, "cost");
  const unpriced = sumColumn(rows, "unpriced_runs");
  const exact = rows.reduce((total, r) => total + (Number(r.exact_share) || 0) * (Number(r.cost) || 0), 0);
  return (
    <>
      {measureOf(meta, "unpriced_runs").label}: {count.format(unpriced)}
      {cost > 0 && ` · ${measureOf(meta, "exact_share").label}: ${share.format(exact / cost)}`}
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
