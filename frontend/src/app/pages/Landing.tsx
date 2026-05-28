import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle,
  FileText,
  Target,
  Upload,
  ListChecks,
  Download,
  Filter,
  Clock,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { CAREER_ARTICLES, getCareerArticlePath } from "../../content/career-advice";
import { PublicHeader } from "../components/PublicHeader";

type Step = {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
  videoSrc: string;
};

const STEPS: Step[] = [
  {
    number: "01",
    icon: Upload,
    title: "Upload your CV",
    description:
      "Drop in your existing CV as a PDF or DOCX. The app reads your experience, skills, and education automatically so you start with everything in one place.",
    videoSrc: "/videos/step-1-upload.mp4",
  },
  {
    number: "02",
    icon: Target,
    title: "Customize for a job",
    description:
      "Enter the role, the company, and paste the job description. The app builds a focused brief so every later step is grounded in what this employer actually wants.",
    videoSrc: "/videos/step-2-tailor.mp4",
  },
  {
    number: "03",
    icon: ListChecks,
    title: "Select keywords & answer questions",
    description:
      "Review the keywords pulled from the job description, pick the ones that fit your background, and answer short prompts so every rewrite stays accurate to you.",
    videoSrc: "/videos/step-3-keywords.mp4",
  },
  {
    number: "04",
    icon: Download,
    title: "Export your CV",
    description:
      "Preview the customized CV, tweak anything that needs a final touch, then export a polished, ATS-friendly PDF in seconds. Keep a fresh version for every application.",
    videoSrc: "/videos/step-4-export.mp4",
  },
];

function VideoFrame({
  src,
  icon: Icon,
  label,
}: {
  src?: string;
  icon: LucideIcon;
  label: string;
}) {
  const [failed, setFailed] = useState(!src);

  return (
    <div
      className="aspect-video rounded-xl border overflow-hidden shadow-sm flex items-center justify-center"
      style={{
        borderColor: "var(--color-border-tertiary)",
        background:
          "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-slate-50) 100%)",
      }}
    >
      {!failed && src ? (
        <video
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={label}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="text-center px-6">
          <Icon
            size={40}
            style={{ color: "var(--color-teal-600)", margin: "0 auto 8px" }}
          />
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {label}
          </p>
        </div>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: Step; index: number }) {
  const reversed = index % 2 === 1;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-14 items-center mb-16 md:mb-24 last:mb-0">
      <div className={reversed ? "md:order-2" : ""}>
        <VideoFrame
          src={step.videoSrc}
          icon={step.icon}
          label={`${step.title} preview`}
        />
      </div>
      <div className={reversed ? "md:order-1" : ""}>
        <p
          className="uppercase mb-3"
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--color-teal-600)",
            letterSpacing: "0.08em",
          }}
        >
          Step {step.number}
        </p>
        <h3
          className="font-medium mb-3"
          style={{
            fontSize: "22px",
            lineHeight: "1.3",
            color: "var(--color-text-primary)",
          }}
        >
          {step.title}
        </h3>
        <p
          style={{
            fontSize: "15px",
            lineHeight: "1.65",
            color: "var(--color-text-secondary)",
          }}
        >
          {step.description}
        </p>
      </div>
    </div>
  );
}

const STATS: { icon: LucideIcon; value: string; label: string }[] = [
  {
    icon: Filter,
    value: "75%",
    label: "of CVs are filtered out by ATS before a recruiter sees them",
  },
  {
    icon: Clock,
    value: "7s",
    label: "is all a recruiter spends scanning your CV on average",
  },
  {
    icon: TrendingUp,
    value: "3x",
    label: "more interviews when your CV is customized to the role",
  },
];

const WHY_BENEFITS = [
  "Mirror the exact keywords ATS systems scan for",
  "Lead with the experience this role actually needs",
  "Cut filler that buries your strongest work",
  "Ship a fresh version for every application in minutes",
];

export function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="font-medium mb-4"
            style={{ fontSize: "32px", lineHeight: "1.2", color: "var(--color-text-primary)" }}
          >
            Build one CV. Customize it for every job.
          </h1>
          <p
            className="mb-8"
            style={{ fontSize: "15px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}
          >
            Upload your CV once, point it at a job, and get a polished, ATS-friendly
            version tuned to that exact role — in minutes, not hours.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/app/create"
              className="interactive-button px-6 py-3 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              Create your CV
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 rounded-lg font-medium transition-colors border"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                borderColor: "var(--color-teal-200)",
              }}
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Product Preview */}
        <div className="mt-16 max-w-5xl mx-auto">
          <VideoFrame
            src="/videos/hero.mp4"
            icon={FileText}
            label="Product preview"
          />
        </div>
      </section>

      {/* Stats / pain-point band */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div
          className="rounded-xl border px-6 md:px-10 py-8 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)",
          }}
        >
          {STATS.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-4"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--color-teal-50)" }}
                >
                  <Icon size={20} style={{ color: "var(--color-teal-600)" }} />
                </div>
                <div>
                  <div
                    className="font-medium mb-1"
                    style={{ fontSize: "28px", lineHeight: "1.1", color: "var(--color-teal-700)" }}
                  >
                    {stat.value}
                  </div>
                  <p
                    style={{
                      fontSize: "13px",
                      lineHeight: "1.5",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {stat.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How It Works — 4 alternating step rows */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16 scroll-mt-20">
        <div className="text-center mb-16">
          <p
            className="uppercase tracking-wider mb-3"
            style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            How it works
          </p>
          <h2
            className="font-medium"
            style={{ fontSize: "26px", color: "var(--color-text-primary)" }}
          >
            From CV to offer in four steps
          </h2>
          <p
            className="mt-3 max-w-xl mx-auto"
            style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}
          >
            Each step takes seconds. The whole flow takes minutes.
          </p>
        </div>

        <div>
          {STEPS.map((step, index) => (
            <StepRow key={step.number} step={step} index={index} />
          ))}
        </div>
      </section>

      {/* Why Tailored CVs Matter */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="rounded-xl p-10 md:p-12" style={{ background: "var(--color-teal-50)" }}>
          <div className="max-w-3xl mx-auto text-center">
            <h2
              className="font-medium mb-4"
              style={{ fontSize: "24px", color: "var(--color-teal-800)" }}
            >
              Why a customized CV beats a generic one
            </h2>
            <p
              className="mx-auto mb-8"
              style={{ fontSize: "15px", lineHeight: "1.6", color: "var(--color-teal-800)" }}
            >
              Recruiters and ATS systems are matching your CV against a specific job —
              not your career. A customized CV speaks their language and proves you're the
              right fit before anyone reads a single sentence in full.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left max-w-2xl mx-auto">
              {WHY_BENEFITS.map((benefit, index) => (
                <div key={index} className="flex items-start gap-3">
                  <CheckCircle
                    size={18}
                    style={{ color: "var(--color-teal-600)", marginTop: "1px", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-teal-800)" }}>
                    {benefit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Career Advice */}
      <section id="career-advice" className="max-w-7xl mx-auto px-6 py-16 scroll-mt-20">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-8">
          <div className="max-w-2xl">
            <p
              className="uppercase tracking-wider mb-3"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
            >
              Career advice
            </p>
            <h2
              className="font-medium mb-3"
              style={{ fontSize: "26px", color: "var(--color-text-primary)" }}
            >
              Learn how to build and tailor a better CV
            </h2>
            <p style={{ fontSize: "14px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}>
              Practical guides for creating a readable CV, matching job descriptions, and
              making every application more focused.
            </p>
          </div>
          <Link
            to="/career-advice"
            className="inline-flex items-center gap-2 font-medium"
            style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
          >
            View all guides <ArrowRight size={15} />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {CAREER_ARTICLES.slice(0, 4).map((article) => (
            <article
              key={article.slug}
              className="border rounded-lg p-6 flex flex-col"
              style={{
                borderColor: "var(--color-border-tertiary)",
                background: "var(--color-background-primary)",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="rounded-full px-3 py-1"
                  style={{
                    fontSize: "12px",
                    background: "var(--color-teal-50)",
                    color: "var(--color-teal-800)",
                  }}
                >
                  {article.category}
                </span>
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {article.readingTime}
                </span>
              </div>
              <h3
                className="font-medium mb-3"
                style={{ fontSize: "20px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
              >
                <Link to={getCareerArticlePath(article)}>{article.title}</Link>
              </h3>
              <p
                className="mb-5 grow"
                style={{ fontSize: "14px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}
              >
                {article.description}
              </p>
              <Link
                to={getCareerArticlePath(article)}
                className="inline-flex items-center gap-2 font-medium"
                style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
              >
                Read the Article <ArrowRight size={15} />
              </Link>
            </article>
          ))}
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
            Create your first customized CV in minutes.
          </p>
          <Link
            to="/app/create"
            className="interactive-button inline-block px-6 py-3 rounded-lg font-medium transition-colors"
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
              <img src="/images/logo.png" alt="" className="w-5 h-5 rounded-lg object-contain shrink-0" />
              <span className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                jobspecificCV
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              © 2026 jobspecificCV. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
