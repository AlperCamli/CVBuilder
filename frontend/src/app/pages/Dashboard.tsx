import { Link } from "react-router";
import { FileText, Edit, Target, Plus, MoreVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";
import type {
  DashboardActivityResponseData,
  DashboardResponseData,
  JobBoardResponse
} from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { ApiClientError } from "../integration/api-error";

const formatDate = (value: string | null): string => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return value;
  }
};

const statusLabel = (status: string): string =>
  status.charAt(0).toUpperCase() + status.slice(1);

export function Dashboard() {
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponseData | null>(null);
  const [jobBoard, setJobBoard] = useState<JobBoardResponse | null>(null);
  const [activity, setActivity] = useState<DashboardActivityResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [dashboardData, boardData, activityData] = await Promise.all([
          api.getDashboard(),
          api.getJobsBoard(),
          api.getDashboardActivity()
        ]);

        if (cancelled) {
          return;
        }

        setDashboard(dashboardData);
        setJobBoard(boardData);
        setActivity(activityData);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof ApiClientError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load dashboard.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const stats = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    const totalCvs =
      dashboard.master_cv_summary.total_count + dashboard.tailored_cv_summary.total_count;
    const applications = dashboard.jobs_summary.total_count;
    const interviews = dashboard.jobs_summary.counts_by_status.interview;
    const applied = dashboard.jobs_summary.counts_by_status.applied;
    const responseRate = applied > 0 ? `${Math.round((interviews / applied) * 100)}%` : "0%";

    return [
      { label: "CVs created", value: String(totalCvs) },
      { label: "Applications", value: String(applications) },
      { label: "Interviews", value: String(interviews), highlight: true },
      { label: "Response rate", value: responseRate, highlight: true }
    ];
  }, [dashboard]);

  const columns = [
    { id: "saved", label: "Saved" },
    { id: "applied", label: "Applied" },
    { id: "interview", label: "Interview" },
    { id: "offer", label: "Offer" }
  ] as const;

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Dashboard
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Dashboard
        </h1>
        <div
          className="mt-4 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-3 underline"
            style={{ color: "var(--color-red-700)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const primaryMaster = dashboard?.master_cv_summary.primary_master_cv ?? null;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Dashboard
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Track your CVs and job applications
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
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
                color: stat.highlight ? "var(--color-teal-400)" : "var(--color-text-primary)"
              }}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <p
          className="uppercase tracking-wider mb-3"
          style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
        >
          Master CV
        </p>

        {!primaryMaster && (
          <div
            className="p-5 rounded-xl border"
            style={{
              background: "var(--color-background-primary)",
              borderColor: "var(--color-border-tertiary)"
            }}
          >
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              You don&apos;t have a master CV yet.
            </p>
            <Link
              to="/app/create"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)"
              }}
            >
              <Plus size={14} />
              Create or upload CV
            </Link>
          </div>
        )}

        {primaryMaster && (
          <div
            className="p-5 rounded-xl border"
            style={{
              background: "var(--color-background-primary)",
              borderColor: "var(--color-border-tertiary)"
            }}
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
                    {primaryMaster.title}
                  </h3>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    Last updated {formatDate(primaryMaster.updated_at)}
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
                to={`/app/cv/${primaryMaster.id}`}
                state={{ cvKind: "master", masterCvId: primaryMaster.id }}
                className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)"
                }}
              >
                <Edit size={14} />
                Edit
              </Link>
              <Link
                to={`/app/tailor/${primaryMaster.id}`}
                className="px-4 py-2 rounded-lg font-medium transition-colors border flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-50)",
                  color: "var(--color-teal-800)",
                  borderColor: "var(--color-teal-200)"
                }}
              >
                <Target size={14} />
                Tailor for a job
              </Link>
            </div>
          </div>
        )}
      </div>

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
          {columns.map((column) => {
            const group = jobBoard?.groups.find((item) => item.status === column.id);
            const items = group?.items ?? [];
            return (
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
                      color: "var(--color-text-secondary)"
                    }}
                  >
                    {group?.count ?? 0}
                  </span>
                </div>

                <div className="space-y-2">
                  {items.slice(0, 3).map((job) => (
                    <div
                      key={job.id}
                      className="p-3 rounded-lg border"
                      style={{
                        background: "var(--color-background-primary)",
                        borderColor: "var(--color-border-tertiary)"
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium mb-0.5" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                            {job.job_title}
                          </h4>
                          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                            {job.company_name}
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
                            color: "var(--color-teal-800)"
                          }}
                        >
                          {statusLabel(job.status)}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {formatDate(job.updated_at)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {items.length === 0 && (
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
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <p
            className="uppercase tracking-wider"
            style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
          >
            Recent activity
          </p>
        </div>

        <div
          className="p-4 rounded-xl border"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          {!activity || activity.activity.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              No activity yet.
            </p>
          ) : (
            <div className="space-y-2">
              {activity.activity.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0"
                  style={{ borderColor: "var(--color-border-tertiary)" }}
                >
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                      {item.message}
                    </p>
                    {item.related_entity.title ? (
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        {item.related_entity.title}
                      </p>
                    ) : null}
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {formatDate(item.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
