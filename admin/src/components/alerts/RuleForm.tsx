import { AlertTriangle, Loader2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/control";
import { ApiError, measureOf, type CatalogEntry, type MetricMeta } from "@/lib/api";
import {
  alertableMetrics,
  CONDITION_LABELS,
  CONDITIONS,
  filterInputOf,
  inputToThreshold,
  isPctChange,
  measureOptions,
  parseFilterInput,
  thresholdIsPercent,
  thresholdToInput,
  WINDOW_LABELS,
  WINDOWS,
  type AlertCondition,
  type AlertRule,
  type AlertWindow,
  type RuleInput,
} from "@/lib/alerts";
import type { Dimension } from "@/lib/filters";
import { DIMENSION_LABELS, notFilteredBy } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAME_MAX = 120;
const COOLDOWN_MAX = 720;

interface FormState {
  name: string;
  metric: string;
  measure: string;
  window: AlertWindow;
  condition: AlertCondition;
  threshold: string;
  cooldown: string;
  currency: "usd" | "try";
  include_internal: boolean;
  enabled: boolean;
  filters: Partial<Record<string, string>>;
}

const asWindow = (w: string): AlertWindow => ((WINDOWS as readonly string[]).includes(w) ? (w as AlertWindow) : "1d");
const asCondition = (c: string): AlertCondition => ((CONDITIONS as readonly string[]).includes(c) ? (c as AlertCondition) : "gt");

function initialState(rule: AlertRule | undefined, metrics: CatalogEntry[], catalog: CatalogEntry[] | undefined): FormState {
  if (rule) {
    const meta = catalog?.find((m) => m.name === rule.metric)?.meta;
    return {
      name: rule.name,
      metric: rule.metric,
      measure: rule.measure,
      window: asWindow(rule.window),
      condition: asCondition(rule.condition),
      threshold: String(thresholdToInput(rule.threshold, measureOf(meta, rule.measure).unit, rule.condition)),
      cooldown: String(rule.cooldown_hours),
      currency: rule.params.currency === "try" ? "try" : "usd",
      include_internal: rule.params.include_internal ?? false,
      enabled: rule.enabled,
      filters: Object.fromEntries(Object.entries(rule.params.filters ?? {}).map(([k, v]) => [k, filterInputOf(v)])),
    };
  }
  const first = metrics[0];
  return {
    name: "",
    metric: first?.name ?? "",
    measure: measureOptions(first?.meta)[0]?.key ?? "",
    window: "1d",
    condition: "gt",
    threshold: "",
    cooldown: "24",
    currency: "usd",
    include_internal: false,
    enabled: true,
    filters: {},
  };
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const inputClass = cn(controlClass, "w-full min-w-0");

interface RuleFormProps {
  catalog: CatalogEntry[] | undefined;
  rule?: AlertRule;
  saving: boolean;
  error: unknown;
  onSubmit: (input: RuleInput) => void;
  onCancel: () => void;
}

/** Create or edit a rule: an alertable metric's measure, window, condition, threshold, cooldown and params. */
export function RuleForm({ catalog, rule, saving, error, onSubmit, onCancel }: RuleFormProps) {
  const id = useId();
  const alertable = alertableMetrics(catalog);
  // A rule on a metric the catalog no longer marks alertable keeps its metric as an option, so editing never
  // silently retargets it.
  const metrics: CatalogEntry[] =
    rule && !alertable.some((m) => m.name === rule.metric)
      ? [...alertable, catalog?.find((m) => m.name === rule.metric) ?? { name: rule.metric, kind: "metric", meta: { title: rule.metric } as MetricMeta }]
      : alertable;
  const [form, setForm] = useState<FormState>(() => initialState(rule, alertable, catalog));
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // The catalog may load after the form opens: until a metric is picked, the first alertable one (and its first
  // measure) is the selection the selects show, so they are what gets saved.
  const metricName = metrics.some((m) => m.name === form.metric) ? form.metric : (metrics[0]?.name ?? "");
  const meta = metrics.find((m) => m.name === metricName)?.meta;
  const options = measureOptions(meta);
  if (form.measure && metricName === form.metric && !options.some((o) => o.key === form.measure)) {
    options.push({ key: form.measure, ...measureOf(meta, form.measure) });
  }
  const measureKey = options.some((o) => o.key === form.measure) ? form.measure : (options[0]?.key ?? "");
  const measure = measureOf(meta, measureKey);
  const percent = thresholdIsPercent(measure.unit, form.condition);
  const prefix = !isPctChange(form.condition) && measure.unit === "currency" ? (form.currency === "try" ? "₺" : "$") : null;
  const suffix = percent ? "%" : !isPctChange(form.condition) && measure.unit === "seconds" ? "s" : null;
  const allowedFilters = meta?.filters ?? [];
  const activeFilters = allowedFilters.filter((d) => parseFilterInput(form.filters[d] ?? "") !== undefined);
  const ignored = notFilteredBy(activeFilters.filter((d) => measure.ignores_filters?.includes(d)));

  const pickMetric = (name: string) => {
    const next = metrics.find((m) => m.name === name)?.meta;
    const allowed = new Set<string>(next?.filters ?? []);
    set({
      metric: name,
      measure: measureOptions(next)[0]?.key ?? "",
      filters: Object.fromEntries(Object.entries(form.filters).filter(([k]) => allowed.has(k))),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const threshold = Number(form.threshold);
    const cooldown = Number(form.cooldown);
    if (!name) return setInvalid("Give the rule a name.");
    if (!metricName || !measureKey) return setInvalid("Pick a metric and a measure.");
    if (form.threshold.trim() === "" || !Number.isFinite(threshold)) return setInvalid("Enter a numeric threshold.");
    if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > COOLDOWN_MAX) {
      return setInvalid(`Cooldown must be a whole number of hours between 1 and ${COOLDOWN_MAX}.`);
    }
    setInvalid(null);
    const filters = Object.fromEntries(
      allowedFilters.flatMap((d) => {
        const value = parseFilterInput(form.filters[d] ?? "");
        return value === undefined ? [] : [[d, value]];
      }),
    );
    onSubmit({
      name,
      metric: metricName,
      measure: measureKey,
      window: form.window,
      condition: form.condition,
      threshold: inputToThreshold(threshold, measure.unit, form.condition),
      cooldown_hours: cooldown,
      enabled: form.enabled,
      params: {
        include_internal: form.include_internal,
        filters,
        ...(measure.unit === "currency" ? { currency: form.currency } : {}),
      },
    });
  };

  const serverError = error instanceof ApiError ? error.message : error ? "The rule could not be saved." : null;
  const message = invalid ?? serverError;

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-xl border bg-card p-4" noValidate>
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {rule ? `Edit “${rule.name}”` : "New alert rule"}
      </h3>
      {alertable.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {catalog ? "No metric is alertable yet." : "The metric catalog could not be loaded, so metrics can't be picked. Use Refresh to try again."}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`} className="sm:col-span-2">
          <input
            id={`${id}-name`}
            className={inputClass}
            value={form.name}
            maxLength={NAME_MAX}
            required
            placeholder="e.g. AI cost per day too high"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Metric" htmlFor={`${id}-metric`}>
          <select id={`${id}-metric`} className={inputClass} value={metricName} onChange={(e) => pickMetric(e.target.value)}>
            {metrics.map((m) => (
              <option key={m.name} value={m.name}>
                {m.meta.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Measure" htmlFor={`${id}-measure`} hint={measure.description}>
          <select id={`${id}-measure`} className={inputClass} value={measureKey} onChange={(e) => set({ measure: e.target.value })}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Window" htmlFor={`${id}-window`} hint="UTC days; checked hourly.">
          <select id={`${id}-window`} className={inputClass} value={form.window} onChange={(e) => set({ window: e.target.value as AlertWindow })}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABELS[w]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition" htmlFor={`${id}-condition`}>
          <select
            id={`${id}-condition`}
            className={inputClass}
            value={form.condition}
            onChange={(e) => set({ condition: e.target.value as AlertCondition })}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Threshold"
          htmlFor={`${id}-threshold`}
          hint={
            isPctChange(form.condition)
              ? "Percent change from the previous window of the same length; use a negative number for drops."
              : percent
                ? "As a percentage."
                : undefined
          }
        >
          <div className="flex items-center gap-1.5">
            {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
            <input
              id={`${id}-threshold`}
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="any"
              required
              value={form.threshold}
              onChange={(e) => set({ threshold: e.target.value })}
            />
            {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
          </div>
        </Field>
        <Field label="Cooldown (hours)" htmlFor={`${id}-cooldown`} hint="After firing, the rule stays quiet this long.">
          <input
            id={`${id}-cooldown`}
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={1}
            max={COOLDOWN_MAX}
            step={1}
            value={form.cooldown}
            onChange={(e) => set({ cooldown: e.target.value })}
          />
        </Field>
        {measure.unit === "currency" && (
          <Field label="Currency" htmlFor={`${id}-currency`}>
            <select
              id={`${id}-currency`}
              className={inputClass}
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value as "usd" | "try" })}
            >
              <option value="usd">USD</option>
              <option value="try">TRY</option>
            </select>
          </Field>
        )}
      </div>

      {allowedFilters.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Filters (optional, comma-separated values)</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {allowedFilters.map((d: Dimension) => (
              <Field key={d} label={DIMENSION_LABELS[d]} htmlFor={`${id}-f-${d}`}>
                <input
                  id={`${id}-f-${d}`}
                  className={inputClass}
                  value={form.filters[d] ?? ""}
                  placeholder={d === "market" ? "e.g. TR, US" : "Any"}
                  onChange={(e) => set({ filters: { ...form.filters, [d]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
          {ignored && <p className="text-xs text-subtle">{ignored}: this measure ignores that filter.</p>}
        </fieldset>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.include_internal} onChange={(e) => set({ include_internal: e.target.checked })} />
          Include internal accounts
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>

      {message && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-delta-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || metrics.length === 0}>
          {saving && <Loader2 className="animate-spin" />}
          {rule ? "Save changes" : "Create rule"}
        </Button>
      </div>
    </form>
  );
}
