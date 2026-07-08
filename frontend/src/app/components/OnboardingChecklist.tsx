import { Check, ChevronDown, ChevronUp, ListChecks, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { trackOnboardingStepView } from "../integration/analytics";
import type { OnboardingStepId } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { useOnboarding } from "../contexts/OnboardingContext";
import { ONBOARDING_STEPS, staticStepRoute } from "../onboarding/onboarding-steps";

const HIDDEN_ROUTE_PREFIXES = [
  "/app/create",
  "/app/upload-processing",
  "/app/cv-score",
  "/app/ai-improving",
  "/app/tailoring-flow"
];

const MINIMIZED_STORAGE_KEY = "onboarding:checklist-minimized";
const TOTAL_STEPS = ONBOARDING_STEPS.length;
const COMPLETION_AUTO_DISMISS_MS = 6000;

function readMinimized(): boolean {
  try {
    return window.localStorage.getItem(MINIMIZED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function OnboardingChecklist() {
  const { api } = useAuth();
  const {
    active,
    currentStep,
    completedCount,
    justCompleted,
    isStepComplete,
    skipOnboarding,
    clearJustCompleted
  } = useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();

  const [minimized, setMinimized] = useState(readMinimized);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const lastViewedStep = useRef<OnboardingStepId | null>(null);

  const hiddenRoute = HIDDEN_ROUTE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));
  const visible = (active || justCompleted) && !hiddenRoute;

  useEffect(() => {
    if (!visible || minimized || !currentStep || lastViewedStep.current === currentStep) {
      return;
    }
    lastViewedStep.current = currentStep;
    trackOnboardingStepView({
      step: currentStep,
      flow: "checklist_v1",
      surface: "checklist",
      source: location.pathname
    });
  }, [visible, minimized, currentStep, location.pathname]);

  useEffect(() => {
    if (!justCompleted) {
      return;
    }

    void import("canvas-confetti").then(({ default: confetti }) => {
      confetti({ particleCount: 140, spread: 75, origin: { x: 0.85, y: 0.85 } });
    });

    const timer = window.setTimeout(clearJustCompleted, COMPLETION_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [justCompleted, clearJustCompleted]);

  if (!visible) {
    return null;
  }

  const setMinimizedPersisted = (value: boolean) => {
    setMinimized(value);
    try {
      window.localStorage.setItem(MINIMIZED_STORAGE_KEY, String(value));
    } catch {
      // localStorage unavailable — minimized state just won't persist.
    }
  };

  const handleGoToStep = async (stepId: OnboardingStepId) => {
    const route = staticStepRoute(stepId);
    if (route) {
      navigate(route);
      return;
    }

    // Editor-bound steps: open the most recent tailored CV, or the main CV
    // editor when nothing has been tailored yet.
    try {
      const tailored = await api.listTailoredCvs();
      const latest = [...tailored].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      navigate(latest ? `/app/cv/${latest.id}` : "/app/cv/master");
    } catch {
      navigate("/app/cv/master");
    }
  };

  const isAtStepTarget = (stepId: OnboardingStepId): boolean => {
    if (stepId === "customize" || stepId === "job_details") {
      return location.pathname.startsWith("/app/tailor");
    }
    if (stepId === "template" || stepId === "layout" || stepId === "export") {
      return location.pathname.startsWith("/app/cv/");
    }
    return false;
  };

  if (justCompleted) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 w-80 rounded-xl p-5 shadow-xl"
        style={{
          background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
          color: "white",
          border: "1px solid rgba(255, 255, 255, 0.15)"
        }}
      >
        <button
          onClick={clearJustCompleted}
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 p-1.5 rounded-lg hover:bg-white/15 transition-colors"
        >
          <X size={14} />
        </button>
        <h3 className="font-medium mb-1" style={{ fontSize: "16px" }}>
          You're all set 🎉
        </h3>
        <p style={{ fontSize: "13px", lineHeight: "1.6", color: "rgba(255,255,255,0.85)" }}>
          You exported your first tailored CV. Next up: cover letters and job tracking are waiting in
          the sidebar.
        </p>
      </div>
    );
  }

  if (minimized) {
    return (
      <button
        onClick={() => setMinimizedPersisted(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-2.5 shadow-lg transition-all hover:shadow-xl"
        style={{
          background: "var(--color-teal-600)",
          color: "white",
          fontSize: "13px",
          fontWeight: 500
        }}
      >
        <ListChecks size={16} />
        <span>
          Setup {completedCount}/{TOTAL_STEPS}
        </span>
        <ChevronUp size={14} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-80 rounded-xl shadow-xl overflow-hidden"
      style={{
        background: "var(--color-background-primary)",
        border: "1px solid var(--color-border-tertiary)"
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "var(--color-teal-600)", color: "white" }}
      >
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 500 }}>Get your first tailored CV</h3>
          <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)" }}>
            {completedCount} of {TOTAL_STEPS} steps done
          </p>
        </div>
        <button
          onClick={() => setMinimizedPersisted(true)}
          aria-label="Minimize checklist"
          className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="h-1" style={{ background: "var(--color-teal-50)" }}>
        <div
          className="h-1 transition-all duration-500"
          style={{
            background: "var(--color-teal-400)",
            width: `${(completedCount / TOTAL_STEPS) * 100}%`
          }}
        />
      </div>

      <div className="px-2 py-2 max-h-96 overflow-y-auto">
        {ONBOARDING_STEPS.map((step) => {
          const done = isStepComplete(step.id);
          const isCurrent = step.id === currentStep;
          const Icon = step.icon;

          return (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-lg px-2 py-2"
              style={isCurrent ? { background: "var(--color-teal-50)" } : undefined}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={
                  done
                    ? { background: "var(--color-teal-600)", color: "white" }
                    : isCurrent
                      ? {
                          background: "var(--color-background-primary)",
                          color: "var(--color-teal-600)",
                          border: "1.5px solid var(--color-teal-400)"
                        }
                      : {
                          background: "var(--color-background-secondary)",
                          color: "var(--color-text-secondary)",
                          border: "1px solid var(--color-border-tertiary)"
                        }
                }
              >
                {done ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  style={{
                    fontSize: "13px",
                    fontWeight: isCurrent ? 500 : 400,
                    color: done ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                    textDecoration: done ? "line-through" : undefined
                  }}
                >
                  {step.label}
                </p>
                {isCurrent && (
                  <>
                    <p style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--color-text-secondary)" }}>
                      {step.description}
                    </p>
                    {!isAtStepTarget(step.id) && (
                      <button
                        onClick={() => void handleGoToStep(step.id)}
                        className="mt-1.5 rounded-lg px-3 py-1.5 transition-colors"
                        style={{
                          background: "var(--color-teal-600)",
                          color: "white",
                          fontSize: "12px",
                          fontWeight: 500
                        }}
                      >
                        Go to this step
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="px-4 py-2.5 flex items-center justify-end gap-3"
        style={{ borderTop: "1px solid var(--color-border-tertiary)" }}
      >
        {confirmSkip ? (
          <>
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              Skip for good?
            </span>
            <button
              onClick={() => setConfirmSkip(false)}
              style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={skipOnboarding}
              style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-red-600, #dc2626)" }}
            >
              Skip tour
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmSkip(true)}
            style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}
            className="hover:underline"
          >
            Skip tour
          </button>
        )}
      </div>
    </div>
  );
}
