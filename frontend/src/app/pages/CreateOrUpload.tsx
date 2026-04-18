import { Link, useNavigate } from "react-router";
import { FileText, Upload, CheckCircle } from "lucide-react";
import { useSidebar } from "../contexts/SidebarContext";
import { useEffect, useRef } from "react";

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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
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
              Let's build your CV
            </h1>
            <p className="mb-8" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              Start by creating a comprehensive master CV or uploading an existing one.
              You'll be able to customize it for specific jobs later.
            </p>

            <div className="space-y-6">
              <h3
                className="uppercase tracking-wider"
                style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
              >
                What happens next
              </h3>

              {[
                { step: "1", title: "Build or upload your base CV", desc: "Add your complete experience and skills" },
                { step: "2", title: "Customize for a specific job", desc: "Tailor content based on job requirements" },
                { step: "3", title: "Export and apply", desc: "Download polished, ATS-friendly versions" },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-teal-50)", color: "var(--color-teal-600)" }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 500 }}>{item.step}</span>
                  </div>
                  <div>
                    <h4 className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                      {item.title}
                    </h4>
                    <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right side - Action Cards */}
          <div className="flex flex-col gap-4">
            <Link
              to="/app/cv/master"
              className="p-6 rounded-xl border group transition-all hover:shadow-lg"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                style={{ background: "var(--color-teal-50)" }}
              >
                <FileText size={24} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Create a CV
              </h3>
              <p className="mb-4" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Start building your master CV with our comprehensive editor. Add your experience, skills, and education with AI assistance.
              </p>
              <div className="flex items-center gap-2">
                <CheckCircle size={14} style={{ color: "var(--color-teal-600)" }} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  AI-assisted writing
                </span>
              </div>
            </Link>

            <button
              onClick={handleUploadClick}
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
                <Upload size={24} style={{ color: "var(--color-text-secondary)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Upload existing CV
              </h3>
              <p className="mb-4" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Already have a CV? Upload it and we'll parse the content, score it, and help you improve it with AI.
              </p>
              <div className="flex items-center gap-2">
                <CheckCircle size={14} style={{ color: "var(--color-text-secondary)" }} />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Supports PDF, DOCX
                </span>
              </div>
            </button>
            
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