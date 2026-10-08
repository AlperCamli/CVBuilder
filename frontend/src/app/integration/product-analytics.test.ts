import {describe, expect, it, vi} from "vitest";
import {withProductAnalytics} from "./product-analytics";
import {trackEvent} from "./analytics";
vi.mock("./analytics", () => ({trackEvent: vi.fn()}));
describe("product activity coverage", () => {
  it("reports CV and AI outcomes without request bodies, IDs or content", async () => {
    vi.mocked(trackEvent).mockClear();
    const client = withProductAnalytics({put: async () => ({private: "content"}), post: async () => ({})} as any);
    await client.put("/master-cvs/private-id/content", {current_content: {email: "private@example.invalid"}});
    await client.post("/ai/blocks/suggest", {user_instruction: "private instruction"});
    expect(trackEvent).toHaveBeenNthCalledWith(1, "product_action", {action: "cv_updated", result: "success"});
    expect(trackEvent).toHaveBeenNthCalledWith(2, "product_action", {action: "ai_block_suggestion", result: "success"});
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain("private");
  });
  it("records a failed API operation and preserves its error for the UI", async () => {
    const failure = new Error("private provider text");
    const client = withProductAnalytics({post: async () => {throw failure;}} as any);
    await expect(client.post("/ai/import-improve", {})).rejects.toBe(failure);
    expect(trackEvent).toHaveBeenLastCalledWith("product_action", {action: "ai_cv_improvement", result: "failure"});
  });
  it("does not let analytics errors prevent a successful database save", async () => {
    vi.mocked(trackEvent).mockImplementationOnce(() => {throw new Error("analytics unavailable");});
    const client = withProductAnalytics({patch: async () => ({saved: true})} as any);
    await expect(client.patch("/jobs/private-id/status", {status: "applied"})).resolves.toEqual({saved: true});
  });
});
