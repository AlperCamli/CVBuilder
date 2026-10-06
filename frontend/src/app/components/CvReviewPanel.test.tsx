import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CvReviewPanel, TailoringReviewPanel } from "./CvReviewPanel";
import { reviewCv, reviewTailoring } from "../../../../backend/src/modules/cv-review/cv-review";
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
    expect(html).toContain("Add a job description");
    expect(html).toContain("Measurable achievements");
    expect(html).toContain("Name missing");
    expect(html).toContain("sum of (dimension score × weight)");
  });

  it("shows a score decrease honestly and labels the generation snapshot", () => {
    const after = structuredClone(content);
    after.sections[0].blocks[0].fields.description = "Responsible for internal reporting and maintenance of existing tools.";
    const review = reviewTailoring(content, after, { job_title: "Developer", job_description: "Python reporting" });
    const html = renderToStaticMarkup(<TailoringReviewPanel review={review} />);
    expect(review.score_change).toBeLessThan(0);
    expect(html).toContain("decreased");
    expect(html).toContain("Before tailoring");
    expect(html).toContain("Why the score changed");
    expect(html).toContain("Later edits are not included");
    expect(html).toContain("Job terms no longer covered");
  });
});
