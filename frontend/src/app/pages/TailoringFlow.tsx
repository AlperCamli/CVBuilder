import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, ChevronRight, CheckCircle } from "lucide-react";

export function TailoringFlow() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);

  const topics = [
    "Data analysis",
    "Stakeholder communication",
    "SQL & databases",
    "Product strategy",
    "Cross-functional leadership",
  ];

  const keywords = [
    "data-driven",
    "SQL",
    "stakeholder management",
    "analytics",
    "dashboard",
    "reporting",
    "product metrics",
    "A/B testing",
  ];

  const handleNext = () => {
    if (currentStep === 0) {
      setCurrentStep(1);
    } else {
      // Navigate to tailored CV editor with job data
      navigate(`/app/cv/tailored-${id}`, {
        state: {
          isTailored: true,
          jobData: {
            role: "Senior Product Designer",
            company: "TechStart",
            selectedTopics,
            selectedKeywords
          }
        }
      });
    }
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  const toggleKeyword = (keyword: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(keyword) ? prev.filter((k) => k !== keyword) : [...prev, keyword]
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <div className="border-b px-6 py-4" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2"
            style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}
          >
            <ChevronLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            {[0, 1].map((step) => (
              <div
                key={step}
                className="w-2 h-2 rounded-full"
                style={{
                  background: step <= currentStep ? "var(--color-teal-600)" : "var(--color-border-secondary)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <div className="max-w-2xl w-full">
          {currentStep === 0 && (
            <div
              className="p-8 rounded-xl border"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <div className="mb-6">
                <div className="inline-block px-3 py-1 rounded-full mb-4" style={{ background: "var(--color-teal-50)", color: "var(--color-teal-800)", fontSize: "11px", fontWeight: 500 }}>
                  Senior Product Designer at TechStart
                </div>
                <h2 className="font-medium mb-3" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
                  This role emphasizes these topics
                </h2>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                  Based on the job description, we identified key areas recruiters may care about.
                  Select which ones should be reflected more strongly in your CV.
                </p>
              </div>

              <div className="space-y-3 mb-6">
                {topics.map((topic) => {
                  const isSelected = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      className="w-full p-4 rounded-lg border-2 flex items-center justify-between transition-all"
                      style={{
                        borderColor: isSelected ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                        background: isSelected ? "var(--color-teal-50)" : "var(--color-background-primary)",
                      }}
                    >
                      <span
                        className="font-medium"
                        style={{
                          fontSize: "14px",
                          color: isSelected ? "var(--color-teal-800)" : "var(--color-text-primary)",
                        }}
                      >
                        {topic}
                      </span>
                      {isSelected && (
                        <CheckCircle size={20} style={{ color: "var(--color-teal-600)" }} />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => navigate(-1)}
                  className="px-6 py-2.5 rounded-lg font-medium border"
                  style={{
                    fontSize: "13px",
                    borderColor: "var(--color-border-secondary)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 px-6 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "var(--color-teal-50)",
                  }}
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div
              className="p-8 rounded-xl border"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <div className="mb-6">
                <h2 className="font-medium mb-3" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
                  Key keywords to include
                </h2>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                  These keywords appear frequently in the job description. Select which ones
                  you want reflected in your tailored CV.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 mb-8">
                {keywords.map((keyword) => {
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
                        color: isSelected ? "var(--color-teal-800)" : "var(--color-text-secondary)",
                      }}
                    >
                      {keyword}
                    </button>
                  );
                })}
              </div>

              <div
                className="p-4 rounded-lg mb-6"
                style={{ background: "var(--color-info-bg)" }}
              >
                <p style={{ fontSize: "12px", lineHeight: "1.6", color: "#0C447C" }}>
                  <strong>Tip:</strong> These keywords will help your CV pass ATS screening and
                  catch the recruiter's attention. We'll suggest where to naturally include them.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(0)}
                  className="px-6 py-2.5 rounded-lg font-medium flex items-center gap-2"
                  style={{
                    fontSize: "13px",
                    borderColor: "var(--color-border-secondary)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 px-6 py-2.5 rounded-lg font-medium"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "var(--color-teal-50)",
                  }}
                >
                  Generate tailored CV
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
