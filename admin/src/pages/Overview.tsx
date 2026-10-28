import { KpiTile } from "@/components/KpiTile";
import { MetricChartCard } from "@/components/MetricChartCard";
import { Sparkline } from "@/components/Sparkline";
import { useFilters } from "@/lib/filters";
import { formatValue } from "@/lib/format";
import { useKpi } from "@/lib/kpi";

const SIGNUPS = "signups";
/** Metrics on this page; the filter bar uses it to flag filters none of them accept. */
export const OVERVIEW_METRICS = [SIGNUPS];

export function OverviewPage() {
  const [filters, setFilters] = useFilters();
  const signups = useKpi(SIGNUPS, filters);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={signups.meta?.title ?? "Signups"}
          loading={signups.loading}
          deltaLoading={signups.deltaLoading}
          value={signups.value === undefined ? undefined : formatValue(signups.value, signups.meta?.unit ?? "count", filters.currency)}
          current={signups.current}
          previous={signups.previous}
          comparisonLabel={signups.comparisonLabel}
          sparkline={<Sparkline values={signups.trend} />}
        />
      </div>
      <MetricChartCard name={SIGNUPS} filters={filters} setFilters={setFilters} />
    </>
  );
}
