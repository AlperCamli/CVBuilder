import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  ChevronUp,
  Briefcase,
  GraduationCap,
  Users,
  BadgeCheck,
  ClipboardList,
  Stethoscope,
  ShieldCheck
} from "lucide-react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AddContentModal } from "../components/AddContentModal";
import type { ContentType } from "../components/AddContentModal";
import { ModuleSection } from "../components/ModuleSection";
import { TipsDrawer } from "../components/TipsDrawer";
import { CVPresentationPreview } from "../components/CVPresentationPreview";
import { TemplateGalleryDialog } from "../components/TemplateGalleryDialog";
import { useSidebar } from "../contexts/SidebarContext";
import { useUpgradePrompt } from "../contexts/UpgradePromptContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../components/ui/dialog";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent
} from "../components/ui/hover-card";
import { Button } from "../components/ui/button";
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
import { toast } from "sonner";
import { useAuth } from "../integration/auth-context";
import type {
  AiBlockVersionChain,
  CvBlock,
  CvContent,
  CvAiHistoryResponse,
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
import { isEntitlementExceeded, resolveEntitlementFeature } from "../integration/entitlement-upsell";
import {
  cvContentToEditorSections,
  editorSectionsToCvContent,
  getSectionFirstBlockId,
  type EditorSection
} from "../integration/cv-mappers";
import { looksLikeBulletAnswer, normalizeToBullets } from "../integration/bulletText";
import { injectPreviewPlaceholders } from "../integration/preview-placeholders";
import { trackCvExported } from "../integration/analytics";
import { isPaidPlanCode } from "../../content/pricing";
import {
  canUseAiForSectionBlock,
  matchesBlockReference,
  resolveCanonicalAiBlockId
} from "./cv-editor-ai-guard";
import {
  buildSkillsPoolDataPatch,
  parseSkillsPoolMetadata,
  parseSkillsPoolMetadataFromBlockMeta
} from "./cv-editor-skills-pool";
import {
  DEFAULT_MODULE_ID,
  getCvModule,
  getModuleManagedSectionDefinition
} from "../modules/module-registry";
import type { SectionTypeDefinition } from "../modules/cv-module.types";

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

const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 1.15;
const SPACING_SCALE_MIN = 0.5;
const SPACING_SCALE_MAX = 1.4;
const LAYOUT_SCALE_MIN = 0.5;
const LAYOUT_SCALE_MAX = 1.3;
// Fine slider increment so users can dial in a compact layout precisely.
const SCALE_STEP = 0.01;
const MASTER_EXPORT_GUIDE_FLAG = "cv-editor:has-exported-master";
const EXPORT_UPSELL_SESSION_KEY = "cv-editor:export-upsell-shown";
const EMPTY_AI_BLOCK_MESSAGE = "This block is empty, please provide some information.";

const clampInRange = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampFontScale = (value: number): number => clampInRange(value, FONT_SCALE_MIN, FONT_SCALE_MAX);
const clampSpacingScale = (value: number): number => clampInRange(value, SPACING_SCALE_MIN, SPACING_SCALE_MAX);
const clampLayoutScale = (value: number): number => clampInRange(value, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX);

const resolveScaleFromMetadata = (
  content: CvContent | null | undefined,
  key: string,
  clamp: (value: number) => number
): number => {
  const rawValue = (content?.metadata as Record<string, unknown> | undefined)?.[key];

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return clamp(rawValue);
  }

  if (typeof rawValue === "string") {
    const parsed = Number.parseFloat(rawValue);
    if (Number.isFinite(parsed)) {
      return clamp(parsed);
    }
  }

  return 1;
};

const resolveFontScaleFromContent = (content: CvContent | null | undefined): number =>
  resolveScaleFromMetadata(content, "font_scale", clampFontScale);

const resolveSpacingScaleFromContent = (content: CvContent | null | undefined): number =>
  resolveScaleFromMetadata(content, "spacing_scale", clampSpacingScale);

const resolveLayoutScaleFromContent = (content: CvContent | null | undefined): number =>
  resolveScaleFromMetadata(content, "layout_scale", clampLayoutScale);

const withDisplayMetadata = (
  content: CvContent,
  fontScale: number,
  spacingScale: number,
  layoutScale: number
): CvContent => {
  const metadata = {
    ...(content.metadata ?? {}),
    font_scale: clampFontScale(fontScale),
    spacing_scale: clampSpacingScale(spacingScale),
    layout_scale: clampLayoutScale(layoutScale)
  };

  return {
    ...content,
    metadata
  };
};

const sanitizeFilenameSegment = (value: string): string => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "cv";
};

const buildExportFilename = (title: string, format: "pdf" | "docx"): string => {
  const safeTitle = sanitizeFilenameSegment(title).replace(/\.(pdf|docx)$/i, "");
  return `${safeTitle}.${format}`;
};

const triggerDownload = (url: string, filename: string) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
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

const moduleSectionDefaultData = (definition: SectionTypeDefinition): Record<string, unknown> => ({
  items: [
    {
      id: `${definition.type}-${Date.now()}`,
      blockType: definition.blockType,
      hidden: false,
      rawFields: { ...definition.defaultBlockFields },
      rawMeta: {}
    }
  ]
});

const toSectionTitle = (type: string): string => {
  const normalized = type.trim();
  if (!normalized) {
    return "Section";
  }

  const mapped: Record<string, string> = {
    summary: "Professional Summary",
    experience: "Work Experience",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
    certifications: "Certifications",
    courses: "Courses",
    projects: "Projects",
    volunteer: "Volunteer Work",
    awards: "Awards",
    publications: "Publications",
    references: "References"
  };

  if (mapped[normalized]) {
    return mapped[normalized];
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

interface CvEditorDraft {
  version: 1 | 2 | 3 | 4;
  cvKind: "master" | "tailored";
  cvId: string;
  moduleType?: string;
  title: string;
  language: string;
  templateId: string | null;
  fontScale: number;
  spacingScale: number;
  layoutScale: number;
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
    const parsed = JSON.parse(raw) as Partial<CvEditorDraft> & {
      version?: number;
      cvKind?: "master" | "tailored";
      cvId?: string;
      sections?: EditorSection[];
    };
    if (
      parsed &&
      (parsed.version === 1 || parsed.version === 2 || parsed.version === 3 || parsed.version === 4) &&
      parsed.cvKind === cvKind &&
      parsed.cvId === cvId &&
      Array.isArray(parsed.sections)
    ) {
      const maybeFontScale =
        typeof parsed.fontScale === "number" ? parsed.fontScale : 1;
      const maybeSpacingScale =
        typeof parsed.spacingScale === "number" ? parsed.spacingScale : 1;
      const maybeLayoutScale =
        typeof parsed.layoutScale === "number" ? parsed.layoutScale : 1;

      return {
        cvKind,
        cvId,
        moduleType: parsed.moduleType,
        title: parsed.title ?? "",
        language: parsed.language ?? "en",
        templateId: parsed.templateId ?? null,
        sections: parsed.sections,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        version: 4,
        fontScale: clampFontScale(maybeFontScale),
        spacingScale: clampSpacingScale(maybeSpacingScale),
        layoutScale: clampLayoutScale(maybeLayoutScale)
      };
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

const DraggableSection = ({ section, index, moveSection, highlighted, children }: any) => {
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
        boxShadow: highlighted
          ? "0 0 0 2px var(--color-teal-400), 0 0 24px rgba(20, 184, 166, 0.32)"
          : isOver
            ? "0 0 0 2px var(--color-teal-200)"
            : "none",
        borderRadius: "12px",
        cursor: isDragging ? "grabbing" : "grab",
        transition: "box-shadow 240ms ease, opacity 200ms ease, transform 200ms ease"
      }}
    >
      {children}
    </div>
  );
};

interface SkillPoolState {
  items: string[];
  lastGeneratedAt: string | null;
  refreshCountDay: string;
  refreshCountValue: number;
  shuffleUsed: boolean;
}

// String narrative fields edited as bullet lists, per block type. Array-shaped bullet
// fields (e.g. medical duties/outcomes) are not listed: the bulletizer only handles strings.
const NARRATIVE_BULLET_FIELDS_BY_BLOCK_TYPE: Record<string, string[]> = {
  experience_item: ["description", "responsibilities", "highlights"],
  education_item: ["description", "responsibilities", "highlights"],
  project_item: ["description", "responsibilities", "highlights"],
  volunteer_item: ["description", "responsibilities", "highlights"],
  award_item: ["description", "responsibilities", "highlights"],
  publication_item: ["description", "responsibilities", "highlights"],
  // medical_uk textarea fields using the "• " bullet convention
  medical_qualification: ["notes"],
  career_gap: ["explanation"],
  additional_skill: ["context"],
  teaching_activity: ["evaluation"]
};

// Frontend safety net mirroring the backend: normalize AI bullet answers into the "• "
// convention so applied suggestions show clean bullets immediately. Summary/skills untouched.
const bulletizeNarrativeBlock = (block: CvBlock): CvBlock => {
  const narrativeKeys = NARRATIVE_BULLET_FIELDS_BY_BLOCK_TYPE[block.type];
  if (!narrativeKeys) {
    return block;
  }

  let changed = false;
  const fields = { ...block.fields };
  for (const key of narrativeKeys) {
    const value = fields[key];
    if (typeof value === "string" && looksLikeBulletAnswer(value)) {
      const normalized = normalizeToBullets(value);
      if (normalized !== value) {
        fields[key] = normalized;
        changed = true;
      }
    }
  }

  return changed ? { ...block, fields } : block;
};

interface CVEditorProps {
  forcedModuleType?: string;
  forcedTitle?: string;
}

export function CVEditor({ forcedModuleType, forcedTitle }: CVEditorProps = {}) {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { api, me } = useAuth();
  const { setSidebarVisible } = useSidebar();
  const { showUpgradePrompt } = useUpgradePrompt();

  const routeCvKind = location.state?.cvKind as "master" | "tailored" | undefined;
  const isUploadedFlow = Boolean(location.state?.isUploaded);
  const isAiImprovedFlow = Boolean(location.state?.aiImproved);
  const isTailoredFlow = Boolean(location.state?.isTailored);
  const [cvKind, setCvKind] = useState<"master" | "tailored">("master");
  const [cvId, setCvId] = useState<string | null>(null);
  const [title, setTitle] = useState("CV");
  const [language, setLanguage] = useState("en");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [spacingScale, setSpacingScale] = useState(1);
  const [layoutScale, setLayoutScale] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [autoFitting, setAutoFitting] = useState(false);
  const [autoFitPreparing, setAutoFitPreparing] = useState(false);
  const autoFitAttemptsRef = useRef(0);
  const autoFitInitializedRef = useRef(false);
  const autoFitChangedRef = useRef(false);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [moduleType, setModuleType] = useState(DEFAULT_MODULE_ID);

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
  const [aiHistory, setAiHistory] = useState<CvAiHistoryResponse | null>(null);
  const [aiBlockVersions, setAiBlockVersions] = useState<Record<string, AiBlockVersionChain>>({});
  const [highlightedAiBlockIds, setHighlightedAiBlockIds] = useState<string[]>([]);
  const [showSkillsPoolDialog, setShowSkillsPoolDialog] = useState(false);
  const [skillsPoolSectionId, setSkillsPoolSectionId] = useState<string | null>(null);
  const [skillsPoolLoading, setSkillsPoolLoading] = useState(false);
  const [skillsPoolRefreshing, setSkillsPoolRefreshing] = useState(false);
  const [skillsPoolError, setSkillsPoolError] = useState<string | null>(null);

  const [showAddContentModal, setShowAddContentModal] = useState(false);
  const [showTipsDrawer, setShowTipsDrawer] = useState(false);
  const [currentTipsSection, setCurrentTipsSection] = useState("experience");

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportSummaryItem[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  // Armed after a successful export for free-plan users. `away` flips once the user
  // leaves the tab/window (opening the downloaded PDF); the prompt fires on return.
  const postExportReturnRef = useRef<{ kind: "master" | "tailored"; away: boolean } | null>(null);

  const [showRevisionDialog, setShowRevisionDialog] = useState(false);
  const [revisions, setRevisions] = useState<CvBlockRevisionSummary[]>([]);
  const [revisionCompareText, setRevisionCompareText] = useState<string | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);

  const [tailoredJobData, setTailoredJobData] = useState<{
    role: string;
    company: string;
    jobId?: string;
  } | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [templatePreviewsByTemplateId, setTemplatePreviewsByTemplateId] = useState<Record<string, RenderingPreviewResponse["presentation"] | null>>({});
  const [templatePreviewLoadingIds, setTemplatePreviewLoadingIds] = useState<string[]>([]);
  const templatePreviewsRef = useRef<Record<string, RenderingPreviewResponse["presentation"] | null>>({});
  const templatePreviewLoadingIdsRef = useRef<Set<string>>(new Set());
  const templatePreviewGenerationRef = useRef(0);

  useEffect(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  useEffect(() => {
    let cancelled = false;

    void api
      .getSettings()
      .then(({ settings }) => {
        if (!cancelled) {
          setOnboardingCompleted(settings.onboarding_completed);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOnboardingCompleted(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const addContentTypes = useMemo<ContentType[] | undefined>(() => {
    if (moduleType === DEFAULT_MODULE_ID) {
      return undefined;
    }

    const activeCvModule = getCvModule(moduleType);
    const iconByType: Record<string, ContentType["icon"]> = {
      medical_registration: ShieldCheck,
      medical_qualifications: GraduationCap,
      clinical_experience: Stethoscope,
      clinical_skills: Stethoscope,
      additional_skills: Lightbulb,
      audit_qi: ClipboardList,
      courses_training: BadgeCheck,
      memberships: Users,
      teaching: Users,
      management_leadership: Briefcase,
      volunteer: Users
    };

    return [...activeCvModule.sectionCatalog]
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((definition) => ({
        id: definition.type,
        name: definition.title,
        icon: iconByType[definition.type] ?? FileText,
        essential: definition.essential,
        description: definition.description,
        order: definition.defaultOrder
      }));
  }, [moduleType]);

  const loadTemplates = async (targetModuleType = DEFAULT_MODULE_ID) => {
    const list =
      targetModuleType === DEFAULT_MODULE_ID
        ? await api.listTemplates()
        : await api.listTemplates(targetModuleType);
    setTemplates(list.templates);
  };

  const hydrateFromMaster = (master: MasterCvDetail) => {
    const nextModuleType = master.module_type ?? DEFAULT_MODULE_ID;
    setCvKind("master");
    setCvId(master.id);
    setModuleType(nextModuleType);
    setTitle(master.title);
    setLanguage(master.language);
    setTemplateId(master.template_id);
    setFontScale(resolveFontScaleFromContent(master.current_content));
    setSpacingScale(resolveSpacingScaleFromContent(master.current_content));
    setLayoutScale(resolveLayoutScaleFromContent(master.current_content));
    setSections(cvContentToEditorSections(master.current_content, nextModuleType));
    setLastSavedAt(master.updated_at);
    void loadTemplates(nextModuleType);
  };

  const hydrateFromTailored = (tailored: TailoredCvDetail) => {
    const nextModuleType = tailored.module_type ?? DEFAULT_MODULE_ID;
    setCvKind("tailored");
    setCvId(tailored.id);
    setModuleType(nextModuleType);
    setTitle(tailored.title);
    setLanguage(tailored.language);
    setTemplateId(tailored.template_id);
    setFontScale(resolveFontScaleFromContent(tailored.current_content));
    setSpacingScale(resolveSpacingScaleFromContent(tailored.current_content));
    setLayoutScale(resolveLayoutScaleFromContent(tailored.current_content));
    setSections(cvContentToEditorSections(tailored.current_content, nextModuleType));
    setLastSavedAt(tailored.updated_at);
    setTailoredJobData(
      tailored.job
        ? {
          role: tailored.job.job_title,
          company: tailored.job.company_name,
          jobId: tailored.job.id
        }
        : null
    );
    void loadTemplates(nextModuleType);
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

  const resolveSkillPoolState = (section: EditorSection): SkillPoolState => {
    const fromData = parseSkillsPoolMetadata(section.data);
    if (fromData.items.length > 0) {
      return fromData;
    }

    const fromMeta = parseSkillsPoolMetadataFromBlockMeta((section.data as Record<string, unknown>)?.meta ?? {});
    return fromMeta;
  };

  const updateSkillSectionData = (
    sectionId: string,
    updater: (current: Record<string, unknown>) => Record<string, unknown>
  ) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) {
          return section;
        }

        const currentData = (section.data ?? {}) as Record<string, unknown>;
        return {
          ...section,
          data: updater(currentData)
        };
      })
    );
    markDirty();
  };

  const applyPersistedBlockUpdate = (blockId: string, updatedBlock: CvBlock): boolean => {
    const currentContent = withDisplayMetadata(
      editorSectionsToCvContent(sections, language, undefined, moduleType),
      fontScale,
      spacingScale,
      layoutScale
    );

    let didReplace = false;
    const nextSections = currentContent.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        didReplace = true;
        return bulletizeNarrativeBlock({
          ...block,
          ...updatedBlock,
          id: block.id
        });
      })
    }));

    if (!didReplace) {
      return false;
    }

    setSections(
      cvContentToEditorSections({
        ...currentContent,
        sections: nextSections
      }, moduleType)
    );
    setDirty(false);
    setRestoredDraftAt(null);
    setLastSavedAt(new Date().toISOString());
    return true;
  };

  const highlightAiUpdatedBlock = (blockId: string) => {
    setHighlightedAiBlockIds((prev) => [...new Set([...prev, blockId])]);
    window.setTimeout(() => {
      setHighlightedAiBlockIds((prev) => prev.filter((item) => item !== blockId));
    }, 3500);
  };

  const markDirty = () => {
    setDirty(true);
    setRestoredDraftAt(null);
  };

  const buildCurrentContent = useCallback(() => {
    return withDisplayMetadata(
      editorSectionsToCvContent(sections, language, undefined, moduleType),
      fontScale,
      spacingScale,
      layoutScale
    );
  }, [fontScale, language, layoutScale, moduleType, sections, spacingScale]);

  const restoreDraftIfAvailable = (nextCvKind: "master" | "tailored", nextCvId: string): boolean => {
    const draft = readDraft(nextCvKind, nextCvId);
    if (!draft) {
      setDirty(false);
      setRestoredDraftAt(null);
      return false;
    }

    setTitle(draft.title);
    if (draft.moduleType) {
      setModuleType(draft.moduleType);
    }
    setLanguage(draft.language);
    setTemplateId(draft.templateId);
    setFontScale(clampFontScale(draft.fontScale));
    setSpacingScale(clampSpacingScale(draft.spacingScale));
    setLayoutScale(clampLayoutScale(draft.layoutScale));
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
      if (forcedModuleType || routeCvKind === "master" || id === "master") {
        let targetMasterId = location.state?.masterCvId as string | undefined;

        if (!targetMasterId && !forcedModuleType && id && id !== "master") {
          targetMasterId = id;
        }

        if (!targetMasterId) {
          const masters = await api.listMasterCvs();
          targetMasterId = forcedModuleType
            ? masters.find((master) => master.module_type === forcedModuleType)?.id
            : masters[0]?.id;
        }

        if (!targetMasterId) {
          const created = await api.createMasterCv({
            title: forcedTitle ?? "My Main CV",
            language: "en",
            ...(forcedModuleType ? { module_type: forcedModuleType } : {})
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
              company: source.job.company_name,
              jobId: source.job.id
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
  }, [forcedModuleType, forcedTitle, id, isUploadedFlow, routeCvKind]);

  useEffect(() => {
    if (!cvId) {
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      // Placeholders are preview-only: they are injected into the request payload, never
      // into the editor state, so saved content and exports stay clean.
      const content = injectPreviewPlaceholders(buildCurrentContent(), moduleType);
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
  }, [api, buildCurrentContent, cvId, cvKind, language, moduleType, templateId]);

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
      version: 4,
      cvKind,
      cvId,
      moduleType,
      title,
      language,
      templateId,
      fontScale,
      spacingScale,
      layoutScale,
      sections,
      updatedAt: new Date().toISOString()
    });
  }, [cvId, cvKind, dirty, fontScale, language, layoutScale, moduleType, sections, spacingScale, templateId, title]);

  const addSection = (sectionType: string) => {
    setSections((prev) => {
      const maxOrder = prev.filter((section) => section.type !== "header").reduce((max, section) => Math.max(max, section.order), -1);
      const moduleDefinition = getModuleManagedSectionDefinition(moduleType, sectionType);
      return [
        ...prev,
        {
          id: `${sectionType}-${Date.now()}`,
          type: sectionType,
          hidden: false,
          order: maxOrder + 1,
          data: moduleDefinition ? moduleSectionDefaultData(moduleDefinition) : sectionDefaultData(sectionType)
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
      const content = withDisplayMetadata(
        editorSectionsToCvContent(sections, language, undefined, moduleType),
        fontScale,
        spacingScale,
        layoutScale
      );

      if (targetCvKind === "master") {
        const updated = await api.putMasterCvContent(targetCvId, content);
        setCvKind("master");
        setCvId(updated.id);
        setTitle(updated.title);
        setLanguage(updated.language);
        setTemplateId(updated.template_id);
        setFontScale(resolveFontScaleFromContent(updated.current_content));
        setSpacingScale(resolveSpacingScaleFromContent(updated.current_content));
        setLayoutScale(resolveLayoutScaleFromContent(updated.current_content));
        setLastSavedAt(updated.updated_at);
      } else {
        const updated = await api.putTailoredCvContent(targetCvId, content);
        setCvKind("tailored");
        setCvId(updated.id);
        setTitle(updated.title);
        setLanguage(updated.language);
        setTemplateId(updated.template_id);
        setFontScale(resolveFontScaleFromContent(updated.current_content));
        setSpacingScale(resolveSpacingScaleFromContent(updated.current_content));
        setLayoutScale(resolveLayoutScaleFromContent(updated.current_content));
        setLastSavedAt(updated.updated_at);
        setTailoredJobData(
          updated.job
            ? {
              role: updated.job.job_title,
              company: updated.job.company_name,
              jobId: updated.job.id
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

  const handlePageCountChange = useCallback((next: number) => {
    setPageCount((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    autoFitInitializedRef.current = false;
    autoFitAttemptsRef.current = 0;
    autoFitChangedRef.current = false;
    setAutoFitting(false);
    setAutoFitPreparing(false);
  }, [cvKind, cvId]);

  useEffect(() => {
    if (loading || !cvId || !renderingPreview) {
      return;
    }
    if (autoFitInitializedRef.current) {
      return;
    }

    const shouldFit = isUploadedFlow || isAiImprovedFlow || isTailoredFlow;
    if (!shouldFit) {
      return;
    }

    const sessionKey = `cv-editor:auto-fit:${cvKind}:${cvId}`;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(sessionKey) === "done") {
      autoFitInitializedRef.current = true;
      return;
    }

    autoFitInitializedRef.current = true;
    autoFitAttemptsRef.current = 0;
    autoFitChangedRef.current = false;
    setAutoFitPreparing(true);
    setAutoFitting(true);
  }, [cvId, cvKind, isAiImprovedFlow, isTailoredFlow, isUploadedFlow, loading, renderingPreview]);

  useEffect(() => {
    if (!autoFitting) {
      return;
    }

    const finish = () => {
      setAutoFitting(false);
      setAutoFitPreparing(false);
      if (autoFitChangedRef.current) {
        setDirty(true);
        setRestoredDraftAt(null);
      }
      if (typeof window !== "undefined" && cvId) {
        window.sessionStorage.setItem(`cv-editor:auto-fit:${cvKind}:${cvId}`, "done");
      }
    };

    if (pageCount <= 1) {
      finish();
      return;
    }

    if (autoFitAttemptsRef.current >= 16) {
      finish();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      autoFitAttemptsRef.current += 1;
      if (spacingScale > SPACING_SCALE_MIN + 0.001) {
        autoFitChangedRef.current = true;
        setSpacingScale((prev) => Math.max(SPACING_SCALE_MIN, prev - 0.05));
      } else if (layoutScale > LAYOUT_SCALE_MIN + 0.001) {
        autoFitChangedRef.current = true;
        setLayoutScale((prev) => Math.max(LAYOUT_SCALE_MIN, prev - 0.05));
      } else if (fontScale > FONT_SCALE_MIN + 0.001) {
        autoFitChangedRef.current = true;
        setFontScale((prev) => Math.max(FONT_SCALE_MIN, prev - 0.02));
      } else {
        finish();
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [autoFitting, cvId, cvKind, fontScale, layoutScale, pageCount, spacingScale]);

  useEffect(() => {
    if (!cvId || !dirty || loading || saving || autoSaving || autoFitting) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistCv("auto");
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoFitting, autoSaving, cvId, cvKind, dirty, fontScale, language, layoutScale, loading, moduleType, saving, sections, spacingScale]);

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

  useEffect(() => {
    templatePreviewsRef.current = templatePreviewsByTemplateId;
  }, [templatePreviewsByTemplateId]);

  useEffect(() => {
    if (showTemplateGallery) {
      return;
    }

    templatePreviewGenerationRef.current += 1;
    templatePreviewsRef.current = {};
    templatePreviewLoadingIdsRef.current = new Set();
    setTemplatePreviewsByTemplateId({});
    setTemplatePreviewLoadingIds([]);
  }, [showTemplateGallery]);

  const ensureTemplatePreviews = useCallback(
    (visibleTemplateIds: Array<string | null>) => {
      if (!showTemplateGallery || visibleTemplateIds.length === 0) {
        return;
      }

      const cardIds = Array.from(
        new Set(visibleTemplateIds.map((templateId) => templateId ?? "__default__"))
      );
      const idsToLoad = cardIds.filter(
        (cardId) =>
          !Object.prototype.hasOwnProperty.call(templatePreviewsRef.current, cardId) &&
          !templatePreviewLoadingIdsRef.current.has(cardId)
      );

      if (idsToLoad.length === 0) {
        return;
      }

      const generation = templatePreviewGenerationRef.current;
      const previewContent = injectPreviewPlaceholders(buildCurrentContent(), moduleType);

      idsToLoad.forEach((cardId) => templatePreviewLoadingIdsRef.current.add(cardId));
      setTemplatePreviewLoadingIds([...templatePreviewLoadingIdsRef.current]);

      void Promise.all(
        idsToLoad.map(async (cardId) => {
          try {
            const preview = await api.postRenderingPreview({
              cv_kind: cvKind,
              current_content: previewContent,
              template_id: cardId === "__default__" ? null : cardId,
              language
            });
            return [cardId, preview.presentation] as const;
          } catch {
            return [cardId, null] as const;
          }
        })
      ).then((entries) => {
        if (generation !== templatePreviewGenerationRef.current) {
          return;
        }

        setTemplatePreviewsByTemplateId((current) => {
          const next = { ...current };
          for (const [cardId, preview] of entries) {
            next[cardId] = preview;
          }
          templatePreviewsRef.current = next;
          return next;
        });

        idsToLoad.forEach((cardId) => templatePreviewLoadingIdsRef.current.delete(cardId));
        setTemplatePreviewLoadingIds([...templatePreviewLoadingIdsRef.current]);
      });
    },
    [api, buildCurrentContent, cvKind, language, moduleType, showTemplateGallery]
  );

  const maybeShowExportUpsell = async (): Promise<void> => {
    if (typeof window === "undefined") return;
    if (onboardingCompleted !== true) return;
    if (window.sessionStorage.getItem(EXPORT_UPSELL_SESSION_KEY) === "true") return;

    try {
      const plan = await api.getBillingPlan();
      if (isPaidPlanCode(plan.plan_code)) return;
      window.sessionStorage.setItem(EXPORT_UPSELL_SESSION_KEY, "true");
      showUpgradePrompt("export_first_in_session");
    } catch {
      // Don't block export on a billing-plan fetch failure.
    }
  };

  const armPostExportReturnPrompt = async (): Promise<void> => {
    if (typeof window === "undefined") return;
    if (cvKind !== "tailored" && onboardingCompleted !== true) return;

    try {
      const plan = await api.getBillingPlan();
      if (isPaidPlanCode(plan.plan_code)) return;
      postExportReturnRef.current = { kind: cvKind, away: false };
    } catch {
      // No return prompt if the billing plan can't be resolved.
    }
  };

  const openExportDialog = async () => {
    if (!cvId) {
      setExportError("CV id is missing.");
      setShowExportDialog(true);
      return;
    }

    setExportError(null);

    void maybeShowExportUpsell();

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
      const filename = buildExportFilename(title, format);
      const exportPayload = {
        template_id: templateId,
        font_scale: fontScale,
        spacing_scale: spacingScale,
        layout_scale: layoutScale
      };
      const detail =
        cvKind === "tailored"
          ? format === "pdf"
            ? await api.createPdfExport(cvId, exportPayload)
            : await api.createDocxExport(cvId, exportPayload)
          : format === "pdf"
            ? await api.createMasterCvPdfExport(cvId, exportPayload)
            : await api.createMasterCvDocxExport(cvId, exportPayload);

      const directUrl = detail.download?.download_url;
      if (directUrl) {
        triggerDownload(directUrl, filename);
      } else {
        const fallback = await api.getExportDownload(detail.export.id);
        triggerDownload(fallback.download_url, filename);
      }

      trackCvExported({
        source: "new_export",
        format,
        cv_kind: cvKind,
        export_status: detail.export.status,
        download_available: detail.export.download_available,
        has_template: Boolean(templateId),
        page_count: pageCount
      });

      const history =
        cvKind === "tailored"
          ? await api.listTailoredCvExports(cvId)
          : await api.listMasterCvExports(cvId);
      setExportHistory(history.exports);

      if (
        cvKind === "master" &&
        history.exports.length === 1 &&
        typeof window !== "undefined" &&
        window.localStorage.getItem(MASTER_EXPORT_GUIDE_FLAG) !== "true"
      ) {
        window.localStorage.setItem(MASTER_EXPORT_GUIDE_FLAG, "true");
        toast.success("Now let's customize this CV for a job!");
        navigate(`/app/tailor/${cvId}`);
      } else {
        void armPostExportReturnPrompt();
      }
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, format === "pdf" ? "export_pdf" : "export_docx"),
          reason: err.message
        });
        setExportError(err.message);
      } else if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError("Export failed.");
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const downloadExistingExport = async (exportId: string, format: "pdf" | "docx") => {
    try {
      const download = await api.getExportDownload(exportId);
      triggerDownload(download.download_url, buildExportFilename(title, format));
      trackCvExported({
        source: "history_download",
        format,
        cv_kind: cvKind,
        has_template: Boolean(templateId),
        page_count: pageCount
      });
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

  const buildAiTargetPayload = (): { tailored_cv_id?: string; master_cv_id?: string } | null => {
    if (!cvId) {
      return null;
    }

    return cvKind === "tailored" ? { tailored_cv_id: cvId } : { master_cv_id: cvId };
  };

  const openSkillsPool = async (sectionId: string, blockId?: string) => {
    const targetSection = sections.find((section) => section.id === sectionId);
    if (!targetSection) {
      setError("Skills section could not be resolved.");
      return;
    }

    const resolvedBlockId = resolveCanonicalAiBlockId(
      targetSection,
      blockId ?? getSectionFirstBlockId(targetSection) ?? undefined
    );

    if (!resolvedBlockId) {
      setError("No block is available for skills suggestions in this section. Save and try again.");
      return;
    }

    setSkillsPoolSectionId(sectionId);
    setSkillsPoolError(null);

    const poolState = resolveSkillPoolState(targetSection);
    if (poolState.items.length > 0) {
      setShowSkillsPoolDialog(true);
      return;
    }

    setSkillsPoolLoading(true);
    try {
      if (dirty) {
        const persisted = await persistCv("auto");
        if (!persisted) {
          setSkillsPoolError("Failed to save current edits before generating skills pool.");
          return;
        }
      }

      const targetPayload = buildAiTargetPayload();
      if (!targetPayload) {
        setSkillsPoolError("CV id is missing.");
        return;
      }

      const suggested = await api.postBlockSuggest({
        ...targetPayload,
        block_id: resolvedBlockId,
        action_type: "improve",
        user_instruction: "Generate a reusable skills suggestion pool from this CV context."
      });

      if (!applyPersistedBlockUpdate(resolvedBlockId, suggested.updated_block)) {
        setSkillsPoolError("AI returned an invalid skills pool.");
        return;
      }

      highlightAiUpdatedBlock(resolvedBlockId);
      if (cvId) {
        await loadAiData(cvKind, cvId);
      }
      setShowSkillsPoolDialog(true);
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, "ai_action"),
          reason: err.message
        });
        setSkillsPoolError(err.message);
      } else if (err instanceof Error) {
        setSkillsPoolError(err.message);
      } else {
        setSkillsPoolError("Skills pool generation failed.");
      }
    } finally {
      setSkillsPoolLoading(false);
    }
  };

  const refreshSkillsPool = async () => {
    if (!skillsPoolSectionId) {
      return;
    }

    const section = sections.find((item) => item.id === skillsPoolSectionId);
    if (!section) {
      return;
    }

    const poolState = resolveSkillPoolState(section);
    if (poolState.items.length === 0) {
      setSkillsPoolError("Skills pool is empty. Generate suggestions first.");
      return;
    }

    const planCode = (me?.current_plan?.plan_code ?? "free").toLowerCase();
    if (planCode === "free") {
      setSkillsPoolError("Refresh is available on a paid plan.");
      return;
    }

    const resolvedBlockId = resolveCanonicalAiBlockId(section, getSectionFirstBlockId(section) ?? undefined);
    if (!resolvedBlockId) {
      setSkillsPoolError("No block is available for refresh.");
      return;
    }

    setSkillsPoolError(null);
    setSkillsPoolRefreshing(true);
    try {
      if (dirty) {
        const persisted = await persistCv("auto");
        if (!persisted) {
          setSkillsPoolError("Failed to save current edits before refresh.");
          return;
        }
      }

      const targetPayload = buildAiTargetPayload();
      if (!targetPayload) {
        setSkillsPoolError("CV id is missing.");
        return;
      }

      const suggested = await api.postBlockSuggest({
        ...targetPayload,
        block_id: resolvedBlockId,
        action_type: "improve",
        user_instruction: "Refresh the existing skills suggestion pool using CV context."
      });

      if (!applyPersistedBlockUpdate(resolvedBlockId, suggested.updated_block)) {
        setSkillsPoolError("AI returned an invalid refreshed pool.");
        return;
      }
      highlightAiUpdatedBlock(resolvedBlockId);
      if (cvId) {
        await loadAiData(cvKind, cvId);
      }
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, "ai_action"),
          reason: err.message
        });
        setSkillsPoolError(err.message);
      } else if (err instanceof Error) {
        setSkillsPoolError(err.message);
      } else {
        setSkillsPoolError("Skills pool refresh failed.");
      }
    } finally {
      setSkillsPoolRefreshing(false);
    }
  };

  const toggleSkillFromPool = (skillValue: string) => {
    if (!skillsPoolSectionId) {
      return;
    }

    updateSkillSectionData(skillsPoolSectionId, (currentData) => {
      const nextSkill = skillValue.trim();
      if (!nextSkill) {
        return currentData;
      }

      const existingSkills = Array.isArray(currentData.skills)
        ? (currentData.skills as unknown[])
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0)
        : [];

      const activeSet = new Set(existingSkills.map((item) => item.toLowerCase()));
      const normalized = nextSkill.toLowerCase();

      const nextSkills = activeSet.has(normalized)
        ? existingSkills.filter((item) => item.toLowerCase() !== normalized)
        : [...existingSkills, nextSkill];

      return {
        ...currentData,
        skills: nextSkills
      };
    });
  };

  const openAiForSection = async (sectionId: string, blockId?: string) => {
    const targetSection = sections.find((section) => section.id === sectionId);
    if (!targetSection) {
      setError("Section could not be resolved for AI action.");
      return;
    }

    if (targetSection.type === "skills") {
      await openSkillsPool(sectionId, blockId);
      return;
    }

    const resolvedBlockReference = blockId ?? getSectionFirstBlockId(targetSection) ?? undefined;
    const isEmpty = !canUseAiForSectionBlock(targetSection, resolvedBlockReference, moduleType);

    if (isEmpty) {
      toast.error(EMPTY_AI_BLOCK_MESSAGE);
      return;
    }

    const resolvedBlockId = resolveCanonicalAiBlockId(targetSection, resolvedBlockReference);
    if (!resolvedBlockId) {
      setError("No block is available for AI action in this section. Save and try again.");
      return;
    }

    setAiTargetSectionId(sectionId);
    setAiTargetBlockId(resolvedBlockId ?? null);
    setShowAIPopup(true);

    if (cvId) {
      await loadAiData(cvKind, cvId);
    }
  };

  const resolveAiBlockId = (): string | null => {
    if (!aiTargetSectionId) {
      return aiTargetBlockId;
    }

    const target = sections.find((section) => section.id === aiTargetSectionId);
    if (!target) {
      return null;
    }

    return resolveCanonicalAiBlockId(target, aiTargetBlockId ?? undefined);
  };

  const resolveSectionForAiBlock = (blockId: string): EditorSection | null => {
    if (aiTargetSectionId) {
      const target = sections.find((section) => section.id === aiTargetSectionId);
      if (target) {
        return target;
      }
    }

    for (const section of sections) {
      const sectionBlockId = getSectionFirstBlockId(section);
      if (sectionBlockId === blockId) {
        return section;
      }

      const data = (section.data ?? {}) as Record<string, unknown>;
      const items = Array.isArray(data.items) ? data.items : [];
      if (
        items.some((item) => matchesBlockReference(item as Record<string, unknown>, blockId))
      ) {
        return section;
      }
    }

    return null;
  };

  const runAiAction = async (
    action: "improve" | "summarize" | "ats_optimize" | "expand"
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

    const targetSection = resolveSectionForAiBlock(blockId);
    if (!targetSection || !canUseAiForSectionBlock(targetSection, aiTargetBlockId ?? blockId, moduleType)) {
      toast.error(EMPTY_AI_BLOCK_MESSAGE);
      return;
    }

    setAiLoading(true);

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

      const suggested = await api.postBlockSuggest({
        ...targetPayload,
        block_id: blockId,
        action_type: action
      });

      if (!applyPersistedBlockUpdate(blockId, suggested.updated_block)) {
        setError("AI updated the block, but the editor could not locate it locally.");
        return;
      }

      highlightAiUpdatedBlock(blockId);
      await loadAiData(cvKind, cvId);
      setShowAIPopup(false);
      toast.success("Block updated with AI.");
    } catch (err) {
      if (isEntitlementExceeded(err)) {
        setShowAIPopup(false);
        showUpgradePrompt("limit_reached", {
          feature: resolveEntitlementFeature(err, "ai_action"),
          reason: err.message
        });
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("AI action failed.");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const replaceBlockFromSnapshot = (blockId: string, snapshot: Record<string, unknown>): boolean => {
    const currentContent = withDisplayMetadata(
      editorSectionsToCvContent(sections, language, undefined, moduleType),
      fontScale,
      spacingScale,
      layoutScale
    );
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
      }, moduleType)
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

  const sectionContainsBlock = (section: EditorSection, blockId: string): boolean => {
    if (getSectionFirstBlockId(section) === blockId) {
      return true;
    }

    const data = (section.data ?? {}) as Record<string, unknown>;
    if (String(data.blockId ?? "") === blockId) {
      return true;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    return items.some((item) => matchesBlockReference(item as Record<string, unknown>, blockId));
  };

  // After an export, the user typically opens the downloaded PDF and then comes back
  // to the tab. The ref is armed on export success; the moment they return we prompt
  // with a subscription offer plus the natural next step (cover letter for a tailored
  // CV, job-specific customization for a master CV).
  useEffect(() => {
    const firePostExportReturnPrompt = (kind: "master" | "tailored") => {
      if (kind === "tailored") {
        const jobId = tailoredJobData?.jobId;
        const firstOnboardingPaywall = onboardingCompleted !== true;
        showUpgradePrompt("post_export", {
          exportedCvKind: "tailored",
          firstOnboardingPaywall,
          onboardingCompletedBefore: onboardingCompleted === true,
          nextStep: {
            label: "Write my cover letter",
            onSelect: () => navigate(jobId ? `/app/cover-letter/${jobId}` : "/app/cover-letters")
          }
        });
        if (firstOnboardingPaywall) {
          setOnboardingCompleted(true);
        }
        return;
      }

      showUpgradePrompt("post_export", {
        exportedCvKind: "master",
        firstOnboardingPaywall: false,
        onboardingCompletedBefore: onboardingCompleted === true,
        nextStep: {
          label: "Create a job-specific CV",
          onSelect: () => navigate(cvId ? `/app/tailor/${cvId}` : "/app")
        }
      });
    };

    const markAway = () => {
      if (postExportReturnRef.current) {
        postExportReturnRef.current.away = true;
      }
    };

    const maybePrompt = () => {
      const pending = postExportReturnRef.current;
      if (!pending?.away) {
        return;
      }
      postExportReturnRef.current = null;
      firePostExportReturnPrompt(pending.kind);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markAway();
      } else {
        maybePrompt();
      }
    };

    window.addEventListener("blur", markAway);
    window.addEventListener("focus", maybePrompt);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", maybePrompt);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cvId, onboardingCompleted, tailoredJobData, navigate, showUpgradePrompt]);

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

    const moduleDefinition = getModuleManagedSectionDefinition(moduleType, section.type);

    const content = (() => {
      if (moduleDefinition) {
        return (
          <ModuleSection
            {...commonProps}
            definition={moduleDefinition}
            getAiVersionNavigator={getAiVersionNavigator}
          />
        );
      }

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
              suggestionPoolPanel={renderSkillsPoolPanel(section)}
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
          return (
            <VolunteerSection
              {...commonProps}
              title={moduleType === "medical_uk" ? "Extracurricular Activities" : undefined}
              addButtonLabel={moduleType === "medical_uk" ? "Add extracurricular activity" : undefined}
            />
          );
        case "awards":
          return <AwardsSection {...commonProps} />;
        case "publications":
          return <PublicationsSection {...commonProps} />;
        case "references":
          return <ReferencesSection {...commonProps} />;
        default:
          return <GenericSection {...commonProps} title={toSectionTitle(section.type)} />;
      }
    })();

    const highlighted = highlightedAiBlockIds.some((blockId) => sectionContainsBlock(section, blockId));

    return (
      <DraggableSection
        key={section.id}
        section={section}
        index={index}
        moveSection={moveSection}
        highlighted={highlighted}
      >
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

  const renderSkillsPoolPanel = (section: EditorSection) => {
    if (section.type !== "skills") {
      return null;
    }

    if (!showSkillsPoolDialog || skillsPoolSectionId !== section.id) {
      return null;
    }

    const sectionPool = resolveSkillPoolState(section);
    const sectionSkillValues = new Set(
      (Array.isArray((section.data as Record<string, unknown>)?.skills)
        ? ((section.data as Record<string, unknown>).skills as unknown[])
        : []
      )
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length > 0)
    );

    return (
      <div
        className="rounded-lg border p-3 space-y-3"
        style={{
          borderColor: "var(--color-border-tertiary)",
          background: "var(--color-background-secondary)"
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Skills Suggestion Pool
            </p>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              Click a skill to toggle it in your Skills section.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshSkillsPool()}
              disabled={skillsPoolLoading || skillsPoolRefreshing || sectionPool.items.length === 0}
              className="h-7 px-2.5 gap-1"
              style={{
                fontSize: "11px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)",
                background: "var(--color-background-primary)",
                opacity: skillsPoolLoading || skillsPoolRefreshing ? 0.7 : 1
              }}
            >
              <RefreshCw size={12} />
              Refresh pool
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowSkillsPoolDialog(false);
                setSkillsPoolError(null);
              }}
              aria-label="Collapse skills pool"
              title="Collapse skills pool"
              className="h-7 w-7 p-0"
              style={{
                fontSize: "11px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)",
                background: "var(--color-background-primary)"
              }}
            >
              <ChevronUp size={14} />
            </Button>
          </div>
        </div>

        {skillsPoolError ? (
          <div
            className="p-2.5 rounded-lg border"
            style={{
              borderColor: "var(--color-red-200)",
              background: "var(--color-red-50)",
              color: "var(--color-red-700)",
              fontSize: "12px"
            }}
          >
            {skillsPoolError}
          </div>
        ) : null}

        {(skillsPoolLoading || skillsPoolRefreshing) && (
          <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            <Loader2 size={14} className="animate-spin" />
            {skillsPoolLoading ? "Generating skills pool..." : "Refreshing skills pool..."}
          </div>
        )}

        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {sectionPool.items.length} skills in pool
        </p>

        {sectionPool.items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sectionPool.items.map((skill) => {
              const isActive = sectionSkillValues.has(skill.trim().toLowerCase());
              return (
                <Button
                  key={skill}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggleSkillFromPool(skill)}
                  className="h-auto py-1.5 px-3 rounded-full transition-colors"
                  style={{
                    fontSize: "12px",
                    borderColor: isActive ? "var(--color-teal-500)" : "var(--color-border-secondary)",
                    background: isActive ? "var(--color-teal-50)" : "var(--color-background-primary)",
                    color: isActive ? "var(--color-teal-800)" : "var(--color-text-primary)"
                  }}
                >
                  {skill}
                </Button>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            No skills in the pool yet.
          </p>
        )}
      </div>
    );
  };


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
                    {cvKind === "master" ? "Main CV" : "Customized CV"}
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

              <button
                onClick={() => void saveCv()}
                disabled={saving || autoSaving}
                className="px-3 py-1.5 rounded-lg font-medium flex items-center gap-2"
                style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
              >
                {saving || autoSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving..." : autoSaving ? "Autosaving..." : "Save"}
              </button>

              <button
                onClick={() => setShowTemplateGallery(true)}
                className="px-3 py-1.5 rounded-lg border"
                style={{
                  fontSize: "12px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-primary)",
                  color: "var(--color-text-primary)"
                }}
                title={`Selected template: ${selectedTemplateName}`}
              >
                Choose template: {selectedTemplateName}
              </button>

              <HoverCard openDelay={120} closeDelay={150}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border flex items-center gap-2"
                    style={{
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                      color: "var(--color-text-primary)",
                      fontSize: "12px"
                    }}
                    title="Adjust font, spacing and layout"
                  >
                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>Font</span>
                    <span>{fontScale.toFixed(2)}x</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>·</span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                      {pageCount} {pageCount === 1 ? "page" : "pages"}
                    </span>
                  </button>
                </HoverCardTrigger>
                <HoverCardContent
                  align="end"
                  sideOffset={10}
                  className="w-72"
                  style={{ background: "var(--color-background-primary)" }}
                >
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                          Font size
                        </label>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {fontScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={FONT_SCALE_MIN}
                        max={FONT_SCALE_MAX}
                        step={SCALE_STEP}
                        value={fontScale}
                        onChange={(event) => {
                          const next = clampFontScale(Number(event.target.value));
                          setFontScale(next);
                          markDirty();
                        }}
                        style={{ accentColor: "var(--color-teal-600)", width: "100%" }}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                          Spacing
                        </label>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {spacingScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={SPACING_SCALE_MIN}
                        max={SPACING_SCALE_MAX}
                        step={SCALE_STEP}
                        value={spacingScale}
                        onChange={(event) => {
                          const next = clampSpacingScale(Number(event.target.value));
                          setSpacingScale(next);
                          markDirty();
                        }}
                        style={{ accentColor: "var(--color-teal-600)", width: "100%" }}
                      />
                      <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                        Vertical gap between sections and entries.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                          Layout
                        </label>
                        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                          {layoutScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={LAYOUT_SCALE_MIN}
                        max={LAYOUT_SCALE_MAX}
                        step={SCALE_STEP}
                        value={layoutScale}
                        onChange={(event) => {
                          const next = clampLayoutScale(Number(event.target.value));
                          setLayoutScale(next);
                          markDirty();
                        }}
                        style={{ accentColor: "var(--color-teal-600)", width: "100%" }}
                      />
                      <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                        Page padding and overall density.
                      </p>
                    </div>

                    <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: "var(--color-border-tertiary)" }}>
                      <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        Preview length: {pageCount} {pageCount === 1 ? "page" : "pages"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setFontScale(1);
                          setSpacingScale(1);
                          setLayoutScale(1);
                          markDirty();
                        }}
                        style={{ fontSize: "11px", color: "var(--color-teal-600)" }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>

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
                  Customize for a job
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
              <div className="flex items-center justify-between mb-4">
                <p className="uppercase tracking-wider" style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                  Preview {renderingPreview?.resolved_template.template?.name ? `• ${renderingPreview.resolved_template.template.name}` : ""}
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      fontSize: "10px",
                      fontWeight: 500,
                      background: pageCount === 1 ? "var(--color-teal-50)" : "var(--color-background-primary)",
                      color: pageCount === 1 ? "var(--color-teal-800)" : "var(--color-text-secondary)",
                      border: pageCount === 1 ? "none" : "1px solid var(--color-border-tertiary)"
                    }}
                    title={pageCount === 1 ? "Fits on one page" : `Will export as ${pageCount} pages`}
                  >
                    {pageCount} {pageCount === 1 ? "page" : "pages"}
                  </span>
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <div style={{ visibility: autoFitPreparing ? "hidden" : "visible" }}>
                  <CVPresentationPreview
                    presentation={renderingPreview?.presentation ?? null}
                    fontScale={fontScale}
                    spacingScale={spacingScale}
                    layoutScale={layoutScale}
                    onPageCountChange={handlePageCountChange}
                  />
                </div>
                {autoFitPreparing ? (
                  <div
                    className="rounded-lg border flex items-center justify-center gap-2"
                    style={{
                      position: "absolute",
                      inset: 0,
                      minHeight: "220px",
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-background-primary)",
                      color: "var(--color-text-secondary)",
                      fontSize: "12px"
                    }}
                  >
                    <Loader2 size={14} className="animate-spin" />
                    Preparing preview...
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <TemplateGalleryDialog
          open={showTemplateGallery}
          onOpenChange={setShowTemplateGallery}
          templates={templates}
          selectedTemplateId={templateId}
          previewsByTemplateId={templatePreviewsByTemplateId}
          loadingTemplateIds={templatePreviewLoadingIds}
          onVisibleTemplateIdsChange={ensureTemplatePreviews}
          onSelectTemplate={(nextTemplateId) => {
            void assignTemplate(nextTemplateId);
            setShowTemplateGallery(false);
          }}
          fontScale={fontScale}
          spacingScale={spacingScale}
          layoutScale={layoutScale}
        />

        <AddContentModal
          isOpen={showAddContentModal}
          onClose={() => setShowAddContentModal(false)}
          onAddSection={addSection}
          existingSections={sections.map((section) => section.type)}
          contentTypes={addContentTypes}
        />

        <TipsDrawer isOpen={showTipsDrawer} onClose={() => setShowTipsDrawer(false)} sectionType={currentTipsSection} />

        <Dialog
          open={showAIPopup}
          onOpenChange={(open) => {
            setShowAIPopup(open);
            if (!open) {
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
                Select an action. The updated block is applied automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Improve writing", action: "improve" },
                  { label: "Summarize", action: "summarize" },
                  { label: "Expand", action: "expand" },
                  { label: "ATS optimize", action: "ats_optimize" }
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => void runAiAction(item.action as "improve" | "summarize" | "expand" | "ats_optimize")}
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
                          onClick={() => void downloadExistingExport(item.id, item.format)}
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
              {cvKind === "tailored" ? "Go to Job Tracker" : "Customize this CV"}
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
