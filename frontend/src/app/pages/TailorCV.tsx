import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { ChevronLeft, Target, Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import type {
  JobAnalysisResult,
  FollowUpQuestion,
  TailoringRunFlowType,
  TailoringRunStatusResponse
} from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";

interface TailorCvLocationState {
  prefillJob?: {
    role?: string;
    company?: string;
    jobDescription?: string;
    jobPostingUrl?: string;
    locationText?: string;
    notes?: string;
  };
}

const RETRY_DELAY_MS = [800, 1800];
const POLL_INTERVAL_MS = 750;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const isTransientAiRequestError = (error: unknown): boolean => {
  if (error instanceof ApiClientError) {
    return error.status >= 500 || error.status === 429;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("load failed")
    );
  }

  return false;
};

const withTransientRetry = async <T,>(
  task: () => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isTransientAiRequestError(error);
      if (!shouldRetry) {
        throw error;
      }

      const baseDelay = RETRY_DELAY_MS[Math.min(attempt - 1, RETRY_DELAY_MS.length - 1)] ?? 0;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(baseDelay + jitter);
    }
  }

  throw lastError ?? new Error("Request failed");
};

const toFlowLabel = (flowType: TailoringRunFlowType): string => {
  if (flowType === "job_analysis") {
    return "Job analysis";
  }
  if (flowType === "follow_up_questions") {
    return "Follow-up questions";
  }
  return "Tailored draft";
};

const toStageLabel = (
  flowType: TailoringRunFlowType,
  stage: TailoringRunStatusResponse["progress_stage"]
): string => {
  const flowLabel = toFlowLabel(flowType);

  if (stage === "queued") {
    return `${flowLabel}: queued`;
  }
  if (stage === "building_prompt") {
    return `${flowLabel}: preparing prompt`;
  }
  if (stage === "calling_model") {
    return `${flowLabel}: calling AI model`;
  }
  if (stage === "parsing_output") {
    return `${flowLabel}: parsing response`;
  }
  if (stage === "validating_output") {
    return `${flowLabel}: validating output`;
  }
  if (stage === "persisting_result") {
    return `${flowLabel}: saving results`;
  }
  if (stage === "completed") {
    return `${flowLabel}: completed`;
  }
  return `${flowLabel}: failed`;
};

const toRunErrorMessage = (status: TailoringRunStatusResponse): string => {
  const raw = status.error_message?.trim();
  const normalized = raw?.toLowerCase() ?? "";

  if (
    normalized.includes("provider_status=429") ||
    normalized.includes("resource_exhausted")
  ) {
    return "AI rate limit reached. Wait a moment and try again.";
  }

  if (
    normalized.includes("provider_status=503") ||
    normalized.includes("provider_status=504") ||
    normalized.includes("unavailable")
  ) {
    return "AI service is temporarily unavailable. Please retry shortly.";
  }

  if (
    normalized.includes("structured output validation failed") ||
    normalized.includes("required contract")
  ) {
    return "AI returned an invalid structured response. Please retry.";
  }

  if (raw) {
    return raw;
  }

  return "Tailoring AI request failed.";
};

export function TailorCV() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { api } = useAuth();
  const state = (location.state ?? {}) as TailorCvLocationState;
  const prefillJob = state.prefillJob;

  const [masterCvId, setMasterCvId] = useState<string | null>(null);
  const [masterCvTitle, setMasterCvTitle] = useState<string>("Master CV");
  const [formData, setFormData] = useState({
    role: prefillJob?.role ?? "",
    company: prefillJob?.company ?? "",
    jobDescription: prefillJob?.jobDescription ?? "",
    jobPostingUrl: prefillJob?.jobPostingUrl ?? "",
    locationText: prefillJob?.locationText ?? "",
    notes: prefillJob?.notes ?? ""
  });
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolveMasterCv = async () => {
      setLoadingMaster(true);
      setError(null);

      try {
        if (!id || id === "master") {
          const masters = await api.listMasterCvs();
          const primary = masters[0];
          if (!primary) {
            throw new Error("Create a master CV first before tailoring.");
          }

          if (!cancelled) {
            setMasterCvId(primary.id);
            setMasterCvTitle(primary.title);
          }
          return;
        }

        const master = await api.getMasterCv(id);
        if (!cancelled) {
          setMasterCvId(master.id);
          setMasterCvTitle(master.title);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load source master CV.");
        }
      } finally {
        if (!cancelled) {
          setLoadingMaster(false);
        }
      }
    };

    void resolveMasterCv();

    return () => {
      cancelled = true;
    };
  }, [api, id]);

  useEffect(() => {
    if (!prefillJob) {
      return;
    }

    setFormData((prev) => ({
      role: prefillJob.role ?? prev.role,
      company: prefillJob.company ?? prev.company,
      jobDescription: prefillJob.jobDescription ?? prev.jobDescription,
      jobPostingUrl: prefillJob.jobPostingUrl ?? prev.jobPostingUrl,
      locationText: prefillJob.locationText ?? prev.locationText,
      notes: prefillJob.notes ?? prev.notes
    }));
  }, [prefillJob]);

  const runTailoringFlow = async <TResult extends Record<string, unknown>>(
    flowType: TailoringRunFlowType,
    input: Record<string, unknown>
  ): Promise<{ ai_run_id: string; result: TResult }> => {
    const started = await withTransientRetry(
      () =>
        api.startTailoringRun({
          flow_type: flowType,
          input
        }),
      3
    );

    setProgressMessage(toStageLabel(flowType, started.progress_stage));

    const executePromise = api.executeTailoringRun(started.ai_run_id).catch((executeError) => executeError);

    let status = await withTransientRetry(
      () => api.getTailoringRunStatus(started.ai_run_id),
      3
    );
    setProgressMessage(toStageLabel(flowType, status.progress_stage));

    while (status.status === "pending") {
      await sleep(POLL_INTERVAL_MS);
      status = await withTransientRetry(() => api.getTailoringRunStatus(started.ai_run_id), 3);
      setProgressMessage(toStageLabel(flowType, status.progress_stage));
    }

    const executeOutcome = await executePromise;
    if (executeOutcome instanceof Error && status.status !== "completed") {
      throw executeOutcome;
    }

    if (status.status !== "completed") {
      throw new Error(toRunErrorMessage(status));
    }

    const result = await withTransientRetry(() => api.getTailoringRunResult(started.ai_run_id), 3);
    return {
      ai_run_id: started.ai_run_id,
      result: result.result as TResult
    };
  };

  const handleSubmit = async () => {
    if (!masterCvId) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setProgressMessage(null);

    try {
      const job = {
        company_name: formData.company,
        job_title: formData.role,
        job_description: formData.jobDescription
      };

      const analysisRun = await runTailoringFlow<Omit<JobAnalysisResult, "ai_run_id">>(
        "job_analysis",
        {
          master_cv_id: masterCvId,
          job
        }
      );
      const analysis: JobAnalysisResult = {
        ai_run_id: analysisRun.ai_run_id,
        ...(analysisRun.result as Omit<JobAnalysisResult, "ai_run_id">)
      };

      const followUpRun = await runTailoringFlow<{ questions: FollowUpQuestion[] }>(
        "follow_up_questions",
        {
          master_cv_id: masterCvId,
          job,
          prior_analysis: analysis
        }
      );
      const followUp = {
        ai_run_id: followUpRun.ai_run_id,
        questions: followUpRun.result.questions
      };

      navigate(`/app/tailoring-flow/${masterCvId}`, {
        state: {
          masterCvId,
          masterCvTitle,
          jobData: {
            role: formData.role,
            company: formData.company,
            jobDescription: formData.jobDescription,
            jobPostingUrl: formData.jobPostingUrl,
            locationText: formData.locationText,
            notes: formData.notes
          },
          analysis,
          followUpQuestions: followUp.questions
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to analyze job description.");
      }
    } finally {
      setProgressMessage(null);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-5xl w-full">
        <div className="mb-6">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 mb-4"
            style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}
          >
            <ChevronLeft size={16} />
            Back to dashboard
          </button>
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
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
                <Target size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <h1 className="font-medium" style={{ fontSize: "28px", lineHeight: "1.2", color: "var(--color-text-primary)" }}>
                Tailor your CV for this role
              </h1>
            </div>

            <p className="mb-8" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              Source: <strong>{loadingMaster ? "Loading..." : masterCvTitle}</strong>
            </p>

            <div className="space-y-4">
              <h3 className="uppercase tracking-wider" style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                What happens next
              </h3>
              {["AI analyzes the job description", "Follow-up questions are generated", "Tailored CV draft is created", "You review every AI change before applying"].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: "var(--color-teal-600)" }} />
                  <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div
              className="p-6 rounded-xl border"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)"
              }}
            >
              <h2 className="font-medium mb-6" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Job details
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Role
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Senior Product Designer"
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)"
                    }}
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Company name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TechStart Inc"
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)"
                    }}
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Job description
                  </label>
                  <textarea
                    rows={10}
                    placeholder="Paste the full job description here..."
                    className="w-full px-3 py-2 rounded-lg border resize-none"
                    style={{
                      fontSize: "13px",
                      lineHeight: "1.6",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)"
                    }}
                    value={formData.jobDescription}
                    onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="url"
                    placeholder="Job posting URL (optional)"
                    value={formData.jobPostingUrl}
                    onChange={(e) => setFormData({ ...formData, jobPostingUrl: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)", background: "var(--color-background-primary)" }}
                  />
                  <input
                    type="text"
                    placeholder="Location (optional)"
                    value={formData.locationText}
                    onChange={(e) => setFormData({ ...formData, locationText: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)", background: "var(--color-background-primary)" }}
                  />
                </div>
              </div>

              <button
                onClick={() => void handleSubmit()}
                disabled={
                  loadingMaster ||
                  submitting ||
                  !masterCvId ||
                  !formData.role ||
                  !formData.company ||
                  !formData.jobDescription
                }
                className="w-full mt-6 px-6 py-3 rounded-lg font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)"
                }}
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? "Analyzing..." : "Analyze job & continue"}
              </button>
              {submitting && progressMessage ? (
                <p className="mt-3" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {progressMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
