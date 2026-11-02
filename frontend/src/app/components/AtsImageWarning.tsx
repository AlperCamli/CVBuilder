import { useTranslation } from "react-i18next";
import { ArrowRight, FileWarning, Loader2, Sparkles } from "lucide-react";
import { translate as t } from "../localization/i18n";

/**
 * Shown for a review with ats_blocker "image_based": the uploaded PDF is a picture of text
 * (often a design-tool export), so applicant tracking systems can't read it.
 */
export function AtsImageWarning({ note, className }: { note?: string; className?: string }) {
  useTranslation();
  return (
    <section
      role="alert"
      aria-labelledby="ats-image-warning-title"
      className={className}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: 16,
        borderRadius: 10,
        border: "1px solid #f0c9c4",
        background: "#fdf3f2",
        color: "#3b2420",
        textAlign: "left",
      }}
    >
      <FileWarning size={22} aria-hidden="true" style={{ flexShrink: 0, color: "#b42318", marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <h2 id="ats-image-warning-title" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 600, color: "#912018" }}>
          {t("ATS systems can't read your CV")}
        </h2>
        <p style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.6 }}>
          {t("Most employers screen CVs with applicant tracking systems (ATS) that read the text in your file. Yours is saved as an image (common with design tools like Canva), so an ATS sees an almost empty page and may reject it automatically.")}
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, fontWeight: 600, color: "#0f6e56", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <Sparkles size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
          <span>{t("Rebuild it as an ATS-friendly CV in a few minutes.")}</span>
        </p>
        {note && <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "#5c4a47" }}>{note}</p>}
      </div>
    </section>
  );
}

const secondary = { background: "transparent", border: "1px solid var(--color-border-tertiary)", color: "var(--color-text-primary)", fontSize: "14px" };

/**
 * Score page actions for an image-based CV. The rebuild opens the editor (a free action) with the
 * recovered content, or with the empty sections of a new CV when no text could be recovered.
 */
export function ImageBasedActions({ recoveredText, converting, canOpen, onRebuild, onTailor, onImprove, onUploadAnother }: {
  recoveredText: boolean; converting: boolean; canOpen: boolean;
  onRebuild: () => void; onTailor: () => void; onImprove: () => void; onUploadAnother: () => void;
}) {
  useTranslation();
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onRebuild}
        disabled={converting || !canOpen}
        className="w-full px-6 py-3 rounded-lg font-medium inline-flex items-center justify-center gap-2"
        style={{ background: "var(--color-teal-600)", color: "white", fontSize: "14px" }}
      >
        {converting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {t("Rebuild as an ATS-friendly CV")}<ArrowRight size={16} />
      </button>
      {recoveredText && (
        <>
          <button type="button" onClick={onTailor} disabled={converting} className="w-full px-6 py-3 rounded-lg font-medium inline-flex items-center justify-center gap-2" style={{ ...secondary, opacity: converting ? 0.7 : 1 }}>
            <Sparkles size={16} />{t("Customize for a job")}
          </button>
          <button type="button" onClick={onImprove} disabled={converting} className="w-full px-6 py-3 rounded-lg font-medium inline-flex items-center justify-center gap-2" style={{ ...secondary, opacity: converting ? 0.7 : 1 }}>
            <Sparkles size={16} />{t("Improve with AI")}
          </button>
        </>
      )}
      <button type="button" onClick={onUploadAnother} disabled={converting} className="w-full px-6 py-3 rounded-lg border text-sm font-medium" style={{ borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}>
        {t("Upload another CV")}
      </button>
    </div>
  );
}
