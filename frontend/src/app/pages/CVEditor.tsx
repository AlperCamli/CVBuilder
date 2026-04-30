import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import {
  ChevronLeft,
  Save,
  Download,
  Target,
  Sparkles,
  Plus,
  Lightbulb,
  FileText,
  Loader2,
  History,
  RefreshCw
} from "lucide-react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AddContentModal } from "../components/AddContentModal";
import { TipsDrawer } from "../components/TipsDrawer";
import { CVPresentationPreview } from "../components/CVPresentationPreview";
import { useSidebar } from "../contexts/SidebarContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../components/ui/dialog";
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
  VolunteerSection
} from "../components/CVSections";
import { useAuth } from "../integration/auth-context";
import type {
  AiBlockVersionChain,
  CvAiHistoryResponse,
  AiBlockCompareResult,
  AiSuggestionSummary,
  CvAiBlockVersionsResponse,
  CvBlockRevisionSummary,
  ExportSummaryItem,
  MasterCvDetail,
  RenderingPreviewResponse,
  TailoredCvDetail,
  TemplateDetail,
  TemplateSummary
} from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import {
  cvContentToEditorSections,
  editorSectionsToCvContent,
  getSectionFirstBlockId,
  type EditorSection
} from "../integration/cv-mappers";

const formatDateTime = (value: string | null | undefined): string => {
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

const sectionDefaultData = (type: string): Record<string, unknown> => {
  switch (type) {
    case "summary":
      return { text: "" };
    case "experience":
    case "education":
    case "languages":
    case "certifications":
    case "courses":
    case "projects":
    case "volunteer":
    case "awards":
    case "publications":
    case "references":
      return { items: [] };
    case "skills":
      return { skills: [] };
    default:
      return { items: [] };
  }
};

interface CvEditorDraft {
  version: 1;
  cvKind: "master" | "tailored";
  cvId: string;
  title: string;
  language: string;
  templateId: string | null;
  sections: EditorSection[];
  updatedAt: string;
}

const getDraftStorageKey = (cvKind: "master" | "tailored", cvId: string): string =>
  `cv-editor:draft:${cvKind}:${cvId}`;

const readDraft = (cvKind: "master" | "tailored", cvId: string): CvEditorDraft | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getDraftStorageKey(cvKind, cvId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CvEditorDraft;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.cvKind === cvKind &&
      parsed.cvId === cvId &&
      Array.isArray(parsed.sections)
    ) {
      return parsed;
    }
  } catch {
    // ignore malformed drafts
  }

  return null;
};

const writeDraft = (draft: CvEditorDraft): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getDraftStorageKey(draft.cvKind, draft.cvId), JSON.stringify(draft));
};

const clearDraft = (cvKind: "master" | "tailored", cvId: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getDraftStorageKey(cvKind, cvId));
};

const DraggableSection = ({ section, index, moveSection, children }: any) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "SECTION",
    item: { index, id: section.id },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  const [{ isOver }, drop] = useDrop({
    accept: "SECTION",
    hover: (draggedItem: { index: number }, monitor) => {
      if (!ref.current) {
        return;
      }

      const dragIndex = draggedItem.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) {
        return;
      }

      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) {
        return;
      }

      const hoverClientY = clientOffset.y - hoverBoundingRect.top;
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      moveSection(dragIndex, hoverIndex);
      draggedItem.index = hoverIndex;
    },
    collect: (monitor) => ({ isOver: monitor.isOver() })
  });

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
        cursor: isDragging ? "grabbing" : "grab"
      }}
    >
      {children}
    </div>
  );
};

interface SuggestionCard {
  id: string;
  rationale: string;
  status: string;
  suggested_content: Record<string, unknown>;
}

export function CVEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { api } = useAuth();
  const { setSidebarVisible } = useSidebar();

  const routeCvKind = location.state?.cvKind as "master" | "tailored" | undefined;
  const isUploadedFlow = Boolean(location.state?.isUploaded);
  const [cvKind, setCvKind] = useState<"master" | "tailored">("master");
  const [cvId, setCvId] = useState<string | null>(null);
  const [title, setTitle] = useState("CV");
  const [language, setLanguage] = useState("en");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [sections, setSections] = useState<EditorSection[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplateDetail, setSelectedTemplateDetail] = useState<TemplateDetail | null>(null);
  const [renderingPreview, setRenderingPreview] = useState<RenderingPreviewResponse | null>(null);

  const [showAIPopup, setShowAIPopup] = useState(false);
  const [aiTargetSectionId, setAiTargetSectionId] = useState<string | null>(null);
  const [aiTargetBlockId, setAiTargetBlockId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCompareResult, setAiCompareResult] = useState<AiBlockCompareResult | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<SuggestionCard[]>([]);
  const [aiHistory, setAiHistory] = useState<CvAiHistoryResponse | null>(null);
  const [aiBlockVersions, setAiBlockVersions] = useState<Record<string, AiBlockVersionChain>>({});

  const [showAddContentModal, setShowAddContentModal] = useState(false);
  const [showTipsDrawer, setShowTipsDrawer] = useState(false);
  const [currentTipsSection, setCurrentTipsSection] = useState("experience");

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportSummaryItem[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);

  const [showRevisionDialog, setShowRevisionDialog] = useState(false);
  const [revisions, setRevisions] = useState<CvBlockRevisionSummary[]>([]);
  const [revisionCompareText, setRevisionCompareText] = useState<string | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);

  const [tailoredJobData, setTailoredJobData] = useState<{ role: string; company: string } | null>(null);

  useEffect(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const loadTemplates = async () => {
    const list = await api.listTemplates();
    setTemplates(list.templates);
  };

  const hydrateFromMaster = (master: MasterCvDetail) => {
    setCvKind("master");
    setCvId(master.id);
    setTitle(master.title);
    setLanguage(master.language);
    setTemplateId(master.template_id);
    setSections(cvContentToEditorSections(master.current_content));
    setLastSavedAt(master.updated_at);
  };

  const hydrateFromTailored = (tailored: TailoredCvDetail) => {
    setCvKind("tailored");
    setCvId(tailored.id);
    setTitle(tailored.title);
    setLanguage(tailored.language);
    setTemplateId(tailored.template_id);
    setSections(cvContentToEditorSections(tailored.current_content));
    setLastSavedAt(tailored.updated_at);
    setTailoredJobData(
      tailored.job
        ? {
          role: tailored.job.job_title,
          company: tailored.job.company_name
        }
        : null
    );
  };

  const mapAiBlockVersions = (response: CvAiBlockVersionsResponse): Record<string, AiBlockVersionChain> => {
    return response.blocks.reduce<Record<string, AiBlockVersionChain>>((acc, item) => {
      acc[item.block_id] = item;
      return acc;
    }, {});
  };

  const loadAiData = async (targetKind: "master" | "tailored", targetId: string) => {
    try {
      const [history, versions] =
        targetKind === "tailored"
          ? await Promise.all([
            api.getTailoredCvAiHistory(targetId),
            api.getTailoredCvAiBlockVersions(targetId)
          ])
          : await Promise.all([
            api.getMasterCvAiHistory(targetId),
            api.getMasterCvAiBlockVersions(targetId)
          ]);

      setAiHistory(history);
      setAiBlockVersions(mapAiBlockVersions(versions));
    } catch {
      setAiHistory(null);
      setAiBlockVersions({});
    }
  };

  const markDirty = () => {
    setDirty(true);
    setRestoredDraftAt(null);
  };

  const restoreDraftIfAvailable = (nextCvKind: "master" | "tailored", nextCvId: string): boolean => {
    const draft = readDraft(nextCvKind, nextCvId);
    if (!draft) {
      setDirty(false);
      setRestoredDraftAt(null);
      return false;
    }

    setTitle(draft.title);
    setLanguage(draft.language);
    setTemplateId(draft.templateId);
    setSections(draft.sections);
    setDirty(true);
    setRestoredDraftAt(draft.updatedAt);
    return true;
  };

  const restoreDraftIfAllowed = (nextCvKind: "master" | "tailored", nextCvId: string): boolean => {
    if (isUploadedFlow) {
      clearDraft(nextCvKind, nextCvId);
      setDirty(false);
      setRestoredDraftAt(null);
      return false;
    }

    return restoreDraftIfAvailable(nextCvKind, nextCvId);
  };

  const loadCv = async () => {
    setLoading(true);
    setError(null);
    setDirty(false);
    setRestoredDraftAt(null);

    try {
      await loadTemplates();

      if (routeCvKind === "master" || id === "master") {
        let targetMasterId = location.state?.masterCvId as string | undefined;

        if (!targetMasterId && id && id !== "master") {
          targetMasterId = id;
        }

        if (!targetMasterId) {
          const masters = await api.listMasterCvs();
          targetMasterId = masters[0]?.id;
        }

        if (!targetMasterId) {
          const created = await api.createMasterCv({
            title: "My Master CV",
            language: "en"
          });
          hydrateFromMaster(created);
          restoreDraftIfAllowed("master", created.id);
          void loadAiData("master", created.id);
          setLoading(false);
          return;
        }

        const master = await api.getMasterCv(targetMasterId);
        hydrateFromMaster(master);
        restoreDraftIfAllowed("master", master.id);
        void loadAiData("master", master.id);
        setLoading(false);
        return;
      }

      if (!id) {
        throw new Error("CV id is missing.");
      }

      try {
        const tailored = await api.getTailoredCv(id);
        hydrateFromTailored(tailored);
        restoreDraftIfAllowed("tailored", tailored.id);

        try {
          const source = await api.getTailoredCvSource(tailored.id);
          if (source.job) {
            setTailoredJobData({
              role: source.job.job_title,
              company: source.job.company_name
            });
          }
        } catch {
          // keep optional source unresolved
        }
        void loadAiData("tailored", tailored.id);
      } catch (tailoredError) {
        if (tailoredError instanceof ApiClientError && tailoredError.status === 404) {
          const master = await api.getMasterCv(id);
          hydrateFromMaster(master);
          restoreDraftIfAllowed("master", master.id);
          void loadAiData("master", master.id);
        } else {
          throw tailoredError;
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load CV.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCv();
  }, [id, isUploadedFlow, routeCvKind]);

  useEffect(() => {
    if (!cvId) {
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      const content = editorSectionsToCvContent(sections, language);
      void api
        .postRenderingPreview({
          cv_kind: cvKind,
          current_content: content,
          template_id: templateId,
          language
        })
        .then((preview) => {
          if (!cancelled) {
            setRenderingPreview(preview);
          }
        })
        .catch(() => {
          // preview is best effort in edit mode
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [api, cvId, cvKind, language, sections, templateId]);

  useEffect(() => {
    if (!templateId) {
      setSelectedTemplateDetail(null);
      return;
    }

    let cancelled = false;
    void api
      .getTemplate(templateId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedTemplateDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedTemplateDetail(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, templateId]);

  useEffect(() => {
    if (!cvId || !dirty) {
      return;
    }

    writeDraft({
      version: 1,
      cvKind,
      cvId,
      title,
      language,
      templateId,
      sections,
      updatedAt: new Date().toISOString()
    });
  }, [cvId, cvKind, dirty, language, sections, templateId, title]);

  const addSection = (sectionType: string) => {
    setSections((prev) => {
      const maxOrder = prev.filter((section) => section.type !== "header").reduce((max, section) => Math.max(max, section.order), -1);
      return [
        ...prev,
        {
          id: `${sectionType}-${Date.now()}`,
          type: sectionType,
          hidden: false,
          order: maxOrder + 1,
          data: sectionDefaultData(sectionType)
        }
      ];
    });
    markDirty();
  };

  const updateSection = (sectionId: string, data: Record<string, unknown>) => {
    setSections((prev) => prev.map((section) => (section.id === sectionId ? { ...section, data } : section)));
    markDirty();
  };

  const toggleSectionVisibility = (sectionId: string) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId ? { ...section, hidden: !section.hidden } : section
      )
    );
    markDirty();
  };

  const removeSection = (sectionId: string) => {
    setSections((prev) => prev.filter((section) => section.id !== sectionId));
    markDirty();
  };

  const moveSection = (fromIndex: number, toIndex: number) => {
    setSections((prev) => {
      const header = prev.find((section) => section.type === "header");
      const body = prev
        .filter((section) => section.type !== "header")
        .sort((a, b) => a.order - b.order);

      const next = [...body];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      const orderedBody = next.map((section, index) => ({ ...section, order: index }));
      return header ? [header, ...orderedBody] : orderedBody;
    });
    markDirty();
  };

  const persistCv = async (trigger: "manual" | "auto"): Promise<boolean> => {
    if (!cvId) {
      return false;
    }

    const targetCvId = cvId;
    const targetCvKind = cvKind;

    if (trigger === "manual") {
      setSaving(true);
      setError(null);
    } else {
      setAutoSaving(true);
    }

    try {
      const content = editorSectionsToCvContent(sections, language);

      if (targetCvKind === "master") {
        const updated = await api.putMasterCvContent(targetCvId, content);
        setCvKind("master");
        setCvId(updated.id);
        setTitle(updated.title);
        setLanguage(updated.language);
        setTemplateId(updated.template_id);
        setLastSavedAt(updated.updated_at);
      } else {
        const updated = await api.putTailoredCvContent(targetCvId, content);
        setCvKind("tailored");
        setCvId(updated.id);
        setTitle(updated.title);
        setLanguage(updated.language);
        setTemplateId(updated.template_id);
        setLastSavedAt(updated.updated_at);
        setTailoredJobData(
          updated.job
            ? {
              role: updated.job.job_title,
              company: updated.job.company_name
            }
            : null
        );
      }

      clearDraft(targetCvKind, targetCvId);
      setDirty(false);
      setRestoredDraftAt(null);
      return true;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to save CV.");
      }
      return false;
    } finally {
      if (trigger === "manual") {
        setSaving(false);
      } else {
        setAutoSaving(false);
      }
    }
  };

  const saveCv = async () => {
    await persistCv("manual");
  };

  useEffect(() => {
    if (!cvId || !dirty || loading || saving || autoSaving) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistCv("auto");
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoSaving, cvId, cvKind, dirty, language, loading, saving, sections]);

  const assignTemplate = async (nextTemplateId: string | null) => {
    if (!cvId) {
      return;
    }

    setTemplateId(nextTemplateId);

    try {
      if (cvKind === "master") {
        const updated = await api.patchMasterCvTemplate(cvId, nextTemplateId);
        setTemplateId(updated.template_id);
      } else {
        const updated = await api.patchTailoredCvTemplate(cvId, nextTemplateId);
        setTemplateId(updated.template_id);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  };

  const openExportDialog = async () => {
    if (!cvId) {
      setExportError("CV id is missing.");
      setShowExportDialog(true);
      return;
    }

    setExportError(null);

    try {
      const history =
        cvKind === "tailored"
          ? await api.listTailoredCvExports(cvId)
          : await api.listMasterCvExports(cvId);
      setExportHistory(history.exports);
    } catch {
      setExportHistory([]);
    }

    setShowExportDialog(true);
  };

  const handleExport = async (format: "pdf" | "docx") => {
    if (!cvId) {
      setExportError("CV id is missing.");
      return;
    }

    setExportError(null);
    setExportingFormat(format);

    if (dirty) {
      const persisted = await persistCv("manual");
      if (!persisted) {
        setExportError("Failed to save the latest edits before export.");
        setExportingFormat(null);
        return;
      }
    }

    try {
      const detail =
        cvKind === "tailored"
          ? format === "pdf"
            ? await api.createPdfExport(cvId, { template_id: templateId })
            : await api.createDocxExport(cvId, { template_id: templateId })
          : format === "pdf"
            ? await api.createMasterCvPdfExport(cvId, { template_id: templateId })
            : await api.createMasterCvDocxExport(cvId, { template_id: templateId });

      const directUrl = detail.download?.download_url;
      if (directUrl) {
        window.open(directUrl, "_blank", "noopener,noreferrer");
      } else {
        const fallback = await api.getExportDownload(detail.export.id);
        window.open(fallback.download_url, "_blank", "noopener,noreferrer");
      }

      const history =
        cvKind === "tailored"
          ? await api.listTailoredCvExports(cvId)
          : await api.listMasterCvExports(cvId);
      setExportHistory(history.exports);
    } catch (err) {
      if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError("Export failed.");
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const downloadExistingExport = async (exportId: string) => {
    try {
      const download = await api.getExportDownload(exportId);
      window.open(download.download_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError("Download failed.");
      }
    }
  };

  const loadRevisions = async () => {
    if (!cvId || cvKind !== "tailored") {
      setRevisions([]);
      return;
    }

    setRevisionLoading(true);
    setRevisionCompareText(null);

    try {
      const list = await api.listTailoredCvRevisions(cvId);
      setRevisions(list.revisions);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setRevisionLoading(false);
    }
  };

  const openRevisionDialog = async () => {
    setShowRevisionDialog(true);
    await loadRevisions();
  };

  const restoreRevision = async (revisionId: string) => {
    try {
      await api.restoreRevision(revisionId);
      await loadCv();
      await loadRevisions();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  };

  const compareLatestRevisions = async () => {
    if (revisions.length < 2) {
      setRevisionCompareText("At least two revisions are required for comparison.");
      return;
    }

    try {
      const sorted = [...revisions].sort((a, b) => b.revision_number - a.revision_number);
      const compared = await api.compareRevisions(sorted[1].id, sorted[0].id);

      setRevisionCompareText(
        `Changed fields: ${compared.comparison.changed_fields.join(", "
        ) || "none"} | Changed meta: ${compared.comparison.changed_meta.join(", ") || "none"}`
      );
    } catch (err) {
      if (err instanceof Error) {
        setRevisionCompareText(err.message);
      }
    }
  };

  const openAiForSection = async (sectionId: string, blockId?: string) => {
    setAiTargetSectionId(sectionId);
    setAiTargetBlockId(blockId ?? null);
    setAiCompareResult(null);
    setAiSuggestions([]);
    setShowAIPopup(true);

    if (cvId) {
      await loadAiData(cvKind, cvId);
    }
  };

  const resolveAiBlockId = (): string | null => {
    if (aiTargetBlockId) {
      return aiTargetBlockId;
    }

    if (!aiTargetSectionId) {
      return null;
    }

    const target = sections.find((section) => section.id === aiTargetSectionId);
    if (!target) {
      return null;
    }

    return getSectionFirstBlockId(target);
  };

  const runAiAction = async (
    action:
      | "improve"
      | "summarize"
      | "rewrite"
      | "ats_optimize"
      | "shorten"
      | "expand"
      | "options"
      | "compare"
  ) => {
    if (!cvId) {
      setError("CV id is missing.");
      return;
    }

    const blockId = resolveAiBlockId();
    if (!blockId) {
      setError("No block is available for AI action in this section. Save and try again.");
      return;
    }

    setAiLoading(true);
    setAiCompareResult(null);
    setAiSuggestions([]);

    try {
      if (dirty) {
        const persisted = await persistCv("auto");
        if (!persisted) {
          setError("Failed to save current edits before running AI action.");
          return;
        }
      }

      const targetPayload =
        cvKind === "tailored" ? { tailored_cv_id: cvId } : { master_cv_id: cvId };

      if (action === "compare") {
        if (cvKind !== "tailored") {
          setError("Compare to job is available only for tailored CVs.");
          return;
        }

        const compared = await api.postBlockCompare({
          tailored_cv_id: cvId,
          block_id: blockId
        });
        setAiCompareResult(compared);
      } else if (action === "options") {
        const options = await api.postBlockOptions({
          ...targetPayload,
          block_id: blockId,
          option_count: 3
        });

        setAiSuggestions(
          options.suggestions.map((suggestion) => ({
            id: suggestion.id,
            rationale: suggestion.rationale,
            status: suggestion.status,
            suggested_content: suggestion.suggested_content
          }))
        );
      } else {
        const suggested = await api.postBlockSuggest({
          ...targetPayload,
          block_id: blockId,
          action_type: action
        });

        setAiSuggestions(
          suggested.suggestions.map((suggestion) => ({
            id: suggestion.id,
            rationale: suggestion.rationale,
            status: suggestion.status,
            suggested_content: suggestion.suggested_content
          }))
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("AI action failed.");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const applySuggestion = async (suggestionId: string) => {
    try {
      await api.getSuggestion(suggestionId);
      await api.applySuggestion(suggestionId);
      await loadCv();
      if (cvId) {
        await loadAiData(cvKind, cvId);
      }
      setShowAIPopup(false);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  };

  const rejectSuggestion = async (suggestionId: string) => {
    try {
      await api.rejectSuggestion(suggestionId);
      setAiSuggestions((prev) => prev.filter((suggestion) => suggestion.id !== suggestionId));
      if (cvId) {
        await loadAiData(cvKind, cvId);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  };

  const replaceBlockFromSnapshot = (blockId: string, snapshot: Record<string, unknown>): boolean => {
    const currentContent = editorSectionsToCvContent(sections, language);
    const nextSections = currentContent.sections.map((section) => {
      const nextBlocks = section.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        return {
          ...block,
          ...snapshot,
          id: block.id
        };
      });

      return {
        ...section,
        blocks: nextBlocks
      };
    });

    const didReplace = nextSections.some((section) => section.blocks.some((block) => block.id === blockId));
    if (!didReplace) {
      return false;
    }

    setSections(
      cvContentToEditorSections({
        ...currentContent,
        sections: nextSections
      })
    );
    markDirty();
    return true;
  };

  const changeAiBlockVersion = (blockId: string, direction: -1 | 1) => {
    const chain = aiBlockVersions[blockId];
    if (!chain || chain.versions.length <= 1) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(chain.current_version_index + direction, chain.versions.length - 1));
    if (nextIndex === chain.current_version_index) {
      return;
    }

    const nextVersion = chain.versions[nextIndex];
    const replaced = replaceBlockFromSnapshot(blockId, nextVersion.content_snapshot);
    if (!replaced) {
      return;
    }

    setAiBlockVersions((prev) => ({
      ...prev,
      [blockId]: {
        ...chain,
        current_version_index: nextIndex
      }
    }));
  };

  const getAiVersionNavigator = (blockId?: string) => {
    if (!blockId) {
      return undefined;
    }

    const chain = aiBlockVersions[blockId];
    if (!chain || chain.versions.length <= 1) {
      return undefined;
    }

    return {
      current: chain.current_version_index,
      total: chain.versions.length,
      onPrev: () => changeAiBlockVersion(blockId, -1),
      onNext: () => changeAiBlockVersion(blockId, 1)
    };
  };

  const handlePostExportNavigation = () => {
    if (cvKind === "tailored" && tailoredJobData) {
      navigate("/app/job-tracker", {
        state: {
          newJob: {
            title: tailoredJobData.role,
            company: tailoredJobData.company
          }
        }
      });
      return;
    }

    if (cvKind === "master" && cvId) {
      navigate(`/app/tailor/${cvId}`);
      return;
    }

    navigate("/app");
  };

  const renderSection = (section: EditorSection, index: number) => {
    const commonProps = {
      data: section.data,
      isHidden: section.hidden,
      onToggleVisibility: () => toggleSectionVisibility(section.id),
      onRemove: () => removeSection(section.id),
      onChange: (data: Record<string, unknown>) => updateSection(section.id, data),
      onAIAssist: (blockId?: string) => {
        void openAiForSection(section.id, blockId);
      }
    };

    if (section.type === "header") {
      return (
        <HeaderSection
          key={section.id}
          data={section.data}
          isHidden={section.hidden}
          onToggleVisibility={() => toggleSectionVisibility(section.id)}
          onChange={(data: Record<string, unknown>) => updateSection(section.id, data)}
        />
      );
    }

    const content = (() => {
      switch (section.type) {
        case "summary":
          return (
            <SummarySection
              {...commonProps}
              aiVersionNavigator={getAiVersionNavigator(
                ((section.data as Record<string, unknown>)?.blockId as string | undefined) ?? undefined
              )}
            />
          );
        case "experience":
          return (
            <ExperienceSection
              {...commonProps}
              getAiVersionNavigator={getAiVersionNavigator}
            />
          );
        case "education":
          return (
            <EducationSection
              {...commonProps}
              aiVersionNavigator={getAiVersionNavigator(getSectionFirstBlockId(section) ?? undefined)}
            />
          );
        case "skills":
          return (
            <SkillsSection
              {...commonProps}
              aiVersionNavigator={getAiVersionNavigator(getSectionFirstBlockId(section) ?? undefined)}
            />
          );
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
          return <GenericSection {...commonProps} sectionType={section.type} />;
      }
    })();

    return (
      <DraggableSection key={section.id} section={section} index={index} moveSection={moveSection}>
        {content}
      </DraggableSection>
    );
  };

  const headerSection = sections.find((section) => section.type === "header");
  const bodySections = sections
    .filter((section) => section.type !== "header")
    .sort((a, b) => a.order - b.order);

  const selectedTemplateName =
    templates.find((template) => template.id === templateId)?.name ??
    renderingPreview?.resolved_template.template?.name ??
    "Default";

  const saveStatusText = (() => {
    if (saving) {
      return "Saving...";
    }

    if (autoSaving) {
      return "Autosaving...";
    }

    if (dirty) {
      if (restoredDraftAt) {
        return `Unsaved draft restored ${formatDateTime(restoredDraftAt)}`;
      }
      return "Unsaved changes";
    }

    return lastSavedAt ? `Last saved ${formatDateTime(lastSavedAt)}` : "Not saved yet";
  })();


  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--color-background-secondary)" }}>
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Loading CV editor...</p>
      </div>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-screen flex flex-col">
        <div className="border-b px-6 py-3" style={{ borderColor: "var(--color-border-tertiary)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate("/app")} style={{ color: "var(--color-text-secondary)" }}>
                <ChevronLeft size={20} />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                    {title}
                  </h2>
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      background: "var(--color-teal-50)",
                      color: "var(--color-teal-800)"
                    }}
                  >
                    {cvKind === "master" ? "Master CV" : "Tailored CV"}
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {saveStatusText}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {error && (
                <span style={{ fontSize: "12px", color: "var(--color-red-700)" }}>{error}</span>
              )}

              <select
                value={templateId ?? ""}
                onChange={(event) => {
                  const value = event.target.value || null;
                  void assignTemplate(value);
                }}
                className="px-2 py-1.5 rounded-lg border"
                style={{
                  fontSize: "12px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-secondary)"
                }}
                title={`Selected template: ${selectedTemplateName}`}
              >
                <option value="">Default template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>

              {selectedTemplateDetail && (
                <span
                  className="px-2 py-1 rounded-full"
                  style={{
                    fontSize: "11px",
                    background: "var(--color-background-secondary)",
                    color: "var(--color-text-secondary)"
                  }}
                  title={`Template slug: ${selectedTemplateDetail.template.slug}`}
                >
                  {selectedTemplateDetail.template.status}
                </span>
              )}

              <button
                onClick={() => void saveCv()}
                disabled={saving || autoSaving}
                className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
              >
                {saving || autoSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving..." : autoSaving ? "Autosaving..." : "Save"}
              </button>

              {cvKind === "master" && cvId && (
                <button
                  onClick={() => navigate(`/app/tailor/${cvId}`)}
                  className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2 border"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "white",
                    borderColor: "var(--color-teal-600)"
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
                  background: "var(--color-teal-50)"
                }}
              >
                <Lightbulb size={14} />
                Tips
              </button>

              {cvKind === "tailored" && (
                <button
                  onClick={() => void openRevisionDialog()}
                  className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-background-primary)",
                    color: "var(--color-text-primary)",
                    border: "1px solid var(--color-border-secondary)"
                  }}
                >
                  <History size={14} />
                  Revisions
                </button>
              )}

              <button
                onClick={() => void openExportDialog()}
                className="px-4 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--color-border-secondary)"
                }}
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-6 transition-all duration-300" style={{ background: "var(--color-background-secondary)" }}>
            <div className="max-w-3xl mx-auto space-y-4">
              {headerSection ? renderSection(headerSection, 0) : null}
              {bodySections.map((section, index) => renderSection(section, index))}

              <button
                onClick={() => setShowAddContentModal(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 hover:shadow-md transition-all"
                style={{
                  borderColor: "var(--color-teal-300)",
                  background: "var(--color-teal-50)",
                  color: "var(--color-teal-700)"
                }}
              >
                <Plus size={16} />
                <span style={{ fontSize: "14px", fontWeight: 500 }}>Add Content</span>
              </button>
            </div>
          </div>

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
              <p className="uppercase tracking-wider mb-4" style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Preview {renderingPreview?.resolved_template.template?.name ? `• ${renderingPreview.resolved_template.template.name}` : ""}
              </p>
              <CVPresentationPreview presentation={renderingPreview?.presentation ?? null} />
            </div>
          </div>
        </div>

        <AddContentModal
          isOpen={showAddContentModal}
          onClose={() => setShowAddContentModal(false)}
          onAddSection={addSection}
          existingSections={sections.map((section) => section.type)}
        />

        <TipsDrawer isOpen={showTipsDrawer} onClose={() => setShowTipsDrawer(false)} sectionType={currentTipsSection} />

        <Dialog
          open={showAIPopup}
          onOpenChange={(open) => {
            setShowAIPopup(open);
            if (!open) {
              setAiCompareResult(null);
              setAiSuggestions([]);
              setAiTargetBlockId(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                AI Block Assistant
              </DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Select an action. Suggestions remain pending until you apply them.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-2">
                {(
                  cvKind === "tailored"
                    ? [
                      { label: "Improve writing", action: "improve" },
                      { label: "Summarize", action: "summarize" },
                      { label: "Rewrite", action: "rewrite" },
                      { label: "Shorten", action: "shorten" },
                      { label: "Expand", action: "expand" },
                      { label: "ATS optimize", action: "ats_optimize" },
                      { label: "Generate options", action: "options" },
                      { label: "Compare to job", action: "compare" }
                    ]
                    : [
                      { label: "Improve writing", action: "improve" },
                      { label: "Summarize", action: "summarize" },
                      { label: "Rewrite", action: "rewrite" },
                      { label: "Shorten", action: "shorten" },
                      { label: "Expand", action: "expand" },
                      { label: "Generate options", action: "options" }
                    ]
                ).map((item) => (
                  <button
                    key={item.label}
                    onClick={() => void runAiAction(item.action as any)}
                    disabled={aiLoading}
                    className="w-full p-2.5 rounded-lg border text-left"
                    style={{
                      fontSize: "12px",
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-background-primary)",
                      color: "var(--color-text-primary)",
                      opacity: aiLoading ? 0.7 : 1
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {aiLoading && (
                <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  <Loader2 size={14} className="animate-spin" />
                  Running AI action...
                </div>
              )}

              {aiCompareResult && (
                <div className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                  <p style={{ fontSize: "12px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
                    {aiCompareResult.comparison_summary}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                    Missing keywords: {aiCompareResult.missing_keywords.join(", ") || "none"}
                  </p>
                </div>
              )}

              {aiSuggestions.length > 0 && (
                <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                  {aiSuggestions.map((suggestion) => (
                    <div key={suggestion.id} className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                      <p style={{ fontSize: "12px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
                        {suggestion.rationale || "AI suggestion"}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void applySuggestion(suggestion.id)}
                          className="px-3 py-1 rounded-lg"
                          style={{ fontSize: "11px", background: "var(--color-teal-600)", color: "white" }}
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => void rejectSuggestion(suggestion.id)}
                          className="px-3 py-1 rounded-lg border"
                          style={{ fontSize: "11px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {aiHistory && (
                <div className="pt-2 border-t" style={{ borderColor: "var(--color-border-tertiary)" }}>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                    Recent AI suggestions: {aiHistory.suggestions.length}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                    Pending: {aiHistory.suggestions.filter((item: AiSuggestionSummary) => item.status === "pending").length}
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showExportDialog}
          onOpenChange={(open) => {
            setShowExportDialog(open);
            if (!open) {
              setExportError(null);
              setExportingFormat(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Export CV
              </DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Generate PDF or DOCX exports and download from history.
              </DialogDescription>
            </DialogHeader>

            {exportError && (
              <div
                className="p-3 rounded-lg border"
                style={{ borderColor: "var(--color-red-200)", background: "var(--color-red-50)", color: "var(--color-red-700)", fontSize: "12px" }}
              >
                {exportError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void handleExport("pdf")}
                disabled={Boolean(exportingFormat)}
                className="p-3 rounded-lg border text-left"
                style={{ borderColor: "var(--color-border-tertiary)", opacity: exportingFormat ? 0.7 : 1 }}
              >
                <div style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  PDF
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {exportingFormat === "pdf" ? "Generating..." : "Best for applications"}
                </div>
              </button>

              <button
                onClick={() => void handleExport("docx")}
                disabled={Boolean(exportingFormat)}
                className="p-3 rounded-lg border text-left"
                style={{ borderColor: "var(--color-border-tertiary)", opacity: exportingFormat ? 0.7 : 1 }}
              >
                <div style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  DOCX
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {exportingFormat === "docx" ? "Generating..." : "Editable format"}
                </div>
              </button>
            </div>

            <div className="pt-2 border-t" style={{ borderColor: "var(--color-border-tertiary)" }}>
              <div className="flex items-center justify-between mb-2">
                <h4 style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  Export history
                </h4>
                <button
                  onClick={() => {
                    if (cvId) {
                      void (cvKind === "tailored"
                        ? api.listTailoredCvExports(cvId)
                        : api.listMasterCvExports(cvId))
                        .then((history) => setExportHistory(history.exports))
                        .catch(() => undefined);
                    }
                  }}
                  style={{ fontSize: "11px", color: "var(--color-teal-600)" }}
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-2 max-h-[180px] overflow-auto pr-1">
                {exportHistory.length === 0 && (
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>No exports yet.</p>
                )}

                {exportHistory.map((item) => (
                  <div key={item.id} className="p-2 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                          {item.format.toUpperCase()} • {item.status}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {formatDateTime(item.created_at)}
                        </p>
                      </div>
                      {item.download_available ? (
                        <button
                          onClick={() => void downloadExistingExport(item.id)}
                          className="px-2 py-1 rounded border"
                          style={{ fontSize: "11px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                        >
                          Download
                        </button>
                      ) : null}
                    </div>
                    {item.status === "failed" && item.error_message ? (
                      <p style={{ fontSize: "11px", color: "var(--color-red-700)", marginTop: "4px" }}>{item.error_message}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handlePostExportNavigation}
              className="w-full px-4 py-2 rounded-lg border flex items-center justify-center gap-2"
              style={{ fontSize: "12px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
            >
              <Target size={14} />
              {cvKind === "tailored" ? "Go to Job Tracker" : "Tailor this CV"}
            </button>
          </DialogContent>
        </Dialog>

        <Dialog open={showRevisionDialog} onOpenChange={setShowRevisionDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                Block Revision History
              </DialogTitle>
              <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                Restore prior versions and compare recent changes.
              </DialogDescription>
            </DialogHeader>

            {revisionLoading ? (
              <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                <Loader2 size={14} className="animate-spin" />
                Loading revisions...
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => void loadRevisions()}
                    className="px-3 py-1 rounded-lg border inline-flex items-center gap-1"
                    style={{ fontSize: "11px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                  >
                    <RefreshCw size={12} /> Refresh
                  </button>
                  <button
                    onClick={() => void compareLatestRevisions()}
                    className="px-3 py-1 rounded-lg border"
                    style={{ fontSize: "11px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                  >
                    Compare latest two
                  </button>
                </div>

                {revisionCompareText && (
                  <div className="p-2 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                    {revisionCompareText}
                  </div>
                )}

                <div className="space-y-2 max-h-[250px] overflow-auto pr-1">
                  {revisions.length === 0 && (
                    <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      No revisions found yet.
                    </p>
                  )}

                  {revisions
                    .sort((a, b) => b.revision_number - a.revision_number)
                    .map((revision) => (
                      <div key={revision.id} className="p-2 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                              {revision.block_type} • #{revision.revision_number}
                            </p>
                            <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                              {revision.change_source} • {formatDateTime(revision.created_at)}
                            </p>
                          </div>
                          <button
                            onClick={() => void restoreRevision(revision.id)}
                            className="px-2 py-1 rounded border"
                            style={{ fontSize: "11px", borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DndProvider>
  );
}
