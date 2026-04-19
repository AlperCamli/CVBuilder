import { MoreVertical, Plus, Info, X, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TutorialGuide } from "../components/TutorialGuide";
import { useAuth } from "../integration/auth-context";
import type { JobBoardResponse, JobDetail, JobHistoryResponse, JobStatus } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";

interface Job {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  date: string;
  isNew?: boolean;
}

const statusToLabel: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived"
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

const DraggableJobCard = ({
  job,
  moveJob,
  disabled,
  onOpenDetails
}: {
  job: Job;
  moveJob: (jobId: string, newStatus: JobStatus) => void;
  disabled: boolean;
  onOpenDetails: (jobId: string) => void;
}) => {
  const [{ isDragging }, drag] = useDrag({
    type: "JOB",
    item: { id: job.id, status: job.status },
    canDrag: !disabled,
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  return (
    <div
      ref={drag}
      className={`p-3 rounded-lg border cursor-move hover:shadow-sm transition-all ${
        job.isNew ? "animate-pulse-slow" : ""
      }`}
      style={{
        background: job.isNew ? "var(--color-teal-50)" : "var(--color-background-primary)",
        borderColor: job.isNew ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
        borderWidth: job.isNew ? "2px" : "1px",
        opacity: isDragging || disabled ? 0.6 : 1,
        boxShadow: job.isNew ? "0 4px 12px rgba(20, 184, 166, 0.15)" : "none"
      }}
    >
      {job.isNew && (
        <div className="flex items-center gap-1 mb-2">
          <div
            className="px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{
              background: "var(--color-teal-600)",
              color: "white"
            }}
          >
            <Sparkles size={10} />
            <span style={{ fontSize: "10px", fontWeight: 600 }}>NEW</span>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h4 className="font-medium mb-0.5" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
            {job.title}
          </h4>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{job.company}</p>
        </div>
        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenDetails(job.id);
          }}
          style={{ color: "var(--color-text-secondary)" }}
        >
          <MoreVertical size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span
          className="px-2 py-0.5 rounded-full text-xs"
          style={{
            background: job.isNew ? "var(--color-teal-600)" : "var(--color-teal-50)",
            color: job.isNew ? "white" : "var(--color-teal-800)"
          }}
        >
          {statusToLabel[job.status]}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{job.date}</span>
      </div>
    </div>
  );
};

const DroppableColumn = ({
  columnId,
  jobs,
  moveJob,
  disabled,
  onOpenDetails
}: {
  columnId: JobStatus;
  jobs: Job[];
  moveJob: (jobId: string, newStatus: JobStatus) => void;
  disabled: boolean;
  onOpenDetails: (jobId: string) => void;
}) => {
  const [{ isOver }, drop] = useDrop({
    accept: "JOB",
    drop: (item: { id: string; status: JobStatus }) => {
      if (item.status !== columnId && !disabled) {
        moveJob(item.id, columnId);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver()
    })
  });

  return (
    <div
      ref={drop}
      className="space-y-2 min-h-[200px] p-2 rounded-lg transition-colors"
      style={{
        background: isOver ? "var(--color-teal-50)" : "transparent",
        border: isOver ? "2px dashed var(--color-teal-400)" : "2px dashed transparent"
      }}
    >
      {jobs.map((job) => (
        <DraggableJobCard
          key={job.id}
          job={job}
          moveJob={moveJob}
          disabled={disabled}
          onOpenDetails={onOpenDetails}
        />
      ))}

      {jobs.length === 0 && (
        <div
          className="p-4 rounded-lg border-2 border-dashed text-center"
          style={{ borderColor: "var(--color-border-tertiary)" }}
        >
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {isOver ? "Drop here" : "No applications"}
          </p>
        </div>
      )}
    </div>
  );
};

export function JobTracker() {
  const { setSidebarVisible } = useSidebar();
  const location = useLocation();
  const { api } = useAuth();
  const [showInstructions, setShowInstructions] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<JobBoardResponse | null>(null);
  const [jobsListTotal, setJobsListTotal] = useState<number>(0);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [jobHistory, setJobHistory] = useState<JobHistoryResponse | null>(null);

  const columns = [
    { id: "saved", label: "Saved", color: "#E6F1FB" },
    { id: "applied", label: "Applied", color: "#E1F5EE" },
    { id: "interview", label: "Interview", color: "#EAF3DE" },
    { id: "offer", label: "Offer", color: "#FAEEDA" },
    { id: "rejected", label: "Rejected", color: "#FCEBEB" }
  ] as const;

  const jobs = useMemo(() => {
    if (!board) {
      return [] as Job[];
    }

    return board.groups.flatMap((group) =>
      group.items.map((job) => ({
        id: job.id,
        title: job.job_title,
        company: job.company_name,
        status: group.status,
        date: formatDate(job.updated_at)
      }))
    );
  }, [board]);

  const loadBoard = async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardData, listData] = await Promise.all([
        api.getJobsBoard(),
        api.listJobs({ page: 1, limit: 100, sort_by: "updated_at", sort_order: "desc" })
      ]);
      setBoard(boardData);
      setJobsListTotal(listData.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load job board.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  useEffect(() => {
    void loadBoard();
  }, []);

  useEffect(() => {
    if (location.state?.newJob) {
      setShowInstructions(true);
      const bannerTimer = setTimeout(() => {
        setShowInstructions(false);
        setShowTutorial(true);
      }, 2000);

      const tutorialTimer = setTimeout(() => {
        setShowTutorial(false);
      }, 12000);

      window.history.replaceState({}, document.title);

      return () => {
        clearTimeout(bannerTimer);
        clearTimeout(tutorialTimer);
      };
    }

    return undefined;
  }, [location.state]);

  const moveJob = async (jobId: string, newStatus: JobStatus) => {
    if (!board) {
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      await api.patchJobStatus(jobId, newStatus);
      await loadBoard();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update job status.");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const openJobDetails = async (jobId: string) => {
    setShowDetailDialog(true);
    setDetailLoading(true);
    setError(null);
    setJobDetail(null);
    setJobHistory(null);

    try {
      const [detail, history] = await Promise.all([
        api.getJob(jobId),
        api.getJobHistory(jobId)
      ]);
      setJobDetail(detail);
      setJobHistory(history);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load job details.");
      }
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="p-8">
        {showInstructions && (
          <div
            className="mb-6 p-4 rounded-lg border flex items-start gap-3"
            style={{ background: "var(--color-teal-50)", borderColor: "var(--color-teal-200)" }}
          >
            <Info size={20} style={{ color: "var(--color-teal-600)", flexShrink: 0, marginTop: "2px" }} />
            <div className="flex-1">
              <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-teal-800)" }}>
                Tailored CV created!
              </h4>
              <p style={{ fontSize: "13px", color: "var(--color-teal-800)", lineHeight: "1.5" }}>
                Your job entry is now tracked here. Drag cards between columns to keep statuses updated.
              </p>
            </div>
            <button onClick={() => setShowInstructions(false)} style={{ color: "var(--color-teal-600)" }}>
              <X size={18} />
            </button>
          </div>
        )}

        {error && (
          <div
            className="mb-6 p-4 rounded-lg border"
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
              className="ml-3 underline"
              style={{ color: "var(--color-red-700)" }}
              onClick={() => void loadBoard()}
            >
              Retry
            </button>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="font-medium" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
              Job Applications
            </h1>
            <button
              className="px-4 py-2 rounded-lg font-medium flex items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
                opacity: 0.6,
                cursor: "not-allowed"
              }}
              disabled
              title="New jobs are created from Tailored CV flow in this phase"
            >
              <Plus size={16} />
              Add application
            </button>
          </div>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            Track your job applications and their status. Drag and drop cards between columns to update status.
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Total tracked jobs: {jobsListTotal}
          </p>
        </div>

        {loading && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading board...</p>}

        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {columns.map((column) => (
              <div key={column.id}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: column.color }} />
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
                    {board?.counts_by_status[column.id] ?? 0}
                  </span>
                </div>

                <DroppableColumn
                  columnId={column.id}
                  jobs={jobs.filter((job) => job.status === column.id)}
                  moveJob={moveJob}
                  disabled={isUpdating}
                  onOpenDetails={openJobDetails}
                />
              </div>
            ))}
          </div>
        )}

        <TutorialGuide
          show={showTutorial}
          onClose={() => setShowTutorial(false)}
          targetElement="a[href='/app/cover-letters']"
          message="Click here to create a cover letter for your new job application!"
          position="right"
        />

        <Dialog
          open={showDetailDialog}
          onOpenChange={(open) => {
            setShowDetailDialog(open);
            if (!open) {
              setJobDetail(null);
              setJobHistory(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Job details
              </DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Current job record and status history from backend.
              </DialogDescription>
            </DialogHeader>

            {detailLoading ? (
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading details...</p>
            ) : jobDetail ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                  <p style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                    {jobDetail.job.job_title}
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {jobDetail.job.company_name}
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px" }}>
                    Status: {statusToLabel[jobDetail.job.status]}
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    Last status change: {formatDate(jobDetail.status_last_changed_at)}
                  </p>
                </div>

                {jobDetail.notes ? (
                  <div className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                    <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{jobDetail.notes}</p>
                  </div>
                ) : null}

                <div className="pt-1">
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                    Status history
                  </p>
                  <div className="space-y-2 max-h-[180px] overflow-auto pr-1">
                    {!jobHistory || jobHistory.history.length === 0 ? (
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        No history yet.
                      </p>
                    ) : (
                      jobHistory.history.map((entry) => (
                        <div
                          key={entry.id}
                          className="p-2 rounded-lg border"
                          style={{ borderColor: "var(--color-border-tertiary)" }}
                        >
                          <p style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>
                            {entry.from_status ? statusToLabel[entry.from_status] : "N/A"} {"->"} {statusToLabel[entry.to_status]}
                          </p>
                          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                            {formatDate(entry.changed_at)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Job detail is not available.
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DndProvider>
  );
}
