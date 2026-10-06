import { describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import type { AiRunRecord, JobRecord, MasterCvRecord, TailoredCvRecord } from "../src/shared/types/domain";
import type { TailoredCvDraftInput } from "../src/modules/ai/ai.types";
import type { SessionContext } from "../src/modules/ai/ai.types";

const content: CvContent = { version: "v1", language: "en", metadata: {}, sections: [{
  id: "experience", type: "experience", title: "Experience", order: 0, meta: {}, blocks: [{
    id: "experience-block", type: "experience", order: 0, visibility: "visible", meta: {},
    fields: { role: "Developer", company: "Example", description: "Responsible for internal reporting and maintenance of existing tools." }
  }]
}] };

function setup() {
  const master = { id: "master", current_content: content, language: "en" } as MasterCvRecord;
  let saved = { id: "tailored", current_content: content, language: "en", title: "Tailored", master_cv_id: master.id, module_type: "standard", status: "draft", created_at: "2026-10-06", updated_at: "2026-10-06" } as TailoredCvRecord;
  const job = { id: "job", job_title: "Developer", company_name: "Example", job_description: "Python reporting tools", status: "saved" } as JobRecord;
  const input: TailoredCvDraftInput = { master_cv_id: master.id, job: { job_title: job.job_title, job_description: job.job_description }, answers: [{ question_id: "priority_keywords", selected_options: ["Python"] }] };
  const billing = { assertActionAllowed: vi.fn(), recordTailoredCvGenerationUsage: vi.fn() };
  const updateById = vi.fn(async (_user: string, _id: string, payload: Partial<TailoredCvRecord>) => {
    saved = { ...saved, ...payload }; return saved;
  });
  const repository = { updateById };
  const aiRepository = { updateRunContext: vi.fn() };
  type Constructor = ConstructorParameters<typeof AiService>;
  const service = new AiService(aiRepository as unknown as Constructor[0], {} as Constructor[1], {} as Constructor[2], repository as unknown as Constructor[3], {} as Constructor[4], {} as Constructor[5], {} as Constructor[6], {} as Constructor[7], billing as unknown as Constructor[8]);
  const internal = service as unknown as {
    requireMasterCv: () => Promise<MasterCvRecord>;
    prepareDraftTarget: () => Promise<{ tailoredCv: TailoredCvRecord; job: JobRecord }>;
    ensureJobLinked: () => Promise<JobRecord>;
    executeFlow: (options: { input_payload: { master_cv: CvContent } }) => Promise<unknown>;
    executeRunFlow: (options: { input_payload: { master_cv: CvContent } }) => Promise<unknown>;
    tryCompleteRun: (user: string, run: string, payload: Record<string, unknown>) => Promise<{ run: AiRunRecord; claimed_completion: boolean }>;
    executeTailoringDraftRun: (user: string, run: AiRunRecord, input: TailoredCvDraftInput, prompt: unknown) => Promise<AiRunRecord>;
  };
  vi.spyOn(internal, "requireMasterCv").mockResolvedValue(master);
  vi.spyOn(internal, "prepareDraftTarget").mockImplementation(async () => ({ tailoredCv: saved, job }));
  vi.spyOn(internal, "ensureJobLinked").mockResolvedValue(job);
  const modelOutput = (options: { input_payload: { master_cv: CvContent } }) => {
    const current = structuredClone(options.input_payload.master_cv);
    current.sections[0].blocks[0].fields.description = "Built Python reporting tools for 200 users and reduced errors by 20%.";
    return { current_content: current, changed_block_ids: [current.sections[0].blocks[0].id] };
  };
  vi.spyOn(internal, "executeFlow").mockImplementation(async options => ({ ai_run: { id: "run" }, output: modelOutput(options), provider: "test", model_name: "test", prompt_key: "test", prompt_version: "1" }));
  vi.spyOn(internal, "executeRunFlow").mockImplementation(async options => ({ output_payload: modelOutput(options), provider: "test", model_name: "test" }));
  vi.spyOn(internal, "tryCompleteRun").mockImplementation(async (_user, id, payload) => ({ run: { id, output_payload: payload } as AiRunRecord, claimed_completion: true }));
  return { service, internal, billing, input, getSaved: () => saved };
}

describe("tailoring review persistence", () => {
  it("returns and persists a comparison against the final post-processed synchronous draft", async () => {
    const { service, input, getSaved, billing } = setup();
    const result = await service.generateTailoredCvDraft({ appUser: { id: "user" } } as SessionContext, input);
    const review = result.tailored_cv.tailoring_review!;
    expect(review).toEqual(getSaved().tailoring_review);
    expect(review.score_change).toBeGreaterThan(0);
    expect(review.added_keywords).toContain("python");
    expect(review.changed_sections).toContain("skills");
    expect(result.tailored_cv.current_content.sections.some(s => s.type === "skills")).toBe(true);
    expect(billing.recordTailoredCvGenerationUsage).toHaveBeenCalledTimes(1);
  });

  it("includes the same persisted comparison in asynchronous run completion", async () => {
    const { internal, input, getSaved, billing } = setup();
    const result = await internal.executeTailoringDraftRun("user", { id: "run", input_payload: {} } as AiRunRecord, input, { prompt_key: "test", prompt_version: "1" });
    const tailored = (result.output_payload as { tailored_cv: TailoredCvRecord }).tailored_cv;
    expect(tailored.tailoring_review).toEqual(getSaved().tailoring_review);
    expect(tailored.tailoring_review?.score_change).toBeGreaterThan(0);
    expect(tailored.tailoring_review?.changes.some(change => change.dimension === "quality")).toBe(true);
    expect(billing.recordTailoredCvGenerationUsage).toHaveBeenCalledTimes(1);
  });
});
