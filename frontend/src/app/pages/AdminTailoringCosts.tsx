import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translate as t } from "../localization/i18n";
import { useAuth } from "../integration/auth-context";
import { ApiClientError } from "../integration/api-error";
import type { TailoringAdminSessionSummary, TailoringCostReport } from "../integration/tailoring-types";
import { TailoringCostReportView } from "../components/tailoring/TailoringCostDialog";

const formatUsd = (value: number | null) => (value === null ? "—" : `$${value.toFixed(4)}`);

// Admin only (ADMIN_EMAILS on the backend): token and cost totals of recent tailoring sessions.
export function AdminTailoringCosts() {
  useTranslation();
  const { api } = useAuth();
  const [sessions, setSessions] = useState<TailoringAdminSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, TailoringCostReport>>({});

  useEffect(() => {
    void api
      .listAdminTailoringSessions(100)
      .then(({ sessions: rows }) => setSessions(rows))
      .catch((loadError) =>
        setError(
          loadError instanceof ApiClientError && loadError.status === 403
            ? t("This page is only available to admins.")
            : loadError instanceof Error
              ? loadError.message
              : t("Could not load costs.")
        )
      );
  }, [api]);

  const toggle = (sessionId: string) => {
    setOpenId((current) => (current === sessionId ? null : sessionId));
    if (!reports[sessionId]) {
      void api.getAdminTailoringCost(sessionId).then((report) => setReports((current) => ({ ...current, [sessionId]: report })));
    }
  };

  const total = sessions?.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0) ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="font-medium" style={{ fontSize: "24px" }}>{t("Tailoring AI costs")}</h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {t("Admin only. Recent tailoring sessions with their model calls, tokens and cost.")}
        </p>
      </div>
      {error ? <p style={{ color: "var(--color-red-700)", fontSize: "14px" }}>{error}</p> : null}
      {!sessions && !error ? (
        <p className="flex items-center gap-2" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <Loader2 size={14} className="animate-spin" /> {t("Loading...")}
        </p>
      ) : null}
      {sessions ? (
        <>
          <p style={{ fontSize: "13px" }}>
            {sessions.length} {t("sessions")} · {t("known cost")} <strong>{formatUsd(total)}</strong> · {t("average")}{" "}
            <strong>{formatUsd(sessions.length ? total / sessions.length : null)}</strong>
          </p>
          <div className="rounded-xl border divide-y" style={{ borderColor: "var(--color-border-tertiary)", background: "var(--color-background-primary)" }}>
            {sessions.map((row) => (
              <div key={row.session_id}>
                <button type="button" onClick={() => toggle(row.session_id)} className="w-full px-4 py-3 flex items-center gap-4 text-left" style={{ fontSize: "13px" }}>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{row.job_title}{row.company_name ? ` · ${row.company_name}` : ""}</p>
                    <p className="truncate" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {row.user_email ?? "—"} · {new Date(row.created_at).toLocaleString()} · {row.status}
                    </p>
                  </div>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>{row.run_count} {t("calls")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>{row.total_tokens.toLocaleString("en-US")} {t("tokens")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 80, textAlign: "right" }}>
                    {formatUsd(row.cost_usd)}{row.cost_complete ? "" : "*"}
                  </span>
                  {openId === row.session_id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {openId === row.session_id ? (
                  <div className="px-4 pb-4">
                    {reports[row.session_id] ? (
                      <TailoringCostReportView report={reports[row.session_id]} />
                    ) : (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
