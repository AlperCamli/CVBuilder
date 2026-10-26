import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Loader2, Pencil } from "lucide-react";
import { translate as t } from "../../localization/i18n";

// Draws tailoring markers over the rendered CV preview. The preview tags every rendered
// chunk with data-cv-section-id / data-cv-block-id; markers target either id and are
// drawn as one box per page (a section split across pages gets a box on each page).

export type PreviewMarkerTone = "working" | "highlight" | "evidence" | "suggested";

export interface PreviewMarker {
  id: string;
  // Used when the preview renders the target without its own chunk (e.g. a summary or
  // skills block shown as the section's inline text).
  fallbackId?: string | null;
  tone: PreviewMarkerTone;
}

interface Box {
  key: string;
  tone: PreviewMarkerTone;
  top: number;
  left: number;
  width: number;
  height: number;
}

const TONE_STYLE: Record<PreviewMarkerTone, { border: string; background: string }> = {
  working: { border: "2px solid var(--color-teal-400)", background: "rgba(29, 158, 117, 0.06)" },
  highlight: { border: "2px solid var(--color-teal-600)", background: "rgba(15, 110, 86, 0.08)" },
  evidence: { border: "1px solid var(--color-teal-200)", background: "rgba(93, 202, 165, 0.10)" },
  suggested: { border: "1px dashed var(--color-amber-200)", background: "rgba(239, 201, 127, 0.10)" }
};

const PADDING = 4;

const elementsFor = (root: HTMLElement, id: string): HTMLElement[] => {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  const byBlock = root.querySelectorAll<HTMLElement>(`[data-cv-block-id="${escaped}"]`);
  if (byBlock.length > 0) return [...byBlock];
  return [...root.querySelectorAll<HTMLElement>(`[data-cv-section-id="${escaped}"]`)];
};

const unionByPage = (root: HTMLElement, elements: HTMLElement[]) => {
  const rootRect = root.getBoundingClientRect();
  const pages = new Map<Element | null, { top: number; left: number; right: number; bottom: number }>();
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const page = element.closest("[data-cv-page]");
    const current = pages.get(page);
    const next = {
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      right: rect.right - rootRect.left,
      bottom: rect.bottom - rootRect.top
    };
    pages.set(
      page,
      current
        ? {
            top: Math.min(current.top, next.top),
            left: Math.min(current.left, next.left),
            right: Math.max(current.right, next.right),
            bottom: Math.max(current.bottom, next.bottom)
          }
        : next
    );
  }
  return [...pages.values()];
};

export function PreviewAnnotations({
  containerRef,
  markers,
  onEdit,
  editable
}: {
  containerRef: RefObject<HTMLElement | null>;
  markers: PreviewMarker[];
  onEdit?: (target: { sectionId: string | null; blockId: string | null }) => void;
  editable: boolean;
}) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hovered, setHovered] = useState<{ sectionId: string | null; blockId: string | null; top: number; right: number } | null>(null);
  const frame = useRef<number | null>(null);
  const markersKey = markers.map((marker) => `${marker.id}:${marker.fallbackId ?? ""}:${marker.tone}`).join("|");

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const next: Box[] = [];
    for (const marker of markers) {
      const elements = elementsFor(root, marker.id);
      const targets = elements.length === 0 && marker.fallbackId ? elementsFor(root, marker.fallbackId) : elements;
      unionByPage(root, targets).forEach((rect, index) => {
        next.push({
          key: `${marker.id}-${marker.tone}-${index}`,
          tone: marker.tone,
          top: rect.top - PADDING,
          left: rect.left - PADDING,
          width: rect.right - rect.left + PADDING * 2,
          height: rect.bottom - rect.top + PADDING * 2
        });
      });
    }
    setBoxes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, markersKey]);

  const scheduleMeasure = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(root);
    const mutation = new MutationObserver(scheduleMeasure);
    mutation.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [containerRef, scheduleMeasure]);

  // Hover edit: find the preview chunk under the pointer and offer a pencil for it.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !editable || !onEdit) {
      setHovered(null);
      return;
    }
    const onMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-preview-edit-button]")) return;
      const chunk = target?.closest<HTMLElement>("[data-cv-section-id]");
      if (!chunk || !root.contains(chunk)) {
        setHovered(null);
        return;
      }
      const sectionId = chunk.dataset.cvSectionId ?? null;
      const rects = unionByPage(root, elementsFor(root, sectionId ?? ""));
      const chunkRect = chunk.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const rect =
        rects.find((item) => chunkRect.top - rootRect.top >= item.top - 1 && chunkRect.top - rootRect.top <= item.bottom) ??
        rects[0];
      if (!rect) return;
      setHovered({ sectionId, blockId: chunk.dataset.cvBlockId ?? null, top: rect.top, right: rect.right });
    };
    const onLeave = () => setHovered(null);
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef, editable, onEdit]);

  return (
    <div aria-hidden={boxes.length === 0} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      {boxes.map((box) => (
        <div
          key={box.key}
          className={box.tone === "working" ? "ai-working-marker" : undefined}
          style={{
            position: "absolute",
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            borderRadius: 6,
            transition: "all 200ms ease",
            ...TONE_STYLE[box.tone]
          }}
        >
          {box.tone === "working" ? (
            <span
              className="inline-flex items-center gap-1 rounded-full"
              style={{
                position: "absolute",
                top: -10,
                right: 8,
                padding: "1px 8px",
                fontSize: "10px",
                fontWeight: 500,
                background: "var(--color-teal-600)",
                color: "white"
              }}
            >
              <Loader2 size={10} className="animate-spin" />
              {t("AI working")}
            </span>
          ) : null}
        </div>
      ))}
      {hovered && onEdit ? (
        <button
          type="button"
          data-preview-edit-button
          onClick={() => onEdit({ sectionId: hovered.sectionId, blockId: hovered.blockId })}
          title={t("Edit in editor")}
          aria-label={t("Edit in editor")}
          className="flex items-center justify-center rounded-full shadow-md"
          style={{
            position: "absolute",
            top: Math.max(0, hovered.top - 12),
            left: hovered.right - 12,
            width: 26,
            height: 26,
            pointerEvents: "auto",
            background: "var(--color-background-primary)",
            border: "1px solid var(--color-border-secondary)",
            color: "var(--color-teal-700)"
          }}
        >
          <Pencil size={12} />
        </button>
      ) : null}
    </div>
  );
}
