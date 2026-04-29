import { Link } from "react-router";
import { FileText, ExternalLink, Target, Download, MoreVertical, Trash2, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { MasterCvSummary, TailoredCvSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

export function Resumes() {
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const [masterCvs, setMasterCvs] = useState<MasterCvSummary[]>([]);
  const [tailoredCvs, setTailoredCvs] = useState<TailoredCvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [busyMasterId, setBusyMasterId] = useState<string | null>(null);
  const [busyTailoredId, setBusyTailoredId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [masters, tailored] = await Promise.all([api.listMasterCvs(), api.listTailoredCvs()]);
      setMasterCvs(masters);
      setTailoredCvs(tailored);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load CVs.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  useEffect(() => {
    void load();
  }, []);

  const primaryMaster = masterCvs[0] ?? null;

  const exportTailoredCv = async (tailoredCvId: string) => {
    setExportingId(tailoredCvId);
    try {
      const result = await api.createPdfExport(tailoredCvId);
      const downloadUrl = result.download?.download_url;

      if (downloadUrl) {
        window.open(downloadUrl, "_blank", "noopener,noreferrer");
      } else {
        const fallback = await api.getExportDownload(result.export.id);
        window.open(fallback.download_url, "_blank", "noopener,noreferrer");
      }
      await load();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Export failed.");
      }
    } finally {
      setExportingId(null);
    }
  };

  const duplicateMaster = async (masterCvId: string) => {
    setBusyMasterId(masterCvId);
    try {
      await api.duplicateMasterCv(masterCvId);
      await load();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to duplicate master CV.");
      }
    } finally {
      setBusyMasterId(null);
    }
  };

  const deleteMaster = async (masterCvId: string) => {
    const confirmed = window.confirm("Delete this master CV? This action can be reversed only from backups.");
    if (!confirmed) {
      return;
    }

    setBusyMasterId(masterCvId);
    try {
      await api.deleteMasterCv(masterCvId);
      // Immediately remove from local state to prevent stale UI
      setMasterCvs((prev) => prev.filter((cv) => cv.id !== masterCvId));
      setTailoredCvs((prev) => prev.filter((cv) => cv.master_cv_id !== masterCvId));
      await load();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to delete master CV.");
      }
    } finally {
      setBusyMasterId(null);
    }
  };

  const deleteTailored = async (tailoredCvId: string) => {
    const confirmed = window.confirm("Delete this tailored CV?");
    if (!confirmed) {
      return;
    }

    setBusyTailoredId(tailoredCvId);
    try {
      await api.deleteTailoredCv(tailoredCvId);
      await load();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to delete tailored CV.");
      }
    } finally {
      setBusyTailoredId(null);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          My CVs
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Manage your master CV and tailored versions
        </p>
      </div>

      {error && (
        <div
          className="mb-6 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {error}
          <button
            type="button"
            className="ml-3 underline"
            style={{ color: "var(--color-red-700)" }}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading CVs...</div>
      )}

      {!loading && (
        <>
          <div className="mb-8">
            <p
              className="uppercase tracking-wider mb-3"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Master CV
            </p>

            {!primaryMaster && (
              <div
                className="p-5 rounded-xl border"
                style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
              >
                <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  You don&apos;t have a master CV yet.
                </p>
                <Link
                  to="/app/create"
                  className="inline-flex mt-3 px-4 py-2 rounded-lg font-medium"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "var(--color-teal-50)"
                  }}
                >
                  Create or upload
                </Link>
              </div>
            )}

            {primaryMaster && (
              <div
                className="p-5 rounded-xl border"
                style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4">
                    <div
                      className="w-12 h-16 rounded border flex items-center justify-center flex-shrink-0"
                      style={{ background: "var(--color-slate-50)", borderColor: "var(--color-border-secondary)" }}
                    >
                      <FileText size={20} style={{ color: "var(--color-text-secondary)" }} />
                    </div>
                    <div>
                      <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                        {primaryMaster.title}
                      </h3>
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        Last updated {formatDate(primaryMaster.updated_at)}
                      </p>
                    </div>
                  </div>
                  <span
                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{ background: "var(--color-teal-50)", color: "var(--color-teal-800)" }}
                  >
                    Master CV
                  </span>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Link
                    to={`/app/cv/${primaryMaster.id}`}
                    state={{ cvKind: "master", masterCvId: primaryMaster.id }}
                    className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                    style={{
                      fontSize: "13px",
                      background: "var(--color-teal-600)",
                      color: "var(--color-teal-50)"
                    }}
                  >
                    <ExternalLink size={14} />
                    Open
                  </Link>
                  <Link
                    to={`/app/tailor/${primaryMaster.id}`}
                    className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
                    style={{
                      fontSize: "13px",
                      background: "var(--color-teal-50)",
                      color: "var(--color-teal-800)",
                      borderColor: "var(--color-teal-200)"
                    }}
                  >
                    <Target size={14} />
                    Tailor for a job
                  </Link>
                  <button
                    onClick={() => void duplicateMaster(primaryMaster.id)}
                    disabled={busyMasterId === primaryMaster.id}
                    className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      color: "var(--color-text-secondary)",
                      opacity: busyMasterId === primaryMaster.id ? 0.6 : 1
                    }}
                  >
                    <Copy size={14} />
                    Duplicate
                  </button>
                  <button
                    onClick={() => void deleteMaster(primaryMaster.id)}
                    disabled={busyMasterId === primaryMaster.id}
                    className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-red-200)",
                      color: "var(--color-red-700)",
                      opacity: busyMasterId === primaryMaster.id ? 0.6 : 1
                    }}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <p
              className="uppercase tracking-wider mb-3"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Tailored CVs ({tailoredCvs.length})
            </p>

            {tailoredCvs.length === 0 && (
              <div
                className="p-8 rounded-xl border-2 border-dashed"
                style={{ borderColor: "var(--color-border-tertiary)" }}
              >
                <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  No tailored CVs yet. Create one from your master CV.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {tailoredCvs.map((cv) => (
                <div
                  key={cv.id}
                  className="p-4 rounded-xl border"
                  style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div
                        className="w-10 h-14 rounded border flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--color-slate-50)", borderColor: "var(--color-border-secondary)" }}
                      >
                        <FileText size={16} style={{ color: "var(--color-text-secondary)" }} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <h3 className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                              {cv.job?.job_title || cv.title}
                            </h3>
                            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                              {cv.job?.company_name || "Unlinked job"}
                            </p>
                          </div>
                          <button style={{ color: "var(--color-text-secondary)" }}>
                            <MoreVertical size={16} />
                          </button>
                        </div>

                        <div className="flex items-center gap-3 mt-3 mb-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs"
                            style={{
                              background: "var(--color-teal-50)",
                              color: "var(--color-teal-800)"
                            }}
                          >
                            {cv.status}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                            Last edited {formatDate(cv.updated_at)}
                          </span>
                        </div>

                        <div className="flex gap-2">
                          <Link
                            to={`/app/cv/${cv.id}`}
                            state={{ cvKind: "tailored" }}
                            className="px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                            style={{
                              fontSize: "12px",
                              background: "var(--color-teal-600)",
                              color: "var(--color-teal-50)"
                            }}
                          >
                            <ExternalLink size={12} />
                            Open
                          </Link>
                          <button
                            onClick={() => void exportTailoredCv(cv.id)}
                            disabled={exportingId === cv.id}
                            className="px-3 py-1.5 rounded-lg font-medium transition-colors border flex items-center gap-1.5"
                            style={{
                              fontSize: "12px",
                              borderColor: "var(--color-border-secondary)",
                              color: "var(--color-text-secondary)",
                              opacity: exportingId === cv.id ? 0.6 : 1
                            }}
                          >
                            <Download size={12} />
                            {exportingId === cv.id ? "Exporting..." : "Export PDF"}
                          </button>
                          <button
                            onClick={() => void deleteTailored(cv.id)}
                            disabled={busyTailoredId === cv.id}
                            className="px-3 py-1.5 rounded-lg font-medium transition-colors border flex items-center gap-1.5"
                            style={{
                              fontSize: "12px",
                              borderColor: "var(--color-red-200)",
                              color: "var(--color-red-700)",
                              opacity: busyTailoredId === cv.id ? 0.6 : 1
                            }}
                          >
                            <Trash2 size={12} />
                            {busyTailoredId === cv.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
