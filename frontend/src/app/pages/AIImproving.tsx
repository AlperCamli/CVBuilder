import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Sparkles, Zap, Target, TrendingUp } from "lucide-react";

export function AIImproving() {
  const navigate = useNavigate();
  const location = useLocation();
  const { parsedData, improvements } = location.state || {};
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const steps = [
    { icon: Sparkles, label: "Analyzing your experience", color: "var(--color-teal-600)", duration: 1800 },
    { icon: Target, label: "Identifying key achievements", color: "var(--color-blue-600)", duration: 1500 },
    { icon: Zap, label: "Enhancing impact statements", color: "var(--color-purple-600)", duration: 1600 },
    { icon: TrendingUp, label: "Optimizing for ATS", color: "var(--color-green-600)", duration: 1400 },
  ];

  useEffect(() => {
    if (!parsedData) {
      navigate("/app/create");
      return;
    }

    let totalElapsed = 0;
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);

    const interval = setInterval(() => {
      totalElapsed += 50;
      const newProgress = Math.min((totalElapsed / totalDuration) * 100, 100);
      setProgress(newProgress);

      // Update current step
      let accumulatedDuration = 0;
      for (let i = 0; i < steps.length; i++) {
        accumulatedDuration += steps[i].duration;
        if (totalElapsed < accumulatedDuration) {
          setCurrentStep(i);
          break;
        }
      }

      if (totalElapsed >= totalDuration) {
        clearInterval(interval);
        // Navigate to CV editor with improved data
        setTimeout(() => {
          navigate("/app/cv/uploaded", {
            state: {
              parsedData: getImprovedData(parsedData),
              isUploaded: true,
              aiImproved: true,
            },
          });
        }, 500);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [parsedData, navigate]);

  // Mock AI improvement (in reality, this would be actual AI processing)
  const getImprovedData = (data: any) => ({
    ...data,
    summary: "Results-driven Senior Software Engineer with 8+ years of expertise in full-stack development. Proven track record of architecting scalable solutions, leading cross-functional teams, and delivering high-impact projects. Specializes in React, Node.js, and cloud technologies with focus on performance optimization and best practices.",
    experience: data.experience.map((exp: any, index: number) => {
      if (index === 0) {
        return {
          ...exp,
          description: "• Led development of microservices architecture serving 2M+ users, improving system reliability by 45%\n• Implemented comprehensive CI/CD pipelines, reducing deployment time by 60% and eliminating manual errors\n• Mentored team of 5 junior developers through code reviews and technical workshops, improving team velocity by 30%\n• Drove adoption of best practices including unit testing, resulting in 80% code coverage",
        };
      }
      return {
        ...exp,
        description: "• Built and maintained 15+ scalable web applications using React and Node.js, serving 500K+ monthly users\n• Collaborated with product and design teams to define technical requirements for 3 major product launches\n• Improved application performance by 40% through code optimization and caching strategies\n• Implemented responsive design patterns, increasing mobile user engagement by 25%",
      };
    }),
  });

  const currentStepData = steps[currentStep];
  const Icon = currentStepData.icon;

  return (
    <div className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden" style={{ background: "var(--color-background-secondary)" }}>
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-pulse"
            style={{
              background: steps[i % steps.length].color,
              width: Math.random() * 100 + 50 + "px",
              height: Math.random() * 100 + 50 + "px",
              left: Math.random() * 100 + "%",
              top: Math.random() * 100 + "%",
              animationDelay: Math.random() * 2 + "s",
              animationDuration: Math.random() * 3 + 2 + "s",
              filter: "blur(40px)",
            }}
          />
        ))}
      </div>

      <div className="max-w-lg w-full relative z-10">
        <div
          className="p-10 rounded-2xl border text-center shadow-lg"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)",
          }}
        >
          {/* Animated Icon */}
          <div className="flex justify-center mb-6">
            <div
              className="relative w-24 h-24 rounded-2xl flex items-center justify-center animate-pulse"
              style={{
                background: `${currentStepData.color}10`,
              }}
            >
              <Icon size={48} style={{ color: currentStepData.color }} />
              
              {/* Orbiting sparkles */}
              <div className="absolute inset-0">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="absolute"
                    style={{
                      animation: `orbit 2s linear infinite`,
                      animationDelay: `${i * 0.66}s`,
                      left: "50%",
                      top: "50%",
                    }}
                  >
                    <Sparkles
                      size={12}
                      style={{
                        color: currentStepData.color,
                        transform: "translate(-50%, -50%)",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Title */}
          <h2 className="font-medium mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
            AI is improving your CV
          </h2>
          <p className="mb-8 font-medium" style={{ fontSize: "15px", color: currentStepData.color }}>
            {currentStepData.label}
          </p>

          {/* Progress bar */}
          <div className="mb-8">
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "var(--color-border-secondary)" }}
            >
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${steps[0].color}, ${steps[steps.length - 1].color})`,
                }}
              />
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex justify-between items-center">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              const isComplete = index < currentStep;
              const isCurrent = index === currentStep;
              
              return (
                <div key={index} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      isCurrent ? "scale-110" : "scale-100"
                    }`}
                    style={{
                      background: isComplete || isCurrent ? `${step.color}15` : "var(--color-border-secondary)",
                      border: `2px solid ${isComplete || isCurrent ? step.color : "transparent"}`,
                    }}
                  >
                    <StepIcon
                      size={16}
                      style={{
                        color: isComplete || isCurrent ? step.color : "var(--color-text-secondary)",
                      }}
                    />
                  </div>
                  <div
                    className="w-1 h-1 rounded-full"
                    style={{
                      background: isComplete ? step.color : "var(--color-border-secondary)",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Fun fact */}
        <div className="text-center mt-6">
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            💡 <span className="font-medium">Did you know?</span> Resumes with quantified achievements get 40% more interviews
          </p>
        </div>
      </div>

      <style>{`
        @keyframes orbit {
          from {
            transform: rotate(0deg) translateX(50px) rotate(0deg);
          }
          to {
            transform: rotate(360deg) translateX(50px) rotate(-360deg);
          }
        }
      `}</style>
    </div>
  );
}
