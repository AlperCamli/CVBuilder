import { X } from "lucide-react";
import { controlClass } from "@/components/ui/control";
import { useCatalog } from "@/lib/api";
import {
  CURRENCIES,
  DATE_PRESETS,
  GRAINS,
  customRange,
  isValidRange,
  todayUtc,
  useFilters,
  type Currency,
  type DatePreset,
  type Dimension,
  type FilterValue,
  type Grain,
} from "@/lib/filters";
import { DIMENSION_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCurrentPage } from "./nav";

const CURRENCY_LABELS: Record<Currency, string> = { native: "USD & TRY (native)", usd: "All in USD", try: "All in TRY" };
const GRAIN_LABELS: Record<Grain, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

/** Which dimensions the current page's metrics accept; null while unknown (no catalog yet). */
function usePageSupport() {
  const page = useCurrentPage();
  const catalog = useCatalog();
  if (!page || !catalog.data) return null;
  const metas = page.metrics.flatMap((name) => catalog.data.metrics.find((m) => m.name === name)?.meta ?? []);
  return {
    filters: new Set<Dimension>(metas.flatMap((m) => m.filters)),
    breakdowns: new Set<Dimension>(metas.flatMap((m) => m.breakdowns)),
  };
}

function Chip({ label, applied, onRemove }: { label: string; applied: boolean; onRemove: () => void }) {
  return (
    <span
      className={cn(
        "flex h-7 items-center gap-1 rounded-full border pl-2.5 pr-1 text-xs",
        applied ? "bg-accent" : "border-dashed text-subtle",
      )}
    >
      <span className={cn(!applied && "line-through")}>{label}</span>
      {!applied && <span>· not applied on this page</span>}
      <button type="button" aria-label={`Remove ${label}`} className="rounded-full p-0.5 hover:bg-card" onClick={onRemove}>
        <X className="size-3" />
      </button>
    </span>
  );
}

const show = (value: FilterValue | FilterValue[] | undefined) => (Array.isArray(value) ? value.join(", ") : String(value));

export function FilterBar() {
  const [filters, setFilters] = useFilters();
  const support = usePageSupport();
  const setRange = (from: string, to: string) => {
    if (isValidRange(from, to)) setFilters(customRange(from, to));
  };
  const dims = Object.keys(filters.filters) as Dimension[];
  const breakdownIgnored = filters.breakdown && support && !support.breakdowns.has(filters.breakdown);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Date range"
        className={controlClass}
        value={filters.range}
        onChange={(e) => {
          const range = e.target.value as DatePreset | "custom";
          setFilters(range === "custom" ? customRange(filters.from, filters.to) : { range });
        }}
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </select>
      {filters.range === "custom" && (
        <span className="flex items-center gap-1">
          <input
            type="date"
            aria-label="From (UTC)"
            className={controlClass}
            value={filters.from}
            max={filters.to}
            onChange={(e) => setRange(e.target.value, filters.to)}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            aria-label="To (UTC)"
            className={controlClass}
            value={filters.to}
            min={filters.from}
            max={todayUtc()}
            onChange={(e) => setRange(filters.from, e.target.value)}
          />
        </span>
      )}
      <select
        aria-label="Grain"
        className={controlClass}
        value={filters.grain}
        onChange={(e) => setFilters({ grain: e.target.value as Grain })}
      >
        {GRAINS.map((g) => (
          <option key={g} value={g}>
            {GRAIN_LABELS[g]}
          </option>
        ))}
      </select>
      <select
        aria-label="Currency"
        className={controlClass}
        value={filters.currency}
        onChange={(e) => setFilters({ currency: e.target.value as Currency })}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {CURRENCY_LABELS[c]}
          </option>
        ))}
      </select>
      <label className="flex h-8 items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={filters.include_internal}
          onChange={(e) => setFilters({ include_internal: e.target.checked })}
        />
        Include admin accounts
      </label>
      {dims.map((dim) => (
        <Chip
          key={dim}
          label={`${DIMENSION_LABELS[dim]}: ${show(filters.filters[dim])}`}
          applied={!support || support.filters.has(dim)}
          onRemove={() => {
            const next = { ...filters.filters };
            delete next[dim];
            setFilters({ filters: next });
          }}
        />
      ))}
      {breakdownIgnored && (
        <Chip
          label={`Breakdown: ${DIMENSION_LABELS[filters.breakdown!]}`}
          applied={false}
          onRemove={() => setFilters({ breakdown: undefined })}
        />
      )}
      <span className="text-xs text-subtle">All dates UTC</span>
    </div>
  );
}
