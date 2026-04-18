import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { ChevronLeft, Save, Download, Target, Sparkles, Plus, Lightbulb, FileText, Link2, Copy, Check, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AddContentModal } from "../components/AddContentModal";
import { TipsDrawer } from "../components/TipsDrawer";
import { useSidebar } from "../contexts/SidebarContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { BorderBeam } from "../components/ui/border-beam";
import {
  HeaderSection,
  SummarySection,
  ExperienceSection,
  EducationSection,
  SkillsSection,
  LanguageSection,
  GenericSection,
  CertificatesSection,
  CoursesSection,
  ProjectsSection,
  AwardsSection,
  PublicationsSection,
  ReferencesSection,
  VolunteerSection,
} from "../components/CVSections";

interface SectionVersion {
  id: string;
  data: any;
  timestamp: number;
  source: "user" | "ai" | "original";
}

interface Section {
  id: string;
  type: string;
  data: any;
  hidden: boolean;
  versions?: SectionVersion[];
  currentVersionIndex?: number;
}

const DraggableSection = ({ section, index, moveSection, children }: any) => {
  const ref = useRef<HTMLDivElement>(null);
  
  const [{ isDragging }, drag] = useDrag({
    type: "SECTION",
    item: { index, id: section.id },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: "SECTION",
    hover: (draggedItem: { index: number; id: string }, monitor) => {
      if (!ref.current) {
        return;
      }
      
      const dragIndex = draggedItem.index;
      const hoverIndex = index;

      // Don't replace items with themselves
      if (dragIndex === hoverIndex) {
        return;
      }

      // Determine rectangle on screen
      const hoverBoundingRect = ref.current?.getBoundingClientRect();

      // Get vertical middle
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;

      // Determine mouse position
      const clientOffset = monitor.getClientOffset();

      // Get pixels to the top
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top;

      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%

      // Dragging downwards
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }

      // Dragging upwards
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      // Time to actually perform the action
      moveSection(dragIndex, hoverIndex);

      // Note: we're mutating the monitor item here!
      // Generally it's better to avoid mutations,
      // but it's good here for the sake of performance
      // to avoid expensive index searches.
      draggedItem.index = hoverIndex;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  // Connect both drag and drop to the ref
  drag(drop(ref));

  return (
    <div
      ref={ref}
      className="transition-all duration-200"
      style={{
        opacity: isDragging ? 0.4 : 1,
        transform: isDragging ? "scale(0.98)" : "scale(1)",
        boxShadow: isOver ? "0 0 0 2px var(--color-teal-200)" : "none",
        borderRadius: "12px",
        cursor: isDragging ? "grabbing" : "grab",
      }}
    >
      {children}
    </div>
  );
};

export function CVEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { setSidebarVisible, sidebarVisible } = useSidebar();
  const isMaster = id === "master";
  const isTailored = location.state?.isTailored || false;
  const jobData = location.state?.jobData || null;
  const [showAIPopup, setShowAIPopup] = useState(false);
  const [showAddContentModal, setShowAddContentModal] = useState(false);
  const [showTipsDrawer, setShowTipsDrawer] = useState(false);
  const [currentTipsSection, setCurrentTipsSection] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [webCVUrl, setWebCVUrl] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | "web" | null>(null);
  const [exportComplete, setExportComplete] = useState(false);

  // Initialize with only header section or uploaded data
  const getInitialSections = (): Section[] => {
    // Check if we have uploaded CV data
    const uploadedData = location.state?.parsedData;
    const isUploaded = location.state?.isUploaded;
    
    if (isUploaded && uploadedData) {
      const initialSections: Section[] = [
        {
          id: "header",
          type: "header",
          data: {
            name: uploadedData.name || "",
            title: uploadedData.title || "",
            email: uploadedData.email || "",
            phone: uploadedData.phone || "",
            location: uploadedData.location || "",
          },
          hidden: false,
          versions: [{
            id: "v1",
            data: {
              name: uploadedData.name || "",
              title: uploadedData.title || "",
              email: uploadedData.email || "",
              phone: uploadedData.phone || "",
              location: uploadedData.location || "",
            },
            timestamp: Date.now(),
            source: "original",
          }],
          currentVersionIndex: 0,
        },
      ];

      // Add summary if exists
      if (uploadedData.summary) {
        initialSections.push({
          id: "summary-1",
          type: "summary",
          data: { text: uploadedData.summary },
          hidden: false,
          versions: [{
            id: "v1",
            data: { text: uploadedData.summary },
            timestamp: Date.now(),
            source: "original",
          }],
          currentVersionIndex: 0,
        });
      }

      // Add experience if exists
      if (uploadedData.experience?.length > 0) {
        initialSections.push({
          id: "experience-1",
          type: "experience",
          data: { 
            items: uploadedData.experience.map((exp: any, index: number) => ({
              ...exp,
              id: exp.id || `exp-${Date.now()}-${index}`,
              hidden: false,
            }))
          },
          hidden: false,
          versions: [{
            id: "v1",
            data: { 
              items: uploadedData.experience.map((exp: any, index: number) => ({
                ...exp,
                id: exp.id || `exp-${Date.now()}-${index}`,
                hidden: false,
              }))
            },
            timestamp: Date.now(),
            source: "original",
          }],
          currentVersionIndex: 0,
        });
      }

      // Add education if exists
      if (uploadedData.education?.length > 0) {
        initialSections.push({
          id: "education-1",
          type: "education",
          data: { 
            items: uploadedData.education.map((edu: any, index: number) => ({
              ...edu,
              id: edu.id || `edu-${Date.now()}-${index}`,
              hidden: false,
            }))
          },
          hidden: false,
          versions: [{
            id: "v1",
            data: { 
              items: uploadedData.education.map((edu: any, index: number) => ({
                ...edu,
                id: edu.id || `edu-${Date.now()}-${index}`,
                hidden: false,
              }))
            },
            timestamp: Date.now(),
            source: "original",
          }],
          currentVersionIndex: 0,
        });
      }

      // Add skills if exists
      if (uploadedData.skills?.length > 0) {
        initialSections.push({
          id: "skills-1",
          type: "skills",
          data: { skills: uploadedData.skills },
          hidden: false,
          versions: [{
            id: "v1",
            data: { skills: uploadedData.skills },
            timestamp: Date.now(),
            source: "original",
          }],
          currentVersionIndex: 0,
        });
      }

      return initialSections;
    }

    // Default sections for new CV
    return [
      {
        id: "header",
        type: "header",
        data: {
          name: "Sarah Johnson",
          title: "Senior Product Designer",
          email: "sarah@example.com",
          phone: "+1 (555) 123-4567",
          location: "San Francisco, CA",
        },
        hidden: false,
      },
    ];
  };

  const [sections, setSections] = useState<Section[]>(getInitialSections());

  // Keep sidebar hidden in CV editor
  useEffect(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const addSection = (sectionType: string) => {
    const newSection: Section = {
      id: `${sectionType}-${Date.now()}`,
      type: sectionType,
      data: getSectionDefaultData(sectionType),
      hidden: false,
    };
    setSections([...sections, newSection]);
  };

  const getSectionDefaultData = (type: string) => {
    switch (type) {
      case "summary":
        return { text: "" };
      case "experience":
        return { items: [] };
      case "education":
        return { items: [] };
      case "skills":
        return { skills: [] };
      default:
        return { items: [] };
    }
  };

  const updateSection = (id: string, data: any) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, data } : s)));
  };

  const toggleSectionVisibility = (id: string) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)));
  };

  const removeSection = (id: string) => {
    setSections(sections.filter((s) => s.id !== id));
  };

  const moveSection = (fromIndex: number, toIndex: number) => {
    const newSections = [...sections];
    const [movedSection] = newSections.splice(fromIndex, 1);
    newSections.splice(toIndex, 0, movedSection);
    setSections(newSections);
  };

  const handleExportOption = (format: "pdf" | "docx" | "web") => {
    setExportingFormat(format);

    if (format === "web") {
      // Simulate generating web CV
      setTimeout(() => {
        const uniqueId = Math.random().toString(36).substring(7);
        const url = `https://mycv.app/${uniqueId}`;
        setWebCVUrl(url);
        setExportingFormat(null);
      }, 1500);
    } else {
      // Simulate PDF/DOCX export download
      setTimeout(() => {
        console.log(`Exporting as ${format}`);
        setExportingFormat(null);
        setExportComplete(true);
      }, 2000);
    }
  };

  const handleNavigateToNext = () => {
    setShowExportDialog(false);
    setExportComplete(false);

    // Navigate based on CV type
    if (isTailored && jobData) {
      // Navigate to job tracker and add to saved jobs
      navigate("/app/job-tracker", {
        state: {
          newJob: {
            title: jobData.role,
            company: jobData.company,
            cvName: `Tailored CV - ${jobData.company}`,
            score: 92,
            isNew: true,
          }
        }
      });
    } else if (isMaster) {
      // Navigate to tailor for job screen after export
      navigate(`/app/tailor/${id}`);
    }
  };

  const copyToClipboard = () => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(webCVUrl)
        .then(() => {
          setCopiedUrl(true);
          setTimeout(() => setCopiedUrl(false), 2000);
        })
        .catch(() => {
          // Fallback to older method
          fallbackCopyToClipboard(webCVUrl);
        });
    } else {
      // Use fallback method
      fallbackCopyToClipboard(webCVUrl);
    }
  };

  const fallbackCopyToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }

    document.body.removeChild(textArea);
  };

  const handleWebCVExportComplete = () => {
    // Don't auto-navigate, just close and reset
    setShowExportDialog(false);
    setWebCVUrl("");
    setExportComplete(false);
  };

  const handleWebCVNavigateToNext = () => {
    setShowExportDialog(false);
    setWebCVUrl("");
    setExportComplete(false);

    // Navigate based on CV type
    if (isTailored && jobData) {
      // Navigate to job tracker and add to saved jobs
      navigate("/app/job-tracker", {
        state: {
          newJob: {
            title: jobData.role,
            company: jobData.company,
            cvName: `Tailored CV - ${jobData.company}`,
            score: 92,
            isNew: true,
          }
        }
      });
    } else if (isMaster) {
      // Navigate to tailor for job screen after web CV export
      navigate(`/app/tailor/${id}`);
    }
  };

  const renderSection = (section: Section, index: number) => {
    const commonProps = {
      data: section.data,
      isHidden: section.hidden,
      onToggleVisibility: () => toggleSectionVisibility(section.id),
      onRemove: () => removeSection(section.id),
      onChange: (data: any) => updateSection(section.id, data),
      onAIAssist: () => setShowAIPopup(true),
    };

    // Header section is not draggable
    if (section.type === "header") {
      return (
        <HeaderSection
          key={section.id}
          data={section.data}
          isHidden={section.hidden}
          onToggleVisibility={() => toggleSectionVisibility(section.id)}
          onChange={(data: any) => updateSection(section.id, data)}
        />
      );
    }

    const content = (() => {
      switch (section.type) {
        case "summary":
          return <SummarySection {...commonProps} />;
        case "experience":
          return <ExperienceSection {...commonProps} />;
        case "education":
          return <EducationSection {...commonProps} />;
        case "skills":
          return <SkillsSection {...commonProps} />;
        case "languages":
          return <LanguageSection {...commonProps} />;
        case "certifications":
          return <CertificatesSection {...commonProps} />;
        case "courses":
          return <CoursesSection {...commonProps} />;
        case "projects":
          return <ProjectsSection {...commonProps} />;
        case "volunteer":
          return <VolunteerSection {...commonProps} />;
        case "awards":
          return <AwardsSection {...commonProps} />;
        case "publications":
          return <PublicationsSection {...commonProps} />;
        case "references":
          return <ReferencesSection {...commonProps} />;
        default:
          return null;
      }
    })();

    return (
      <DraggableSection key={section.id} section={section} index={index} moveSection={moveSection}>
        {content}
      </DraggableSection>
    );
  };

  const visibleSections = sections.filter((s) => !s.hidden);
  const headerSection = sections.find((s) => s.type === "header");

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-screen flex flex-col">
        {/* Top Bar */}
        <div className="border-b px-6 py-3" style={{ borderColor: "var(--color-border-tertiary)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate("/app")} style={{ color: "var(--color-text-secondary)" }}>
                <ChevronLeft size={20} />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                    My Master CV
                  </h2>
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      background: "var(--color-teal-50)",
                      color: "var(--color-teal-800)",
                    }}
                  >
                    {isMaster ? "Master CV" : "Tailored CV"}
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Last saved 2 minutes ago</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                }}
              >
                <Save size={14} />
                Saved
              </button>
              {isMaster && (
                <button
                  onClick={() => navigate(`/app/tailor/${id}`)}
                  className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2 border"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "white",
                    borderColor: "var(--color-teal-600)",
                  }}
                >
                  <Target size={14} />
                  Tailor for a job
                </button>
              )}
              <button
                onClick={() => {
                  setCurrentTipsSection("experience");
                  setShowTipsDrawer(true);
                }}
                className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  color: "var(--color-teal-600)",
                  border: "1px solid var(--color-teal-200)",
                  background: "var(--color-teal-50)",
                }}
              >
                <Lightbulb size={14} />
                Tips
              </button>
              <button
                onClick={() => setShowExportDialog(true)}
                className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--color-border-secondary)",
                }}
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left - Editing Panel */}
          <div 
            className="flex-1 overflow-auto p-6 transition-all duration-300" 
            style={{ 
              background: "var(--color-background-secondary)",
            }}
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {sections.map((section, index) => renderSection(section, index))}

              {/* Add Content Button */}
              <button
                onClick={() => setShowAddContentModal(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 hover:shadow-md transition-all"
                style={{
                  borderColor: "var(--color-teal-300)",
                  background: "var(--color-teal-50)",
                  color: "var(--color-teal-700)",
                }}
              >
                <Plus size={16} />
                <span style={{ fontSize: "14px", fontWeight: 500 }}>Add Content</span>
              </button>
            </div>
          </div>

          {/* Right - Preview Panel */}
          <div
            className="hidden lg:flex border-l overflow-auto transition-all duration-300 justify-center items-start"
            style={{ 
              borderColor: "var(--color-border-tertiary)", 
              background: "#F8F9FA",
              flexShrink: 0,
              width: "auto",
              minWidth: "600px",
              padding: "32px"
            }}
          >
            <div>
              <p
                className="uppercase tracking-wider mb-4"
                style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}
              >
                Preview
              </p>
              {/* A4 Page Container - Fixed size for proper proportions */}
              <div
                className="bg-white shadow-lg"
                style={{
                  width: "595px", // A4 width at 72 DPI
                  minHeight: "842px", // A4 height at 72 DPI
                  padding: "48px 40px",
                  fontFamily: "Georgia, serif",
                }}
              >
                {/* CV Preview Content */}
                <div className="max-w-lg mx-auto">
                  {/* Header Preview */}
                  {headerSection && !headerSection.hidden && (
                    <>
                      <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
                        {headerSection.data.name || "Your Name"}
                      </h1>
                      <p className="mb-3" style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
                        {headerSection.data.title || "Your Job Title"}
                      </p>
                      <div
                        className="mb-6 pb-4 border-b"
                        style={{
                          fontSize: "12px",
                          color: "var(--color-text-secondary)",
                          borderColor: "var(--color-border-tertiary)",
                        }}
                      >
                        {headerSection.data.email && <div>{headerSection.data.email}</div>}
                        {headerSection.data.phone && <div>{headerSection.data.phone}</div>}
                        {headerSection.data.location && <div>{headerSection.data.location}</div>}
                      </div>
                    </>
                  )}

                  {/* Other Sections Preview */}
                  {visibleSections
                    .filter((s) => s.type !== "header")
                    .map((section) => (
                      <div key={section.id} className="mb-6">
                        {section.type === "summary" && section.data.text && (
                          <>
                            <h2 className="font-medium mb-2" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                              Professional Summary
                            </h2>
                            <p style={{ fontSize: "12px", lineHeight: "1.7", color: "var(--color-text-secondary)" }}>
                              {section.data.text}
                            </p>
                          </>
                        )}

                        {section.type === "experience" && section.data.items?.length > 0 && (
                          <>
                            <h2 className="font-medium mb-3" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                              Work Experience
                            </h2>
                            {section.data.items
                              .filter((item: any) => !item.hidden)
                              .map((item: any, idx: number) => (
                                <div key={idx} className="mb-4">
                                  <div className="flex items-start justify-between mb-1">
                                    <h3 className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                                      {item.role || "Position"}
                                    </h3>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{item.dates}</span>
                                  </div>
                                  <p className="mb-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                                    {item.company}
                                  </p>
                                  {item.description && (
                                    <div style={{ fontSize: "12px", lineHeight: "1.6", color: "var(--color-text-secondary)", whiteSpace: "pre-line" }}>
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </>
                        )}

                        {section.type === "education" && section.data.items?.length > 0 && (
                          <>
                            <h2 className="font-medium mb-3" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                              Education
                            </h2>
                            {section.data.items
                              .filter((item: any) => !item.hidden)
                              .map((item: any, idx: number) => (
                                <div key={idx} className="mb-3">
                                  <div className="flex items-start justify-between mb-1">
                                    <h3 className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                                      {item.degree || "Degree"}
                                    </h3>
                                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{item.dates}</span>
                                  </div>
                                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{item.institution}</p>
                                  {item.description && (
                                    <p style={{ fontSize: "12px", lineHeight: "1.6", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                                      {item.description}
                                    </p>
                                  )}
                                </div>
                              ))}
                          </>
                        )}

                        {section.type === "skills" && section.data.skills?.length > 0 && (
                          <>
                            <h2 className="font-medium mb-2" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                              Skills
                            </h2>
                            <p style={{ fontSize: "12px", lineHeight: "1.7", color: "var(--color-text-secondary)" }}>
                              {section.data.skills.join(", ")}
                            </p>
                          </>
                        )}

                        {/* Generic sections preview */}
                        {["languages", "certifications", "projects", "volunteer", "awards", "publications"].includes(section.type) &&
                          section.data.items?.length > 0 && (
                            <>
                              <h2 className="font-medium mb-3" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                                {section.type.charAt(0).toUpperCase() + section.type.slice(1)}
                              </h2>
                              {section.data.items
                                .filter((item: any) => !item.hidden)
                                .map((item: any, idx: number) => (
                                  <div key={idx} className="mb-3">
                                    <div className="flex items-start justify-between mb-1">
                                      <h3 className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                                        {item.title || "Title"}
                                      </h3>
                                      {item.dates && (
                                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{item.dates}</span>
                                      )}
                                    </div>
                                    {item.subtitle && (
                                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{item.subtitle}</p>
                                    )}
                                    {item.description && (
                                      <p
                                        style={{
                                          fontSize: "12px",
                                          lineHeight: "1.6",
                                          color: "var(--color-text-secondary)",
                                          marginTop: "4px",
                                        }}
                                      >
                                        {item.description}
                                      </p>
                                    )}
                                  </div>
                                ))}
                            </>
                          )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Popup */}
        {showAIPopup && (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4 z-50" onClick={() => setShowAIPopup(false)}>
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-lg" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-medium mb-4" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                Improve with AI
              </h3>
              <div className="space-y-2">
                {["Improve writing", "Make shorter", "Make more impactful", "Add keywords"].map((option) => (
                  <button
                    key={option}
                    className="w-full p-3 rounded-lg border text-left hover:bg-gray-50 transition-colors"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-tertiary)",
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Add Content Modal */}
        <AddContentModal
          isOpen={showAddContentModal}
          onClose={() => setShowAddContentModal(false)}
          onAddSection={addSection}
          existingSections={sections.map((s) => s.type)}
        />

        {/* Tips Drawer */}
        <TipsDrawer
          isOpen={showTipsDrawer}
          onClose={() => setShowTipsDrawer(false)}
          sectionType={currentTipsSection}
        />

        {/* Export Dialog */}
        <Dialog
          open={showExportDialog}
          onOpenChange={(open) => {
            setShowExportDialog(open);
            if (!open) {
              // Reset states when dialog closes
              setExportingFormat(null);
              setExportComplete(false);
              setWebCVUrl("");
              setCopiedUrl(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Export Your CV
              </DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Choose your preferred export format below
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-4">
              {!exportComplete && !webCVUrl && (
                <>
                  {/* PDF Export */}
                  <button
                    onClick={() => handleExportOption("pdf")}
                    disabled={exportingFormat !== null}
                    className="w-full p-4 rounded-lg border-2 hover:border-teal-400 hover:bg-teal-50 transition-all text-left flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: exportingFormat === "pdf" ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                      background: exportingFormat === "pdf" ? "var(--color-teal-50)" : "var(--color-background-primary)",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: "var(--color-teal-50)" }}
                    >
                      {exportingFormat === "pdf" ? (
                        <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-teal-600)" }} />
                      ) : (
                        <FileText size={20} style={{ color: "var(--color-teal-600)" }} />
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                        {exportingFormat === "pdf" ? "Generating PDF..." : "PDF Document"}
                      </h4>
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        Standard format for applications
                      </p>
                    </div>
                  </button>

                  {/* DOCX Export */}
                  <button
                    onClick={() => handleExportOption("docx")}
                    disabled={exportingFormat !== null}
                    className="w-full p-4 rounded-lg border-2 hover:border-teal-400 hover:bg-teal-50 transition-all text-left flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: exportingFormat === "docx" ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                      background: exportingFormat === "docx" ? "var(--color-teal-50)" : "var(--color-background-primary)",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: "var(--color-teal-50)" }}
                    >
                      {exportingFormat === "docx" ? (
                        <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-teal-600)" }} />
                      ) : (
                        <FileText size={20} style={{ color: "var(--color-teal-600)" }} />
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                        {exportingFormat === "docx" ? "Generating DOCX..." : "Word Document (.docx)"}
                      </h4>
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        Editable format for further customization
                      </p>
                    </div>
                  </button>

                  {/* Web CV Export */}
                  <button
                    onClick={() => handleExportOption("web")}
                    disabled={exportingFormat !== null}
                    className="w-full p-4 rounded-lg border-2 hover:border-teal-400 hover:bg-teal-50 transition-all text-left flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: exportingFormat === "web" ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                      background: exportingFormat === "web" ? "var(--color-teal-50)" : "var(--color-background-primary)",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: "var(--color-teal-50)" }}
                    >
                      {exportingFormat === "web" ? (
                        <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-teal-600)" }} />
                      ) : (
                        <Link2 size={20} style={{ color: "var(--color-teal-600)" }} />
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                        {exportingFormat === "web" ? "Generating Web CV..." : "Web CV with Link & QR"}
                      </h4>
                      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                        Share online with a link and QR code
                      </p>
                    </div>
                  </button>
                </>
              )}

              {/* Success State with CTA */}
              {exportComplete && (
                <div className="space-y-4">
                  <div
                    className="p-6 rounded-lg border text-center"
                    style={{
                      borderColor: "var(--color-teal-200)",
                      background: "var(--color-teal-50)",
                    }}
                  >
                    <div className="flex justify-center mb-3">
                      <div
                        className="w-16 h-16 rounded-full flex items-center justify-center"
                        style={{ background: "var(--color-teal-600)" }}
                      >
                        <CheckCircle2 size={32} style={{ color: "white" }} />
                      </div>
                    </div>
                    <h4 className="font-medium mb-2" style={{ fontSize: "16px", color: "var(--color-teal-800)" }}>
                      CV Downloaded Successfully!
                    </h4>
                    <p style={{ fontSize: "13px", color: "var(--color-teal-700)", lineHeight: "1.5" }}>
                      Your CV has been saved to your downloads folder
                    </p>
                  </div>

                  {/* Compelling CTA based on CV type */}
                  {isTailored && jobData ? (
                    <BorderBeam
                      onClick={handleNavigateToNext}
                      className="w-full"
                      duration={3}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="text-left">
                          <div className="font-semibold mb-1">Track Your Application</div>
                          <div style={{ fontSize: "12px", opacity: 0.9 }}>
                            Add {jobData.company} to your job tracker
                          </div>
                        </div>
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </div>
                    </BorderBeam>
                  ) : (
                    <BorderBeam
                      onClick={handleNavigateToNext}
                      className="w-full"
                      duration={3}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="text-left">
                          <div className="font-semibold mb-1">Ready for Your Next Application?</div>
                          <div style={{ fontSize: "12px", opacity: 0.9 }}>
                            Tailor this CV for a specific job
                          </div>
                        </div>
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </div>
                    </BorderBeam>
                  )}
                </div>
              )}

              {/* Web CV Details (shown after generating) */}
              {webCVUrl && (
                <div className="space-y-4">
                  <div
                    className="p-6 rounded-lg border text-center"
                    style={{
                      borderColor: "var(--color-teal-200)",
                      background: "var(--color-teal-50)",
                    }}
                  >
                    <div className="flex justify-center mb-3">
                      <div
                        className="w-16 h-16 rounded-full flex items-center justify-center"
                        style={{ background: "var(--color-teal-600)" }}
                      >
                        <CheckCircle2 size={32} style={{ color: "white" }} />
                      </div>
                    </div>
                    <h4 className="font-medium mb-2" style={{ fontSize: "16px", color: "var(--color-teal-800)" }}>
                      Your Web CV is Ready!
                    </h4>

                    {/* URL with copy button */}
                    <div className="flex items-center gap-2 mb-4">
                      <input
                        type="text"
                        value={webCVUrl}
                        readOnly
                        className="flex-1 px-3 py-2 rounded-lg border text-sm"
                        style={{
                          borderColor: "var(--color-border-secondary)",
                          background: "white",
                          color: "var(--color-text-primary)",
                        }}
                      />
                      <button
                        onClick={copyToClipboard}
                        className="px-3 py-2 rounded-lg font-medium flex items-center gap-2"
                        style={{
                          fontSize: "13px",
                          background: "var(--color-teal-600)",
                          color: "white",
                        }}
                      >
                        {copiedUrl ? <Check size={16} /> : <Copy size={16} />}
                        {copiedUrl ? "Copied!" : "Copy"}
                      </button>
                    </div>

                    {/* QR Code */}
                    <div className="flex flex-col items-center mb-4">
                      <div className="bg-white p-4 rounded-lg">
                        <QRCodeSVG value={webCVUrl} size={160} />
                      </div>
                      <p className="text-center mt-2" style={{ fontSize: "11px", color: "var(--color-teal-800)" }}>
                        Scan this QR code to view your CV
                      </p>
                    </div>
                  </div>

                  {/* Compelling CTA based on CV type */}
                  {isTailored && jobData ? (
                    <BorderBeam
                      onClick={handleWebCVNavigateToNext}
                      className="w-full"
                      duration={3}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="text-left">
                          <div className="font-semibold mb-1">Track Your Application</div>
                          <div style={{ fontSize: "12px", opacity: 0.9 }}>
                            Add {jobData.company} to your job tracker
                          </div>
                        </div>
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </div>
                    </BorderBeam>
                  ) : (
                    <BorderBeam
                      onClick={handleWebCVNavigateToNext}
                      className="w-full"
                      duration={3}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="text-left">
                          <div className="font-semibold mb-1">Ready for Your Next Application?</div>
                          <div style={{ fontSize: "12px", opacity: 0.9 }}>
                            Tailor this CV for a specific job
                          </div>
                        </div>
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </div>
                    </BorderBeam>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DndProvider>
  );
}