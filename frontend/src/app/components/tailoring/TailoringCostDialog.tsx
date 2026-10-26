import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { BackendApi } from "../../integration/backend-api";
import type { TailoringCostReport } from "../../integration/tailoring-types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

const formatUsd = (value: number | null): string =>
  value === null ? t("price not configured") : `$${value.toFixed(value < 0.01 ? 5 : 4)}`;

const formatTokens = (value: number): string => value.toLocaleString("en-US");

// Admin-only: token and cost breakdown of one tailoring session (every model call it made).
export function TailoringCostReportView({ report }: { report: TailoringCostReport }) {
  const totals = report.totals;
  const stat = (label: string, value: string) => (
    <div className="rounded-lg p-3" style={{ background: "var(--color-background-secondary)" }}>
      <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{label}</p>
      <p style={{ fontSize: "16px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4" style={{ fontSize: "13px" }}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stat(t("Total cost"), `${formatUsd(totals.cost_usd)}${totals.cost_complete ? "" : " *"}`)}
        {stat(t("Total tokens"), formatTokens(totals.total_tokens))}
        {stat(t("Model calls"), `${totals.run_count}${totals.failed_run_count ? ` (${totals.failed_run_count} ${t("failed")})` : ""}`)}
        {stat(t("Cached input"), formatTokens(totals.cached_input_tokens))}
      </div>
      {!totals.cost_complete ? (
        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          {t("* Some calls use a model without a configured price (AI_MODEL_PRICING_JSON), so the total is partial.")}
        </p>
      ) : null}

      <div>
        <h3 className="font-medium mb-2">{t("By step")}</h3>
        <table className="w-full" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ color: "var(--color-text-secondary)", fontSize: "11px", textAlign: "left" }}>
              <th className="py-1">{t("Step")}</th>
              <th className="py-1 text-right">{t("Calls")}</th>
              <th className="py-1 text-right">{t("Tokens")}</th>
              <th className="py-1 text-right">{t("Cost")}</th>
            </tr>
          </thead>
          <tbody>
            {report.by_step.map((step) => (
              <tr key={step.step} className="border-t" style={{ borderColor: "var(--color-border-tertiary)" }}>
                <td className="py-1.5">{step.step}</td>
                <td className="py-1.5 text-right">{step.run_count}</td>
                <td className="py-1.5 text-right">{formatTokens(step.total_tokens)}</td>
                <td className="py-1.5 text-right">{formatUsd(step.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="font-medium mb-2">{t("Every call")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontVariantNumeric: "tabular-nums", fontSize: "12px" }}>
            <thead>
              <tr style={{ color: "var(--color-text-secondary)", fontSize: "11px", textAlign: "left" }}>
                <th className="py-1 pr-2">{t("Step")}</th>
                <th className="py-1 pr-2 text-right">{t("Input")}</th>
                <th className="py-1 pr-2 text-right">{t("Cached")}</th>
                <th className="py-1 pr-2 text-right">{t("Output")}</th>
                <th className="py-1 pr-2 text-right">{t("Reasoning")}</th>
                <th className="py-1 pr-2 text-right">{t("Time")}</th>
                <th className="py-1 text-right">{t("Cost")}</th>
              </tr>
            </thead>
            <tbody>
              {report.runs.map((run) => (
                <tr key={run.ai_run_id} className="border-t" style={{ borderColor: "var(--color-border-tertiary)", color: run.status === "failed" ? "var(--color-red-600)" : undefined }}>
                  <td className="py-1.5 pr-2" title={run.model_name}>{run.step}{run.status === "failed" ? ` (${t("failed")})` : ""}</td>
                  <td className="py-1.5 pr-2 text-right">{formatTokens(run.input_tokens)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatTokens(run.cached_input_tokens)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatTokens(run.output_tokens)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatTokens(run.reasoning_tokens)}</td>
                  <td className="py-1.5 pr-2 text-right">{run.duration_ms === null ? "—" : `${(run.duration_ms / 1000).toFixed(1)}s`}</td>
                  <td className="py-1.5 text-right">{formatUsd(run.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function TailoringCostDialog({
  api,
  sessionId,
  open,
  onOpenChange
}: {
  api: BackendApi;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [report, setReport] = useState<TailoringCostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    void api
      .getAdminTailoringCost(sessionId)
      .then((next) => !cancelled && setReport(next))
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : t("Could not load costs.")));
    return () => {
      cancelled = true;
    };
  }, [api, open, sessionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Session AI cost")}</DialogTitle>
          <DialogDescription>{t("Admin only. Tokens and cost of every model call in this tailoring session.")}</DialogDescription>
        </DialogHeader>
        {error ? <p style={{ color: "var(--color-red-700)", fontSize: "13px" }}>{error}</p> : null}
        {!report && !error ? (
          <p className="flex items-center gap-2" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            <Loader2 size={14} className="animate-spin" /> {t("Loading...")}
          </p>
        ) : null}
        {report ? <TailoringCostReportView report={report} /> : null}
      </DialogContent>
    </Dialog>
  );
}
