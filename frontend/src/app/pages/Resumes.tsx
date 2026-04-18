import { Link } from "react-router";
import { FileText, Edit, Target, Download, MoreVertical } from "lucide-react";
import { useEffect } from "react";
import { useSidebar } from "../contexts/SidebarContext";

export function Resumes() {
  const { setSidebarVisible } = useSidebar();

  // Show sidebar when on this page
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  const masterCV = {
    id: "master",
    name: "My Master CV",
    type: "master",
    lastEdited: "Mar 29, 2026",
  };

  const tailoredCVs = [
    {
      id: "1",
      name: "Tailored CV - Acme Corp",
      role: "Senior Product Designer",
      company: "Acme Corp",
      basedOn: "My Master CV",
      score: 94,
      lastEdited: "Mar 28, 2026",
    },
    {
      id: "2",
      name: "Tailored CV - TechStart",
      role: "UX Lead",
      company: "TechStart",
      basedOn: "My Master CV",
      score: 88,
      lastEdited: "Mar 25, 2026",
    },
    {
      id: "3",
      name: "Tailored CV - Design Co",
      role: "Product Designer",
      company: "Design Co",
      basedOn: "My Master CV",
      score: 91,
      lastEdited: "Mar 24, 2026",
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          My CVs
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Manage your master CV and tailored versions
        </p>
      </div>

      {/* Master CV Section */}
      <div className="mb-8">
        <p
          className="uppercase tracking-wider mb-3"
          style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
        >
          Master CV
        </p>
        <div
          className="p-5 rounded-xl border"
          style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-4">
              <div
                className="w-12 h-16 rounded border flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--color-slate-50)", borderColor: "var(--color-border-secondary)" }}
              >
                <FileText size={20} style={{ color: "var(--color-text-secondary)" }} />
              </div>
              <div>
                <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {masterCV.name}
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Last updated {masterCV.lastEdited}
                </p>
              </div>
            </div>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: "var(--color-teal-50)", color: "var(--color-teal-800)" }}
            >
              Master CV
            </span>
          </div>
          <div className="flex gap-2">
            <Link
              to="/app/cv/master"
              className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              <Edit size={14} />
              Edit
            </Link>
            <Link
              to="/app/tailor/master"
              className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                borderColor: "var(--color-teal-200)",
              }}
            >
              <Target size={14} />
              Tailor for a job
            </Link>
            <button
              className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)",
              }}
            >
              <Download size={14} />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Tailored CVs Section */}
      <div>
        <p
          className="uppercase tracking-wider mb-3"
          style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
        >
          Tailored CVs ({tailoredCVs.length})
        </p>
        
        <div className="space-y-3">
          {tailoredCVs.map((cv) => (
            <div
              key={cv.id}
              className="p-4 rounded-xl border"
              style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div
                    className="w-10 h-14 rounded border flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-slate-50)", borderColor: "var(--color-border-secondary)" }}
                  >
                    <FileText size={16} style={{ color: "var(--color-text-secondary)" }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <h3 className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                          {cv.role}
                        </h3>
                        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                          {cv.company}
                        </p>
                      </div>
                      <button style={{ color: "var(--color-text-secondary)" }}>
                        <MoreVertical size={16} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-3 mb-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs"
                        style={{
                          background: "var(--color-teal-50)",
                          color: "var(--color-teal-800)",
                        }}
                      >
                        {cv.score}% match
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        Based on {cv.basedOn}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        • Last edited {cv.lastEdited}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/app/cv/${cv.id}`}
                        className="px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                        style={{
                          fontSize: "12px",
                          background: "var(--color-teal-600)",
                          color: "var(--color-teal-50)",
                        }}
                      >
                        <Edit size={12} />
                        Edit
                      </Link>
                      <button
                        className="px-3 py-1.5 rounded-lg font-medium transition-colors border flex items-center gap-1.5"
                        style={{
                          fontSize: "12px",
                          borderColor: "var(--color-border-secondary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        <Download size={12} />
                        Export
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}