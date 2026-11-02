import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CvReviewPanel } from "./CvReviewPanel";
import { AI_REVIEW_CRITERIA, reviewCv, scoreAiReview } from "../../../../backend/src/modules/cv-review/cv-review";
import type { CvContent, CvReview } from "../integration/api-types";

const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => motionPreference.reduced };
});
afterEach(() => { motionPreference.reduced = false; });

const content: CvContent = { version: "v1", language: "en", metadata: {}, sections: [{
  id: "experience", type: "experience", title: "Experience", order: 0, meta: {}, blocks: [{
    id: "block", type: "experience", order: 0, visibility: "visible", meta: {}, fields: {
      role: "Developer", company: "Example", description: "Built Python reporting tools for 200 users and reduced errors by 20%."
    }
  }]
}] };

describe("CV review presentation", () => {
  it("shows recovery advice without a numerical score or positive feedback after parsing failure", () => {
    const html = renderToStaticMarkup(<CvReviewPanel review={reviewCv({ content: null, import_status: "failed" })} />);
    expect(html).toContain("Score unavailable");
    expect(html).toContain("ATS compatibility issue");
    expect(html).toContain("Upload a text-based PDF or DOCX");
    expect(html).not.toContain(" / 100");
    expect(html).not.toContain('aria-label="Strengths"');
    expect(html).not.toContain("Score breakdown");
  });

  it("labels unavailable dimensions and shows evidence and the actual evaluation formula", () => {
    const html = renderToStaticMarkup(<CvReviewPanel review={reviewCv({ content })} />);
    expect(html).not.toContain("Partial review");
    expect(html).not.toContain("% of the rubric assessed");
    const evaluation = html.slice(html.indexOf('<details class="group'));
    expect(html.slice(0, html.indexOf('<details class="group'))).not.toContain("Score breakdown");
    expect(evaluation).toContain("Score breakdown");
    expect(evaluation).toContain("Not assessed");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).toContain("Not assessed");
    expect(html).toContain("assessed by the AI review, which was not available");
    expect(html).toContain("Measurable results");
    expect(html).toContain("Name missing");
    expect(html).toContain("sum of (dimension score × weight)");
  });

  it("shows AI-rated weaknesses with their CV quote up front and keeps the method collapsed", () => {
    const review = scoreAiReview({ content }, { criteria: AI_REVIEW_CRITERIA.map(id => ({
      id, level: id === "wording" ? 1 : 2, assessment: `${id} assessment.`, strength: null,
      issue: `${id} issue.`, quote: id === "wording" ? "Built Python reporting tools" : null, fix: `${id} fix.`
    })) });
    const html = renderToStaticMarkup(<CvReviewPanel review={review} />);
    const [visible, evaluation] = [html.slice(0, html.indexOf('<details class="group')), html.slice(html.indexOf('<details class="group'))];
    expect(visible).toContain(`>${review.score}<`);
    // Issue, quoted line and fix are separate parts of the weakness card, in that order.
    const card = visible.slice(visible.indexOf(">wording issue.<"));
    expect(card).toMatch(/>wording issue\.<[\s\S]*Quote from your CV:[\s\S]*“Built Python reporting tools”[\s\S]*How to fix[\s\S]*>wording fix\.</);
    expect(visible).not.toContain("Score breakdown");
    expect(visible).not.toContain("wording assessment.");
    expect(evaluation).toContain("Score breakdown");
    expect(evaluation).toContain("wording assessment.");
    expect(evaluation).toContain("strict rubric");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });
});

// The product owner's own review (BRIEF.md), stored before improvement_details existed.
const SAMPLE_WEAKNESSES = [
  "Deneyimlerin çoğu görev anlatıyor; sonuç veya ölçek düzenli biçimde ölçülmemiş. Her rolde mümkünse gerçek kullanıcı, gelir, zaman tasarrufu veya çıktı sayılarını ekleyin; ölçemediğiniz sonuçları sayı uydurmadan açıklayın.",
  "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor. “Supported online store management and digital marketing initiatives.” Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın.",
  "Özet birden fazla yönü aynı anda sunuyor ve hangi role başvurulduğunu belirtmiyor. “hands-on experience in Business Intelligence, data modeling, and SAP consulting.” Başvuracağınız hedef rolü belirleyip özeti, beceri sırasını ve deneyim vurgularını bu role göre uyumlu hale getirin."
];
const sample = (): CvReview => ({
  version: "cv-review-v2", method: "ai", status: "complete", score: 71, assessed_weight: 100,
  summary: "Good foundation, not yet competitive. All seven review dimensions were assessed.",
  dimensions: [],
  strengths: ["Experience depth: End-to-end BI pipeline and product scope are described.", "Skills backed by experience: React, TypeScript and Supabase appear in the experience.", "Name and contact details: Name found; contact method found."],
  improvements: SAMPLE_WEAKNESSES,
  matched_keywords: [], missing_keywords: [], limitations: []
});
const renderPanel = (review: CvReview, reveal = { key: "import-1" }) => renderToStaticMarkup(<CvReviewPanel review={review} reveal={reveal} />);
const strengthTexts = ["Your roles show real scope and ownership.", "Your skills are backed by your experience.", "Your name and contact details are included."];
const weaknessTexts = [
  "Deneyimlerin çoğu görev anlatıyor",
  "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor.",
  "Supported online store management and digital marketing initiatives.",
  "Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın.",
  "hands-on experience in Business Intelligence, data modeling, and SAP consulting.",
  "Başvuracağınız hedef rolü belirleyip"
];

describe("CV score reveal (guided cascade)", () => {
  it("has every strength and weakness in the first render, in reading order, hidden only visually", () => {
    const html = renderPanel(sample());
    const order = ["Your CV score: 71", ...strengthTexts, ...weaknessTexts, "How we evaluate your CV"].map(text => html.indexOf(text));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The cascade starts hidden (opacity/transform only); nothing is removed from layout or the a11y tree.
    expect(html).toContain("opacity:0");
    expect(html).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    const hidden = html.match(/<[a-z]+[^>]*aria-hidden="true"[^>]*>/g) ?? [];
    expect(hidden.length).toBeGreaterThan(0);
    for (const tag of hidden) expect(tag).toMatch(/^<svg|class="(sp-ring-number|sp-badge|sp-heading-icon|sp-skip-bar)"/);
    // The skip control is there from the start.
    expect(html).toContain("data-reveal-skip");
    expect(html).toContain("Show all");
  });

  it("keeps the evaluation method in a collapsed details section, after the weaknesses", () => {
    const html = renderPanel(sample());
    expect(html).toMatch(/<details class="group sp-how"/);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).not.toContain("Score breakdown");
    expect(visible).not.toContain("weighted average");
  });

  it("splits stored weakness strings into issue, highlighted quote and a How to fix box", () => {
    const html = renderPanel(sample());
    expect(html.match(/class="sp-fix"/g)).toHaveLength(2);
    expect(html.match(/<mark class="sp-mark"/g)).toHaveLength(2);
    expect(html).toContain("“Supported online store management and digital marketing initiatives.”");
    // Without a quote the whole string is the issue.
    expect(html).toContain(`<p class="sp-issue">${SAMPLE_WEAKNESSES[0]}</p>`);
  });

  it("shows the final state with reduced motion: no count-up, no hidden items, no skip pill", () => {
    motionPreference.reduced = true;
    const html = renderPanel(sample());
    expect(html).toContain("sp-fade");
    expect(html).toMatch(/aria-hidden="true">71</);
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("data-reveal-skip");
    for (const text of [...strengthTexts, ...weaknessTexts]) expect(html).toContain(text);
  });

  it("fades unscorable and image-based reviews in instead of playing the cascade", () => {
    const unscorable = renderPanel(reviewCv({ content: null, import_status: "failed" }) as CvReview);
    expect(unscorable).toContain("sp-fade");
    expect(unscorable).toContain("Score unavailable");
    expect(unscorable).not.toContain("data-reveal-skip");
    const image = renderToStaticMarkup(<CvReviewPanel review={sample()} reveal={{ key: "import-2", simple: true }} />);
    expect(image).toContain("sp-fade");
    expect(image).not.toContain("opacity:0");
  });

  it("is static without the reveal option", () => {
    const html = renderToStaticMarkup(<CvReviewPanel review={sample()} />);
    expect(html).not.toContain("sp-fade");
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("data-reveal-skip");
    expect(html).toMatch(/aria-hidden="true">71</);
  });
});
