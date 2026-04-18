import { Link } from "react-router";
import { FileText, Edit, Target, Download, Plus, MoreVertical } from "lucide-react";
import { useEffect } from "react";
import { useSidebar } from "../contexts/SidebarContext";

export function Dashboard() {
  const { setSidebarVisible } = useSidebar();

  // Show sidebar when on dashboard
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  // Mock data
  const stats = [
    { label: "CVs created", value: "4" },
    { label: "Applications", value: "23" },
    { label: "Interviews", value: "6", highlight: true },
    { label: "Response rate", value: "26%", highlight: true },
  ];

  const jobs = [
    {
      id: 1,
      title: "Senior Product Designer",
      company: "Acme Corp",
      status: "Interview",
      cvName: "Tailored CV - Acme",
      score: 94,
      date: "Mar 28, 2026",
      column: "interview",
    },
    {
      id: 2,
      title: "UX Lead",
      company: "TechStart",
      status: "Applied",
      cvName: "Tailored CV - TechStart",
      score: 88,
      date: "Mar 25, 2026",
      column: "applied",
    },
    {
      id: 3,
      title: "Product Designer",
      company: "Design Co",
      status: "Saved",
      cvName: "Tailored CV - Design Co",
      score: 91,
      date: "Mar 24, 2026",
      column: "saved",
    },
  ];

  const columns = [
    { id: "saved", label: "Saved", count: 1 },
    { id: "applied", label: "Applied", count: 1 },
    { id: "interview", label: "Interview", count: 1 },
    { id: "offer", label: "Offer", count: 0 },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Dashboard
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Track your CVs and job applications
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-8">
        {stats.map((stat, index) => (
          <div
            key={index}
            className="p-4 rounded-lg"
            style={{ background: "var(--color-background-secondary)" }}
          >
            <p className="mb-1.5" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              {stat.label}
            </p>
            <p
              className="font-medium"
              style={{
                fontSize: "24px",
                color: stat.highlight ? "var(--color-teal-400)" : "var(--color-text-primary)",
              }}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Master CV Card */}
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
                  My Master CV
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Last updated Mar 29, 2026
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

      {/* Job Tracker Kanban */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <p
            className="uppercase tracking-wider"
            style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            Job applications
          </p>
          <Link
            to="/app/job-tracker"
            className="font-medium"
            style={{ fontSize: "13px", color: "var(--color-teal-600)" }}
          >
            View all
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {columns.map((column) => (
            <div key={column.id}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                  {column.label}
                </h3>
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{
                    fontSize: "11px",
                    background: "var(--color-background-secondary)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {column.count}
                </span>
              </div>
              <div className="space-y-2">
                {jobs
                  .filter((job) => job.column === column.id)
                  .map((job) => (
                    <div
                      key={job.id}
                      className="p-3 rounded-lg border"
                      style={{
                        background: "var(--color-background-primary)",
                        borderColor: "var(--color-border-tertiary)",
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium mb-0.5" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                            {job.title}
                          </h4>
                          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                            {job.company}
                          </p>
                        </div>
                        <button style={{ color: "var(--color-text-secondary)" }}>
                          <MoreVertical size={14} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs"
                          style={{
                            background: "var(--color-teal-50)",
                            color: "var(--color-teal-800)",
                          }}
                        >
                          {job.score}% match
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {job.date}
                        </span>
                      </div>
                    </div>
                  ))}
                {column.count === 0 && (
                  <div
                    className="p-4 rounded-lg border-2 border-dashed text-center"
                    style={{ borderColor: "var(--color-border-tertiary)" }}
                  >
                    <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      No applications
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/app/create"
          className="p-6 rounded-xl border-2 border-dashed flex items-center justify-center gap-3 transition-colors hover:border-teal-400"
          style={{ borderColor: "var(--color-border-tertiary)" }}
        >
          <Plus size={20} style={{ color: "var(--color-teal-600)" }} />
          <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-teal-600)" }}>
            Create new CV
          </span>
        </Link>
        <Link
          to="/app/tailor/master"
          className="p-6 rounded-xl border-2 border-dashed flex items-center justify-center gap-3 transition-colors hover:border-teal-400"
          style={{ borderColor: "var(--color-border-tertiary)" }}
        >
          <Target size={20} style={{ color: "var(--color-teal-600)" }} />
          <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-teal-600)" }}>
            Tailor CV for a job
          </span>
        </Link>
      </div>
    </div>
  );
}