import { useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { ChevronLeft, ChevronRight, CheckCircle, Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { useUpgradePrompt } from "../contexts/UpgradePromptContext";
import { isEntitlementExceeded, resolveEntitlementFeature } from "../integration/entitlement-upsell";
import type { FollowUpQuestion, JobAnalysisResult } from "../integration/api-types";
import { runTailoringFlow } from "../integration/tailoring-run";
import { trackTailoredCvGenerated } from "../integration/analytics";

interface TailoringFlowState {
  masterCvId?: string;
  masterCvTitle?: string;
  jobData?: {
    role: string;
    company: string;
    jobDescription: string;
    jobPostingUrl?: string;
    locationText?: string;
    notes?: string;
  };
  analysis?: JobAnalysisResult;
}

const toOptionalUrl = (value?: string): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
};

const toOptionalTrimmed = (value: string | undefined, maxLength: number): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

export function TailoringFlow() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { api } = useAuth();
  const { showUpgradePrompt } = useUpgradePrompt();

  const state = (location.state ?? {}) as TailoringFlowState;
  const masterCvId = state.masterCvId ?? id;
  const jobData = state.jobData;
  const analysis = state.analysis;

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<FollowUpQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const topics = useMemo(() => (analysis?.topics ?? []).slice(0, 10), [analysis]);

  const keywords = useMemo(() => (analysis?.keywords ?? []).slice(0, 14), [analysis]);

  if (!masterCvId || !jobData || !analysis) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <div className="max-w-md w-full p-6 rounded-xl border" style={{ borderColor: "var(--color-border-tertiary)", background: "var(--color-background-primary)" }}>
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Customization context was not found. Start again from the Customize page.
          </p>
          <button
            onClick={() => navigate(`/app/tailor/${id ?? "master"}`)}
            className="mt-4 px-4 py-2 rounded-lg font-medium"
            style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}
          >
            Back to Customize CV
          </button>
        </div>
      </div>
    );
  }

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setProgressMessage(null);

    try {
      const normalizedJobPostingUrl = toOptionalUrl(jobData.jobPostingUrl);
      if (jobData.jobPostingUrl?.trim() && !normalizedJobPostingUrl) {
        setError("Job posting URL is invalid. Use a full URL (for example https://...) or leave it empty.");
        setGenerating(false);
        return;
      }

      const answers = [
        {
          question_id: "priority_topics",
          selected_options: selectedTopics.slice(0, 20).map((value) => value.slice(0, 200))
        },
        {
          question_id: "priority_keywords",
          selected_options: selectedKeywords.slice(0, 20).map((value) => value.slice(0, 200))
        },
        ...followUpQuestions
          .map((question) => {
            const answer = questionAnswers[question.id]?.trim();
            if (!answer) {
              return null;
            }
            return {
              question_id: question.id,
              question_text: question.question,
              answer_text: answer.slice(0, 4000)
            };
          })
          .filter((item): item is { question_id: string; answer_text: string } => Boolean(item))
      ];

      const draft = await runTailoringFlow<Record<string, unknown>>({
        api,
        flowType: "tailored_draft",
        input: {
          master_cv_id: masterCvId,
          job: {
            company_name: jobData.company,
            job_title: jobData.role,
            job_description: jobData.jobDescription,
            job_posting_url: normalizedJobPostingUrl,
            location_text: toOptionalTrimmed(jobData.locationText, 240),
            notes: toOptionalTrimmed(jobData.notes, 10_000)
          },
          answers
        },
        onStage: setProgressMessage
      });

      const draftPayload = draft.result as {
        tailored_cv: { id: string };
        job: { job_title: string; company_name: string };
      };

      trackTailoredCvGenerated({
        source: "tailoring_flow",
        selected_topic_count: selectedTopics.length,
        selected_keyword_count: selectedKeywords.length,
        answered_follow_up_count: answers.filter((answer) => "answer_text" in answer).length,
        generated_question_count: followUpQuestions.length,
        has_company: Boolean(jobData.company.trim()),
        has_job_posting_url: Boolean(jobData.jobPostingUrl?.trim()),
        has_location: Boolean(jobData.locationText?.trim()),
        has_notes: Boolean(jobData.notes?.trim())
      });

      navigate(`/app/cv/${draftPayload.tailored_cv.id}`, {
        state: {
          cvKind: "tailored",
          isTailored: true,
          tailoredCvId: draftPayload.tailored_cv.id,
          jobData: {
            role: draftPayload.job.job_title,
            company: draftPayload.job.company_name
          }
        }
      });
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, "tailored_cv_generation"),
          reason: err.message
        });
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to generate customized CV draft.");
      }
      setGenerating(false);
      setProgressMessage(null);
    }
  };

  const handleNext = () => {
    if (currentStep === 0) {
      void handleGenerateFollowUps();
      return;
    }

    void handleGenerate();
  };

  const handleGenerateFollowUps = async () => {
    if (selectedTopics.length + selectedKeywords.length === 0) {
      setError("Select at least one topic or keyword before continuing.");
      return;
    }

    setLoadingFollowUps(true);
    setError(null);
    setProgressMessage(null);

    try {
      const followUpRun = await runTailoringFlow<{ questions: FollowUpQuestion[] }>({
        api,
        flowType: "follow_up_questions",
        input: {
          master_cv_id: masterCvId,
          selected_topics: selectedTopics.slice(0, 20),
          selected_keywords: selectedKeywords.slice(0, 20)
        },
        onStage: setProgressMessage
      });

      setFollowUpQuestions(followUpRun.result.questions ?? []);
      setCurrentStep(1);
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, "ai_action"),
          reason: err.message
        });
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to generate follow-up questions.");
      }
    } finally {
      setLoadingFollowUps(false);
      setProgressMessage(null);
    }
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((item) => item !== topic) : [...prev, topic]
    );
  };

  const toggleKeyword = (keyword: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(keyword) ? prev.filter((item) => item !== keyword) : [...prev, keyword]
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="border-b px-6 py-4" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2" style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>
            <ChevronLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            {[0, 1].map((step) => (
              <div
                key={step}
                className="w-2 h-2 rounded-full"
                style={{ background: step <= currentStep ? "var(--color-teal-600)" : "var(--color-border-secondary)" }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <div className="max-w-2xl w-full">
          {error && (
            <div
              className="mb-5 p-4 rounded-lg border"
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

          {currentStep === 0 && (
            <div className="p-8 rounded-xl border" style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}>
              <div className="mb-6">
                <div className="inline-block px-3 py-1 rounded-full mb-4" style={{ background: "var(--color-teal-50)", color: "var(--color-teal-800)", fontSize: "11px", fontWeight: 500 }}>
                  {jobData.company ? `${jobData.role} at ${jobData.company}` : jobData.role}
                </div>
                <h2 className="font-medium mb-3" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
                  Choose topics and keywords
                </h2>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                  Select at least one topic or keyword that should be emphasized in your customized CV.
                </p>
              </div>

              <div className="space-y-3 mb-6">
                {(topics.length > 0 ? topics : ["Core responsibilities", "Team collaboration", "Execution quality"]).map((topic) => {
                  const isSelected = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      className="w-full p-4 rounded-lg border-2 flex items-center justify-between transition-all"
                      style={{
                        borderColor: isSelected ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                        background: isSelected ? "var(--color-teal-50)" : "var(--color-background-primary)"
                      }}
                    >
                      <span className="font-medium" style={{ fontSize: "14px", color: isSelected ? "var(--color-teal-800)" : "var(--color-text-primary)" }}>
                        {topic}
                      </span>
                      {isSelected && <CheckCircle size={20} style={{ color: "var(--color-teal-600)" }} />}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 mb-6">
                {(keywords.length > 0 ? keywords : ["results-driven", "collaboration", "ownership"]).map((keyword) => {
                  const isSelected = selectedKeywords.includes(keyword);
                  return (
                    <button
                      key={keyword}
                      onClick={() => toggleKeyword(keyword)}
                      className="px-4 py-2 rounded-full border-2 transition-all"
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        borderColor: isSelected ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                        background: isSelected ? "var(--color-teal-50)" : "var(--color-background-primary)",
                        color: isSelected ? "var(--color-teal-800)" : "var(--color-text-secondary)"
                      }}
                    >
                      {keyword}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => navigate(-1)}
                  className="px-6 py-2.5 rounded-lg font-medium border"
                  style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={loadingFollowUps}
                  className="flex-1 px-6 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2"
                  style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "var(--color-teal-50)" }}
                >
                  {loadingFollowUps ? <Loader2 size={14} className="animate-spin" /> : null}
                  {loadingFollowUps ? "Generating questions..." : "Continue"}
                  {!loadingFollowUps ? <ChevronRight size={16} /> : null}
                </button>
              </div>
              {loadingFollowUps && progressMessage ? (
                <p className="mt-3" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {progressMessage}
                </p>
              ) : null}
            </div>
          )}

          {currentStep === 1 && (
            <div className="p-8 rounded-xl border" style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}>
              <div className="mb-6">
                <h2 className="font-medium mb-3" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
                  Follow-up context
                </h2>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                  Answer only the questions that help explain how your selected topics should appear in the CV.
                </p>
              </div>

              {followUpQuestions.length > 0 && (
                <div className="space-y-3 mb-6">
                  {followUpQuestions.slice(0, 3).map((question) => (
                    <div key={question.id}>
                      <label className="block mb-1" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                        {question.question}
                      </label>
                      {question.question_type === "yes_no" ? (
                        <div className="flex gap-2">
                          {["yes", "no"].map((value) => {
                            const isSelected = questionAnswers[question.id] === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setQuestionAnswers((prev) => ({
                                    ...prev,
                                    [question.id]: value
                                  }))
                                }
                                className="px-4 py-2 rounded-lg border font-medium"
                                style={{
                                  fontSize: "13px",
                                  borderColor: isSelected ? "var(--color-teal-400)" : "var(--color-border-secondary)",
                                  background: isSelected ? "var(--color-teal-50)" : "var(--color-background-primary)",
                                  color: isSelected ? "var(--color-teal-800)" : "var(--color-text-secondary)"
                                }}
                              >
                                {value === "yes" ? "Yes" : "No"}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          value={questionAnswers[question.id] ?? ""}
                          onChange={(event) =>
                            setQuestionAnswers((prev) => ({
                              ...prev,
                              [question.id]: event.target.value
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg border"
                          style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)", background: "var(--color-background-primary)" }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(0)}
                  className="px-6 py-2.5 rounded-lg font-medium flex items-center gap-2"
                  style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={generating}
                  className="flex-1 px-6 py-2.5 rounded-lg font-medium inline-flex items-center justify-center gap-2"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "var(--color-teal-50)",
                    opacity: generating ? 0.7 : 1
                  }}
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : null}
                  {generating ? "Generating customized CV..." : "Generate customized CV"}
                </button>
              </div>
              {generating && progressMessage ? (
                <p className="mt-3" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {progressMessage}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
