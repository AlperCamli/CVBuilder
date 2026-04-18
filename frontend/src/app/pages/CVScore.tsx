import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { TrendingUp, AlertCircle, Sparkles, ArrowRight } from "lucide-react";

export function CVScore() {
  const navigate = useNavigate();
  const location = useLocation();
  const { fileName, parsedData } = location.state || {};
  const [improvingWithAI, setImprovingWithAI] = useState(false);

  // Mock CV score (75/100)
  const score = 75;
  const scoreColor = score >= 80 ? "var(--color-teal-600)" : score >= 60 ? "var(--color-yellow-600)" : "var(--color-red-600)";
  const scoreBackground = score >= 80 ? "var(--color-teal-50)" : score >= 60 ? "var(--color-yellow-50)" : "var(--color-red-50)";

  const improvements = [
    "Add more quantifiable achievements with metrics",
    "Strengthen action verbs in experience descriptions",
    "Include relevant keywords for ATS optimization",
    "Expand skills section with specific technologies",
  ];

  const handleImproveWithAI = () => {
    setImprovingWithAI(true);
    // Navigate to AI improving page
    navigate("/app/ai-improving", {
      state: {
        parsedData,
        improvements,
      },
    });
  };

  const handleContinueWithoutAI = () => {
    // Navigate directly to CV editor with parsed data
    navigate("/app/cv/uploaded", {
      state: {
        parsedData,
        isUploaded: true,
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-2xl w-full">
        <div
          className="p-8 rounded-2xl border"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)",
          }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="font-medium mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
              Your CV Score
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
              Based on {fileName}
            </p>
          </div>

          {/* Score Circle */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              {/* Circular progress */}
              <svg className="transform -rotate-90" width="200" height="200">
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  fill="none"
                  stroke="var(--color-border-secondary)"
                  strokeWidth="12"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="12"
                  strokeDasharray={`${(score / 100) * 565.48} 565.48`}
                  strokeLinecap="round"
                />
              </svg>
              {/* Score text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-medium" style={{ fontSize: "48px", color: scoreColor }}>
                  {score}
                </div>
                <div style={{ fontSize: "16px", color: "var(--color-text-secondary)" }}>
                  out of 100
                </div>
              </div>
            </div>
          </div>

          {/* Score interpretation */}
          <div
            className="p-4 rounded-xl mb-6 flex items-start gap-3"
            style={{ background: scoreBackground }}
          >
            <TrendingUp size={20} style={{ color: scoreColor, flexShrink: 0, marginTop: "2px" }} />
            <div>
              <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                {score >= 80 ? "Great CV!" : score >= 60 ? "Good foundation" : "Needs improvement"}
              </h3>
              <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                {score >= 80
                  ? "Your CV is well-structured. Minor improvements could make it even stronger."
                  : score >= 60
                  ? "Your CV has a solid base, but there's room for significant improvement to stand out."
                  : "Your CV needs substantial work to be competitive in the job market."}
              </p>
            </div>
          </div>

          {/* Suggested improvements */}
          <div className="mb-8">
            <h3
              className="font-medium mb-3 flex items-center gap-2"
              style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
            >
              <AlertCircle size={16} style={{ color: "var(--color-text-secondary)" }} />
              Suggested Improvements
            </h3>
            <div className="space-y-2">
              {improvements.map((improvement, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg"
                  style={{ background: "var(--color-background-secondary)" }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-teal-100)", color: "var(--color-teal-700)", fontSize: "11px", fontWeight: 500, marginTop: "1px" }}
                  >
                    {index + 1}
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: "1.5" }}>
                    {improvement}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={handleImproveWithAI}
              disabled={improvingWithAI}
              className="w-full px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all hover:shadow-md"
              style={{
                background: "var(--color-teal-600)",
                color: "white",
                fontSize: "14px",
                opacity: improvingWithAI ? 0.7 : 1,
              }}
            >
              <Sparkles size={16} />
              Improve with AI
              <ArrowRight size={16} />
            </button>

            <button
              onClick={handleContinueWithoutAI}
              className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-gray-50"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-tertiary)",
                color: "var(--color-text-secondary)",
                fontSize: "14px",
              }}
            >
              Continue without AI improvements
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
