import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { SmallSampleBadge } from "@/components/Badge";
import { Button } from "@/components/ui/button";
import { bucketEnd } from "@/lib/drill";
import { eraMarkers, type Era } from "@/lib/eras";
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
  /** Total of the sample-size column over the range, when one was given. */
  sample?: number;
}

export interface PivotResult {
  /** A series value is null when its only rows for that bucket had a null measure (a gap, not a zero). */
  data: Array<{ bucket: string } & Record<string, number | string | null>>;
  series: Series[];
  breakdown: boolean;
}

export const OTHER_LABEL = "Other";
const SLOTS = 8;
const color = (index: number) => `var(--series-${(index % SLOTS) + 1})`;

/** Turns `{bucket, dimension, <measure>}` rows into one column per series; long tails fold into "Other". */
export function pivotRows(rows: Row[], measure: string, topN = 5, label = measure, sampleMeasure?: string): PivotResult {
  const breakdown = rows.some((r) => r.dimension != null);
  const dimOf = (r: Row) => (breakdown ? String(r.dimension ?? "unknown") : "");
  const valueOf = (r: Row) => Number(r[measure]) || 0;

  const totals = new Map<string, number>();
  const samples = new Map<string, number>();
  for (const r of rows) {
    totals.set(dimOf(r), (totals.get(dimOf(r)) ?? 0) + valueOf(r));
    if (sampleMeasure) samples.set(dimOf(r), (samples.get(dimOf(r)) ?? 0) + (Number(r[sampleMeasure]) || 0));
  }
  const ranked = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b));
  const limit = Math.min(topN, SLOTS - 1);
  const kept = ranked.length > limit + 1 ? ranked.slice(0, limit) : ranked;
  const folded = kept.length < ranked.length;

  const sampleOf = (dims: string[]) =>
    sampleMeasure ? { sample: dims.reduce((sum, d) => sum + (samples.get(d) ?? 0), 0) } : {};
  const series: Series[] = breakdown
    ? kept.map((d, i) => ({ key: `s${i}`, label: d, color: color(i), dimension: d, ...sampleOf([d]) }))
    : [{ key: "s0", label, color: color(0), dimension: null, ...sampleOf([""]) }];
  if (folded) {
    const rest = ranked.slice(kept.length);
    series.push({ key: "other", label: OTHER_LABEL, color: "var(--series-other)", dimension: null, ...sampleOf(rest) });
  }
  const keyOf = new Map(series.filter((s) => s.dimension !== null || !breakdown).map((s) => [breakdown ? s.label : "", s.key]));

  const byBucket = new Map<string, Record<string, number | string | null>>();
  const counted = new Set<string>();
  for (const r of rows) {
    const bucket = String(r.bucket);
    const point = byBucket.get(bucket) ?? Object.fromEntries([["bucket", bucket], ...series.map((s) => [s.key, 0])]);
    const key = keyOf.get(dimOf(r)) ?? "other";
    if (r[measure] === null) {
      if (!counted.has(`${bucket}|${key}`)) point[key] = null;
    } else {
      point[key] = (Number(point[key]) || 0) + valueOf(r);
      counted.add(`${bucket}|${key}`);
    }
    byBucket.set(bucket, point);
  }
  const data = [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))) as PivotResult["data"];
  return { data, series, breakdown };
}

/**
 * One series per measure (`meta.plot`), summed over any `dimension` rows in a bucket. A bucket whose rows are all
 * null for a measure stays null (a gap, not a zero). Colors follow the measure's position in `plot`.
 */
export function pivotMeasures(rows: Row[], measures: Array<{ key: string; label: string }>): PivotResult {
  const series: Series[] = measures.map((m, i) => ({ key: `m${i}`, label: m.label, color: color(i), dimension: null }));
  const byBucket = new Map<string, Record<string, number | string | null>>();
  for (const r of rows) {
    const bucket = String(r.bucket);
    const point = byBucket.get(bucket) ?? Object.fromEntries([["bucket", bucket], ...series.map((s) => [s.key, null])]);
    measures.forEach((m, i) => {
      const value = r[m.key];
      if (value === null || value === undefined) return;
      point[`m${i}`] = (Number(point[`m${i}`]) || 0) + (Number(value) || 0);
    });
    byBucket.set(bucket, point);
  }
  const data = [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))) as PivotResult["data"];
  return { data, series, breakdown: false };
}

/** Where a flag marker sits: the top of the stack (positive parts) or the highest visible series. */
export function flagY(point: Record<string, unknown>, keys: string[], stacked: boolean): number | null {
  const values = keys.map((k) => point[k]).filter((v): v is number => typeof v === "number");
  if (!values.length) return null;
  return stacked ? values.filter((v) => v > 0).reduce((a, b) => a + b, 0) : Math.max(...values);
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
  /** Measure name and unit shown above the plot, e.g. "Cost (USD)". */
  axisLabel?: string;
  /** Column counting the people/events behind each series; breakdown series below `minGroup` get a badge. */
  sampleMeasure?: string;
  minGroup?: number;
  /** Data-era cutoffs to mark when they fall inside the selected range. */
  eras?: Era[];
  /** The selected date range; era markers are clamped to it. Defaults to the plotted buckets. */
  range?: { from: string; to: string };
  /** Set on all but one of several stacked charts so the era list isn't repeated. */
  hideEraList?: boolean;
  /** Plot these measures as separate series (`meta.plot`) instead of `measure` by dimension. */
  measures?: Array<{ key: string; label: string }>;
  /** Stack the bars; negative values stack below zero (e.g. MRR contraction and churn). */
  stacked?: boolean;
  /** Buckets to highlight (rows whose `meta.flag_column` is true). */
  flags?: Set<string>;
  /** What a flag means, e.g. "Anomaly". */
  flagLabel?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  grain,
  series,
  formatValue,
  sorted = true,
  flagged,
}: TooltipProps<number, string> & {
  grain: Grain;
  series: Series[];
  formatValue: (v: number) => string;
  /** Largest first (breakdowns); off keeps the series order (plotted measures). */
  sorted?: boolean;
  flagged?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => p.value !== null && p.value !== undefined)
    .map((p) => ({ series: series.find((s) => s.key === p.dataKey), value: Number(p.value) || 0 }))
    .filter((r): r is { series: Series; value: number } => Boolean(r.series));
  if (sorted) rows.sort((a, b) => b.value - a.value);
  return (
    <div className="min-w-40 rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 text-muted-foreground">{formatBucketLong(String(label), grain)}</div>
      {flagged && (
        <p className="mb-1.5 flex items-center gap-1.5 font-medium">
          <TriangleAlert className="size-3.5 text-delta-bad" aria-hidden="true" />
          {flagged}
        </p>
      )}
      {rows.length === 0 && <p className="text-muted-foreground">No data</p>}
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
  axisLabel,
  sampleMeasure,
  minGroup,
  eras,
  range,
  hideEraList,
  measures,
  stacked,
  flags,
  flagLabel = "Flagged",
}: TimeSeriesChartProps) {
  const { data, series, breakdown } = useMemo(
    () => (measures?.length ? pivotMeasures(rows, measures) : pivotRows(rows, measure, topN, label, sampleMeasure)),
    [rows, measure, topN, label, sampleMeasure, measures],
  );
  const stack = variant === "bar" && (breakdown || Boolean(stacked));
  const signed = data.some((d) => series.some((s) => Number(d[s.key]) < 0));
  const flaggedPoints = flags?.size ? data.filter((d) => flags.has(d.bucket)) : [];
  const buckets = data.map((d) => d.bucket);
  const markers = eraMarkers(
    eras ?? [],
    buckets,
    range ?? { from: buckets[0] ?? "", to: buckets.length ? bucketEnd(buckets[buckets.length - 1], grain) : "" },
  );
  // Several eras can share a week/month bucket: one line, numbered labels, details listed under the chart.
  const markerLines = new Map<string, number[]>();
  markers.forEach((m, i) => markerLines.set(m.bucket, [...(markerLines.get(m.bucket) ?? []), i + 1]));
  const legend = series.length > 1 || breakdown;
  const visibleKeys = () => series.filter((s) => !hiddenKeys.has(s.key)).map((s) => s.key);
  const small = (s: Series) => breakdown && minGroup !== undefined && s.sample !== undefined && s.sample < minGroup;
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
  const summary = `${label ?? measure}${breakdown || series.length > 1 ? ` by ${series.length} series` : ""}, ${data.length} periods${
    first ? ` from ${formatBucketLong(first, grain)} to ${formatBucketLong(last!, grain)}` : ""
  }${flaggedPoints.length ? `, ${flaggedPoints.length} marked ${flagLabel.toLowerCase()}` : ""}. Use the Table button for exact values.`;
  const flagKey = flaggedPoints.length > 0 && (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: "var(--status-critical)" }} aria-hidden="true" />
      <TriangleAlert className="size-3 text-delta-bad" aria-hidden="true" />
      {flagLabel} ({flaggedPoints.length})
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      {axisLabel && legend && <div className="text-xs text-subtle">{axisLabel}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {legend ? (
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
                    {small(s) && <SmallSampleBadge minGroup={minGroup!} />}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-xs text-subtle">{axisLabel}</span>
        )}
        {flagKey}
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowTable((v) => !v)}>
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
                  <th key={s.key} className="px-2 py-1.5 text-right font-medium">
                    {s.label}
                    {small(s) && <span className="ml-1 font-normal text-subtle">(small sample)</span>}
                  </th>
                ))}
                {flaggedPoints.length > 0 && <th className="px-2 py-1.5 font-medium">{flagLabel}</th>}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((point) => (
                <tr key={point.bucket} className="border-t">
                  <td className="px-2 py-1">{formatBucketLong(point.bucket, grain)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right">
                      {point[s.key] === null ? <span className="text-subtle">—</span> : formatValue(Number(point[s.key]) || 0)}
                    </td>
                  ))}
                  {flaggedPoints.length > 0 && <td className="px-2 py-1">{flags!.has(point.bucket) ? "Yes" : ""}</td>}
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
            stackOffset={stack && signed ? "sign" : undefined}
            margin={{ top: markers.length ? 18 : 8, right: 8, bottom: 0, left: 0 }}
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
              content={(props: TooltipProps<number, string>) => (
                <ChartTooltip
                  {...props}
                  grain={grain}
                  series={series}
                  formatValue={formatValue}
                  sorted={breakdown}
                  flagged={flags?.has(String(props.label)) ? flagLabel : undefined}
                />
              )}
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
                  stackId={stack ? "stack" : undefined}
                  stroke={stack ? "var(--card)" : undefined}
                  strokeWidth={stack ? 1 : 0}
                  maxBarSize={24}
                  radius={stack || signed ? 0 : [4, 4, 0, 0]}
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
            {signed && <ReferenceLine y={0} stroke="var(--axis)" strokeWidth={1} />}
            {flaggedPoints.map((point) => {
              const y = flagY(point, visibleKeys(), stack);
              return y === null ? null : (
                <ReferenceDot
                  key={`flag-${point.bucket}`}
                  x={point.bucket}
                  y={y}
                  r={5}
                  fill="var(--status-critical)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  isFront
                />
              );
            })}
            {[...markerLines].map(([bucket, numbers]) => (
              <ReferenceLine
                key={`era-${bucket}`}
                x={bucket}
                stroke="var(--subtle)"
                strokeWidth={1}
                label={{ value: numbers.join(","), position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
              />
            ))}
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
      {markers.length > 0 && !hideEraList && (
        <ol aria-label="Data changes in this range" className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {markers.map((m, i) => (
            <li key={m.date} className="flex gap-1.5">
              <span className="font-medium tabular-nums text-foreground">{i + 1}</span>
              <span>
                {formatBucketLong(m.date, "day")}: {m.label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
