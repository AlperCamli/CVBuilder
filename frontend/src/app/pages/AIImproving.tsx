import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sparkles, Zap, Target, TrendingUp, Loader2, RefreshCw } from "lucide-react";
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
      { icon: TrendingUp, label: "Optimizing for ATS", sublabel: "Adding keywords and formatting", duration: 1200 }
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

  const progressRadius = 54;
  const progressCircumference = 2 * Math.PI * progressRadius;
  const progressOffset = progressCircumference - (progress / 100) * progressCircumference;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #0c4a4e 40%, #134e4a 70%, #1e293b 100%)"
      }}
    >
      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="ai-particle absolute rounded-full"
            style={{
              width: `${Math.random() * 4 + 2}px`,
              height: `${Math.random() * 4 + 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: `hsla(${170 + Math.random() * 30}, 80%, 70%, ${0.3 + Math.random() * 0.4})`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${4 + Math.random() * 6}s`
            }}
          />
        ))}
      </div>

      {/* Ambient glow */}
      <div
        className="absolute rounded-full"
        style={{
          width: "600px",
          height: "600px",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, rgba(20, 184, 166, 0.12) 0%, transparent 70%)",
          animation: "ambientGlow 4s ease-in-out infinite"
        }}
      />

      <div className="max-w-lg w-full relative z-10">
        <div
          className="p-10 rounded-3xl text-center"
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(20, 184, 166, 0.15)",
            boxShadow: "0 25px 60px -12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)"
          }}
        >
          {/* Animated progress ring */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <svg width="128" height="128" className="transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r={progressRadius}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeWidth="4"
                />
                <circle
                  cx="64"
                  cy="64"
                  r={progressRadius}
                  fill="none"
                  stroke="url(#progressGradient)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={progressCircumference}
                  strokeDashoffset={progressOffset}
                  className="transition-all duration-300"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="50%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#0d9488" />
                  </linearGradient>
                </defs>
              </svg>
              <div
                className="absolute inset-0 flex items-center justify-center ai-icon-float"
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(20, 184, 166, 0.2) 0%, rgba(45, 212, 191, 0.1) 100%)",
                    border: "1px solid rgba(20, 184, 166, 0.3)"
                  }}
                >
                  <Sparkles size={28} style={{ color: "#2dd4bf" }} />
                </div>
              </div>
            </div>
          </div>

          <h2
            className="font-semibold mb-2"
            style={{ fontSize: "22px", color: "#f1f5f9", letterSpacing: "-0.01em" }}
          >
            AI is improving your CV
          </h2>
          <p
            className="mb-1 font-medium ai-step-text"
            key={currentStep}
            style={{ fontSize: "15px", color: "#2dd4bf" }}
          >
            {currentStepData.label}
          </p>
          <p
            className="mb-8"
            style={{ fontSize: "13px", color: "#64748b" }}
          >
            {currentStepData.sublabel}
          </p>

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-3 mb-6">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              const isComplete = index < currentStep;
              const isCurrent = index === currentStep;

              return (
                <div
                  key={step.label}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-500 ${
                      isCurrent ? "scale-110" : "scale-100"
                    }`}
                    style={{
                      background: isComplete
                        ? "rgba(20, 184, 166, 0.15)"
                        : isCurrent
                          ? "rgba(20, 184, 166, 0.2)"
                          : "rgba(255, 255, 255, 0.03)",
                      border: `1.5px solid ${
                        isComplete
                          ? "rgba(20, 184, 166, 0.4)"
                          : isCurrent
                            ? "rgba(45, 212, 191, 0.5)"
                            : "rgba(255, 255, 255, 0.06)"
                      }`,
                      boxShadow: isCurrent ? "0 0 20px rgba(20, 184, 166, 0.2)" : "none"
                    }}
                  >
                    <StepIcon
                      size={16}
                      style={{
                        color: isComplete || isCurrent ? "#2dd4bf" : "#475569",
                        transition: "color 0.5s"
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progress percentage */}
          <p style={{ fontSize: "12px", color: "#475569" }}>
            {Math.round(progress)}% complete
          </p>

          {isFinalizing && (
            <div
              className="mt-6 flex items-center justify-center gap-2 p-3 rounded-xl"
              style={{
                fontSize: "13px",
                color: "#2dd4bf",
                background: "rgba(20, 184, 166, 0.08)",
                border: "1px solid rgba(20, 184, 166, 0.15)"
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              Applying improvements and creating Master CV...
            </div>
          )}

          {error && (
            <div className="mt-6 space-y-3">
              <div
                className="p-4 rounded-xl text-left"
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "#fca5a5",
                  fontSize: "13px"
                }}
              >
                {error}
              </div>
              <button
                type="button"
                onClick={() => navigate("/app/create")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all"
                style={{
                  fontSize: "13px",
                  background: "rgba(255, 255, 255, 0.06)",
                  color: "#94a3b8",
                  border: "1px solid rgba(255, 255, 255, 0.1)"
                }}
              >
                <RefreshCw size={14} />
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes particleFloat {
          0%, 100% {
            transform: translateY(0) translateX(0);
            opacity: 0.3;
          }
          25% {
            transform: translateY(-30px) translateX(10px);
            opacity: 0.8;
          }
          50% {
            transform: translateY(-15px) translateX(-10px);
            opacity: 0.5;
          }
          75% {
            transform: translateY(-40px) translateX(5px);
            opacity: 0.7;
          }
        }
        .ai-particle {
          animation: particleFloat 6s ease-in-out infinite;
        }
        @keyframes ambientGlow {
          0%, 100% {
            opacity: 0.6;
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.1);
          }
        }
        @keyframes iconFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        .ai-icon-float {
          animation: iconFloat 3s ease-in-out infinite;
        }
        @keyframes stepFadeIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .ai-step-text {
          animation: stepFadeIn 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
