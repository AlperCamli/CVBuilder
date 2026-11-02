import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import { aiImportImproveSchema } from "../src/modules/ai/ai.schemas";
import { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../src/modules/ai/provider/ai-provider";
import { MockAiProvider } from "../src/modules/ai/provider/mock-ai-provider";
import { scoreAiReview } from "../src/modules/cv-review/cv-review";
import type { CvScoreImprovementRecordInput } from "../src/modules/cv-review/cv-score-improvements.repository";
import type { ImportDetailRow } from "../src/modules/imports/imports.repository";
import type { ParseCvFileDiagnostics } from "../src/modules/imports/parsers/cv-parser";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import type { ImportRecord, UserRecord } from "../src/shared/types/domain";
import type { SessionContext } from "../src/modules/imports/imports.types";
import { trackedAiService } from "./helpers/tracked-ai-service";

// POST /ai/import-improve with import_id: the real AiService, prompt registry and mock provider run
// the improvement fan-out and the cv_review_verify run; imports and the score table are in memory.
const now = () => new Date().toISOString();
const content = (): CvContent => ({
  version: "v1", language: "en", metadata: {}, sections: [
    { id: "h", type: "header", title: "Header", order: 0, meta: {}, blocks: [{ id: "h1", type: "header", order: 0, visibility: "visible", fields: { full_name: "Alex Doe", email: "alex@example.com" }, meta: {} }] },
    { id: "e", type: "experience", title: "Experience", order: 1, meta: {}, blocks: [{ id: "e1", type: "experience", order: 0, visibility: "visible", fields: { role: "Data Analyst", company: "Example Ltd", description: ["Built BI dashboards for 40 managers.", "Was responsible for weekly sales reporting."] }, meta: {} }] },
    { id: "d", type: "education", title: "Education", order: 2, meta: {}, blocks: [{ id: "d1", type: "education", order: 0, visibility: "visible", fields: { degree: "Economics", institution: "Example University" }, meta: {} }] },
    { id: "s", type: "skills", title: "Skills", order: 3, meta: {}, blocks: [{ id: "s1", type: "skills", order: 0, visibility: "visible", fields: { skills: ["SQL", "Power BI"] }, meta: {} }] }
  ]
});
const rawText = "Alex Doe Data Analyst at Example Ltd. Built BI dashboards for 40 managers and was responsible for weekly sales reporting.";
const diagnostics: ParseCvFileDiagnostics = { mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text", quality: { score: 100, confidence: "high", low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 } };
const session = (userId: string): SessionContext => {
  const appUser = { id: userId, auth_user_id: "auth-user", email: "tester@cvbuilder.dev", full_name: "Test User", locale: "en", default_cv_language: "en", onboarding_completed: true, onboarding_state: {}, created_at: now(), updated_at: now() } as UserRecord;
  return { authUser: { auth_user_id: appUser.auth_user_id, email: appUser.email, full_name: appUser.full_name, locale: appUser.locale }, appUser };
};
const reviewOutput = {
  criteria: (["impact", "wording", "depth", "focus", "skills_evidence"] as const).map(id => ({ id, level: 2, assessment: `The ${id} assessment.`, strength: null, issue: `The ${id} issue.`, quote: null, fix: `The ${id} fix.` }))
};

function setup(options: { failVerify?: boolean; failStore?: boolean } = {}) {
  const userId = randomUUID();
  const importId = randomUUID();
  const stored = scoreAiReview({ content: content(), import_status: "parsed", raw_text: rawText, diagnostics }, reviewOutput);
  const importRow = { id: importId, user_id: userId, source_file_id: randomUUID(), target_master_cv_id: null, status: "parsed", module_type: "standard", parser_name: "smart_pdf_parser_v2", raw_extracted_text: rawText, parsed_content: content(), review_context: { diagnostics, warnings: [], cv_review: stored }, error_message: null, created_at: now(), updated_at: now() } as ImportRecord;
  const imports = { findImportDetailById: vi.fn(async (owner: string, id: string) => owner === userId && id === importId ? ({ importRow } as ImportDetailRow) : null) };
  const scores: CvScoreImprovementRecordInput[] = [];
  const store = { create: vi.fn(async (row: CvScoreImprovementRecordInput) => { if (options.failStore) throw new Error("db down"); scores.push(row); }) };
  const calls: string[] = [];
  const mock = new MockAiProvider("mock-model");
  const provider: AiProvider = {
    providerName: "mock",
    resolveModelName: () => "mock-model",
    async generate(request: AiProviderRequest): Promise<AiProviderResult> {
      calls.push(request.flow_type);
      if (request.flow_type === "cv_review_verify" && options.failVerify) throw new Error("simulated verify outage");
      return mock.generate(request);
    }
  };
  const tracked = trackedAiService(provider);
  const billing = { claimFreeUse: vi.fn(async () => ({ kind: "improve" })), releaseFreeUse: vi.fn(async () => undefined), recordAiActionUsage: vi.fn(async () => undefined), assertActionAllowed: vi.fn(async () => undefined) };
  const logger = { warn: vi.fn() };
  const service = new AiService(tracked.repository, provider, {} as never, {} as never, {} as never, {} as never, {} as never,
    new AiPromptResolver({ listActiveByProfile: async () => [] }, "test"), billing as never, undefined, undefined,
    { logger, scoreImprovements: { imports, store } });
  return { userId, importId, stored, service, tracked, scores, store, calls, billing, logger, session: session(userId) };
}

describe("POST /ai/import-improve score_improvement", () => {
  it("returns and stores a higher score anchored on the upload's stored review", async () => {
    const f = setup();
    const result = await f.service.improveImportedContent(f.session, { parsed_content: content() as never, import_id: f.importId });
    expect(f.stored.score).toBe(66);
    expect(result.score_improvement).toEqual({ before: 66, after: expect.any(Number) });
    expect(result.score_improvement!.after).toBeGreaterThan(66);
    expect(f.scores).toHaveLength(1);
    expect(f.scores[0]).toMatchObject({ user_id: f.userId, import_id: f.importId, score_before: 66, score_after: result.score_improvement!.after });
    expect(f.scores[0].review_after).toMatchObject({ version: "cv-review-v2", method: "ai", score: result.score_improvement!.after });
    expect(f.scores[0].review_after.limitations.at(-1)).toMatch(/updated after an AI improvement/);
    // The verify run is tracked, linked to the upload and never sees contact details.
    const verifyRun = [...f.tracked.runs.values()].find(run => run.flow_type === "cv_review_verify")!;
    expect(verifyRun).toMatchObject({ status: "completed", user_id: f.userId, import_id: f.importId });
    expect(JSON.stringify(verifyRun.input_payload)).not.toMatch(/alex@example\.com|Alex Doe/);
    expect(f.calls.at(-1)).toBe("cv_review_verify");
    // One free-use claim for the improvement itself; the score neither claims nor releases one.
    expect(f.billing.claimFreeUse).toHaveBeenCalledTimes(1);
    expect(f.billing.releaseFreeUse).not.toHaveBeenCalled();
  });

  it("stays backward compatible: no import_id, or an upload of another account, gives null without a verify run", async () => {
    const f = setup();
    expect((await f.service.improveImportedContent(f.session, { parsed_content: content() as never })).score_improvement).toBeNull();
    const other = setup();
    expect((await other.service.improveImportedContent(other.session, { parsed_content: content() as never, import_id: f.importId })).score_improvement).toBeNull();
    expect([...f.calls, ...other.calls]).not.toContain("cv_review_verify");
    expect(f.scores).toHaveLength(0);
    expect(other.scores).toHaveLength(0);
  });

  it("never fails the improvement when verification or storage fails", async () => {
    const f = setup({ failVerify: true });
    const result = await f.service.improveImportedContent(f.session, { parsed_content: content() as never, import_id: f.importId });
    expect(result.improved_content.sections.length).toBeGreaterThan(0);
    expect(result.score_improvement!.after).toBeGreaterThanOrEqual(66);
    expect(f.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "AI_VERIFY_FAILED" }), expect.any(String));
    expect(f.billing.releaseFreeUse).not.toHaveBeenCalled();
    const g = setup({ failStore: true });
    const stored = await g.service.improveImportedContent(g.session, { parsed_content: content() as never, import_id: g.importId });
    expect(stored.score_improvement!.after).toBeGreaterThan(66);
    expect(g.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "STORE_FAILED" }), expect.any(String));
  });

  it("accepts import_id but never a client-sent score", () => {
    const base = { parsed_content: content() };
    expect(aiImportImproveSchema.safeParse({ ...base, import_id: randomUUID() }).success).toBe(true);
    expect(aiImportImproveSchema.safeParse({ ...base, import_id: "not-a-uuid" }).success).toBe(false);
    expect(aiImportImproveSchema.safeParse({ ...base, score_improvement: { before: 10, after: 99 } }).success).toBe(false);
  });
});
