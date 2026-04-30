import { X as XIcon, Lightbulb } from "lucide-react";

interface Tip {
  title: string;
  description: string;
  example?: string;
}

interface TipsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sectionType: string;
}

const tipsData: Record<string, Tip[]> = {
  summary: [
    {
      title: "Start with a strong opening",
      description: "Lead with your years of experience and key expertise",
      example: "Results-driven Senior Software Engineer with 8+ years of expertise in full-stack development..."
    },
    {
      title: "Include quantifiable achievements",
      description: "Add numbers to demonstrate your impact",
      example: "Delivered 15+ projects, improving system performance by 40%"
    },
    {
      title: "Keep it concise",
      description: "Aim for 3-4 sentences that capture your professional identity",
      example: "Focus on what makes you unique and valuable to employers"
    }
  ],
  experience: [
    {
      title: "Use action verbs",
      description: "Start each bullet point with a strong action verb",
      example: "Led, Developed, Architected, Implemented, Optimized, Streamlined"
    },
    {
      title: "Quantify your achievements",
      description: "Include metrics and numbers to show impact",
      example: "Increased sales by 35%, Reduced load time by 2.5 seconds, Managed team of 10"
    },
    {
      title: "Show progression",
      description: "Highlight promotions and increasing responsibilities",
      example: "Started as Junior Developer → promoted to Senior Developer within 2 years"
    },
    {
      title: "Focus on results, not just tasks",
      description: "Explain the outcome and business impact of your work",
      example: "Instead of 'Wrote code' → 'Developed feature that increased user retention by 25%'"
    }
  ],
  education: [
    {
      title: "List relevant coursework",
      description: "Include courses related to the job you're applying for",
      example: "Relevant coursework: Machine Learning, Data Structures, Algorithms"
    },
    {
      title: "Highlight academic achievements",
      description: "Mention honors, awards, and notable GPA",
      example: "Graduated summa cum laude, GPA: 3.9/4.0"
    },
    {
      title: "Include relevant projects",
      description: "Describe significant academic or thesis projects",
      example: "Thesis: 'Optimizing Neural Networks for Edge Computing' - Published in IEEE"
    }
  ],
  skills: [
    {
      title: "Group by category",
      description: "Organize skills into logical groups",
      example: "Frontend: React, Vue, TypeScript | Backend: Node.js, Python, PostgreSQL"
    },
    {
      title: "Prioritize relevant skills",
      description: "List skills most relevant to the job first",
      example: "Put job-specific technologies and tools at the top"
    },
    {
      title: "Be specific",
      description: "Include versions and proficiency levels when relevant",
      example: "React 18 (Expert), Python 3.11 (Advanced), AWS (Intermediate)"
    }
  ],
  languages: [
    {
      title: "Be honest about proficiency",
      description: "Use standard proficiency levels accurately",
      example: "Native, Professional, Advanced, Intermediate, Basic"
    },
    {
      title: "Include certifications",
      description: "Add test scores or official certifications when available",
      example: "IELTS 8.0, TOEFL 110, DELE B2"
    }
  ],
  projects: [
    {
      title: "Highlight impact",
      description: "Focus on the problem solved and results achieved",
      example: "Built e-commerce platform serving 10K+ users with 99.9% uptime"
    },
    {
      title: "Include technologies",
      description: "List key technologies and tools used",
      example: "Tech stack: React, Node.js, PostgreSQL, AWS"
    },
    {
      title: "Add links when possible",
      description: "Include GitHub repos or live demos",
      example: "github.com/username/project-name or live-demo.com"
    }
  ]
};

export function TipsDrawer({ isOpen, onClose, sectionType }: TipsDrawerProps) {
  const tips = tipsData[sectionType] || [];

  if (!isOpen || tips.length === 0) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        style={{ opacity: isOpen ? 1 : 0 }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full w-full md:w-96 bg-white shadow-2xl z-50 transform transition-transform duration-300 overflow-y-auto"
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between"
          style={{ borderColor: "var(--color-border-tertiary)" }}>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg" style={{ background: "var(--color-teal-50)" }}>
              <Lightbulb size={20} style={{ color: "var(--color-teal-600)" }} />
            </div>
            <h2 className="font-medium" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
              Tips & Best Practices
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--color-background-secondary)] transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <XIcon size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {tips.map((tip, index) => (
            <div
              key={index}
              className="p-4 rounded-xl border"
              style={{
                background: "var(--color-background-primary)",
                borderColor: "var(--color-border-tertiary)",
              }}
            >
              <div className="flex items-start gap-2 mb-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--color-teal-50)", color: "var(--color-teal-600)" }}
                >
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>{index + 1}</span>
                </div>
                <h3 className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {tip.title}
                </h3>
              </div>
              <p className="mb-3" style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
                {tip.description}
              </p>
              {tip.example && (
                <div
                  className="p-3 rounded-lg"
                  style={{
                    background: "var(--color-slate-50)",
                    fontSize: "12px",
                    color: "var(--color-text-secondary)",
                    lineHeight: "1.6",
                    fontFamily: "monospace",
                  }}
                >
                  <div className="font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
                    Example:
                  </div>
                  {tip.example}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
