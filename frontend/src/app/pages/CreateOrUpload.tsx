import { Link, useNavigate } from "react-router";
import { FileText, Upload, CheckCircle, Target, Download, Sparkles } from "lucide-react";
import { useSidebar } from "../contexts/SidebarContext";
import { useEffect, useRef } from "react";
import {
  fileAnalyticsParams,
  trackCvUploadStarted,
  trackOnboardingPathSelected,
  trackOnboardingStepView
} from "../integration/analytics";

const ONBOARDING_CHECKLIST = [
  { icon: Upload, label: "Upload your existing CV" },
  { icon: Target, label: "Customize it for a real job" },
  { icon: Download, label: "Export a job-specific PDF or DOCX" },
  { icon: Sparkles, label: "Use AI rewrites, cover letters, and job tracking" }
];

export function CreateOrUpload() {
  const navigate = useNavigate();
  const { setSidebarVisible } = useSidebar();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Hide sidebar when entering this page from main buttons
    setSidebarVisible(false);
    
    // Cleanup: show sidebar when leaving (unless going to CV editor)
    return () => {
      // We'll keep it hidden, the next page will decide
    };
  }, [setSidebarVisible]);

  useEffect(() => {
    trackOnboardingStepView({
      step: "create_or_upload",
      source: "post_signup"
    });
  }, []);

  const handleUploadClick = () => {
    trackOnboardingPathSelected({
      step: "create_or_upload",
      path_selected: "upload"
    });
    fileInputRef.current?.click();
  };

  const handleCreateClick = () => {
    trackOnboardingPathSelected({
      step: "create_or_upload",
      path_selected: "manual_create"
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      trackCvUploadStarted({
        source: "create_or_upload",
        ...fileAnalyticsParams(file)
      });
      // Navigate to upload processing page with file
      navigate("/app/upload-processing", { state: { file } });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-5xl w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left side - Explanation */}
          <div className="flex flex-col justify-center">
            <h1
              className="font-medium mb-4"
              style={{ fontSize: "28px", lineHeight: "1.2", color: "var(--color-text-primary)" }}
            >
              Start with your current CV
            </h1>
            <p className="mb-8" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              Upload your CV first, then customize it for a real job and export the finished version.
              This is the fastest path to seeing how jobspecificCV helps.
            </p>

            <div className="space-y-5">
              <h3
                className="uppercase tracking-wider"
                style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
              >
                First application checklist
              </h3>

              {ONBOARDING_CHECKLIST.map((item) => {
                const Icon = item.icon;
                return (
                <div key={item.label} className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-teal-50)", color: "var(--color-teal-600)" }}
                  >
                    <Icon size={15} />
                  </div>
                  <div>
                    <h4 className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                      {item.label}
                    </h4>
                    <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      {item.label.includes("Upload")
                        ? "We parse your experience so you do not start from scratch."
                        : item.label.includes("Customize")
                          ? "Paste the role and job description so the CV matches the application."
                          : item.label.includes("Export")
                            ? "Review the tailored CV and download the finished file."
                            : "Continue with the application workflow after the first export."}
                    </p>
                  </div>
                </div>
              );
              })}
            </div>
          </div>

          {/* Right side - Action Cards */}
          <div className="flex flex-col gap-4">
            <button
              onClick={handleUploadClick}
              className="p-6 rounded-xl border-2 group transition-all hover:shadow-lg text-left"
              style={{
                background: "var(--color-teal-50)",
                borderColor: "var(--color-teal-400)",
              }}
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                style={{ background: "var(--color-background-primary)" }}
              >
                <Upload size={24} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Upload existing CV
              </h3>
              <p className="mb-4" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Recommended for first-time users. Upload a PDF or DOCX, review the parsed content, then customize it for a job.
              </p>
              <div className="flex items-center gap-2">
                <CheckCircle size={14} style={{ color: "var(--color-teal-600)" }} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Fastest path to a tailored export
                </span>
              </div>
            </button>

            <Link
              to="/app/cv/master"
              onClick={handleCreateClick}
              className="p-6 rounded-xl border group transition-all hover:shadow-lg text-left"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                style={{ background: "var(--color-slate-50)" }}
              >
                <FileText size={24} style={{ color: "var(--color-text-secondary)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Create CV manually
              </h3>
              <p className="mb-4" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Start from a blank main CV if you do not have a file ready. You can still customize it for a job later.
              </p>
              <div className="flex items-center gap-2">
                <CheckCircle size={14} style={{ color: "var(--color-text-secondary)" }} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Structured editor with live preview
                </span>
              </div>
            </Link>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
