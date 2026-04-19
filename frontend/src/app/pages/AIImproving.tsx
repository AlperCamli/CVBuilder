import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sparkles, Zap, Target, TrendingUp, Loader2 } from "lucide-react";
import type { CvContent, CvSection } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";

const cloneContent = (content: CvContent): CvContent =>
  JSON.parse(JSON.stringify(content)) as CvContent;

const buildSummarySection = (order: number): CvSection => ({
  id: `summary-${Date.now()}`,
  type: "summary",
  title: "Summary",
  order,
  meta: {},
  blocks: [
    {
      id: `summary-block-${Date.now()}`,
      type: "summary",
      order: 0,
      visibility: "visible",
      fields: {
        text: "Results-driven professional with strong ownership, communication, and delivery focus."
      },
      meta: {}
    }
  ]
});

const improveParsedContent = (content: CvContent): CvContent => {
  const next = cloneContent(content);

  const summarySection = next.sections.find((section) => section.type === "summary");

  if (summarySection && summarySection.blocks[0]) {
    const block = summarySection.blocks[0];
    const baseText = typeof block.fields.text === "string" ? block.fields.text : "";
    const improvedText = baseText.trim().length
      ? `${baseText.trim()} Focused on measurable outcomes and role-specific impact.`
      : "Results-driven professional with measurable achievements and role-specific impact.";

    block.fields.text = improvedText;
  } else {
    next.sections.unshift(buildSummarySection(0));
    next.sections = next.sections.map((section, index) => ({ ...section, order: index }));
  }

  const experienceSection = next.sections.find((section) => section.type === "experience");
  if (experienceSection) {
    experienceSection.blocks = experienceSection.blocks.map((block) => {
      const description = typeof block.fields.description === "string" ? block.fields.description : "";
      if (description.trim().length > 0) {
        block.fields.description = `${description.trim()}\n• Delivered improvements with clear business impact.`;
      }
      return block;
    });
  }

  return next;
};

export function AIImproving() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useAuth();

  const importId = location.state?.importId as string | undefined;
  const parsedContent = location.state?.parsedContent as CvContent | undefined;

  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const steps = useMemo(
    () => [
      { icon: Sparkles, label: "Analyzing imported sections", color: "var(--color-teal-600)", duration: 1400 },
      { icon: Target, label: "Strengthening achievements", color: "var(--color-blue-600)", duration: 1500 },
      { icon: Zap, label: "Improving clarity", color: "var(--color-purple-600)", duration: 1300 },
      { icon: TrendingUp, label: "Optimizing for ATS", color: "var(--color-green-600)", duration: 1200 }
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
          const improved = improveParsedContent(parsedContent);

          void (async () => {
            try {
              await api.patchImportResult(importId, improved);
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
  }, [api, importId, navigate, parsedContent, steps]);

  const currentStepData = steps[currentStep];
  const Icon = currentStepData.icon;

  return (
    <div className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden" style={{ background: "var(--color-background-secondary)" }}>
      <div className="absolute inset-0 overflow-hidden opacity-20">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-pulse"
            style={{
              background: steps[i % steps.length].color,
              width: `${Math.random() * 100 + 50}px`,
              height: `${Math.random() * 100 + 50}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${Math.random() * 3 + 2}s`,
              filter: "blur(40px)"
            }}
          />
        ))}
      </div>

      <div className="max-w-lg w-full relative z-10">
        <div
          className="p-10 rounded-2xl border text-center shadow-lg"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          <div className="flex justify-center mb-6">
            <div
              className="relative w-24 h-24 rounded-2xl flex items-center justify-center animate-pulse"
              style={{ background: `${currentStepData.color}10` }}
            >
              <Icon size={48} style={{ color: currentStepData.color }} />
            </div>
          </div>

          <h2 className="font-medium mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
            AI is improving your CV
          </h2>
          <p className="mb-8 font-medium" style={{ fontSize: "15px", color: currentStepData.color }}>
            {currentStepData.label}
          </p>

          <div className="mb-8">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border-secondary)" }}>
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${steps[0].color}, ${steps[steps.length - 1].color})`
                }}
              />
            </div>
          </div>

          <div className="flex justify-between items-center">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              const isComplete = index < currentStep;
              const isCurrent = index === currentStep;

              return (
                <div key={step.label} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      isCurrent ? "scale-110" : "scale-100"
                    }`}
                    style={{
                      background: isComplete || isCurrent ? `${step.color}15` : "var(--color-border-secondary)",
                      border: `2px solid ${isComplete || isCurrent ? step.color : "transparent"}`
                    }}
                  >
                    <StepIcon
                      size={16}
                      style={{ color: isComplete || isCurrent ? step.color : "var(--color-text-secondary)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {isFinalizing && (
            <div className="mt-6 flex items-center justify-center gap-2" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              <Loader2 size={14} className="animate-spin" />
              Applying improvements and creating Master CV...
            </div>
          )}

          {error && (
            <div
              className="mt-6 p-3 rounded-lg border text-left"
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
        </div>
      </div>
    </div>
  );
}
