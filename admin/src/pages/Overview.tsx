import { AlertTriangle } from "lucide-react";
import { SmallSampleBadge } from "@/components/Badge";
import { errorCopy, InfoTip } from "@/components/ChartCard";
import { KpiTile, type KpiPart } from "@/components/KpiTile";
import { MetricChartCard } from "@/components/MetricChartCard";
import { aiCostBadges, aiCostFootnote, fxBadge, revenueFootnote } from "@/components/metricExtras";
import { DEFAULT_MIN_GROUP, ignoredFilters, measureOf } from "@/lib/api";
import { useFilters, type Currency, type GlobalFilters } from "@/lib/filters";
import { formatBucketLong, formatValue, notFilteredBy } from "@/lib/format";
import { useKpiRow } from "@/lib/kpi";

const KPI = "kpi_overview";
const SIGNUPS = "signups";
const REVENUE = "revenue";
const AI_COST = "ai_cost";
/** Metrics on this page; the filter bar uses it to flag filters none of them accept. */
export const OVERVIEW_METRICS = [KPI, SIGNUPS, REVENUE, AI_COST];

const NATIVE_CURRENCIES = [
  { label: "USD", suffix: "_usd_native", currency: "usd" },
  { label: "TRY", suffix: "_try_native", currency: "try" },
] as const;

const count = new Intl.NumberFormat("en-US");

function OverviewKpis({ filters }: { filters: GlobalFilters }) {
  const kpi = useKpiRow(KPI, filters);
  const { meta, row } = kpi;
  const native = filters.currency === "native";
  const minGroup = meta?.min_group ?? DEFAULT_MIN_GROUP;
  const flag = (key: string) => row?.[key] === true;

  const label = (key: string, fallback: string) => measureOf(meta, key, fallback).label;
  const format = (key: string, currency: Currency = filters.currency, unitKey = key) => {
    const value = kpi.value(key);
    return value === undefined ? undefined : formatValue(value, measureOf(meta, unitKey).unit, currency);
  };
  const info = (title: string, keys: string[]) => meta && <InfoTip title={title} meta={meta} measures={keys} />;
  /** "Not filtered by plan" when an active page filter doesn't narrow these columns. */
  const caveat = (keys: string[]) => notFilteredBy(ignoredFilters(meta, filters, keys)) || undefined;
  const common = { loading: kpi.loading, deltaLoading: kpi.deltaLoading, comparisonLabel: kpi.comparisonLabel };
  const tile = (key: string, fallback: string, keys = [key]) => ({
    ...common,
    label: label(key, fallback),
    value: format(key),
    ...kpi.delta(key),
    info: info(label(key, fallback), keys),
    caveat: caveat(keys),
  });
  /** In native mode `revenue`/`mrr` are null; USD and TRY are shown side by side instead of being converted. */
  const money = (key: string, fallback: string) => {
    const badges = flag(`${key}_fx_provisional`) && fxBadge;
    if (!native) return { ...tile(key, fallback), badges };
    const parts: KpiPart[] = NATIVE_CURRENCIES.map(({ label: name, suffix, currency }) => ({
      label: name,
      value: format(`${key}${suffix}`, currency, key),
      ...kpi.delta(`${key}${suffix}`),
    }));
    const keys = [key, ...NATIVE_CURRENCIES.map(({ suffix }) => `${key}${suffix}`)];
    return { ...common, label: label(key, fallback), parts, badges, info: info(label(key, fallback), keys), caveat: caveat(keys) };
  };
  const rate = (key: string, fallback: string) => {
    const value = kpi.value(key);
    return value === undefined ? undefined : `${label(key, fallback)} ${formatValue(value, measureOf(meta, key).unit, filters.currency)}`;
  };

  const eligible = kpi.value("activation_eligible");
  const rateDelta = kpi.delta("activation_rate");
  const trialStarts = kpi.value("trial_starts");
  const trialResolved = kpi.value("trial_resolved");
  const trialConversions = kpi.value("trial_conversions");
  const unpriced = kpi.value("unpriced_ai_runs") ?? 0;
  const aiCurrency: Currency = filters.currency === "try" ? "try" : "usd";
  const endOfRange = `At end of ${formatBucketLong(filters.to, "day")}`;

  if (kpi.error && !row) {
    const copy = errorCopy(kpi.error);
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-delta-bad" aria-hidden="true" />
        <span>
          Key metrics could not be loaded: {copy.title}. {copy.body}
        </span>
      </div>
    );
  }

  const activationKeys = ["activated_users", "activation_rate", "activation_eligible", "activated_eligible"];
  const trialKeys = ["trial_to_paid_rate", "trial_conversions", "trial_resolved", "trial_starts"];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile {...tile("signups", "Signups")} />
      {/* Recent signups haven't had their 7 days yet, so the comparison and sample size use the eligible cohort's rate. */}
      <KpiTile
        {...tile("activated_users", "Activated users", activationKeys)}
        current={rateDelta.current}
        previous={rateDelta.previous}
        deltaFormat="points"
        comparisonLabel={kpi.comparisonLabel && `rate ${kpi.comparisonLabel}`}
        note={
          rate("activation_rate", "Activation rate") &&
          `${rate("activation_rate", "Activation rate")}${eligible !== undefined ? ` of ${count.format(eligible)} signups past 7 days` : ""}`
        }
        badges={eligible !== undefined && eligible < minGroup && <SmallSampleBadge minGroup={minGroup} />}
      />
      <KpiTile {...tile("new_paying_customers", "New paying customers")} />
      <KpiTile {...money("revenue", "Revenue")} />
      <KpiTile {...money("mrr", "MRR")} note={endOfRange} />
      <KpiTile {...tile("active_subscriptions", "Active subscriptions")} note={endOfRange} />
      <KpiTile
        {...tile("trial_to_paid_rate", "Trial → paid rate", trialKeys)}
        deltaFormat="points"
        note={
          trialResolved !== undefined &&
          trialConversions !== undefined &&
          `${count.format(trialConversions)} of ${count.format(trialResolved)} resolved${
            trialStarts !== undefined ? ` (${count.format(trialStarts)} started)` : ""
          }`
        }
        badges={trialResolved !== undefined && trialResolved < minGroup && <SmallSampleBadge minGroup={minGroup} />}
      />
      <KpiTile
        {...tile("ai_cost", "AI cost", ["ai_cost", "ai_runs", "unpriced_ai_runs"])}
        value={kpi.value("ai_cost") === undefined ? undefined : format("ai_cost", aiCurrency)}
        upIsGood={false}
        badges={flag("ai_cost_fx_provisional") && fxBadge}
        note={unpriced > 0 && `${count.format(unpriced)} unpriced runs not included`}
      />
    </div>
  );
}

export function OverviewPage() {
  const [filters, setFilters] = useFilters();

  return (
    <>
      <OverviewKpis filters={filters} />
      <MetricChartCard name={SIGNUPS} filters={filters} setFilters={setFilters} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MetricChartCard
          name={REVENUE}
          measure="revenue"
          native="split"
          sampleMeasure="invoices"
          footnote={revenueFootnote}
          filters={filters}
          setFilters={setFilters}
        />
        <MetricChartCard
          name={AI_COST}
          measure="cost"
          native="usd"
          sampleMeasure="runs"
          footnote={aiCostFootnote}
          badges={aiCostBadges}
          filters={filters}
          setFilters={setFilters}
        />
      </div>
    </>
  );
}
