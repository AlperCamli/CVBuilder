import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CvReviewPanel } from "./CvReviewPanel";
import { AI_REVIEW_CRITERIA, reviewCv, scoreAiReview } from "../../../../backend/src/modules/cv-review/cv-review";
import type { CvContent } from "../integration/api-types";

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
    expect(visible).toContain("wording issue. “Built Python reporting tools” wording fix.");
    expect(visible).not.toContain("Score breakdown");
    expect(visible).not.toContain("wording assessment.");
    expect(evaluation).toContain("Score breakdown");
    expect(evaluation).toContain("wording assessment.");
    expect(evaluation).toContain("strict rubric");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });
});
