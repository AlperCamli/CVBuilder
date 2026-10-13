import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AiService } from "../src/modules/ai/ai.service";
import type { MasterCvRecord, AiRunRecord } from "../src/shared/types/domain";
import type { SessionContext } from "../src/modules/ai/ai.types";

function fixture() {
  const userId = randomUUID();
  const session = { appUser: { id: userId, locale: "tr" }, authUser: {} } as SessionContext;
  const master: MasterCvRecord = { id: randomUUID(), user_id: userId, title: "Main", language: "en", module_type: "standard", template_id: null, source_type: "scratch", is_deleted: false, summary_text: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), current_content: { version: "v1", language: "en", metadata: { full_name: "Çağrı Işık", email: "cagri@example.com" }, sections: [{ id: "experience", type: "experience", title: "Work Experience", order: 0, meta: {}, blocks: [{ id: "job", type: "experience", order: 0, visibility: "visible", fields: { role: "Analyst", company: "Company Ltd", description: "Delivered 20 reports." }, meta: {} }] }] } };
  const masters = [master];
  const runs = new Map<string, any>();
  const repository = {
    createRun: vi.fn(async payload => { const run = { ...payload, id: randomUUID(), status: "pending", progress_stage: "queued", output_payload: null, error_message: null }; runs.set(run.id, run); return run; }),
    findRunById: vi.fn(async (owner, id) => { const run = runs.get(id); return run?.user_id === owner ? run : null; }),
    claimRunForExecution: vi.fn(async (owner, id) => { const run = runs.get(id); if (!run || run.user_id !== owner || run.progress_stage !== "queued") return null; run.progress_stage = "calling_model"; return run; }),
    updateRunProgressStage: vi.fn(async (_owner, id, stage) => { const run = runs.get(id); run.progress_stage = stage; return run; }),
    recordRunUsage: vi.fn(async () => {}),
    completeRun: vi.fn(async (_owner, id, output) => { const run = runs.get(id); Object.assign(run, { output_payload: output, status: "completed", progress_stage: "completed" }); return run; }),
    failRun: vi.fn(async (_owner, id, error) => { const run = runs.get(id); Object.assign(run, { status: "failed", progress_stage: "failed", error_message: error }); return run; })
  };
  const masterRepository = {
    findById: vi.fn(async (owner, id) => masters.find(row => row.user_id === owner && row.id === id && !row.is_deleted) ?? null),
    listByUser: vi.fn(async owner => masters.filter(row => row.user_id === owner && !row.is_deleted)),
    create: vi.fn(async payload => { const created = { ...payload, id: randomUUID(), is_deleted: false, created_at: master.created_at, updated_at: master.updated_at }; masters.push(created); return created; })
  };
  const provider = {
    providerName: "fixture", resolveModelName: () => "fixture-model",
    generate: vi.fn(async request => ({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: request.input_payload.texts.map((item: any) => ({ path: item.path, text: ({ "Work Experience": "İş Deneyimi", Analyst: "Analist", "Delivered 20 reports.": "20 rapor hazırladı." } as Record<string, string>)[item.text] ?? item.text })) } }))
  };
  const billing = { assertActionAllowed: vi.fn(async () => {}), recordAiActionUsage: vi.fn(async () => {}) };
  const resolver = { resolve: vi.fn(async input => ({ ...input.fallback, user_prompt_template: null })) };
  const service = new AiService(repository as any, provider as any, masterRepository as any, {} as any, {} as any, {} as any, {} as any, resolver as any, billing as any);
  return { service, session, master, masters, repository, masterRepository, provider, billing };
}

describe("translation start, execution, review and apply", () => {
  it("uses atomic completion with the current allowance across simultaneous execution requests", async () => {
    const f = fixture();
    const complete = vi.fn(async (owner: string, id: string, output: Record<string, unknown>, _max: number | null) => f.repository.completeRun(owner, id, output));
    (f.repository as any).completeTranslationRun = complete;
    (f.billing as any).getBillingEntitlements = vi.fn(async () => ({ limits: { ai_actions: 20 } }));
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await Promise.all([f.service.executeTranslation(f.session, f.master.id, start.ai_run_id), f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)]);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][3]).toBe(20);
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
  });
  it("creates a reviewed independent master and charges successful inference once across retries", async () => {
    const f = fixture();
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    expect(f.masterRepository.create).not.toHaveBeenCalled();
    await f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    await f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
    const review = await f.service.getTranslation(f.session, f.master.id, start.ai_run_id);
    expect(review.status).toBe("completed");
    expect(f.masters).toHaveLength(1);
    const translated = await f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id);
    expect(translated.language).toBe("tr");
    expect(translated.current_content.metadata).toEqual(f.master.current_content.metadata);
    expect(f.master.current_content.sections[0].title).toBe("Work Experience");
    await expect(f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id)).rejects.toMatchObject({ details: { existing_master_cv_id: translated.id } });
    expect(f.masters).toHaveLength(2);
  });
  it("rejects another owner's run and an already occupied language", async () => {
    const f = fixture();
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await expect(f.service.getTranslation({ ...f.session, appUser: { ...f.session.appUser, id: randomUUID() } }, f.master.id, start.ai_run_id)).rejects.toThrow("Translation was not found");
    f.masters.push({ ...f.master, id: randomUUID(), language: "tr" });
    await expect(f.service.startTranslation(f.session, f.master.id, "tr")).rejects.toMatchObject({ details: { reason: "master_language_exists" } });
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it("does not charge when a valid translation cannot be persisted", async () => {
    const f = fixture();
    f.repository.completeRun.mockRejectedValueOnce(new Error("Database unavailable"));
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Database unavailable");
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    expect(f.masterRepository.create).not.toHaveBeenCalled();
  });
  it("persists failure without charging or creating a partial master", async () => {
    const f = fixture();
    f.provider.generate.mockResolvedValue({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: [] } });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow();
    expect((await f.service.getTranslation(f.session, f.master.id, start.ai_run_id)).status).toBe("failed");
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    expect(f.masterRepository.create).not.toHaveBeenCalled();
  });
});
