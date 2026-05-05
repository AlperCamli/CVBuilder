import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { CVPresentationPreview } from "./CVPresentationPreview";
import type { RenderingPresentation, TemplateSummary } from "../integration/api-types";

interface TemplateGalleryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateSummary[];
  selectedTemplateId: string | null;
  previewsByTemplateId: Record<string, RenderingPresentation | null>;
  loadingTemplateIds: string[];
  onSelectTemplate: (templateId: string | null) => void;
  fontScale: number;
  spacingScale: number;
  layoutScale: number;
}

const PREVIEW_SCALE = 0.34;

export function TemplateGalleryDialog({
  open,
  onOpenChange,
  templates,
  selectedTemplateId,
  previewsByTemplateId,
  loadingTemplateIds,
  onSelectTemplate,
  fontScale,
  spacingScale,
  layoutScale
}: TemplateGalleryDialogProps) {
  const loadingIds = new Set(loadingTemplateIds);
  const cards: Array<{
    id: string;
    templateId: string | null;
    name: string;
    slug: string;
  }> = [
    {
      id: "__default__",
      templateId: null,
      name: "Default Template",
      slug: "default"
    },
    ...templates.map((template) => ({
      id: template.id,
      templateId: template.id,
      name: template.name,
      slug: template.slug
    }))
  ];

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

        <div className="overflow-auto pr-1" style={{ maxHeight: "74vh" }}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
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
                      <p
                        className="truncate"
                        style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}
                      >
                        {card.name}
                      </p>
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
