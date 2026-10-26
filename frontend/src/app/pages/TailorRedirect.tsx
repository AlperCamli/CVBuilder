import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { translate as t } from "../localization/i18n";
import { useAuth } from "../integration/auth-context";
import type { MasterCvSummary } from "../integration/api-types";

// Tailoring v2 happens inside the CV editor. Old /app/tailor/:id links (dashboard, resumes,
// job tracker, onboarding) land here and open the editor in tailoring mode.
export function TailorRedirect() {
  useTranslation();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { api } = useAuth();
  const prefillJob = (location.state as { prefillJob?: unknown } | null)?.prefillJob;
  const [choices, setChoices] = useState<MasterCvSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openEditor = (masterId: string) =>
    navigate(`/app/cv/${masterId}?tailor=1`, {
      replace: true,
      state: { cvKind: "master", masterCvId: masterId, openTailoring: true, prefillJob }
    });

  useEffect(() => {
    if (id && id !== "master") return;
    let cancelled = false;
    void api
      .listMasterCvs()
      .then((masters) => {
        if (cancelled) return;
        const standard = masters.filter((master) => master.module_type === "standard");
        if (standard.length === 0) navigate("/app/create", { replace: true });
        else if (standard.length === 1) openEditor(standard[0].id);
        else setChoices(standard);
      })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : t("Failed to load source main CV.")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id]);

  if (id && id !== "master") {
    // Legacy links almost always carry a main CV id, so it is passed as a "master" hint; the
    // editor falls back to loading the id as a tailored CV when no main CV has that id
    // (e.g. a pre-v2 checkout return path that pointed at a tailored copy).
    return (
      <Navigate
        to={`/app/cv/${id}?tailor=1`}
        replace
        state={{ cvKind: "master", masterCvId: id, openTailoring: true, prefillJob }}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-md w-full p-6 rounded-xl border space-y-3" style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}>
        {error ? <p style={{ fontSize: "13px", color: "var(--color-red-700)" }}>{t(error)}</p> : null}
        {choices ? (
          <>
            <h1 className="font-medium" style={{ fontSize: "18px" }}>{t("Choose a source CV")}</h1>
            <div className="space-y-2">
              {choices.map((master) => (
                <button
                  key={master.id}
                  type="button"
                  onClick={() => openEditor(master.id)}
                  className="w-full text-left px-4 py-3 rounded-lg border hover:shadow-sm"
                  style={{ borderColor: "var(--color-border-secondary)", fontSize: "14px" }}
                >
                  {master.title} <span style={{ color: "var(--color-text-secondary)" }}>· {master.language === "tr" ? "Türkçe" : "English"}</span>
                </button>
              ))}
            </div>
          </>
        ) : !error ? (
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>{t("Loading...")}</p>
        ) : null}
      </div>
    </div>
  );
}
