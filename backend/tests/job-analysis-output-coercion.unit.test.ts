import { describe, expect, it } from "vitest";
import { coerceJobAnalysisOutputPayload } from "../src/modules/ai/job-analysis-output-coercion";
import { jobAnalysisOutputSchema } from "../src/modules/ai/flows/flow-contracts";

describe("coerceJobAnalysisOutputPayload", () => {
  it("clamps overflow keyword and topic lists to contract limits", () => {
    const payload = {
      topics: Array.from({ length: 25 }, (_, index) => `topic ${index}`),
      keywords: Array.from({ length: 40 }, (_, index) => `keyword ${index}`)
    };

    const coerced = coerceJobAnalysisOutputPayload(payload);

    expect((coerced.topics as string[]).length).toBe(20);
    expect((coerced.keywords as string[]).length).toBe(30);
    expect(jobAnalysisOutputSchema.safeParse(coerced).success).toBe(true);
  });

  it("drops empty, non-string, and over-length entries", () => {
    const payload = {
      topics: ["  valid topic  ", "", "   ", 42, "x".repeat(200)],
      keywords: ["sales operations", null, "y".repeat(100)]
    };

    const coerced = coerceJobAnalysisOutputPayload(payload);

    expect(coerced.topics).toEqual(["valid topic"]);
    expect(coerced.keywords).toEqual(["sales operations"]);
    expect(jobAnalysisOutputSchema.safeParse(coerced).success).toBe(true);
  });

  it("passes through missing or non-array values so contract violations still surface", () => {
    const coerced = coerceJobAnalysisOutputPayload({ topics: "not-an-array" });

    expect(coerced.topics).toBe("not-an-array");
    expect(jobAnalysisOutputSchema.safeParse(coerced).success).toBe(false);
  });
});
