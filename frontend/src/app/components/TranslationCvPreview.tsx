import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../integration/auth-context";
import type { RenderingPreviewResponse } from "../integration/api-types";
import {
  resolveScaleFromMetadata,
  FONT_SCALE_MIN, FONT_SCALE_MAX,
  SPACING_SCALE_MIN, SPACING_SCALE_MAX,
  LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX
} from "../integration/cv-display-settings";
import { translate as t } from "../localization/i18n";
import { CVPresentationPreview } from "./CVPresentationPreview";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_GAP = 24;

export function TranslationCvPreview({ masterId, runId, direction }: { masterId: string; runId: string; direction?: "ltr" | "rtl" }) {
  useTranslation();
  const { api } = useAuth();
  const [preview, setPreview] = useState<RenderingPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    void api.getTranslationPreview(masterId, runId).then(result => {
      if (active) setPreview(result);
    }).catch(() => {
      if (active) setError(t("Failed to load CV preview"));
    });
    return () => { active = false; };
  }, [api, masterId, runId, attempt]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setScale(Math.min(1, element.clientWidth / PAGE_WIDTH));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [preview]);

  if (error) return (
    <div className="mb-4" role="alert">
      <p>{error}</p>
      <button type="button" className="border rounded-lg px-3 py-2 mt-2" onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</button>
    </div>
  );
  if (!preview) return <p role="status" className="mb-4">{t("Loading CV preview…")}</p>;

  const content = preview.current_content;
  const clamp = (min: number, max: number) => (value: number) => Math.min(max, Math.max(min, value));
  return (
    <div className="overflow-y-auto overflow-x-hidden max-h-[50vh] border rounded-xl bg-slate-100 p-3 mb-4" aria-label={t("Translated CV preview")}>
      <div ref={viewport}>
        <div style={{ width: PAGE_WIDTH * scale, height: (pageCount * PAGE_HEIGHT + (pageCount - 1) * PAGE_GAP) * scale, margin: "0 auto" }}>
          <div dir={direction} style={{ width: PAGE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <CVPresentationPreview
              presentation={preview.presentation}
              fontScale={resolveScaleFromMetadata(content, "font_scale", clamp(FONT_SCALE_MIN, FONT_SCALE_MAX))}
              spacingScale={resolveScaleFromMetadata(content, "spacing_scale", clamp(SPACING_SCALE_MIN, SPACING_SCALE_MAX))}
              layoutScale={resolveScaleFromMetadata(content, "layout_scale", clamp(LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX))}
              onPageCountChange={setPageCount}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
