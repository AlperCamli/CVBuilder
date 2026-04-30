import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Save, Download, Sparkles, Loader2, FileText } from "lucide-react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import { ApiClientError } from "../integration/api-error";
import type { CoverLetterDetail, CoverLetterExportSummaryItem } from "../integration/api-types";

interface CoverLetterDraft {
  version: 1;
  coverLetterId: string;
  title: string;
  content: string;
  updatedAt: string;
}

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const getDraftStorageKey = (coverLetterId: string): string => `cover-letter-editor:draft:${coverLetterId}`;

const readDraft = (coverLetterId: string): CoverLetterDraft | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getDraftStorageKey(coverLetterId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CoverLetterDraft;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.coverLetterId === coverLetterId &&
      typeof parsed.content === "string"
    ) {
      return parsed;
    }
  } catch {
    // ignore malformed drafts
  }

  return null;
};

const writeDraft = (draft: CoverLetterDraft): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getDraftStorageKey(draft.coverLetterId), JSON.stringify(draft));
};

const clearDraft = (coverLetterId: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getDraftStorageKey(coverLetterId));
};

export function CoverLetterEditor() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coverLetter, setCoverLetter] = useState<CoverLetterDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | null>(null);
  const [exportHistory, setExportHistory] = useState<CoverLetterExportSummaryItem[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const markDirty = () => {
    setDirty(true);
    setRestoredDraftAt(null);
  };

  const loadExportHistory = async (coverLetterId: string) => {
    try {
      const history = await api.listCoverLetterExports(coverLetterId);
      setExportHistory(history.exports);
    } catch {
      setExportHistory([]);
    }
  };

  const loadCoverLetter = async () => {
    if (!jobId) {
      setError("Job id is missing.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setDirty(false);
    setRestoredDraftAt(null);

    try {
      const detail = await api.upsertCoverLetterByJob(jobId);
      setCoverLetter(detail);
      setTitle(detail.title);
      setContent(detail.content);
      setLastSavedAt(detail.updated_at);

      const draft = readDraft(detail.id);
      if (draft) {
        setTitle(draft.title);
        setContent(draft.content);
        setDirty(true);
        setRestoredDraftAt(draft.updatedAt);
      }

      await loadExportHistory(detail.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load cover letter.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCoverLetter();
  }, [jobId]);

  useEffect(() => {
    if (!coverLetter?.id || !dirty) {
      return;
    }

    writeDraft({
      version: 1,
      coverLetterId: coverLetter.id,
      title,
      content,
      updatedAt: new Date().toISOString()
    });
  }, [coverLetter?.id, content, dirty, title]);

  const persistCoverLetter = async (trigger: "manual" | "auto"): Promise<boolean> => {
    if (!coverLetter?.id) {
      return false;
    }

    const targetId = coverLetter.id;

    if (trigger === "manual") {
      setSaving(true);
      setError(null);
    } else {
      setAutoSaving(true);
    }

    try {
      const updated = await api.putCoverLetterContent(targetId, {
        title,
        content
      });

      setCoverLetter(updated);
      setTitle(updated.title);
      setContent(updated.content);
      setLastSavedAt(updated.updated_at);
      clearDraft(targetId);
      setDirty(false);
      setRestoredDraftAt(null);
      return true;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to save cover letter.");
      }
      return false;
    } finally {
      if (trigger === "manual") {
        setSaving(false);
      } else {
        setAutoSaving(false);
      }
    }
  };

  useEffect(() => {
    if (!coverLetter?.id || !dirty || loading || saving || autoSaving) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistCoverLetter("auto");
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoSaving, coverLetter?.id, content, dirty, loading, saving, title]);

  const handleExport = async (format: "pdf" | "docx") => {
    if (!coverLetter?.id) {
      return;
    }

    if (dirty) {
      const saved = await persistCoverLetter("manual");
      if (!saved) {
        return;
      }
    }

    setExportError(null);
    setExportingFormat(format);

    try {
      const detail =
        format === "pdf"
          ? await api.createCoverLetterPdfExport(coverLetter.id)
          : await api.createCoverLetterDocxExport(coverLetter.id);

      const directUrl = detail.download?.download_url;
      if (directUrl) {
        window.open(directUrl, "_blank", "noopener,noreferrer");
      } else {
        const fallback = await api.getCoverLetterExportDownload(detail.export.id);
        window.open(fallback.download_url, "_blank", "noopener,noreferrer");
      }

      await loadExportHistory(coverLetter.id);
    } catch (err) {
      if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError("Export failed.");
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const downloadExistingExport = async (coverLetterExportId: string) => {
    try {
      const download = await api.getCoverLetterExportDownload(coverLetterExportId);
      window.open(download.download_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError("Download failed.");
      }
    }
  };

  const handleGenerateWithAi = async () => {
    if (!coverLetter?.job?.tailored_cv_id) {
      setError("A tailored CV must be linked to this job to generate a cover letter.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const generated = await api.postGenerateCoverLetter({
        job_title: coverLetter.job.job_title,
        company_name: coverLetter.job.company_name,
        job_description: coverLetter.job.job_description,
        tailored_cv_id: coverLetter.job.tailored_cv_id
      });

      setTitle(generated.title);
      setContent(generated.content);
      markDirty();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("AI Generation failed.");
      }
    } finally {
      setGenerating(false);
    }
  };

  const saveStatusText = (() => {
    if (saving) {
      return "Saving...";
    }

    if (autoSaving) {
      return "Saving draft...";
    }

    if (dirty) {
      if (restoredDraftAt) {
        return `Unsaved draft restored ${formatDateTime(restoredDraftAt)}`;
      }
      return "Unsaved changes";
    }

    return lastSavedAt ? `Last saved ${formatDateTime(lastSavedAt)}` : "Not saved yet";
  })();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Loading cover letter...</p>
      </div>
    );
  }

  if (!coverLetter) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            {error ?? "Cover letter could not be loaded."}
          </p>
          <button
            onClick={() => navigate("/app/job-tracker")}
            className="mt-4 px-4 py-2 rounded-lg font-medium"
            style={{
              fontSize: "13px",
              background: "var(--color-teal-600)",
              color: "white"
            }}
          >
            Go to Job Tracker
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="border-b px-6 py-3" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/app/job-tracker")} style={{ color: "var(--color-text-secondary)" }}>
              <ChevronLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  Cover Letter - {coverLetter.job?.company_name ?? "Job"}
                </h2>
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    background: "var(--color-teal-50)",
                    color: "var(--color-teal-800)"
                  }}
                >
                  {coverLetter.job?.job_title ?? "Role"}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{saveStatusText}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleGenerateWithAi()}
              disabled={generating || !coverLetter?.job?.tailored_cv_id}
              className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2 border"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                borderColor: "var(--color-teal-200)",
                opacity: generating || !coverLetter?.job?.tailored_cv_id ? 0.7 : 1,
                cursor: generating || !coverLetter?.job?.tailored_cv_id ? "not-allowed" : "pointer"
              }}
              title={!coverLetter?.job?.tailored_cv_id ? "A tailored CV must be linked to the job first." : "Generate with AI"}
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? "Generating..." : "Generate with AI"}
            </button>
            <button
              onClick={() => void persistCoverLetter("manual")}
              disabled={saving || autoSaving || !dirty}
              className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
              style={{
                fontSize: "13px",
                color: dirty ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                opacity: saving || autoSaving || !dirty ? 0.7 : 1
              }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : "Save"}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExportMenu((prev) => !prev)}
                disabled={Boolean(exportingFormat)}
                className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "white",
                  opacity: exportingFormat ? 0.7 : 1
                }}
              >
                {exportingFormat ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {exportingFormat ? "Exporting..." : "Export"}
              </button>
              {showExportMenu && !exportingFormat && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                  <div
                    className="absolute right-0 mt-2 w-40 py-1 rounded-lg border shadow-lg z-50"
                    style={{
                      background: "var(--color-background-primary)",
                      borderColor: "var(--color-border-tertiary)"
                    }}
                  >
                    <button
                      onClick={() => { setShowExportMenu(false); void handleExport("pdf"); }}
                      className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-[var(--color-background-secondary)] transition-colors"
                      style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
                    >
                      <Download size={14} style={{ color: "var(--color-teal-600)" }} />
                      Export as PDF
                    </button>
                    <button
                      onClick={() => { setShowExportMenu(false); void handleExport("docx"); }}
                      className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-[var(--color-background-secondary)] transition-colors"
                      style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
                    >
                      <FileText size={14} style={{ color: "var(--color-teal-600)" }} />
                      Export as DOCX
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="mx-6 mt-4 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {error}
        </div>
      )}

      {exportError && (
        <div
          className="mx-6 mt-4 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {exportError}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-6" style={{ background: "var(--color-background-secondary)" }}>
          <div className="max-w-3xl mx-auto">
            <div className="bg-white p-8 rounded-xl border shadow-sm" style={{ borderColor: "var(--color-border-tertiary)" }}>
              <div className="mb-4">
                <input
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    markDirty();
                  }}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{
                    fontSize: "15px",
                    borderColor: "var(--color-border-secondary)",
                    background: "var(--color-background-primary)",
                    color: "var(--color-text-primary)"
                  }}
                  placeholder="Cover letter title"
                />
              </div>

              <div
                className="mb-6 p-4 rounded-lg border"
                style={{
                  background: "var(--color-teal-50)",
                  borderColor: "var(--color-teal-200)"
                }}
              >
                <p style={{ fontSize: "13px", color: "var(--color-teal-800)", lineHeight: "1.5" }}>
                  <strong>Autosave enabled.</strong> Edits are saved silently and continuously while you type.
                </p>
              </div>

              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  markDirty();
                }}
                className="w-full min-h-[500px] p-0 border-0 focus:outline-none resize-none"
                style={{
                  fontSize: "14px",
                  lineHeight: "1.8",
                  color: "var(--color-text-primary)",
                  fontFamily: "inherit"
                }}
                placeholder="Start writing your cover letter..."
              />
            </div>

            {exportHistory.length > 0 && (
              <div className="mt-4 p-4 rounded-xl border" style={{ borderColor: "var(--color-border-tertiary)", background: "white" }}>
                <p className="mb-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Recent exports
                </p>
                <div className="space-y-2">
                  {exportHistory.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border p-2"
                      style={{ borderColor: "var(--color-border-tertiary)" }}
                    >
                      <div>
                        <p style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                          {item.format.toUpperCase()} • {item.status}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {formatDateTime(item.created_at)}
                        </p>
                      </div>
                      {item.download_available ? (
                        <button
                          onClick={() => void downloadExistingExport(item.id)}
                          className="text-xs underline"
                          style={{ color: "var(--color-teal-700)" }}
                        >
                          Download
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className="hidden lg:flex border-l overflow-auto justify-center items-start"
          style={{
            borderColor: "var(--color-border-tertiary)",
            background: "#F8F9FA",
            flexShrink: 0,
            width: "auto",
            minWidth: "600px",
            padding: "32px"
          }}
        >
          <div>
            <p
              className="uppercase tracking-wider mb-4"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Preview
            </p>
            <div
              className="bg-white shadow-lg"
              style={{
                width: "595px",
                minHeight: "842px",
                padding: "48px 40px",
                fontFamily: "Georgia, serif"
              }}
            >
              <div className="max-w-lg mx-auto">
                <div
                  style={{
                    fontSize: "14px",
                    lineHeight: "1.8",
                    color: "var(--color-text-primary)",
                    whiteSpace: "pre-wrap"
                  }}
                >
                  {content}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
