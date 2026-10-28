import { measureOf, type MetricMeta, type Unit } from "./api";

/**
 * Pure helpers behind the generic shape renderers (breakdown, funnel, cohort, table, multi-measure timeseries).
 * Row shapes are in docs/admin-analytics/metrics-plan.md, "Row shapes".
 */

export type Row = Record<string, unknown>;
export type Shape = MetricMeta["shape"];

export const OTHER_LABEL = "Other";
const SUMMABLE = new Set<Unit>(["count", "currency", "tokens"]);
/** Columns that carry structure, never a measure. */
const STRUCTURAL = new Set(["bucket", "dimension", "step", "step_order", "cohort", "period", "cursor"]);

/** A finite number, or null for null/missing/non-numeric cells (a gap, not a zero). */
export const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const isSummable = (meta: MetricMeta | undefined, key: string) => SUMMABLE.has(measureOf(meta, key).unit);

/** The shape to render: the catalog's, or a best guess from the columns when the catalog couldn't load. */
export function inferShape(meta: MetricMeta | undefined, rows: Row[] | undefined): Shape {
  if (meta) return meta.shape;
  const first = rows?.[0];
  if (!first) return "timeseries";
  if ("bucket" in first) return "timeseries";
  if ("step" in first && "users" in first) return "funnel";
  if ("cohort" in first && "period" in first) return "cohort";
  if ("dimension" in first) return "breakdown";
  return rows.length === 1 ? "kpi" : "table";
}

/**
 * Measure columns in the order the function returns them: the first row's column order, then any column only later
 * rows carry. A column is a measure when `meta.measures` declares it or some row holds a number in it; structural
 * columns and the flag column never are. `meta.measures` key order is not used: Postgres jsonb reorders object keys
 * (shorter keys first), so the function's column order is the only reliable "declaration order".
 */
export function measureKeys(meta: MetricMeta | undefined, rows: Row[], exclude: string[] = []): string[] {
  const skip = new Set([...STRUCTURAL, ...exclude, ...(meta?.flag_column ? [meta.flag_column] : [])]);
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return columns.filter((k) => !skip.has(k) && (meta?.measures?.[k] !== undefined || rows.some((r) => typeof r[k] === "number")));
}

/**
 * The primary measure: the column named like the metric, else the first measure column of the rows (see
 * `measureKeys`). Before rows arrive it falls back to `plot`, then to any declared measure.
 */
export function primaryMeasure(name: string, meta: MetricMeta | undefined, rows: Row[] | undefined) {
  if (meta?.measures?.[name] || rows?.some((r) => typeof r[name] === "number")) return name;
  const keys = measureKeys(meta, rows ?? []);
  if (keys.length) return keys[0];
  if (meta?.plot?.length) return meta.plot[0];
  const declared = Object.keys(meta?.measures ?? {}).filter((k) => !STRUCTURAL.has(k) && k !== meta?.flag_column);
  return declared[0] ?? name;
}

// --- Breakdown -------------------------------------------------------------------------------------------

export interface BreakdownBar {
  key: string;
  label: string;
  /** The row's `dimension` value; null for the folded "Other" bar (nothing single to filter on). */
  dimension: string | null;
  value: number | null;
  /** Every measure for the tooltip and table; folded measures that can't be summed are null. */
  values: Record<string, number | null>;
  /** How many rows were folded into this bar ("Other" only). */
  folded?: number;
  /** The sample column is below `min_group`. */
  small?: boolean;
}

export interface BreakdownOptions {
  measures: string[];
  topN?: number;
  /** Whether a measure can be summed into "Other". When the primary can't, the tail is listed in the table only. */
  summable?: (key: string) => boolean;
  sampleMeasure?: string;
  minGroup?: number;
}

export interface BreakdownResult {
  bars: BreakdownBar[];
  /** Rows not drawn (only when the primary measure can't be folded into "Other"). */
  hidden: number;
}

/** Sorts by the primary measure (desc, nulls last); a tail longer than one row folds into "Other". */
export function rankBreakdown(rows: Row[], measure: string, opts: BreakdownOptions): BreakdownResult {
  const { measures, topN = 8, summable = () => true, sampleMeasure, minGroup } = opts;
  const keys = measures.includes(measure) ? measures : [measure, ...measures];
  const toBar = (r: Row, i: number): BreakdownBar => {
    const dimension = r.dimension === null || r.dimension === undefined ? null : String(r.dimension);
    const sample = sampleMeasure ? num(r[sampleMeasure]) : null;
    return {
      key: `d${i}`,
      label: dimension ?? "Unknown",
      dimension,
      value: num(r[measure]),
      values: Object.fromEntries(keys.map((k) => [k, num(r[k])])),
      ...(sample !== null && minGroup !== undefined && sample < minGroup ? { small: true } : {}),
    };
  };
  const ranked = rows
    .map(toBar)
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.label.localeCompare(b.label));
  if (ranked.length <= topN + 1) return { bars: ranked, hidden: 0 };
  if (!summable(measure)) return { bars: ranked.slice(0, topN), hidden: ranked.length - topN };

  const rest = ranked.slice(topN);
  const sum = (k: string) => {
    const vals = rest.map((b) => b.values[k]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const values = Object.fromEntries(keys.map((k) => [k, summable(k) ? sum(k) : null]));
  const sample = sampleMeasure && summable(sampleMeasure) ? sum(sampleMeasure) : null;
  const other: BreakdownBar = {
    key: "other",
    label: OTHER_LABEL,
    dimension: null,
    value: values[measure],
    values,
    folded: rest.length,
    ...(sample !== null && minGroup !== undefined && sample < minGroup ? { small: true } : {}),
  };
  return { bars: [...ranked.slice(0, topN), other], hidden: 0 };
}

/** Where a value sits on a bar scale that always includes zero: `start`/`width` are % of the track. */
export function barGeometry(value: number, min: number, max: number) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  const width = (Math.abs(value) / span) * 100;
  return { zero, start: value < 0 ? zero - width : zero, width };
}

// --- Funnel ----------------------------------------------------------------------------------------------

export interface FunnelStep {
  order: number;
  step: string;
  users: number;
  /** Users at the previous step (null on the first). */
  previous: number | null;
  fromPrev: number | null;
  fromStart: number | null;
}

export interface Funnel {
  key: string;
  /** The `dimension` value; null for the single funnel and for "Other". */
  dimension: string | null;
  label: string;
  steps: FunnelStep[];
  /** Index of the step with the steepest drop from the previous step, or -1 when no step loses anyone. */
  worst: number;
  start: number;
}

const ratio = (a: number, b: number | null) => (b ? a / b : null);

function funnelOf(key: string, dimension: string | null, label: string, rows: Row[], recompute: boolean): Funnel {
  const byStep = new Map<number, { step: string; users: number; fromPrev: number | null; fromStart: number | null }>();
  for (const r of rows) {
    const order = num(r.step_order) ?? 0;
    const current = byStep.get(order);
    const users = (current?.users ?? 0) + (num(r.users) ?? 0);
    byStep.set(order, {
      step: String(r.step ?? current?.step ?? `Step ${order}`),
      users,
      fromPrev: recompute ? null : num(r.conversion_from_prev),
      fromStart: recompute ? null : num(r.conversion_from_start),
    });
  }
  const ordered = [...byStep.entries()].sort(([a], [b]) => a - b);
  const start = ordered[0]?.[1].users ?? 0;
  const steps: FunnelStep[] = ordered.map(([order, s], i) => {
    const previous = i > 0 ? ordered[i - 1][1].users : null;
    return {
      order,
      step: s.step,
      users: s.users,
      previous,
      fromPrev: i === 0 ? null : (s.fromPrev ?? ratio(s.users, previous)),
      fromStart: s.fromStart ?? ratio(s.users, start),
    };
  });
  let worst = -1;
  steps.forEach((s, i) => {
    if (i > 0 && s.fromPrev !== null && s.fromPrev < 1 && (worst === -1 || s.fromPrev < steps[worst].fromPrev!)) worst = i;
  });
  return { key, dimension, label, steps, worst, start };
}

/** One funnel, or one per `dimension` value (largest first); a tail longer than one folds into "Other". */
export function buildFunnels(rows: Row[], topN = 6): Funnel[] {
  const segmented = rows.some((r) => r.dimension !== null && r.dimension !== undefined);
  if (!segmented) return [funnelOf("all", null, "All users", rows, false)];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const dim = r.dimension === null || r.dimension === undefined ? "Unknown" : String(r.dimension);
    groups.set(dim, [...(groups.get(dim) ?? []), r]);
  }
  const funnels = [...groups.entries()]
    .map(([dim, list], i) => funnelOf(`f${i}`, dim === "Unknown" ? null : dim, dim, list, false))
    .sort((a, b) => b.start - a.start || a.label.localeCompare(b.label));
  if (funnels.length <= topN + 1) return funnels;
  const rest = funnels.slice(topN).flatMap((f) => groups.get(f.label) ?? []);
  return [...funnels.slice(0, topN), funnelOf("other", null, OTHER_LABEL, rest, true)];
}

// --- Cohort ----------------------------------------------------------------------------------------------

export interface CohortCell {
  rate: number | null;
  active: number | null;
}

export interface CohortRow {
  cohort: string;
  size: number;
  cells: Map<number, CohortCell>;
}

export interface CohortGrid {
  cohorts: CohortRow[];
  periods: number[];
  /** Top of the color scale: the highest rate after period 0 (period 0 is ~100% by definition). */
  max: number;
}

export function buildCohortGrid(rows: Row[]): CohortGrid {
  const byCohort = new Map<string, CohortRow>();
  const periods = new Set<number>();
  for (const r of rows) {
    const cohort = String(r.cohort ?? "");
    const period = num(r.period);
    if (period === null) continue;
    const size = num(r.cohort_size) ?? 0;
    const row = byCohort.get(cohort) ?? { cohort, size, cells: new Map() };
    row.size = Math.max(row.size, size);
    const active = num(r.active);
    row.cells.set(period, { rate: num(r.rate) ?? (active !== null && size ? active / size : null), active });
    byCohort.set(cohort, row);
    periods.add(period);
  }
  const cohorts = [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
  const rates = (later: boolean) =>
    cohorts.flatMap((c) => [...c.cells].filter(([p]) => !later || p > 0).map(([, cell]) => cell.rate ?? 0));
  const tail = rates(true);
  const max = Math.max(0, ...(tail.length ? tail : rates(false)));
  return { cohorts, periods: [...periods].sort((a, b) => a - b), max };
}

export const COHORT_BINS = 7;

/** Sequential bin 0..COHORT_BINS-1 for a rate; anything at or above `max` takes the darkest step. */
export function rateBin(rate: number, max: number, bins = COHORT_BINS) {
  if (max <= 0 || rate <= 0) return 0;
  return Math.min(bins - 1, Math.floor((rate / max) * bins));
}

const pct0 = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/** Compact cell text: "24%", "<1%" for tiny non-zero rates, "0%". */
export const formatCellRate = (rate: number) => (rate > 0 && rate < 0.005 ? "<1%" : pct0.format(rate));

// --- Timeseries with several measures ---------------------------------------------------------------------

/** Buckets where any row has the flag column set to true. */
export function flaggedBuckets(rows: Row[], column: string | undefined): Set<string> {
  if (!column) return new Set();
  return new Set(rows.filter((r) => r[column] === true).map((r) => String(r.bucket)));
}

/** Plotted measures grouped by unit, in plot order: each group shares one axis (never two y-scales). */
export function groupByUnit(meta: MetricMeta | undefined, keys: string[]) {
  const groups: Array<{ unit: Unit; keys: string[] }> = [];
  for (const key of keys) {
    const unit = measureOf(meta, key).unit;
    const group = groups.find((g) => g.unit === unit);
    if (group) group.keys.push(key);
    else groups.push({ unit, keys: [key] });
  }
  return groups;
}

// --- Table -----------------------------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

/** Numbers numerically, everything else as text; nulls always last. Stable for ties. */
export function sortRows(rows: Row[], key: string, dir: SortDir): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[key];
      const y = b.row[key];
      const xNull = x === null || x === undefined;
      const yNull = y === null || y === undefined;
      if (xNull || yNull) return xNull === yNull ? a.i - b.i : xNull ? 1 : -1;
      const nx = num(x);
      const ny = num(y);
      const cmp = nx !== null && ny !== null ? nx - ny : String(x).localeCompare(String(y));
      return cmp * sign || a.i - b.i;
    })
    .map(({ row }) => row);
}

/** Column order: first-seen across rows; the opaque pagination cursor is never shown. */
export const tableColumns = (rows: Row[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== "cursor");
