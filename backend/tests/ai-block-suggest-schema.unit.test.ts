import { describe, expect, it } from "vitest";
import { aiBlockSuggestSchema } from "../src/modules/ai/ai.schemas";

const basePayload = {
  master_cv_id: "11111111-1111-4111-8111-111111111111",
  block_id: "summary-1"
};

describe("AI block suggestion request schema", () => {
  it.each(["improve", "summarize", "expand", "ats_optimize"])(
    "accepts supported action %s",
    (actionType) => {
      const parsed = aiBlockSuggestSchema.safeParse({
        ...basePayload,
        action_type: actionType
      });

      expect(parsed.success).toBe(true);
    }
  );

  it.each(["rewrite", "shorten", "options"])("rejects removed action %s", (actionType) => {
    const parsed = aiBlockSuggestSchema.safeParse({
      ...basePayload,
      action_type: actionType
    });

    expect(parsed.success).toBe(false);
  });
});
