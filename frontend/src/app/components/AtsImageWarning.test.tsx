import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AtsImageWarning, ImageBasedActions } from "./AtsImageWarning";
import { hasCvText } from "./AtsImageWarning.helpers";
import { CvReviewPanel } from "./CvReviewPanel";
import { i18n } from "../localization/i18n";
import { isImageBasedReview } from "../onboarding/onboarding-flow";
import { reviewCv } from "../../../../backend/src/modules/cv-review/cv-review";
import type { CvContent, CvReview } from "../integration/api-types";

afterEach(async () => { await i18n.changeLanguage("en"); });

const quality = { score: 55, confidence: "medium" as const, low_confidence: false, natural_language_ratio: 0.5, symbol_ratio: 0.4, repeated_token_ratio: 0.5, entropy_ratio: 0.99 };
const placeholder: CvContent = { version: "v1", language: "en", metadata: {}, sections: [
  { id: "summary", type: "summary", title: "Summary", order: 0, meta: {}, blocks: [{ id: "s1", type: "summary", order: 0, visibility: "visible", meta: {}, fields: { text: "" } }] },
] };
// The review the backend stores for an image-based PDF without usable text.
const imageReview = reviewCv({
  content: placeholder, import_status: "parsed", raw_text: "",
  diagnostics: { mime_type: "application/pdf", attempted_stages: ["pdfjs_text", "pdf_token_heuristic"], final_stage: "pdf_token_heuristic", page_count: 1, text_layer: "missing", image_based: true, ocr: "timed_out", quality },
}) as CvReview;
const noop = () => undefined;

describe("image-based CV on the score page", () => {
  it("shows a number and the ATS warning, with the rebuild as the primary action", () => {
    expect(isImageBasedReview(imageReview)).toBe(true);
    expect(hasCvText(placeholder)).toBe(false);
    const panel = renderToStaticMarkup(<CvReviewPanel review={imageReview} />);
    expect(panel).toContain(">10<");
    expect(panel).not.toContain("Score unavailable");
    expect(panel).toContain("ATS systems can’t read this CV because it’s saved as an image");
    expect(panel).toContain("Rebuild your CV with selectable text");
    const warning = renderToStaticMarkup(<AtsImageWarning note="Starting note" />);
    expect(warning).toContain('role="alert"');
    expect(warning).toContain("ATS systems can’t read your CV");
    expect(warning).toContain("an ATS sees an almost empty page and may reject it automatically");
    expect(warning).toContain("Starting note");
    const blank = renderToStaticMarkup(<ImageBasedActions recoveredText={false} converting={false} canOpen onRebuild={noop} onTailor={noop} onImprove={noop} onUploadAnother={noop} />);
    expect(blank.indexOf("Rebuild as an ATS-friendly CV")).toBeLessThan(blank.indexOf("Upload another CV"));
    expect(blank).not.toContain("Tailor for a job");
    expect(blank).not.toContain("Improve with AI");
    const recovered = renderToStaticMarkup(<ImageBasedActions recoveredText converting={false} canOpen onRebuild={noop} onTailor={noop} onImprove={noop} onUploadAnother={noop} />);
    expect(recovered.indexOf("Rebuild as an ATS-friendly CV")).toBeLessThan(recovered.indexOf("Tailor for a job"));
  });

  it("is fully translated for Turkish users", async () => {
    await i18n.changeLanguage("tr");
    const panel = renderToStaticMarkup(<CvReviewPanel review={imageReview} />);
    expect(panel).toContain("CV’n görsel olarak kaydedildiği için ATS sistemleri onu okuyamıyor");
    expect(panel).toContain("ATS sistemlerinin okuyabilmesi için CV’ni görsel yerine seçilebilir metinle yeniden oluştur.");
    expect(panel).toContain("İçinde hiç metin okuyamadık");
    expect(panel).toContain("Değerlendirilmedi: bu dosyada metin okuyamadık.");
    expect(panel).not.toContain("can't read");
    expect(renderToStaticMarkup(<AtsImageWarning />)).toContain("Canva gibi tasarım araçlarında");
    expect(renderToStaticMarkup(<ImageBasedActions recoveredText={false} converting={false} canOpen onRebuild={noop} onTailor={noop} onImprove={noop} onUploadAnother={noop} />)).toContain("ATS uyumlu CV olarak yeniden oluştur");
  });
});
