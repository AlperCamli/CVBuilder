import { useMemo, useState } from "react";
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { Button } from "@/components/ui/button";
import type { Grain } from "@/lib/filters";
import { formatBucket, formatBucketLong } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

export interface Series {
  key: string;
  label: string;
  color: string;
  /** null for the single (no-breakdown) series and for the folded "Other" series. */
  dimension: string | null;
}

export interface PivotResult {
  data: Array<{ bucket: string } & Record<string, number | string>>;
  series: Series[];
  breakdown: boolean;
}

export const OTHER_LABEL = "Other";
const SLOTS = 8;
const color = (index: number) => `var(--series-${(index % SLOTS) + 1})`;

/** Turns `{bucket, dimension, <measure>}` rows into one column per series; long tails fold into "Other". */
export function pivotRows(rows: Row[], measure: string, topN = 5, label = measure): PivotResult {
  const breakdown = rows.some((r) => r.dimension != null);
  const dimOf = (r: Row) => (breakdown ? String(r.dimension ?? "unknown") : "");
  const valueOf = (r: Row) => Number(r[measure]) || 0;

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(dimOf(r), (totals.get(dimOf(r)) ?? 0) + valueOf(r));
  const ranked = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b));
  const limit = Math.min(topN, SLOTS - 1);
  const kept = ranked.length > limit + 1 ? ranked.slice(0, limit) : ranked;
  const folded = kept.length < ranked.length;

  const series: Series[] = breakdown
    ? kept.map((d, i) => ({ key: `s${i}`, label: d, color: color(i), dimension: d }))
    : [{ key: "s0", label, color: color(0), dimension: null }];
  if (folded) series.push({ key: "other", label: OTHER_LABEL, color: "var(--series-other)", dimension: null });
  const keyOf = new Map(series.filter((s) => s.dimension !== null || !breakdown).map((s) => [breakdown ? s.label : "", s.key]));

  const byBucket = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const bucket = String(r.bucket);
    const point = byBucket.get(bucket) ?? Object.fromEntries([["bucket", bucket], ...series.map((s) => [s.key, 0])]);
    const key = keyOf.get(dimOf(r)) ?? "other";
    point[key] = (Number(point[key]) || 0) + valueOf(r);
    byBucket.set(bucket, point);
  }
  const data = [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))) as PivotResult["data"];
  return { data, series, breakdown };
}

interface TimeSeriesChartProps {
  rows: Row[];
  measure: string;
  label?: string;
  grain: Grain;
  variant?: "line" | "bar";
  topN?: number;
  height?: number;
  formatValue?: (value: number) => string;
  formatAxis?: (value: number) => string;
  onPointClick?: (point: { bucket: string; dimension: string | null }) => void;
}

function ChartTooltip({
  active,
  payload,
  label,
  grain,
  series,
  formatValue,
}: TooltipProps<number, string> & { grain: Grain; series: Series[]; formatValue: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .map((p) => ({ series: series.find((s) => s.key === p.dataKey), value: Number(p.value) || 0 }))
    .filter((r): r is { series: Series; value: number } => Boolean(r.series))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="min-w-40 rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 text-muted-foreground">{formatBucketLong(String(label), grain)}</div>
      <ul className="space-y-1">
        {rows.map(({ series: s, value }) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{formatValue(value)}</span>
            <span className="truncate text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimeSeriesChart({
  rows,
  measure,
  label,
  grain,
  variant = "line",
  topN = 5,
  height = 280,
  formatValue = (v) => v.toLocaleString("en-US"),
  formatAxis = formatValue,
  onPointClick,
}: TimeSeriesChartProps) {
  const { data, series, breakdown } = useMemo(() => pivotRows(rows, measure, topN, label), [rows, measure, topN, label]);
  const seriesId = series.map((s) => s.label).join("|");
  const [hidden, setHidden] = useState<{ id: string; keys: Set<string> }>({ id: seriesId, keys: new Set() });
  const hiddenKeys = hidden.id === seriesId ? hidden.keys : new Set<string>();
  const [showTable, setShowTable] = useState(false);

  const toggle = (key: string) => {
    const next = new Set(hiddenKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden({ id: seriesId, keys: next });
  };

  const fire = (bucket: unknown, s: Series) => {
    if (onPointClick && typeof bucket === "string" && (!breakdown || s.dimension)) onPointClick({ bucket, dimension: s.dimension });
  };
  const clickable = Boolean(onPointClick);
  // Only marks whose click actually drills get a pointer: no handler, or the folded "Other", stays inert.
  const drillable = (s: Series) => clickable && (!breakdown || Boolean(s.dimension));
  const first = data[0]?.bucket;
  const last = data[data.length - 1]?.bucket;
  const summary = `${label ?? measure}${breakdown ? ` by ${series.length} series` : ""}, ${data.length} periods${
    first ? ` from ${formatBucketLong(first, grain)} to ${formatBucketLong(last!, grain)}` : ""
  }. Use the Table button for exact values.`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Series">
            {series.map((s) => {
              const off = hiddenKeys.has(s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-pressed={!off}
                    onClick={() => toggle(s.key)}
                    className={cn("flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground", off && "opacity-40 line-through")}
                  >
                    <span
                      className={cn("shrink-0", variant === "bar" ? "size-2.5 rounded-sm" : "h-0.5 w-3 rounded-full")}
                      style={{ background: s.color }}
                      aria-hidden="true"
                    />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </Button>
      </div>

      {showTable ? (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Period</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((point) => (
                <tr key={point.bucket} className="border-t">
                  <td className="px-2 py-1">{formatBucketLong(point.bucket, grain)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right">{formatValue(Number(point[s.key]) || 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            key={`${data.length}:${data[0]?.bucket}`}
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={!breakdown && clickable ? (state) => fire(state?.activeLabel, series[0]) : undefined}
            style={{ cursor: clickable && !breakdown ? "pointer" : undefined }}
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(d: string) => formatBucket(d, grain)}
              stroke="var(--axis)"
              tick={{ fill: "var(--subtle)", fontSize: 12 }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              width={48}
              tickFormatter={formatAxis}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--subtle)", fontSize: 12 }}
            />
            <Tooltip
              content={<ChartTooltip grain={grain} series={series} formatValue={formatValue} />}
              cursor={variant === "bar" ? { fill: "var(--accent)", opacity: 0.6 } : { stroke: "var(--axis)" }}
            />
            {series.map((s) =>
              variant === "bar" ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  hide={hiddenKeys.has(s.key)}
                  stackId={breakdown ? "stack" : undefined}
                  stroke={breakdown ? "var(--card)" : undefined}
                  strokeWidth={breakdown ? 1 : 0}
                  maxBarSize={24}
                  radius={breakdown ? 0 : [4, 4, 0, 0]}
                  isAnimationActive={false}
                  cursor={drillable(s) ? "pointer" : undefined}
                  onClick={breakdown && drillable(s) ? (point: { payload?: Row }) => fire(point.payload?.bucket, s) : undefined}
                />
              ) : (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  hide={hiddenKeys.has(s.key)}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={(dot: { cx?: number; cy?: number; payload?: Row }) => (
                    <g
                      key={`${s.key}-active`}
                      onClick={breakdown && drillable(s) ? () => fire(dot.payload?.bucket, s) : undefined}
                      style={{ cursor: drillable(s) ? "pointer" : undefined }}
                    >
                      <circle cx={dot.cx} cy={dot.cy} r={12} fill="transparent" />
                      <circle cx={dot.cx} cy={dot.cy} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                    </g>
                  )}
                />
              ),
            )}
            {data.length > 2 && (
              <Brush
                dataKey="bucket"
                height={24}
                travellerWidth={8}
                stroke="var(--axis)"
                fill="var(--card)"
                tickFormatter={(d: string) => formatBucket(d, grain)}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
