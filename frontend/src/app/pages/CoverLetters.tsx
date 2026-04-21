import { FileText, Plus, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import { ApiClientError } from "../integration/api-error";
import type { JobSummary } from "../integration/api-types";

interface JobCard {
  id: string;
  title: string;
  company: string;
  cvName: string;
  hasCoverLetter: boolean;
  date: string;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

export function CoverLetters() {
  const { setSidebarVisible } = useSidebar();
  const navigate = useNavigate();
  const { api } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.listJobs({
        sort_by: "updated_at",
        sort_order: "desc",
        linked_tailored_cv: true,
        page: 1,
        limit: 100
      });
      setJobs(response.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load jobs.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  const jobCards = useMemo<JobCard[]>(() => {
    return jobs.map((job) => ({
      id: job.id,
      title: job.job_title,
      company: job.company_name,
      cvName: job.tailored_cv_title ?? "Tailored CV",
      hasCoverLetter: Boolean(job.cover_letter_id),
      date: formatDate(job.updated_at)
    }));
  }, [jobs]);

  const openCoverLetter = async (job: JobSummary) => {
    setProcessingJobId(job.id);
    setError(null);

    try {
      const detail = await api.upsertCoverLetterByJob(job.id);
      setJobs((prev) =>
        prev.map((item) =>
          item.id === job.id
            ? {
                ...item,
                cover_letter_id: detail.id
              }
            : item
        )
      );

      navigate(`/app/cover-letter/${job.id}`, {
        state: {
          coverLetterId: detail.id
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open cover letter.");
      }
    } finally {
      setProcessingJobId(null);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Cover Letters
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Create and manage cover letters for your job applications
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
            onClick={() => void loadJobs()}
          >
            Retry
          </button>
        </div>
      )}

      <div className="max-w-4xl">
        {loading && (
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading jobs...</p>
        )}

        {!loading && (
          <div className="grid gap-4">
            {jobCards.map((jobCard) => {
              const job = jobs.find((item) => item.id === jobCard.id);
              if (!job) {
                return null;
              }

              const isProcessing = processingJobId === job.id;

              return (
                <div
                  key={jobCard.id}
                  className="p-5 rounded-xl border bg-white hover:shadow-md transition-all"
                  style={{ borderColor: "var(--color-border-tertiary)" }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-medium" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
                          {jobCard.title}
                        </h3>
                        {jobCard.hasCoverLetter && (
                          <div
                            className="px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{
                              background: "var(--color-teal-50)",
                              color: "var(--color-teal-800)"
                            }}
                          >
                            <CheckCircle2 size={12} />
                            <span style={{ fontSize: "11px", fontWeight: 500 }}>Created</span>
                          </div>
                        )}
                      </div>
                      <p className="mb-1" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                        {jobCard.company}
                      </p>
                      <div className="flex items-center gap-4 mt-3">
                        <span
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: "var(--color-slate-50)",
                            color: "var(--color-text-secondary)"
                          }}
                        >
                          {jobCard.cvName}
                        </span>
                        <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                          {jobCard.date}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isProcessing ? (
                        <button
                          disabled
                          className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed"
                          style={{
                            fontSize: "13px",
                            background: "var(--color-teal-600)",
                            color: "white",
                            opacity: 0.7
                          }}
                        >
                          <Loader2 size={14} className="animate-spin" />
                          {jobCard.hasCoverLetter ? "Opening..." : "Creating..."}
                        </button>
                      ) : jobCard.hasCoverLetter ? (
                        <button
                          onClick={() => void openCoverLetter(job)}
                          className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 border"
                          style={{
                            fontSize: "13px",
                            color: "var(--color-teal-600)",
                            borderColor: "var(--color-teal-200)",
                            background: "var(--color-teal-50)"
                          }}
                        >
                          <Mail size={14} />
                          View Cover Letter
                        </button>
                      ) : (
                        <button
                          onClick={() => void openCoverLetter(job)}
                          className="px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                          style={{
                            fontSize: "13px",
                            background: "var(--color-teal-600)",
                            color: "white"
                          }}
                        >
                          <Plus size={14} />
                          Create Cover Letter
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && jobCards.length === 0 && (
          <div className="mt-16">
            <div
              className="p-12 rounded-xl border-2 border-dashed text-center"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "var(--color-slate-50)" }}
              >
                <FileText size={32} style={{ color: "var(--color-text-secondary)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                No jobs with tailored CV yet
              </h3>
              <p
                className="mb-6 max-w-md mx-auto"
                style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}
              >
                Create a tailored CV for a job first, then generate and manage its cover letter here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
