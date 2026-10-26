import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Loader2, Pencil, Sparkles } from "lucide-react";
import { translate as t } from "../../localization/i18n";

// Draws tailoring markers over the rendered CV preview. The preview tags every rendered
// chunk with data-cv-section-id / data-cv-block-id; markers target either id and are
// drawn as one box per page (a section split across pages gets a box on each page).
// Hovering a chunk offers a pencil (and, in tailoring, "Refine with AI") on the hovered
// item's own box; hovering a section title offers the section pencil.

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

type PageRect = { top: number; left: number; right: number; bottom: number };

const unionByPage = (root: HTMLElement, elements: HTMLElement[]) => {
  const rootRect = root.getBoundingClientRect();
  const pages = new Map<Element | null, PageRect>();
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const page = element.closest("[data-cv-page]");
    const current = pages.get(page);
    // A chunk taller than its page is clipped by the page; keep the box on the visible part.
    const pageRect = page?.getBoundingClientRect();
    const next = {
      top: Math.max(rect.top, pageRect?.top ?? -Infinity) - rootRect.top,
      left: rect.left - rootRect.left,
      right: rect.right - rootRect.left,
      bottom: Math.min(rect.bottom, pageRect?.bottom ?? Infinity) - rootRect.top
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
  return pages;
};

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

// A chunk without a block id is a section title, a section's inline text (summary,
// skills or languages shown as a paragraph) or both bundled together. Returns the inline
// text elements under the pointer, or null when the pointer is on the title.
const inlineTextElements = (chunk: HTMLElement, target: HTMLElement): HTMLElement[] | null => {
  if (target.closest(HEADING_SELECTOR)) return null;
  if (!chunk.querySelector(HEADING_SELECTOR)) return chunk.textContent?.trim() ? [chunk] : null;
  const paragraph = target.closest("p");
  if (!paragraph || !chunk.contains(paragraph)) return null;
  return [...chunk.querySelectorAll<HTMLElement>("p")].filter((element) => !element.closest(HEADING_SELECTOR));
};

interface HoverTarget extends PageRect {
  sectionId: string | null;
  blockId: string | null;
}

export function PreviewAnnotations({
  containerRef,
  markers,
  onEdit,
  onRefine,
  resolveBlockId,
  editable
}: {
  containerRef: RefObject<HTMLElement | null>;
  markers: PreviewMarker[];
  onEdit?: (target: { sectionId: string | null; blockId: string | null }) => void;
  // Shown next to the pencil for hovered chunks that resolve to a CV block.
  onRefine?: (target: { sectionId: string | null; blockId: string | null }) => void;
  // Maps a hovered chunk to the CV block it shows. `previewBlockId` is the chunk's own id
  // (null for a section's inline text); preview-only ids (e.g. a bulleted skills list)
  // map to the section's block. Without it the chunk's own id is used.
  resolveBlockId?: (sectionId: string, previewBlockId: string | null) => string | null;
  editable: boolean;
}) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const resolveRef = useRef(resolveBlockId);
  resolveRef.current = resolveBlockId;
  const frame = useRef<number | null>(null);
  const markersKey = markers.map((marker) => `${marker.id}:${marker.fallbackId ?? ""}:${marker.tone}`).join("|");

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const next: Box[] = [];
    for (const marker of markers) {
      const elements = elementsFor(root, marker.id);
      const targets = elements.length === 0 && marker.fallbackId ? elementsFor(root, marker.fallbackId) : elements;
      [...unionByPage(root, targets).values()].forEach((rect, index) => {
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
      if (!target || target.closest("[data-preview-edit-button]")) return;
      const chunk = target.closest<HTMLElement>("[data-cv-section-id]");
      if (!chunk || !root.contains(chunk)) {
        setHovered(null);
        return;
      }
      const sectionId = chunk.dataset.cvSectionId ?? null;
      const chunkBlockId = chunk.dataset.cvBlockId ?? null;
      const resolve = (previewBlockId: string | null) =>
        sectionId && resolveRef.current ? resolveRef.current(sectionId, previewBlockId) : previewBlockId;
      let elements: HTMLElement[];
      let blockId: string | null;
      if (chunkBlockId) {
        // Every chunk of this item (one per page if the item continues on the next page).
        elements = elementsFor(root, chunkBlockId);
        blockId = resolve(chunkBlockId);
      } else {
        const inline = inlineTextElements(chunk, target);
        elements = inline ?? elementsFor(root, sectionId ?? "");
        blockId = inline ? resolve(null) : null;
      }
      const rects = unionByPage(root, elements);
      const rect = rects.get(chunk.closest("[data-cv-page]")) ?? [...rects.values()][0];
      if (!rect) return;
      setHovered((current) =>
        current &&
        current.sectionId === sectionId &&
        current.blockId === blockId &&
        current.top === rect.top &&
        current.left === rect.left &&
        current.right === rect.right &&
        current.bottom === rect.bottom
          ? current
          : { sectionId, blockId, ...rect }
      );
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
        // Outline of the hovered item (or section) the buttons act on.
        <div
          style={{
            position: "absolute",
            top: hovered.top - PADDING,
            left: hovered.left - PADDING,
            width: hovered.right - hovered.left + PADDING * 2,
            height: hovered.bottom - hovered.top + PADDING * 2,
            borderRadius: 6,
            border: "1px dashed var(--color-teal-200)"
          }}
        />
      ) : null}
      {hovered && onEdit ? (
        <div
          data-preview-edit-button
          className="flex items-center gap-1.5"
          style={{
            position: "absolute",
            top: Math.max(0, hovered.top - 20),
            left: hovered.right + 14,
            transform: "translateX(-100%)",
            pointerEvents: "auto"
          }}
        >
          {onRefine && hovered.blockId ? (
            <button
              type="button"
              onClick={() => onRefine({ sectionId: hovered.sectionId, blockId: hovered.blockId })}
              title={t("Refine with AI")}
              className="flex items-center gap-1 rounded-full shadow-md whitespace-nowrap"
              style={{
                height: 26,
                padding: "0 10px",
                fontSize: "11px",
                fontWeight: 500,
                background: "var(--color-teal-600)",
                border: "1px solid var(--color-teal-600)",
                color: "white"
              }}
            >
              <Sparkles size={12} />
              {t("Refine with AI")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onEdit({ sectionId: hovered.sectionId, blockId: hovered.blockId })}
            title={t("Edit in editor")}
            aria-label={t("Edit in editor")}
            className="flex items-center justify-center rounded-full shadow-md"
            style={{
              width: 26,
              height: 26,
              background: "var(--color-background-primary)",
              border: "1px solid var(--color-border-secondary)",
              color: "var(--color-teal-700)"
            }}
          >
            <Pencil size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
