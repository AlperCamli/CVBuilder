import { FileText, Plus, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";

interface Job {
  id: number;
  title: string;
  company: string;
  cvName: string;
  hasCoverLetter: boolean;
  date: string;
}

export function CoverLetters() {
  const { setSidebarVisible } = useSidebar();
  const navigate = useNavigate();
  const [creatingCoverLetter, setCreatingCoverLetter] = useState<number | null>(null);

  // Mock jobs data - in a real app, this would come from a global state or API
  const [jobs, setJobs] = useState<Job[]>([
    {
      id: 1,
      title: "Senior Product Designer",
      company: "Acme Corp",
      cvName: "Tailored CV - Acme",
      hasCoverLetter: true,
      date: "Mar 28, 2026",
    },
    {
      id: 2,
      title: "UX Lead",
      company: "TechStart",
      cvName: "Tailored CV - TechStart",
      hasCoverLetter: false,
      date: "Mar 25, 2026",
    },
    {
      id: 3,
      title: "Product Designer",
      company: "Design Co",
      cvName: "Tailored CV - Design Co",
      hasCoverLetter: true,
      date: "Mar 24, 2026",
    },
  ]);

  // Show sidebar when on this page
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  const handleCreateCoverLetter = (job: Job) => {
    // Set loading state
    setCreatingCoverLetter(job.id);

    // Simulate cover letter creation
    setTimeout(() => {
      // Update job to have cover letter
      setJobs((prevJobs) =>
        prevJobs.map((j) =>
          j.id === job.id ? { ...j, hasCoverLetter: true } : j
        )
      );

      // Clear loading state
      setCreatingCoverLetter(null);

      // Navigate to editor
      navigate(`/app/cover-letter/${job.id}`, {
        state: {
          jobData: {
            id: job.id,
            title: job.title,
            company: job.company,
            cvName: job.cvName,
          }
        }
      });
    }, 1500);
  };

  const handleViewCoverLetter = (job: Job) => {
    navigate(`/app/cover-letter/${job.id}`, {
      state: {
        jobData: {
          id: job.id,
          title: job.title,
          company: job.company,
          cvName: job.cvName,
        }
      }
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Cover Letters
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Create and manage cover letters for your job applications
        </p>
      </div>

      {/* Jobs List */}
      <div className="max-w-4xl">
        <div className="grid gap-4">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="p-5 rounded-xl border bg-white hover:shadow-md transition-all"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-medium" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
                      {job.title}
                    </h3>
                    {job.hasCoverLetter && (
                      <div
                        className="px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{
                          background: "var(--color-teal-50)",
                          color: "var(--color-teal-800)",
                        }}
                      >
                        <CheckCircle2 size={12} />
                        <span style={{ fontSize: "11px", fontWeight: 500 }}>Created</span>
                      </div>
                    )}
                  </div>
                  <p className="mb-1" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                    {job.company}
                  </p>
                  <div className="flex items-center gap-4 mt-3">
                    <span
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        background: "var(--color-slate-50)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {job.cvName}
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {job.date}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {creatingCoverLetter === job.id ? (
                    <button
                      disabled
                      className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed"
                      style={{
                        fontSize: "13px",
                        background: "var(--color-teal-600)",
                        color: "white",
                        opacity: 0.7,
                      }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      Creating...
                    </button>
                  ) : job.hasCoverLetter ? (
                    <button
                      onClick={() => handleViewCoverLetter(job)}
                      className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 border"
                      style={{
                        fontSize: "13px",
                        color: "var(--color-teal-600)",
                        borderColor: "var(--color-teal-200)",
                        background: "var(--color-teal-50)",
                      }}
                    >
                      <Mail size={14} />
                      View Cover Letter
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCreateCoverLetter(job)}
                      className="px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                      style={{
                        fontSize: "13px",
                        background: "var(--color-teal-600)",
                        color: "white",
                      }}
                    >
                      <Plus size={14} />
                      Create Cover Letter
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {jobs.length === 0 && (
          <div className="mt-16">
            <div
              className="p-12 rounded-xl border-2 border-dashed text-center"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "var(--color-slate-50)" }}
              >
                <FileText size={32} style={{ color: "var(--color-text-secondary)" }} />
              </div>
              <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                No jobs yet
              </h3>
              <p className="mb-6 max-w-md mx-auto" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Create a tailored CV for a job to generate a cover letter.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}