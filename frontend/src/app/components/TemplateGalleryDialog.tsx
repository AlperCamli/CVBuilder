import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type UIEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { CVPresentationPreview } from "./CVPresentationPreview";
import type { RenderingPresentation, TemplateSummary } from "../integration/api-types";

interface TemplateGalleryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateSummary[];
  selectedTemplateId: string | null;
  previewsByTemplateId: Record<string, RenderingPresentation | null>;
  loadingTemplateIds: string[];
  onVisibleTemplateIdsChange: (templateIds: Array<string | null>) => void;
  onSelectTemplate: (templateId: string | null) => void;
  fontScale: number;
  spacingScale: number;
  layoutScale: number;
}

const PREVIEW_SCALE = 0.34;
const TEMPLATE_BATCH_SIZE = 6;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 180;
const DEFAULT_TEMPLATE_CARD_ID = "__default__";

const getTemplateBadges = (template: TemplateSummary): string[] => {
  const badges = template.preview_config?.badges;
  if (!Array.isArray(badges)) {
    return [];
  }

  return badges
    .filter((badge): badge is string => typeof badge === "string")
    .map((badge) => badge.trim())
    .filter((badge) => badge.length > 0);
};

const isLatexTemplate = (template: TemplateSummary): boolean => {
  const badges = getTemplateBadges(template);
  return (
    template.slug.toLowerCase().startsWith("latex-") ||
    badges.some((badge) => badge.toLowerCase() === "latex")
  );
};

export function TemplateGalleryDialog({
  open,
  onOpenChange,
  templates,
  selectedTemplateId,
  previewsByTemplateId,
  loadingTemplateIds,
  onVisibleTemplateIdsChange,
  onSelectTemplate,
  fontScale,
  spacingScale,
  layoutScale
}: TemplateGalleryDialogProps) {
  const loadingIds = new Set(loadingTemplateIds);
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_BATCH_SIZE);
  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((a, b) => {
        const aLatex = isLatexTemplate(a);
        const bLatex = isLatexTemplate(b);
        if (aLatex !== bLatex) {
          return aLatex ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }),
    [templates]
  );
  const cards = useMemo<Array<{
    id: string;
    templateId: string | null;
    name: string;
    slug: string;
    badges: string[];
  }>>(
    () => [
      ...sortedTemplates.map((template) => ({
        id: template.id,
        templateId: template.id,
        name: template.name,
        slug: template.slug,
        badges: getTemplateBadges(template)
      })),
      {
        id: DEFAULT_TEMPLATE_CARD_ID,
        templateId: null,
        name: "Default Template",
        slug: "default",
        badges: []
      }
    ],
    [sortedTemplates]
  );
  const visibleCards = useMemo(() => cards.slice(0, visibleCount), [cards, visibleCount]);
  const visibleTemplateIds = useMemo(
    () => visibleCards.map((card) => card.templateId),
    [visibleCards]
  );
  const hasMoreTemplates = visibleCount < cards.length;

  const loadNextBatch = useCallback(() => {
    setVisibleCount((current) => Math.min(cards.length, current + TEMPLATE_BATCH_SIZE));
  }, [cards.length]);

  const handleTemplateScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMoreTemplates) {
        return;
      }

      const target = event.currentTarget;
      const remainingScroll = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remainingScroll <= LOAD_MORE_SCROLL_THRESHOLD_PX) {
        loadNextBatch();
      }
    },
    [hasMoreTemplates, loadNextBatch]
  );

  useEffect(() => {
    if (open) {
      setVisibleCount(Math.min(TEMPLATE_BATCH_SIZE, cards.length));
    }
  }, [cards.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    onVisibleTemplateIdsChange(visibleTemplateIds);
  }, [onVisibleTemplateIdsChange, open, visibleTemplateIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1200px] max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
            Choose a Template
          </DialogTitle>
          <DialogDescription style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Pick a template and apply it instantly to your CV.
          </DialogDescription>
        </DialogHeader>

        <div
          className="overflow-auto pr-1"
          style={{ maxHeight: "74vh" }}
          onScroll={handleTemplateScroll}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleCards.map((card) => {
              const isSelected = selectedTemplateId === card.templateId;
              const isLoading = loadingIds.has(card.id);
              const preview = previewsByTemplateId[card.id] ?? null;

              return (
                <div
                  key={card.id}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: isSelected ? "var(--color-teal-500)" : "var(--color-border-tertiary)",
                    background: "var(--color-background-primary)"
                  }}
                >
                  <div
                    className="rounded-lg border overflow-hidden"
                    style={{
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-background-secondary)",
                      height: "285px"
                    }}
                  >
                    {isLoading ? (
                      <div
                        className="h-full w-full flex items-center justify-center gap-2"
                        style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
                      >
                        <Loader2 size={14} className="animate-spin" />
                        Loading preview...
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "595px",
                          transform: `scale(${PREVIEW_SCALE})`,
                          transformOrigin: "top left"
                        }}
                      >
                        <CVPresentationPreview
                          presentation={preview}
                          fontScale={fontScale}
                          spacingScale={spacingScale}
                          layoutScale={layoutScale}
                          mode="thumbnail"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          className="truncate"
                          style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}
                        >
                          {card.name}
                        </span>
                        {card.badges.map((badge) => (
                          <Badge
                            key={`${card.id}-${badge}`}
                            variant="outline"
                            className="px-1.5 py-0"
                            style={{
                              fontSize: "10px",
                              borderColor: "var(--color-teal-200)",
                              color: "var(--color-teal-700)",
                              background: "var(--color-teal-50)"
                            }}
                          >
                            {badge}
                          </Badge>
                        ))}
                      </div>
                      <p
                        className="truncate"
                        style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}
                      >
                        {card.slug}
                      </p>
                    </div>
                    <button
                      onClick={() => onSelectTemplate(card.templateId)}
                      className="px-3 py-1.5 rounded-lg border"
                      style={{
                        fontSize: "12px",
                        borderColor: isSelected ? "var(--color-teal-600)" : "var(--color-border-secondary)",
                        background: isSelected ? "var(--color-teal-50)" : "var(--color-background-primary)",
                        color: isSelected ? "var(--color-teal-700)" : "var(--color-text-primary)"
                      }}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </div>
                </div>
              );
            })}
            {hasMoreTemplates ? (
              <div className="md:col-span-2 xl:col-span-3 flex justify-center py-2">
                <button
                  type="button"
                  onClick={loadNextBatch}
                  className="px-3 py-1.5 rounded-lg border"
                  style={{
                    fontSize: "12px",
                    borderColor: "var(--color-border-secondary)",
                    background: "var(--color-background-primary)",
                    color: "var(--color-text-primary)"
                  }}
                >
                  Load more templates
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
