import { MoreVertical, Plus, Info, X, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TutorialGuide } from "../components/TutorialGuide";

interface Job {
  id: number;
  title: string;
  company: string;
  status: string;
  cvName: string;
  score: number;
  date: string;
  isNew?: boolean;
}

const DraggableJobCard = ({ job, moveJob }: { job: Job; moveJob: (jobId: number, newStatus: string) => void }) => {
  const [{ isDragging }, drag] = useDrag({
    type: "JOB",
    item: { id: job.id, status: job.status },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  return (
    <div
      ref={drag}
      className={`p-3 rounded-lg border cursor-move hover:shadow-sm transition-all ${job.isNew ? 'animate-pulse-slow' : ''}`}
      style={{
        background: job.isNew ? "var(--color-teal-50)" : "var(--color-background-primary)",
        borderColor: job.isNew ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
        borderWidth: job.isNew ? "2px" : "1px",
        opacity: isDragging ? 0.5 : 1,
        boxShadow: job.isNew ? "0 4px 12px rgba(20, 184, 166, 0.15)" : "none",
      }}
    >
      {/* NEW Badge */}
      {job.isNew && (
        <div className="flex items-center gap-1 mb-2">
          <div
            className="px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{
              background: "var(--color-teal-600)",
              color: "white",
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
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {job.company}
          </p>
        </div>
        <button style={{ color: "var(--color-text-secondary)" }}>
          <MoreVertical size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span
          className="px-2 py-0.5 rounded-full text-xs"
          style={{
            background: job.isNew ? "var(--color-teal-600)" : "var(--color-teal-50)",
            color: job.isNew ? "white" : "var(--color-teal-800)",
          }}
        >
          {job.score}% match
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          {job.date}
        </span>
      </div>
    </div>
  );
};

const DroppableColumn = ({
  columnId,
  jobs,
  moveJob
}: {
  columnId: string;
  jobs: Job[];
  moveJob: (jobId: number, newStatus: string) => void;
}) => {
  const [{ isOver }, drop] = useDrop({
    accept: "JOB",
    drop: (item: { id: number; status: string }) => {
      if (item.status !== columnId) {
        moveJob(item.id, columnId);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  return (
    <div
      ref={drop}
      className="space-y-2 min-h-[200px] p-2 rounded-lg transition-colors"
      style={{
        background: isOver ? "var(--color-teal-50)" : "transparent",
        border: isOver ? "2px dashed var(--color-teal-400)" : "2px dashed transparent",
      }}
    >
      {jobs.map((job) => (
        <DraggableJobCard key={job.id} job={job} moveJob={moveJob} />
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
  const navigate = useNavigate();
  const [showInstructions, setShowInstructions] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const columns = [
    { id: "saved", label: "Saved", color: "#E6F1FB" },
    { id: "applied", label: "Applied", color: "#E1F5EE" },
    { id: "interview", label: "Interview", color: "#EAF3DE" },
    { id: "offer", label: "Offer", color: "#FAEEDA" },
    { id: "rejected", label: "Rejected", color: "#FCEBEB" },
  ];

  const initialJobs: Job[] = [
    {
      id: 1,
      title: "Senior Product Designer",
      company: "Acme Corp",
      status: "interview",
      cvName: "Tailored CV - Acme",
      score: 94,
      date: "Mar 28, 2026",
    },
    {
      id: 2,
      title: "UX Lead",
      company: "TechStart",
      status: "applied",
      cvName: "Tailored CV - TechStart",
      score: 88,
      date: "Mar 25, 2026",
    },
    {
      id: 3,
      title: "Product Designer",
      company: "Design Co",
      status: "saved",
      cvName: "Tailored CV - Design Co",
      score: 91,
      date: "Mar 24, 2026",
    },
  ];

  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  // Show sidebar when on this page
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  // Check if a new job was added via navigation
  useEffect(() => {
    if (location.state?.newJob) {
      const newJob: Job = {
        id: Date.now(),
        title: location.state.newJob.title,
        company: location.state.newJob.company,
        status: "saved",
        cvName: location.state.newJob.cvName,
        score: location.state.newJob.score,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        isNew: true,
      };
      setJobs((prevJobs) => [...prevJobs, newJob]);
      setShowInstructions(true);

      // Remove isNew flag after 10 seconds
      setTimeout(() => {
        setJobs((prevJobs) =>
          prevJobs.map((job) =>
            job.id === newJob.id ? { ...job, isNew: false } : job
          )
        );
      }, 10000);

      // Show tutorial guide after 2 seconds
      setTimeout(() => {
        setShowInstructions(false);
        setShowTutorial(true);
      }, 2000);

      // Clear the state
      window.history.replaceState({}, document.title);
    }
  }, [location.state, navigate]);

  const moveJob = (jobId: number, newStatus: string) => {
    setJobs((prevJobs) =>
      prevJobs.map((job) =>
        job.id === jobId ? { ...job, status: newStatus, isNew: false } : job
      )
    );
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="p-8">
        {/* Instructions Banner */}
        {showInstructions && (
          <div
            className="mb-6 p-4 rounded-lg border flex items-start gap-3"
            style={{
              background: "var(--color-teal-50)",
              borderColor: "var(--color-teal-200)",
            }}
          >
            <Info size={20} style={{ color: "var(--color-teal-600)", flexShrink: 0, marginTop: "2px" }} />
            <div className="flex-1">
              <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-teal-800)" }}>
                Job added to Saved!
              </h4>
              <p style={{ fontSize: "13px", color: "var(--color-teal-800)", lineHeight: "1.5" }}>
                Your tailored CV has been created. Next, let's create a cover letter for this position!
              </p>
            </div>
            <button
              onClick={() => setShowInstructions(false)}
              style={{ color: "var(--color-teal-600)" }}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Header */}
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
              }}
            >
              <Plus size={16} />
              Add application
            </button>
          </div>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            Track your job applications and their status. Drag and drop cards between columns to update status.
          </p>
        </div>

        {/* Kanban Board */}
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
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {jobs.filter((j) => j.status === column.id).length}
                </span>
              </div>

              <DroppableColumn
                columnId={column.id}
                jobs={jobs.filter((job) => job.status === column.id)}
                moveJob={moveJob}
              />
            </div>
          ))}
        </div>

        {/* Tutorial Guide */}
        <TutorialGuide
          show={showTutorial}
          onClose={() => setShowTutorial(false)}
          targetElement="a[href='/app/cover-letters']"
          message="Click here to create a cover letter for your new job application!"
          position="right"
        />
      </div>
    </DndProvider>
  );
}