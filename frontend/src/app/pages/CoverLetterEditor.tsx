import { useState, useEffect } from "react";
import { useNavigate, useLocation, useParams } from "react-router";
import { ChevronLeft, Save, Download, Sparkles } from "lucide-react";
import { useSidebar } from "../contexts/SidebarContext";

export function CoverLetterEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobId } = useParams();
  const { setSidebarVisible } = useSidebar();
  const jobData = location.state?.jobData;

  // Keep sidebar hidden in cover letter editor
  useEffect(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  // Generate initial cover letter content based on job data
  const generateInitialContent = () => {
    if (!jobData) return "";

    return `Dear Hiring Manager,

I am writing to express my strong interest in the ${jobData.title} position at ${jobData.company}. With my background and experience, I am confident I would be a valuable addition to your team.

Throughout my career, I have developed expertise that directly aligns with the requirements for this role. My experience has equipped me with the skills necessary to contribute effectively to ${jobData.company}'s goals and objectives.

I am particularly drawn to this opportunity because it represents an ideal match between my capabilities and the position requirements. I am excited about the prospect of bringing my unique blend of skills and experience to your organization.

Thank you for considering my application. I look forward to the opportunity to discuss how I can contribute to ${jobData.company}'s continued success.

Sincerely,
[Your Name]`;
  };

  const [content, setContent] = useState(generateInitialContent());
  const [isAIGenerating, setIsAIGenerating] = useState(false);

  const handleAIEnhance = () => {
    setIsAIGenerating(true);
    // Simulate AI enhancement
    setTimeout(() => {
      setIsAIGenerating(false);
      // In a real app, this would call an AI service
    }, 2000);
  };

  const handleExport = () => {
    // Export the cover letter
    console.log("Exporting cover letter...");
    // Navigate back to cover letters page after export
    navigate("/app/cover-letters");
  };

  if (!jobData) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            No job data found. Please select a job from the tracker.
          </p>
          <button
            onClick={() => navigate("/app/job-tracker")}
            className="mt-4 px-4 py-2 rounded-lg font-medium"
            style={{
              fontSize: "13px",
              background: "var(--color-teal-600)",
              color: "white",
            }}
          >
            Go to Job Tracker
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top Bar */}
      <div className="border-b px-6 py-3" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/app/job-tracker")} style={{ color: "var(--color-text-secondary)" }}>
              <ChevronLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  Cover Letter - {jobData.company}
                </h2>
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    background: "var(--color-teal-50)",
                    color: "var(--color-teal-800)",
                  }}
                >
                  {jobData.title}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                Auto-generated based on your CV
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAIEnhance}
              disabled={isAIGenerating}
              className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2 border disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                borderColor: "var(--color-teal-200)",
              }}
            >
              <Sparkles size={14} />
              {isAIGenerating ? "Enhancing..." : "AI Enhance"}
            </button>
            <button
              className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
              style={{
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}
            >
              <Save size={14} />
              Saved
            </button>
            <button
              onClick={handleExport}
              className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "white",
              }}
            >
              <Download size={14} />
              Export & Continue
            </button>
          </div>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left - Editing Panel */}
        <div
          className="flex-1 overflow-auto p-6"
          style={{
            background: "var(--color-background-secondary)",
          }}
        >
          <div className="max-w-3xl mx-auto">
            <div
              className="bg-white p-8 rounded-xl border shadow-sm"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              {/* Info Banner */}
              <div
                className="mb-6 p-4 rounded-lg border"
                style={{
                  background: "var(--color-teal-50)",
                  borderColor: "var(--color-teal-200)",
                }}
              >
                <p style={{ fontSize: "13px", color: "var(--color-teal-800)", lineHeight: "1.5" }}>
                  <strong>Auto-generated for you!</strong> We've created this cover letter based on your CV and the job details. Feel free to edit and personalize it.
                </p>
              </div>

              {/* Editable Content */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full min-h-[500px] p-0 border-0 focus:outline-none resize-none"
                style={{
                  fontSize: "14px",
                  lineHeight: "1.8",
                  color: "var(--color-text-primary)",
                  fontFamily: "inherit",
                }}
                placeholder="Start writing your cover letter..."
              />
            </div>
          </div>
        </div>

        {/* Right - Preview Panel */}
        <div
          className="hidden lg:flex border-l overflow-auto justify-center items-start"
          style={{
            borderColor: "var(--color-border-tertiary)",
            background: "#F8F9FA",
            flexShrink: 0,
            width: "auto",
            minWidth: "600px",
            padding: "32px",
          }}
        >
          <div>
            <p
              className="uppercase tracking-wider mb-4"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Preview
            </p>
            {/* A4 Page Container */}
            <div
              className="bg-white shadow-lg"
              style={{
                width: "595px",
                minHeight: "842px",
                padding: "48px 40px",
                fontFamily: "Georgia, serif",
              }}
            >
              <div className="max-w-lg mx-auto">
                <div
                  style={{
                    fontSize: "14px",
                    lineHeight: "1.8",
                    color: "var(--color-text-primary)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {content}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
