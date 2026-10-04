import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  GripVertical,
  LayoutTemplate,
  Mail,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { CVPresentationPreview } from "../../components/CVPresentationPreview";
import { StartLink } from "./DesignShared";
import {
  DEMO_BULLET,
  DEMO_SUMMARY,
  DEMO_TEMPLATES,
  makeDemoPresentation,
} from "./product-demo-data";

export function Mascot({
  className = "",
  eager = false,
}: {
  className?: string;
  eager?: boolean;
}) {
  return (
    <img
      className={`v2-mascot ${className}`}
      src="/images/designs/mascot/guide.webp"
      width="1024"
      height="1536"
      alt="Our turquoise mascot is here to help"
      loading={eager ? "eager" : "lazy"}
    />
  );
}

function Preview({
  presentation,
  fontScale = 1,
  small = false,
}: {
  presentation: ReturnType<typeof makeDemoPresentation>;
  fontScale?: number;
  small?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(small ? 0.2 : 0.65);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const resize = () => setScale(Math.min(node.clientWidth / 595, 1));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={`pd-preview ${small ? "pd-preview-small" : ""}`}
      ref={container}
      role="img"
      aria-label={`${presentation.theme.template_name} CV preview for Alex Morgan. ${presentation.sections.find((section) => section.type === "experience")?.items[0].bullets[0]}`}
    >
      <div
        className="pd-paper-viewport"
        style={{ height: 842 * scale }}
        aria-hidden="true"
      >
        <div className="pd-paper" style={{ transform: `scale(${scale})` }}>
          <CVPresentationPreview
            presentation={presentation}
            fontScale={fontScale}
            mode="thumbnail"
          />
        </div>
      </div>
    </div>
  );
}

export function DemoDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pd-dialog"
      onClose={onClose}
      aria-labelledby={id}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pd-dialog-top">
        <h3 id={id}>{title}</h3>
        <button onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export type DemoAction = "keywords" | "edit" | "template" | "export" | "reset";

export function ProductDemo({
  compactGuide = false,
  guidedStep,
  onStepChange,
  onAction,
  onExplorePlans,
  onModalChange,
  hideCompanionCaption = false,
}: {
  compactGuide?: boolean;
  guidedStep?: number;
  onStepChange?: (step: number) => void;
  onAction?: (action: DemoAction) => void;
  onExplorePlans?: () => void;
  onModalChange?: (open: boolean) => void;
  hideCompanionCaption?: boolean;
}) {
  const [localStep, setLocalStep] = useState(1);
  const step = guidedStep ?? localStep;
  const setStep = (next: number) => {
    setLocalStep(next);
    onStepChange?.(next);
  };
  const [summary, setSummary] = useState(DEMO_SUMMARY);
  const [bullet, setBullet] = useState(DEMO_BULLET);
  const [template, setTemplate] = useState(0);
  const [fontScale, setFontScale] = useState(1);
  const [showSummary, setShowSummary] = useState(true);
  const [skills, setSkills] = useState([
    "Excel",
    "Sales analysis",
    "Weekly reporting",
  ]);
  const [mobileView, setMobileView] = useState("edit");
  useEffect(() => {
    if (guidedStep !== undefined) {
      setMobileView("edit");
      setLocalStep(guidedStep);
    }
  }, [guidedStep]);
  const [modal, setModal] = useState<"suggestion" | "export" | null>(null);
  useEffect(() => {
    onModalChange?.(modal !== null);
  }, [modal, onModalChange]);
  const [format, setFormat] = useState("PDF");
  const [notice, setNotice] = useState("");
  const fieldId = useId();
  const presentation = makeDemoPresentation({
    template,
    summary,
    bullet,
    skills,
    showSummary,
  });
  const suggestion =
    "Data analyst experienced in weekly Excel reporting and sales analysis. Organizes sales data, highlights performance trends, and communicates findings to the team.";
  const guide = [
    "Choose the keywords that match your experience.",
    "Try editing a line. Your CV updates beside you.",
    "Try a template. Find the presentation that fits.",
  ][step];
  const toggleSkill = (skill: string) =>
    setSkills((current) =>
      current.includes(skill)
        ? current.filter((item) => item !== skill)
        : [...current, skill],
    );
  const reset = () => {
    setStep(1);
    setSummary(DEMO_SUMMARY);
    setBullet(DEMO_BULLET);
    setTemplate(0);
    setFontScale(1);
    setShowSummary(true);
    setSkills(["Excel", "Sales analysis", "Weekly reporting"]);
    setMobileView("edit");
    setFormat("PDF");
    setModal(null);
    setNotice("Sample reset.");
    onAction?.("reset");
  };
  const applySample = () => {
    setBullet(
      skills.includes("Sales analysis")
        ? `Prepared ${skills.includes("Weekly reporting") ? "weekly " : ""}${skills.includes("Excel") ? "Excel " : ""}reports to track sales performance and highlight trends.`
        : `Created ${skills.includes("Weekly reporting") ? "weekly " : ""}${skills.includes("Excel") ? "Excel " : ""}reports using sales data.`,
    );
    onAction?.("keywords");
    setStep(1);
    setNotice("Your sample choices are reflected in the CV.");
  };
  return (
    <div
      className={`v2-product-tour ${compactGuide ? "v2-tour-compact" : ""} ${guidedStep !== undefined ? "pd-guided" : ""}`}
      data-guide-step={guidedStep}
    >
      <div
        className="v2-tour-tabs"
        role="group"
        aria-label="Product tour steps"
      >
        {["Add the job", "Review & edit", "Style & export"].map(
          (label, index) => (
            <button
              key={label}
              aria-pressed={step === index}
              onClick={() => {
                setStep(index);
                setMobileView("edit");
              }}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ),
        )}
      </div>
      <div className="pd-window">
        <div className="pd-window-bar">
          <div className="pd-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>
            jobspecificCV <span>/ Interactive sample</span>
          </span>
          <button onClick={reset} aria-label="Reset product demo">
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
        <div className="pd-app-shell">
          <aside className="pd-sidebar" aria-label="Sample application sidebar">
            <div className="pd-app-brand">
              <img src="/images/logo.png" width="24" height="24" alt="" />
              <span>jobspecificCV</span>
            </div>
            <div className="pd-sidebar-items">
              {[
                { icon: FileText, name: "Dashboard" },
                { icon: FileCheck2, name: "My CVs" },
                { icon: BriefcaseBusiness, name: "Applications" },
                { icon: Mail, name: "Cover Letters" },
              ].map(({ icon: Icon, name }) => (
                <span
                  key={name}
                  className={name === "My CVs" ? "is-active" : ""}
                >
                  <Icon size={15} />
                  {name}
                </span>
              ))}
            </div>
            <div className="pd-sidebar-profile">
              <span>AM</span>
              <div>
                Alex Morgan<small>Sample applicant</small>
              </div>
            </div>
          </aside>
          <div className="pd-app-main">
            <div className="pd-editor-toolbar">
              <div className="pd-editor-title">
                <ChevronLeft size={18} />
                <div>
                  <strong>
                    Alex Morgan — Data Analyst <span>Customized CV</span>
                  </strong>
                  <small>
                    <Check size={11} />
                    {notice || "Your edits stay in this demo"}
                  </small>
                </div>
              </div>
              <div className="pd-editor-actions">
                <button
                  onClick={() => {
                    setStep(2);
                    setMobileView("edit");
                  }}
                >
                  <LayoutTemplate size={14} />
                  <span>Choose template</span>
                </button>
                <button
                  onClick={() => {
                    setModal("export");
                    onAction?.("export");
                  }}
                >
                  <Download size={14} />
                  Export
                </button>
              </div>
            </div>
            <div
              className="pd-mobile-view"
              role="group"
              aria-label="Demo panel"
            >
              <button
                aria-pressed={mobileView === "edit"}
                onClick={() => setMobileView("edit")}
              >
                Edit
              </button>
              <button
                aria-pressed={mobileView === "preview"}
                onClick={() => setMobileView("preview")}
              >
                Live preview
              </button>
            </div>
            <div className={`pd-editor-columns pd-show-${mobileView}`}>
              <div className="pd-edit-panel">
                {step === 0 ? (
                  <div className="pd-job-step">
                    <div className="pd-section-card">
                      <span className="pd-role-badge">
                        Data Analyst · Example Company
                      </span>
                      <h3>Job details</h3>
                      <label htmlFor={`${fieldId}-job`}>Job description</label>
                      <textarea
                        id={`${fieldId}-job`}
                        readOnly
                        rows={4}
                        value="Prepare weekly reports in Excel, analyze sales performance, and share clear insights with the team. SQL experience is also requested."
                      />
                      <h4>Choose topics and keywords</h4>
                      <div className="pd-keywords">
                        {["Excel", "Sales analysis", "Weekly reporting"].map(
                          (skill) => (
                            <button
                              key={skill}
                              aria-pressed={skills.includes(skill)}
                              onClick={() => toggleSkill(skill)}
                            >
                              {skills.includes(skill) && <Check size={12} />}
                              {skill}
                            </button>
                          ),
                        )}
                        <span>SQL · needs evidence</span>
                      </div>
                      <p className="pd-field-note">
                        <ShieldCheck size={13} />
                        This sample confirms reporting and sales analysis
                        experience.
                      </p>
                      <button
                        className="pd-primary"
                        onClick={applySample}
                        disabled={skills.length === 0}
                      >
                        Apply sample choices <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ) : step === 1 ? (
                  <>
                    <div className="pd-section-card pd-person-card">
                      <div className="pd-section-title">
                        <span>
                          <GripVertical size={13} />
                          Personal details
                        </span>
                        <CheckCircle2 size={14} />
                      </div>
                      <div className="pd-person">
                        <div className="pd-person-avatar">AM</div>
                        <div>
                          <strong>Alex Morgan</strong>
                          <p>Data Analyst</p>
                          <small>alex@example.com · London, UK</small>
                        </div>
                      </div>
                    </div>
                    <div className="pd-section-card">
                      <div className="pd-section-title">
                        <span>
                          <GripVertical size={13} />
                          Professional Summary
                        </span>
                        <div>
                          <button
                            className="pd-ai-button"
                            onClick={() => setModal("suggestion")}
                          >
                            <Sparkles size={12} />
                            <span>Improve with AI</span>
                          </button>
                          <button
                            aria-label={
                              showSummary
                                ? "Hide summary from CV"
                                : "Show summary in CV"
                            }
                            aria-pressed={!showSummary}
                            onClick={() => setShowSummary(!showSummary)}
                          >
                            {showSummary ? (
                              <Eye size={14} />
                            ) : (
                              <EyeOff size={14} />
                            )}
                          </button>
                        </div>
                      </div>
                      {showSummary && (
                        <textarea
                          aria-label="Professional summary"
                          value={summary}
                          rows={3}
                          onChange={(event) => {
                            setSummary(event.target.value);
                            onAction?.("edit");
                            setNotice("Preview updated");
                          }}
                        />
                      )}
                    </div>
                    <div className="pd-section-card">
                      <div className="pd-section-title">
                        <span>
                          <GripVertical size={13} />
                          Work Experience
                        </span>
                        <ChevronDown size={14} />
                      </div>
                      <div className="pd-experience-title">
                        <strong>Reporting Assistant</strong>
                        <span>2023 – Present</span>
                      </div>
                      <p className="pd-employer">
                        Example Company · London, UK
                      </p>
                      <label
                        className="pd-sr-only"
                        htmlFor={`${fieldId}-bullet`}
                      >
                        Experience description
                      </label>
                      <textarea
                        className="pd-highlight-field"
                        id={`${fieldId}-bullet`}
                        rows={3}
                        value={bullet}
                        onChange={(event) => {
                          setBullet(event.target.value);
                          onAction?.("edit");
                          setNotice("Preview updated");
                        }}
                      />
                      <div className="pd-inline-hint">
                        <Sparkles size={12} />
                        Tailored to your selected keywords
                      </div>
                    </div>
                    <details className="pd-section-card pd-skills-card">
                      <summary>
                        <span>
                          <GripVertical size={13} />
                          Skills
                        </span>
                        <ChevronDown size={14} />
                      </summary>
                      <div className="pd-keywords">
                        {[
                          "Excel",
                          "Sales analysis",
                          "Weekly reporting",
                          "Communication",
                        ].map((skill) => (
                          <button
                            key={skill}
                            aria-pressed={skills.includes(skill)}
                            onClick={() => toggleSkill(skill)}
                          >
                            {skills.includes(skill) && <Check size={12} />}
                            {skill}
                          </button>
                        ))}
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="pd-style-step">
                    <div className="pd-style-heading">
                      <h3>Choose your template</h3>
                      <p>Same experience. A different presentation.</p>
                    </div>
                    <div className="pd-template-options">
                      {DEMO_TEMPLATES.map((item, index) => (
                        <button
                          key={item.template_slug}
                          onClick={() => {
                            setTemplate(index);
                            onAction?.("template");
                          }}
                          aria-pressed={template === index}
                        >
                          <Preview
                            small
                            presentation={makeDemoPresentation({
                              template: index,
                              summary: DEMO_SUMMARY,
                              bullet: DEMO_BULLET,
                              skills,
                            })}
                          />
                          <span>
                            {item.template_name}
                            {template === index && <CheckCircle2 size={14} />}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="pd-section-card pd-font-control">
                      <label htmlFor={`${fieldId}-font`}>
                        <Settings2 size={15} />
                        Font size <span>{fontScale.toFixed(2)}×</span>
                      </label>
                      <input
                        id={`${fieldId}-font`}
                        type="range"
                        min="0.8"
                        max="1.1"
                        step="0.05"
                        value={fontScale}
                        onChange={(event) =>
                          setFontScale(Number(event.target.value))
                        }
                      />
                    </div>
                    <button
                      className="pd-primary"
                      onClick={() => {
                        setModal("export");
                        onAction?.("export");
                      }}
                    >
                      <Download size={14} />
                      Export your CV
                    </button>
                  </div>
                )}
              </div>
              <div className="pd-preview-panel">
                <div className="pd-preview-label">
                  <span>
                    PREVIEW · {DEMO_TEMPLATES[template].template_name}
                  </span>
                  <span>Sample CV</span>
                </div>
                <Preview presentation={presentation} fontScale={fontScale} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {guidedStep === undefined && !hideCompanionCaption && (
        <div className="v2-demo-guide">
          <img src="/images/logo.png" width="43" height="43" alt="" />
          <p aria-live="polite">{guide}</p>
          <span>Fictional sample · No account needed</span>
        </div>
      )}
      {modal === "suggestion" && (
        <DemoDialog title="Sample AI suggestion" onClose={() => setModal(null)}>
          <span className="pd-dialog-label">PROFESSIONAL SUMMARY</span>
          <div className="pd-suggestion-before">
            <small>CURRENT</small>
            <p>{summary}</p>
          </div>
          <div className="pd-suggestion-after">
            <small>SUGGESTED</small>
            <p>{suggestion}</p>
          </div>
          <p className="pd-dialog-note">
            <ShieldCheck size={15} />
            Review the facts before applying a suggestion.
          </p>
          <button
            className="pd-primary"
            onClick={() => {
              setSummary(suggestion);
              onAction?.("edit");
              setNotice("Sample suggestion applied");
              setModal(null);
            }}
          >
            Apply this suggestion <Check size={15} />
          </button>
        </DemoDialog>
      )}
      {modal === "export" && (
        <DemoDialog title="Export CV" onClose={() => setModal(null)}>
          <p className="pd-export-intro">
            Choose a format for your finished CV.
          </p>
          <div className="pd-export-options">
            {["PDF", "DOCX"].map((item) => (
              <button
                key={item}
                aria-pressed={format === item}
                onClick={() => setFormat(item)}
              >
                <FileText size={23} />
                <strong>{item}</strong>
                <small>
                  {item === "PDF" ? "Ready to send" : "Keep editing in Word"}
                </small>
                {format === item && <CheckCircle2 size={17} />}
              </button>
            ))}
          </div>
          <p className="pd-dialog-note">
            This is a sample. Create a free account to tailor and export your
            own CV.
          </p>
          <StartLink className="pd-primary">
            Create your free account <ArrowRight size={15} />
          </StartLink>
          {onExplorePlans && (
            <button
              className="gj-dialog-link"
              onClick={() => {
                setModal(null);
                onExplorePlans();
              }}
            >
              Let my guide explain the plans <ArrowRight size={15} />
            </button>
          )}
        </DemoDialog>
      )}
    </div>
  );
}
