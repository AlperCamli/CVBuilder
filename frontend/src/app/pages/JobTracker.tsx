import { MoreVertical, Plus, Info, X, Sparkles, FileText, Mail, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TutorialGuide } from "../components/TutorialGuide";
import { useAuth } from "../integration/auth-context";
import type { JobBoardResponse, JobDetail, JobHistoryResponse, JobStatus } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";

interface Job {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  date: string;
  tailoredCvId: string | null;
  coverLetterId: string | null;
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

const statusBadgeStyle = (status: JobStatus): { background: string; color: string } => {
  switch (status) {
    case "saved":
      return { background: "var(--status-saved-bg)", color: "var(--status-saved-fg)" };
    case "applied":
      return { background: "var(--status-applied-bg)", color: "var(--status-applied-fg)" };
    case "interview":
      return { background: "var(--status-interview-bg)", color: "var(--status-interview-fg)" };
    case "offer":
      return { background: "var(--status-offer-bg)", color: "var(--status-offer-fg)" };
    case "rejected":
      return { background: "var(--status-rejected-bg)", color: "var(--status-rejected-fg)" };
    case "archived":
    default:
      return { background: "var(--status-draft-bg)", color: "var(--status-draft-fg)" };
  }
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const applyBoardMove = (
  board: JobBoardResponse,
  jobId: string,
  nextStatus: JobStatus
): JobBoardResponse => {
  let movedItem: JobBoardResponse["groups"][number]["items"][number] | null = null;

  const groupsWithoutOriginal = board.groups.map((group) => {
    const index = group.items.findIndex((item) => item.id === jobId);
    if (index === -1) {
      return group;
    }

    const found = group.items[index];
    movedItem = {
      ...found,
      status: nextStatus,
      updated_at: new Date().toISOString()
    };

    const nextItems = [...group.items.slice(0, index), ...group.items.slice(index + 1)];
    return {
      ...group,
      count: nextItems.length,
      items: nextItems
    };
  });

  if (!movedItem) {
    return board;
  }

  const groupsWithTarget = groupsWithoutOriginal.map((group) => {
    if (group.status !== nextStatus) {
      return group;
    }

    const nextItems = [movedItem!, ...group.items];
    return {
      ...group,
      count: nextItems.length,
      items: nextItems
    };
  });

  const countsByStatus = groupsWithTarget.reduce(
    (acc, group) => {
      acc[group.status] = group.items.length;
      return acc;
    },
    {
      saved: 0,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      archived: 0
    } as JobBoardResponse["counts_by_status"]
  );

  return {
    ...board,
    groups: groupsWithTarget,
    counts_by_status: countsByStatus,
    total: groupsWithTarget.reduce((acc, group) => acc + group.items.length, 0)
  };
};

const updateBoardCoverLetterId = (
  board: JobBoardResponse,
  jobId: string,
  coverLetterId: string
): JobBoardResponse => {
  return {
    ...board,
    groups: board.groups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.id === jobId
          ? {
              ...item,
              cover_letter_id: coverLetterId,
              updated_at: new Date().toISOString()
            }
          : item
      )
    }))
  };
};

const DraggableJobCard = ({
  job,
  disabled,
  actionLoading,
  onOpenDetails,
  onOpenTailoredCv,
  onOpenCoverLetter
}: {
  job: Job;
  disabled: boolean;
  actionLoading: boolean;
  onOpenDetails: (jobId: string) => void;
  onOpenTailoredCv: (job: Job) => void;
  onOpenCoverLetter: (job: Job) => void;
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
      className={`p-3 rounded-lg border cursor-move hover:shadow-sm transition-all ${job.isNew ? "animate-pulse-slow" : ""}`}
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
          <div className="px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "var(--color-teal-600)", color: "white" }}>
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

      <div className="grid grid-cols-1 gap-2 mt-3">
        <button
          type="button"
          disabled={actionLoading}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenTailoredCv(job);
          }}
          className="w-full px-2 py-1.5 rounded-md border text-left"
          style={{
            borderColor: "var(--color-border-tertiary)",
            color: "var(--color-text-primary)",
            fontSize: "11px",
            opacity: actionLoading ? 0.7 : 1
          }}
        >
          <span className="inline-flex items-center gap-1">
            <FileText size={12} />
            {job.tailoredCvId ? "View Tailored CV" : "Create a Customized CV for this job"}
          </span>
        </button>

        <button
          type="button"
          disabled={actionLoading}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenCoverLetter(job);
          }}
          className="w-full px-2 py-1.5 rounded-md border text-left"
          style={{
            borderColor: job.coverLetterId ? "var(--color-teal-200)" : "var(--color-border-tertiary)",
            color: job.coverLetterId ? "var(--color-teal-700)" : "var(--color-text-primary)",
            background: job.coverLetterId ? "var(--color-teal-50)" : "transparent",
            fontSize: "11px",
            opacity: actionLoading ? 0.7 : 1
          }}
        >
          <span className="inline-flex items-center gap-1">
            {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
            {job.coverLetterId ? "View Cover Letter" : "Create Cover Letter"}
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between mt-3">
        <span
          className="px-2 py-0.5 rounded-full text-xs"
          style={
            job.isNew
              ? { background: "var(--color-teal-600)", color: "var(--color-teal-50)" }
              : statusBadgeStyle(job.status)
          }
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
  actionLoadingJobId,
  onOpenDetails,
  onOpenTailoredCv,
  onOpenCoverLetter
}: {
  columnId: JobStatus;
  jobs: Job[];
  moveJob: (jobId: string, newStatus: JobStatus) => void;
  disabled: boolean;
  actionLoadingJobId: string | null;
  onOpenDetails: (jobId: string) => void;
  onOpenTailoredCv: (job: Job) => void;
  onOpenCoverLetter: (job: Job) => void;
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
          disabled={disabled}
          actionLoading={actionLoadingJobId === job.id}
          onOpenDetails={onOpenDetails}
          onOpenTailoredCv={onOpenTailoredCv}
          onOpenCoverLetter={onOpenCoverLetter}
        />
      ))}

      {jobs.length === 0 && (
        <div className="p-4 rounded-lg border-2 border-dashed text-center" style={{ borderColor: "var(--color-border-tertiary)" }}>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{isOver ? "Drop here" : "No applications"}</p>
        </div>
      )}
    </div>
  );
};

export function JobTracker() {
  const { setSidebarVisible } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { api } = useAuth();

  const [showInstructions, setShowInstructions] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [board, setBoard] = useState<JobBoardResponse | null>(null);
  const [pendingStatusByJob, setPendingStatusByJob] = useState<Record<string, JobStatus>>({});
  const [autoSavingStatuses, setAutoSavingStatuses] = useState(false);
  const [lastStatusSavedAt, setLastStatusSavedAt] = useState<string | null>(null);

  const [actionLoadingJobId, setActionLoadingJobId] = useState<string | null>(null);

  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [jobHistory, setJobHistory] = useState<JobHistoryResponse | null>(null);

  const columns = [
    { id: "saved", label: "Saved", color: "var(--status-saved-bg)" },
    { id: "applied", label: "Applied", color: "var(--status-applied-bg)" },
    { id: "interview", label: "Interview", color: "var(--status-interview-bg)" },
    { id: "offer", label: "Offer", color: "var(--status-offer-bg)" },
    { id: "rejected", label: "Rejected", color: "var(--status-rejected-bg)" }
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
        date: formatDate(job.updated_at),
        tailoredCvId: job.tailored_cv_id,
        coverLetterId: job.cover_letter_id
      }))
    );
  }, [board]);

  const loadBoard = async () => {
    setLoading(true);
    setError(null);

    try {
      const boardData = await api.getJobsBoard();
      setBoard(boardData);
      setPendingStatusByJob({});
      setLastStatusSavedAt(new Date().toISOString());
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

  const flushPendingStatuses = async () => {
    if (autoSavingStatuses) {
      return;
    }

    const queuedEntries = Object.entries(pendingStatusByJob);
    if (queuedEntries.length === 0) {
      return;
    }

    setAutoSavingStatuses(true);
    setPendingStatusByJob({});

    const failed: Record<string, JobStatus> = {};

    for (const [jobId, status] of queuedEntries) {
      try {
        await api.patchJobStatus(jobId, status);
      } catch {
        failed[jobId] = status;
      }
    }

    if (Object.keys(failed).length > 0) {
      setPendingStatusByJob((prev) => ({ ...failed, ...prev }));
      setError("Some status updates failed. Retrying in background.");
    } else {
      setLastStatusSavedAt(new Date().toISOString());
    }

    setAutoSavingStatuses(false);
  };

  useEffect(() => {
    if (loading || autoSavingStatuses || Object.keys(pendingStatusByJob).length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void flushPendingStatuses();
    }, 900);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoSavingStatuses, loading, pendingStatusByJob]);

  const moveJob = (jobId: string, newStatus: JobStatus) => {
    setError(null);

    setBoard((prev) => {
      if (!prev) {
        return prev;
      }

      return applyBoardMove(prev, jobId, newStatus);
    });

    setPendingStatusByJob((prev) => ({
      ...prev,
      [jobId]: newStatus
    }));
  };

  const openJobDetails = async (jobId: string) => {
    setShowDetailDialog(true);
    setDetailLoading(true);
    setError(null);
    setJobDetail(null);
    setJobHistory(null);

    try {
      const [detail, history] = await Promise.all([api.getJob(jobId), api.getJobHistory(jobId)]);
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

  const openTailoredCv = async (job: Job) => {
    if (job.tailoredCvId) {
      navigate(`/app/cv/${job.tailoredCvId}`, {
        state: {
          cvKind: "tailored"
        }
      });
      return;
    }

    setActionLoadingJobId(job.id);
    try {
      const detail = await api.getJob(job.id);
      navigate("/app/tailor/master", {
        state: {
          prefillJob: {
            role: detail.job.job_title,
            company: detail.job.company_name,
            jobDescription: detail.job_description,
            jobPostingUrl: detail.job.job_posting_url ?? "",
            locationText: detail.job.location_text ?? "",
            notes: detail.notes ?? ""
          }
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open tailored CV flow.");
      }
    } finally {
      setActionLoadingJobId(null);
    }
  };

  const openCoverLetter = async (job: Job) => {
    setActionLoadingJobId(job.id);
    setError(null);

    try {
      const detail = await api.upsertCoverLetterByJob(job.id);
      setBoard((prev) => {
        if (!prev) {
          return prev;
        }

        return updateBoardCoverLetterId(prev, job.id, detail.id);
      });

      navigate(`/app/cover-letter/${job.id}`, {
        state: {
          coverLetterId: detail.id
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open cover letter.");
      }
    } finally {
      setActionLoadingJobId(null);
    }
  };

  const saveStatusText = (() => {
    if (autoSavingStatuses) {
      return "Saving status changes...";
    }

    if (Object.keys(pendingStatusByJob).length > 0) {
      return "Unsaved status changes";
    }

    return `Last synced ${formatDateTime(lastStatusSavedAt)}`;
  })();

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
            Total tracked jobs: {board?.total ?? 0}
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
            {saveStatusText}
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
                  disabled={false}
                  actionLoadingJobId={actionLoadingJobId}
                  onOpenDetails={openJobDetails}
                  onOpenTailoredCv={openTailoredCv}
                  onOpenCoverLetter={openCoverLetter}
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
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>Job details</DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Current job record and status history from backend.
              </DialogDescription>
            </DialogHeader>

            {detailLoading ? (
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading details...</p>
            ) : jobDetail ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                  <p style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>{jobDetail.job.job_title}</p>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{jobDetail.job.company_name}</p>
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
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>No history yet.</p>
                    ) : (
                      jobHistory.history.map((entry) => (
                        <div key={entry.id} className="p-2 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                          <p style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>
                            {entry.from_status ? statusToLabel[entry.from_status] : "N/A"} {"->"} {statusToLabel[entry.to_status]}
                          </p>
                          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{formatDate(entry.changed_at)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Job detail is not available.</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DndProvider>
  );
}
