import { describe, expect, it } from "vitest";
import type { CatalogEntry, MetricMeta } from "./api";
import {
  alertableMetrics,
  eventSchema,
  formatCondition,
  inputToThreshold,
  measureOptions,
  parseFilterInput,
  readEvent,
  rulesSchema,
  summarySchema,
  thresholdToInput,
  type AlertRule,
} from "./alerts";

const meta = (extra: Partial<MetricMeta> = {}): MetricMeta => ({
  title: "Health KPIs",
  definition: "",
  unit: "count",
  shape: "kpi",
  breakdowns: [],
  filters: ["market", "plan"],
  alertable: true,
  measures: {
    ai_cost: { label: "AI cost", unit: "currency" },
    ai_failure_rate: { label: "AI failure rate", unit: "ratio" },
    failed_payments: { label: "Failed payments", unit: "count" },
  },
  ...extra,
});

const rule = (extra: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Cost spike",
  metric: "kpi_health",
  measure: "ai_cost",
  params: { currency: "usd" },
  window: "1d",
  condition: "gt",
  threshold: 100,
  cooldown_hours: 24,
  enabled: true,
  created_by: null,
  created_at: null,
  updated_at: null,
  ...extra,
});

describe("thresholds", () => {
  it("types ratios and % changes as percentages and stores fractions", () => {
    expect(thresholdToInput(0.05, "ratio", "gt")).toBe(5);
    expect(inputToThreshold(5, "ratio", "gt")).toBe(0.05);
    expect(inputToThreshold(-20, "currency", "pct_change_lt")).toBe(-0.2);
    expect(thresholdToInput(0.5, "count", "pct_change_gt")).toBe(50);
    expect(inputToThreshold(100, "currency", "gt")).toBe(100);
    expect(inputToThreshold(0.1 * 3 * 100, "percent", "lt")).toBe(0.3);
  });

  it("formats the condition in the measure's unit and the rule's currency", () => {
    expect(formatCondition(rule(), meta())).toBe("Above $100");
    expect(formatCondition(rule({ params: { currency: "try" }, condition: "lt", threshold: 2500 }), meta())).toBe("Below ₺2,500");
    expect(formatCondition(rule({ measure: "ai_failure_rate", threshold: 0.05 }), meta())).toBe("Above 5%");
    expect(formatCondition(rule({ condition: "pct_change_gt", threshold: 0.5 }), meta())).toBe("Change vs previous window above +50%");
    expect(formatCondition(rule({ condition: "pct_change_lt", threshold: -0.2 }), meta())).toBe("Change vs previous window below −20%");
  });
});

describe("events", () => {
  const event = (extra: Record<string, unknown> = {}) =>
    eventSchema.parse({ id: 7, rule_id: "r1", rule_name: "Cost spike", metric: "kpi_health", fired_at: "2026-10-28T08:00:00Z", value: "150", baseline: null, message: "AI cost 150 > 100", ...extra });

  it("parses numeric strings and fills missing optional fields", () => {
    const e = event();
    expect(e.id).toBe("7");
    expect(e.value).toBe(150);
    expect(e.acknowledged_at).toBeNull();
  });

  it("reads value vs threshold and value vs baseline", () => {
    expect(readEvent(event(), rule(), meta())).toEqual({ value: "$150", condition: "Above $100" });
    const pct = readEvent(event({ value: 120, baseline: 80 }), rule({ condition: "pct_change_gt", threshold: 0.3 }), meta());
    expect(pct).toEqual({ value: "$120", baseline: "previous window $80 (+50%)", condition: "Change vs previous window above +30%" });
    expect(readEvent(event({ value: null }), undefined, undefined).value).toBe("—");
  });
});

describe("parsing", () => {
  it("accepts a bare or wrapped rule list and drops malformed rules", () => {
    const good = { id: "a", name: "n", metric: "kpi_health", measure: "ai_runs", params: null, window: "7d", condition: "gt", threshold: "3" };
    expect(rulesSchema.parse([good, { id: "b" }])).toHaveLength(1);
    const [parsed] = rulesSchema.parse({ rules: [good] });
    expect(parsed.threshold).toBe(3);
    expect(parsed.params).toEqual({});
    expect(parsed.cooldown_hours).toBe(24);
    expect(parsed.enabled).toBe(true);
    expect(summarySchema.parse({ open_count: "2", latest_fired_at: null }).open_count).toBe(2);
  });

  it("splits comma-separated filter values", () => {
    expect(parseFilterInput(" TR , US,TR ")).toEqual(["TR", "US"]);
    expect(parseFilterInput("pro")).toBe("pro");
    expect(parseFilterInput(" , ")).toBeUndefined();
  });

  it("offers only alertable metrics and their measures by label", () => {
    const catalog = [
      { name: "kpi_health", kind: "metric", meta: meta() },
      { name: "signups", kind: "metric", meta: meta({ title: "Signups", alertable: false }) },
      { name: "kpi_overview", kind: "metric", meta: meta({ title: "Overview KPIs" }) },
    ] as CatalogEntry[];
    expect(alertableMetrics(catalog).map((m) => m.name)).toEqual(["kpi_health", "kpi_overview"]);
    expect(measureOptions(meta()).map((m) => m.key)).toEqual(["ai_cost", "ai_failure_rate", "failed_payments"]);
  });
});
