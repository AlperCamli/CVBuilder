import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sparkles, Zap, Target, TrendingUp, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import type { CvContent } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";

export function AIImproving() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useAuth();

  const importId = location.state?.importId as string | undefined;
  const parsedContent = location.state?.parsedContent as CvContent | undefined;
  const improvementGuidance = (location.state?.improvements as string[] | undefined) ?? [];

  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const steps = useMemo(
    () => [
      { icon: Sparkles, label: "Analyzing imported sections", sublabel: "Scanning structure and content quality", duration: 1400 },
      { icon: Target, label: "Strengthening achievements", sublabel: "Enhancing impact statements and metrics", duration: 1500 },
      { icon: Zap, label: "Improving clarity", sublabel: "Refining language and readability", duration: 1300 },
      { icon: TrendingUp, label: "Optimizing for ATS", sublabel: "Highlighting relevant keywords and impact", duration: 1200 }
    ],
    []
  );

  useEffect(() => {
    if (!importId || !parsedContent) {
      navigate("/app/create", { replace: true });
      return;
    }

    let cancelled = false;
    let totalElapsed = 0;
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);

    const interval = setInterval(() => {
      totalElapsed += 50;
      const nextProgress = Math.min((totalElapsed / totalDuration) * 100, 100);
      setProgress(nextProgress);

      let accumulated = 0;
      for (let index = 0; index < steps.length; index += 1) {
        accumulated += steps[index].duration;
        if (totalElapsed < accumulated) {
          setCurrentStep(index);
          break;
        }
      }

      if (totalElapsed >= totalDuration) {
        clearInterval(interval);

        setTimeout(() => {
          if (cancelled) {
            return;
          }

          setIsFinalizing(true);

          void (async () => {
            try {
              const improved = await api.postImportImprove({
                parsed_content: parsedContent as unknown as Record<string, unknown>,
                language: parsedContent.language,
                improvement_guidance: improvementGuidance
              });

              await api.patchImportResult(importId, improved.improved_content);

              try {
                const existing = await api.listMasterCvs();
                for (const cv of existing) {
                  await api.deleteMasterCv(cv.id);
                }
              } catch {
                // Continue and create a new master CV even if cleanup is partial.
              }

              const converted = await api.createMasterCvFromImport(importId, {});

              navigate(`/app/cv/${converted.master_cv.id}`, {
                state: {
                  cvKind: "master",
                  masterCvId: converted.master_cv.id,
                  aiImproved: true,
                  isUploaded: true
                }
              });
            } catch (err) {
              if (err instanceof Error) {
                setError(err.message);
              } else {
                setError("AI improvement failed.");
              }
              setIsFinalizing(false);
            }
          })();
        }, 400);
      }
    }, 50);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, improvementGuidance, importId, navigate, parsedContent, steps]);

  const currentStepData = steps[currentStep];

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--color-background-secondary)" }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border p-7"
        style={{
          background: "var(--color-background-primary)",
          borderColor: "var(--color-border-tertiary)"
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 style={{ fontSize: "24px", color: "var(--color-text-primary)", fontWeight: 600 }}>
              AI is improving your CV
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
              {currentStepData.sublabel}
            </p>
          </div>
          <div
            className="px-3 py-1 rounded-full"
            style={{
              fontSize: "12px",
              background: "var(--color-teal-50)",
              color: "var(--color-teal-800)",
              fontWeight: 600
            }}
          >
            {Math.round(progress)}%
          </div>
        </div>

        <div
          className="w-full rounded-full"
          style={{ height: "8px", background: "var(--color-background-secondary)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: "var(--color-teal-600)" }}
          />
        </div>

        <div className="mt-6 space-y-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isDone = index < currentStep;
            const isActive = index === currentStep;

            return (
              <div
                key={step.label}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                style={{
                  borderColor: isActive ? "var(--color-teal-300)" : "var(--color-border-tertiary)",
                  background: isActive ? "var(--color-teal-50)" : "var(--color-background-primary)"
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: isDone || isActive ? "var(--color-teal-100)" : "var(--color-background-secondary)"
                  }}
                >
                  {isDone ? (
                    <CheckCircle2 size={16} style={{ color: "var(--color-teal-700)" }} />
                  ) : (
                    <Icon size={16} style={{ color: isActive ? "var(--color-teal-700)" : "var(--color-text-secondary)" }} />
                  )}
                </div>
                <div className="min-w-0">
                  <p style={{ fontSize: "14px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {isFinalizing && (
          <div
            className="mt-6 flex items-center gap-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: "var(--color-teal-200)",
              background: "var(--color-teal-50)",
              color: "var(--color-teal-800)",
              fontSize: "13px"
            }}
          >
            <Loader2 size={14} className="animate-spin" />
            Applying improvements and creating your Master CV...
          </div>
        )}

        {error && (
          <div className="mt-6">
            <div
              className="p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              {error}
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/create")}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)"
              }}
            >
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
