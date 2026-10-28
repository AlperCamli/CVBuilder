import { useId } from "react";
import { isWideShape, MetricChartCard } from "@/components/MetricChartCard";
import { RecomputeControl } from "@/components/RecomputeControl";
import type { PageMetric, PageSection } from "@/app/pages";
import { useCatalog } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import type { Shape } from "@/lib/shapes";
import { cn } from "@/lib/utils";

/**
 * Which cards span the full row on wide screens: wide shapes always do, half-width cards pair up, and a half card
 * left without a partner (before a wide card or at the end) stretches so no row has a hole.
 */
export function fullWidthCards(wide: boolean[]): boolean[] {
  const full = wide.map(() => false);
  let pending: number | null = null;
  wide.forEach((isWide, i) => {
    if (isWide) {
      if (pending !== null) full[pending] = true;
      pending = null;
      full[i] = true;
    } else if (pending === null) {
      pending = i;
    } else {
      pending = null;
    }
  });
  if (pending !== null) full[pending] = true;
  return full;
}

function Section({ section, shapeOf }: { section: PageSection; shapeOf: (m: PageMetric) => Shape | undefined }) {
  const [filters, setFilters] = useFilters();
  const id = useId();
  const full = fullWidthCards(section.metrics.map((m) => isWideShape(shapeOf(m))));
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm font-semibold text-muted-foreground">
        {section.title}
      </h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {section.metrics.map(({ name, title, shape: _shape, ...options }, i) => (
          <MetricChartCard
            key={name}
            name={name}
            title={title}
            filters={filters}
            setFilters={setFilters}
            headingLevel={3}
            className={cn(full[i] && "xl:col-span-2")}
            {...options}
          />
        ))}
      </div>
    </section>
  );
}

/** A dashboard page declared as sections of catalog metrics (src/app/pages.ts). */
export function MetricsPage({ sections }: { sections: PageSection[] }) {
  const catalog = useCatalog();
  // The catalog's shape wins; a metric it doesn't list renders the compact "Not available yet" card (half width).
  const shapeOf = (m: PageMetric): Shape | undefined => {
    if (!catalog.data) return m.shape;
    return catalog.data.metrics.find((entry) => entry.name === m.name)?.meta.shape;
  };
  // Recompute only rebuilds materialized views, so it appears on pages that show a pre-computed metric.
  const names = new Set(sections.flatMap((s) => s.metrics.map((m) => m.name)));
  const precomputed = catalog.data?.metrics.some((entry) => names.has(entry.name) && entry.meta.precomputed === true);
  return (
    <div className="flex flex-col gap-6">
      {precomputed && <RecomputeControl />}
      {sections.map((section) => (
        <Section key={section.title} section={section} shapeOf={shapeOf} />
      ))}
    </div>
  );
}
