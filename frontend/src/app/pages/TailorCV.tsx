import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Target } from "lucide-react";

export function TailorCV() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [formData, setFormData] = useState({
    role: "",
    company: "",
    jobDescription: "",
  });

  const handleSubmit = () => {
    navigate(`/app/tailoring-flow/${id}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-5xl w-full">
        <div className="mb-6">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-2 mb-4"
            style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}
          >
            <ChevronLeft size={16} />
            Back to dashboard
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left side - Explanation */}
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: "var(--color-teal-50)" }}
              >
                <Target size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <h1
                className="font-medium"
                style={{ fontSize: "28px", lineHeight: "1.2", color: "var(--color-text-primary)" }}
              >
                Apply to your first job
              </h1>
            </div>

            <p className="mb-8" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              Tell us about the job you're applying to, and we'll help you tailor your CV to match the role.
            </p>

            <div className="space-y-4">
              <h3
                className="uppercase tracking-wider"
                style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
              >
                What we'll do
              </h3>

              {[
                "Analyze the job description for key requirements",
                "Identify relevant keywords and topics",
                "Surface questions to highlight your matching experience",
                "Help you adjust your CV content strategically",
              ].map((item, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                    style={{ background: "var(--color-teal-600)" }}
                  />
                  <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                    {item}
                  </p>
                </div>
              ))}
            </div>

            <div
              className="mt-8 p-4 rounded-lg"
              style={{ background: "var(--color-teal-50)" }}
            >
              <p style={{ fontSize: "12px", lineHeight: "1.6", color: "var(--color-teal-800)" }}>
                <strong>Note:</strong> AI will only suggest changes. You'll review and approve everything
                before it's applied to your CV.
              </p>
            </div>
          </div>

          {/* Right side - Form */}
          <div>
            <div
              className="p-6 rounded-xl border"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <h2 className="font-medium mb-6" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Job details
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Role
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Senior Product Designer"
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                    }}
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Company name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TechStart Inc"
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                    }}
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    Job description
                  </label>
                  <textarea
                    rows={12}
                    placeholder="Paste the full job description here..."
                    className="w-full px-3 py-2 rounded-lg border resize-none"
                    style={{
                      fontSize: "13px",
                      lineHeight: "1.6",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                    }}
                    value={formData.jobDescription}
                    onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
                  />
                  <p className="mt-2" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                    Tip: Include as much detail as possible for better tailoring
                  </p>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!formData.role || !formData.company || !formData.jobDescription}
                className="w-full mt-6 px-6 py-3 rounded-lg font-medium disabled:opacity-50"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)",
                }}
              >
                Analyze job & continue
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
