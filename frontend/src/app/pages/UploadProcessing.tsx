import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { FileText, CheckCircle, Loader2 } from "lucide-react";

export function UploadProcessing() {
  const navigate = useNavigate();
  const location = useLocation();
  const file = location.state?.file;
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    { label: "Uploading file", duration: 1000 },
    { label: "Parsing content", duration: 1500 },
    { label: "Extracting information", duration: 1200 },
    { label: "Analyzing structure", duration: 800 },
  ];

  useEffect(() => {
    if (!file) {
      navigate("/app/create");
      return;
    }

    let totalElapsed = 0;
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);

    const interval = setInterval(() => {
      totalElapsed += 50;
      const newProgress = Math.min((totalElapsed / totalDuration) * 100, 100);
      setProgress(newProgress);

      // Update current step based on progress
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
        // Navigate to CV score page
        setTimeout(() => {
          navigate("/app/cv-score", {
            state: {
              fileName: file.name,
              parsedData: getMockParsedData(),
            },
          });
        }, 300);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [file, navigate]);

  // Mock parsed data
  const getMockParsedData = () => ({
    name: "John Anderson",
    title: "Senior Software Engineer",
    email: "john.anderson@email.com",
    phone: "+1 (555) 987-6543",
    location: "Seattle, WA",
    summary: "Experienced software engineer with 8 years of expertise in full-stack development, specializing in React, Node.js, and cloud technologies.",
    experience: [
      {
        role: "Senior Software Engineer",
        company: "Tech Corp",
        dates: "2020 - Present",
        description: "Led development of microservices architecture\nImplemented CI/CD pipelines reducing deployment time by 60%\nMentored junior developers and conducted code reviews",
      },
      {
        role: "Software Engineer",
        company: "StartupXYZ",
        dates: "2017 - 2020",
        description: "Built scalable web applications using React and Node.js\nCollaborated with product team to define technical requirements\nImproved application performance by 40%",
      },
    ],
    education: [
      {
        degree: "Bachelor of Science in Computer Science",
        institution: "University of Washington",
        dates: "2013 - 2017",
        description: "GPA: 3.8/4.0, Dean's List",
      },
    ],
    skills: ["JavaScript", "React", "Node.js", "TypeScript", "AWS", "Docker", "MongoDB", "PostgreSQL"],
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-md w-full">
        <div
          className="p-8 rounded-2xl border text-center"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)",
          }}
        >
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
              <FileText size={32} style={{ color: "var(--color-teal-600)" }} />
            </div>
          </div>

          {/* Title */}
          <h2 className="font-medium mb-2" style={{ fontSize: "20px", color: "var(--color-text-primary)" }}>
            Processing your CV
          </h2>
          <p className="mb-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            {file?.name}
          </p>

          {/* Progress Bar */}
          <div className="mb-6">
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "var(--color-border-secondary)" }}
            >
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${progress}%`,
                  background: "var(--color-teal-600)",
                }}
              />
            </div>
            <p className="mt-2" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {Math.round(progress)}% complete
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex items-center gap-3 px-4 py-2 rounded-lg transition-all"
                style={{
                  background: index === currentStep ? "var(--color-teal-50)" : "transparent",
                }}
              >
                {index < currentStep ? (
                  <CheckCircle size={16} style={{ color: "var(--color-teal-600)" }} />
                ) : index === currentStep ? (
                  <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-teal-600)" }} />
                ) : (
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ background: "var(--color-border-secondary)" }}
                  />
                )}
                <span
                  style={{
                    fontSize: "13px",
                    color: index <= currentStep ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: index === currentStep ? 500 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
