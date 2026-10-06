import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { CvReviewPanel } from "../components/CvReviewPanel";
import type { CvContent, CvReview } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { useOnboarding } from "../contexts/OnboardingContext";
import { ApiClientError } from "../integration/api-error";
import { trackOnboardingStepCompleted, trackOnboardingStepView } from "../integration/analytics";

export function CVScore() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useAuth();
  const { completeStep } = useOnboarding();

  const importId = location.state?.importId as string | undefined;
  const fileName = location.state?.fileName as string | undefined;
  const [review, setReview] = useState<CvReview | null>(null);

  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedContent, setParsedContent] = useState<CvContent | null>(null);
  const [moduleType, setModuleType] = useState<string | undefined>(
    location.state?.moduleType as string | undefined
  );

  useEffect(() => {
    if (!importId) {
      navigate("/app/create", { replace: true });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await api.getImportResult(importId);

        if (cancelled) {
          return;
        }

        setReview(result.review ?? null);
        setParsedContent(result.parsed_content);
        setModuleType(result.module_type);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load parsed CV.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api, importId, navigate]);

  const improvements = review?.improvements ?? [];
  const parseNeedsManualReview = review?.status === "unscorable" || !review;

  useEffect(() => {
    trackOnboardingStepView({
      step: "cv_score",
      source: "upload_processing"
    });
  }, []);

  const convertImportToMasterCv = async (contentToSave: CvContent, destination: "tailor" | "editor") => {
    if (!importId) {
      return;
    }

    setError(null);

    try {
      const targetModule = moduleType ?? "standard";
      const existing = (await api.listMasterCvs()).filter(
        (cv) => (cv.module_type ?? "standard") === targetModule
      );
      if (existing.length > 0) {
        const confirmed = window.confirm(
          "You already have a main CV. Creating a new one will permanently delete the existing one. Continue?"
        );
        if (!confirmed) {
          return;
        }
        for (const cv of existing) {
          await api.deleteMasterCv(cv.id);
        }
      }
    } catch {
      // If the check fails, proceed anyway — a backend error on create will surface
    }

    setConverting(true);

    try {
      await api.patchImportResult(importId, contentToSave);
      const converted = await api.createMasterCvFromImport(importId, {});

      completeStep("create_cv");

      trackOnboardingStepCompleted({
        step: "cv_score",
        destination,
        parse_needs_manual_review: parseNeedsManualReview
      });

      if (destination === "tailor") {
        navigate(`/app/tailor/${converted.master_cv.id}`, {
          state: {
            source: "onboarding_upload"
          }
        });
        return;
      }

      navigate(`/app/cv/${converted.master_cv.id}`, {
        state: {
          cvKind: "master",
          masterCvId: converted.master_cv.id,
          isUploaded: true
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to convert import to main CV.");
      }
      setConverting(false);
    }
  };

  const handleImproveWithAI = () => {
    if (!parsedContent || !importId || parseNeedsManualReview) {
      return;
    }

    navigate("/app/ai-improving", {
      state: {
        importId,
        parsedContent,
        improvements,
        moduleType,
        source: "onboarding_upload"
      }
    });
  };

  const handleCustomizeForJob = () => {
    if (!parsedContent || parseNeedsManualReview) {
      return;
    }
    void convertImportToMasterCv(parsedContent, "tailor");
  };

  const handleReviewInEditor = () => {
    if (!parsedContent) {
      return;
    }
    void convertImportToMasterCv(parsedContent, "editor");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Loading your CV review...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-2xl w-full">
        <div
          className="p-8 rounded-2xl border"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          <div className="text-center mb-8">
            <h1 className="font-medium mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
              Your CV Score
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
              Based on {fileName || "uploaded file"}
            </p>
          </div>

          {error && (
            <div
              className="mb-6 p-4 rounded-xl border"
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

          <div className="mb-8">
            {review ? <CvReviewPanel review={review} /> : <p role="status" style={{ color: "var(--color-text-secondary)" }}>A reliable review is unavailable. Please try uploading your CV again.</p>}
          </div>

          {parseNeedsManualReview ? (
            <button type="button" onClick={() => navigate("/app/create")} className="w-full mb-4 px-6 py-3 rounded-lg border text-sm font-medium" style={{ borderColor: "var(--color-border-secondary)", color: "var(--color-text-primary)" }}>Upload another CV</button>
          ) : null}

          <div className="space-y-3">
            <button
              onClick={handleCustomizeForJob}
              disabled={converting || !parsedContent || parseNeedsManualReview}
              className="w-full px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all hover:shadow-md"
              style={{
                background: "var(--color-teal-600)",
                color: "white",
                fontSize: "14px",
                opacity: converting || parseNeedsManualReview ? 0.7 : 1
              }}
            >
              {converting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Customize for a job
              <ArrowRight size={16} />
            </button>

            <button
              onClick={handleImproveWithAI}
              disabled={converting || !parsedContent || parseNeedsManualReview}
              className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-[var(--color-background-secondary)] inline-flex items-center justify-center gap-2"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-tertiary)",
                color: "var(--color-text-primary)",
                fontSize: "14px",
                opacity: converting ? 0.7 : 1
              }}
            >
              <Sparkles size={16} />
              Improve with AI
            </button>

            <button
              onClick={handleReviewInEditor}
              disabled={converting || !parsedContent}
              className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-[var(--color-background-secondary)] inline-flex items-center justify-center gap-2"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-tertiary)",
                color: "var(--color-text-secondary)",
                fontSize: "14px",
                opacity: converting ? 0.7 : 1
              }}
            >
              {converting ? <Loader2 size={16} className="animate-spin" /> : null}
              Review parsed result in editor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
