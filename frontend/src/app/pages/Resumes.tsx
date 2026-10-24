import { useUpgradePrompt } from "../contexts/UpgradePromptContext";
import { MasterRevisionDialog } from "../components/MasterRevisionDialog";
import { Link, useNavigate } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Plus, Download, Trash2, Languages } from "lucide-react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type {
  MasterCvSummary,
  TailoredCvSummary,
} from "../integration/api-types";
import {
  buildTailoredExportFilename,
  triggerBlobDownload,
} from "../integration/export-filenames";
import { TranslationDialog } from "../components/TranslationDialog";
import { localeCode, translate as t } from "../localization/i18n";
import { prioritizeMasterLanguages } from "./resume-list";

const CV_BATCH_SIZE = 2;

export function Resumes() {
  useTranslation();
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const { ensureProAccess } = useUpgradePrompt();
  const navigate = useNavigate();
  const [masters, setMasters] = useState<MasterCvSummary[]>([]);
  const [tailored, setTailored] = useState<TailoredCvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [translating, setTranslating] = useState<MasterCvSummary | null>(null);
  const [extraMasterCount, setExtraMasterCount] = useState(0);
  const [tailoredVisibleCount, setTailoredVisibleCount] =
    useState(CV_BATCH_SIZE);
  const tailoredEnd = useRef<HTMLDivElement>(null);
  const orderedMasters = useMemo(
    () => prioritizeMasterLanguages(masters),
    [masters],
  );
  const masterVisibleCount = orderedMasters.initialCount + extraMasterCount;
  const hasMoreTailored = tailoredVisibleCount < tailored.length;

  useEffect(() => {
    const sentinel = tailoredEnd.current;
    if (!sentinel || !hasMoreTailored || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        setTailoredVisibleCount((count) => count + CV_BATCH_SIZE);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreTailored, loading, tailoredVisibleCount, tailored.length]);
  const load = async () => {
    try {
      const [masterRows, tailoredRows] = await Promise.all([
        api.listMasterCvs(),
        api.listTailoredCvs(),
      ]);
      setMasters(masterRows);
      setTailored(tailoredRows);
    } catch (error) {
      setError(
        error instanceof Error ? t(error.message) : t("Failed to load CVs."),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setSidebarVisible(true);
    void load();
  }, [api]);
  const remove = async (id: string, kind: "master" | "tailored") => {
    if (
      !window.confirm(
        t(
          kind === "master"
            ? "Delete this main CV and its associated customized versions?"
            : "Delete this customized CV?",
        ),
      )
    )
      return;
    setBusy(id);
    try {
      if (kind === "master") await api.deleteMasterCv(id);
      else await api.deleteTailoredCv(id);
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? t(error.message) : t("Could not delete CV."),
      );
    } finally {
      setBusy(null);
    }
  };
  const exportCv = async (cv: TailoredCvSummary) => {
    if (!(await ensureProAccess("export_pdf"))) return;
    setBusy(cv.id);
    try {
      const result = await api.createPdfExport(cv.id);
      const download =
        result.download?.download_url ??
        (await api.getExportDownload(result.export.id)).download_url;
      const source = masters.find((master) => master.id === cv.master_cv_id);
      await triggerBlobDownload(
        download,
        buildTailoredExportFilename(
          source?.title,
          cv.title,
          cv.job?.company_name,
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? t(error.message) : t("Export failed."));
    } finally {
      setBusy(null);
    }
  };
  const languageName = (language: string) =>
    language.startsWith("tr")
      ? "Türkçe"
      : language.startsWith("en")
        ? "English"
        : language;
  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-medium">{t("My CVs")}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {t(
              "One main CV per language, with customized versions for each application.",
            )}
          </p>
        </div>
        <Link
          to="/app/create"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 text-white px-4 py-2 text-sm"
        >
          <Plus size={16} />
          {t("New CV")}
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-red-700 mb-4">
          {t(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t("Loading…")}</p>
      ) : masters.length === 0 ? (
        <p>{t("Create or upload CV")}</p>
      ) : (
        <div className="space-y-8">
          <section aria-label={t("Main CVs")}>
            <div className="space-y-4">
              {orderedMasters.items
                .slice(0, masterVisibleCount)
                .map((master) => (
                  <section key={master.id}>
                    <div className="rounded-xl border border-slate-200 p-5 bg-white">
                      <div className="flex justify-between gap-4 mb-4">
                        <div>
                          <h2 className="font-medium text-lg">
                            {master.title}
                          </h2>
                          <p className="text-sm text-slate-500 mt-1">
                            {t("Main CV")} ·{" "}
                            <span lang={master.language}>
                              {languageName(master.language)}
                            </span>{" "}
                            ·{" "}
                            {new Date(master.updated_at).toLocaleDateString(
                              localeCode(),
                            )}
                          </p>
                        </div>
                        <FileText size={24} className="text-teal-700" />
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <Link
                          className="rounded-lg bg-teal-700 text-white px-4 py-2"
                          to={`/app/cv/${master.id}`}
                          state={{ cvKind: "master", masterCvId: master.id }}
                        >
                          {t("Open")}
                        </Link>
                        <Link
                          className="rounded-lg border px-4 py-2"
                          to={`/app/tailor/${master.id}`}
                        >
                          {t("Customize for a job")}
                        </Link>
                        {master.module_type === "standard" && (
                          <button
                            type="button"
                            className="rounded-lg border px-4 py-2 inline-flex gap-2 items-center"
                            onClick={() => void ensureProAccess("ai_action").then(allowed => { if (allowed) setTranslating(master); })}
                          >
                            <Languages size={15} />
                            {t("Translate")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg border px-4 py-2"
                          onClick={() => setHistoryId(master.id)}
                        >
                          {t("Revisions")}
                        </button>
                        <button
                          type="button"
                          disabled={busy === master.id}
                          className="rounded-lg border px-4 py-2 text-red-700"
                          onClick={() => void remove(master.id, "master")}
                        >
                          <Trash2 size={15} aria-label={t("Delete")} />
                        </button>
                      </div>
                    </div>
                  </section>
                ))}
            </div>
            {masterVisibleCount < masters.length && (
              <button
                type="button"
                onClick={() =>
                  setExtraMasterCount((count) => count + CV_BATCH_SIZE)
                }
                className="mt-4 rounded-lg border px-4 py-2 text-sm text-teal-800"
              >
                {t("Load more main CVs")}
              </button>
            )}
          </section>
          {tailored.length > 0 && (
            <section aria-label={t("Customized CVs")}>
              <h2 className="text-sm font-medium mb-2">
                {t("Customized CVs")}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {tailored.slice(0, tailoredVisibleCount).map((cv) => (
                  <article key={cv.id} className="border rounded-xl p-4">
                    <h3 className="font-medium">
                      {cv.job?.job_title || cv.title}
                    </h3>
                    <p className="text-sm text-slate-600 mb-3">
                      {cv.job?.company_name} · {languageName(cv.language)}
                    </p>
                    <div className="flex gap-3 text-sm">
                      <Link
                        className="text-teal-800 underline"
                        to={`/app/cv/${cv.id}`}
                        state={{ cvKind: "tailored" }}
                      >
                        {t("Open")}
                      </Link>
                      <button
                        type="button"
                        disabled={busy === cv.id}
                        onClick={() => void exportCv(cv)}
                        className="inline-flex gap-1 items-center"
                      >
                        <Download size={14} />
                        {t("Download")}
                      </button>
                      <button
                        type="button"
                        disabled={busy === cv.id}
                        onClick={() => void remove(cv.id, "tailored")}
                        className="text-red-700"
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {hasMoreTailored && (
                <div
                  ref={tailoredEnd}
                  className="py-4 text-center text-sm text-slate-500"
                >
                  {t("Scroll to see more customized CVs")}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {historyId && (
        <MasterRevisionDialog
          masterId={historyId}
          onClose={() => setHistoryId(null)}
          onRestored={() => {
            setHistoryId(null);
            void load();
          }}
        />
      )}
      {translating && (
        <TranslationDialog
          source={translating}
          onClose={() => setTranslating(null)}
          onCreated={(id) => {
            setTranslating(null);
            navigate(`/app/cv/${id}`, {
              state: { cvKind: "master", masterCvId: id },
            });
          }}
        />
      )}
    </div>
  );
}
