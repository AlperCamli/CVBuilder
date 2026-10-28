import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { measureOf, type MetricMeta } from "@/lib/api";
import { isIsoDate, type Currency } from "@/lib/filters";
import { formatDate, formatValue, humanize, labelWithUnit } from "@/lib/format";
import { sortRows, tableColumns, type Row, type SortDir } from "@/lib/shapes";
import { cn } from "@/lib/utils";

interface DataTableProps {
  rows: Row[];
  meta?: MetricMeta;
  currency: Currency;
  /** Columns to show, in order; defaults to every column the rows carry. */
  columns?: string[];
  /** Header overrides, e.g. `{ dimension: "Plan" }`. */
  labels?: Record<string, string>;
  /** Accessible name for the table. */
  label: string;
  className?: string;
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const STRUCTURAL_LABELS: Record<string, string> = {
  bucket: "Period",
  dimension: "Segment",
  step: "Step",
  step_order: "#",
  cohort: "Cohort",
  period: "Period",
};

/** A cell as text: declared measures by their unit, ISO dates as dates, booleans as Yes/No, null as a dash. */
export function formatCell(value: unknown, key: string, meta: MetricMeta | undefined, currency: Currency): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return meta?.measures?.[key] ? formatValue(value, measureOf(meta, key).unit, currency) : plain.format(value);
  }
  if (typeof value === "string" && isIsoDate(value)) return formatDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Generic sortable table with measure-aware formatting; the "Table" view of every shape. */
export function DataTable({ rows, meta, currency, columns, labels = {}, label, className }: DataTableProps) {
  const cols = useMemo(() => columns ?? tableColumns(rows), [columns, rows]);
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const sorted = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const numeric = (key: string) => rows.some((r) => typeof r[key] === "number");
  const header = (key: string) =>
    labels[key] ?? (meta?.measures?.[key] ? labelWithUnit(measureOf(meta, key), currency) : (STRUCTURAL_LABELS[key] ?? humanize(key)));

  const toggle = (key: string) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: numeric(key) ? "desc" : "asc" },
    );

  return (
    <div className={cn("max-h-80 overflow-auto rounded-md border", className)}>
      <table className="w-full text-xs" aria-label={label}>
        <thead className="sticky top-0 bg-card text-left text-muted-foreground">
          <tr>
            {cols.map((key) => {
              const active = sort?.key === key;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("px-2 py-1.5 font-medium", numeric(key) && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", numeric(key) && "flex-row-reverse")}
                  >
                    {header(key)}
                    {active &&
                      (sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sorted.map((row, i) => (
            <tr key={i} className="border-t">
              {cols.map((key) => (
                <td key={key} className={cn("px-2 py-1", numeric(key) && "text-right")}>
                  {row[key] === null || row[key] === undefined ? (
                    <span className="text-subtle">—</span>
                  ) : (
                    formatCell(row[key], key, meta, currency)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
