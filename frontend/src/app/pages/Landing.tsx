import { Link } from "react-router";
import { CheckCircle, Sparkles, FileText, Target } from "lucide-react";

export function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md"
              style={{ background: "var(--color-teal-600)" }}
            />
            <span className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
              Resumé
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/signin"
              className="px-4 py-2 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                color: "var(--color-teal-600)",
              }}
            >
              Sign in
            </Link>
            <Link
              to="/app/create"
              className="px-4 py-2 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="font-medium mb-4"
            style={{ fontSize: "28px", lineHeight: "1.2", color: "var(--color-text-primary)" }}
          >
            Build one CV. Tailor it for every job.
          </h1>
          <p
            className="mb-8"
            style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}
          >
            Create your master CV once, then customize it for specific jobs using AI-assisted editing.
            Export polished, ATS-friendly versions in seconds.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/app/create"
              className="px-6 py-3 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              Create your CV
            </Link>
            <button
              className="px-6 py-3 rounded-lg font-medium transition-colors border"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                borderColor: "var(--color-teal-200)",
              }}
            >
              See how it works
            </button>
          </div>
        </div>

        {/* Product Preview */}
        <div className="mt-16 rounded-xl border overflow-hidden shadow-lg" style={{ borderColor: "var(--color-border-tertiary)" }}>
          <div className="aspect-video bg-gradient-to-br flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-slate-50) 100%)" }}>
            <div className="text-center">
              <FileText size={48} style={{ color: "var(--color-teal-600)", margin: "0 auto 12px" }} />
              <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Product preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <p
            className="uppercase tracking-wider mb-3"
            style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            How it works
          </p>
          <h2
            className="font-medium"
            style={{ fontSize: "22px", color: "var(--color-text-primary)" }}
          >
            Three steps to a tailored CV
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: FileText,
              title: "Build or upload your base CV",
              description: "Create a comprehensive master CV or upload your existing one. Include all your experience, skills, and achievements.",
            },
            {
              icon: Target,
              title: "Customize for a specific job",
              description: "Paste a job description and let AI identify relevant keywords and focus areas. Review and approve suggestions.",
            },
            {
              icon: Sparkles,
              title: "Export and apply",
              description: "Download your tailored CV in PDF or DOCX format. Track applications and manage multiple versions.",
            },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={index}
                className="p-6 rounded-xl border"
                style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: "var(--color-teal-50)" }}
                >
                  <Icon size={20} style={{ color: "var(--color-teal-600)" }} />
                </div>
                <h3
                  className="font-medium mb-2"
                  style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Why Tailored CVs Matter */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="rounded-xl p-12 text-center" style={{ background: "var(--color-teal-50)" }}>
          <h2
            className="font-medium mb-4"
            style={{ fontSize: "22px", color: "var(--color-teal-800)" }}
          >
            Why tailored CVs matter
          </h2>
          <p
            className="max-w-2xl mx-auto mb-8"
            style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-teal-800)" }}
          >
            Generic CVs get overlooked. Recruiters and ATS systems look for specific keywords and relevant experience.
            A tailored CV shows you're the right fit for the role.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              "Match job-specific keywords",
              "Highlight relevant experience",
              "Pass ATS screening",
              "Stand out to recruiters",
            ].map((benefit, index) => (
              <div key={index} className="flex items-center gap-2 justify-center">
                <CheckCircle size={16} style={{ color: "var(--color-teal-600)" }} />
                <span style={{ fontSize: "14px", color: "var(--color-teal-800)" }}>
                  {benefit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center">
          <h2
            className="font-medium mb-4"
            style={{ fontSize: "22px", color: "var(--color-text-primary)" }}
          >
            Ready to get started?
          </h2>
          <p
            className="mb-6"
            style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}
          >
            Create your first tailored CV in minutes.
          </p>
          <Link
            to="/app/create"
            className="inline-block px-6 py-3 rounded-lg font-medium transition-colors"
            style={{
              fontSize: "13px",
              background: "var(--color-teal-600)",
              color: "var(--color-teal-50)",
            }}
          >
            Create your CV
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t mt-16" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded"
                style={{ background: "var(--color-teal-600)" }}
              />
              <span className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Resumé
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              © 2026 Resumé. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}