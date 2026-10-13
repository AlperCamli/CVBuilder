import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, ForbiddenError } from "../src/shared/errors/app-error";
import { randomUUID } from "node:crypto";
import { AiService } from "../src/modules/ai/ai.service";
import { RenderingService } from "../src/modules/rendering/rendering.service";
import type { MasterCvRecord, AiRunRecord } from "../src/shared/types/domain";
import type { SessionContext } from "../src/modules/ai/ai.types";
import type { AiProviderResult } from "../src/modules/ai/provider/ai-provider";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

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
    failRun: vi.fn(async (_owner, id, error, _debug?: unknown, output?: Record<string, unknown>) => { const run = runs.get(id); Object.assign(run, { status: "failed", progress_stage: "failed", error_message: error, ...(output ? { output_payload: output } : {}) }); return run; })
  };
  const masterRepository = {
    findById: vi.fn(async (owner, id) => masters.find(row => row.user_id === owner && row.id === id && !row.is_deleted) ?? null),
    listByUser: vi.fn(async owner => masters.filter(row => row.user_id === owner && !row.is_deleted)),
    create: vi.fn(async payload => { const created = { ...payload, id: randomUUID(), is_deleted: false, created_at: master.created_at, updated_at: master.updated_at }; masters.push(created); return created; })
  };
  const provider = {
    providerName: "fixture", resolveModelName: () => "fixture-model",
    generate: vi.fn(async (request: any): Promise<AiProviderResult> => ({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: request.input_payload.texts.map((item: any) => ({ path: item.path, text: item.text === "Analyst" ? "Analist" : item.text.replace(/^Delivered (.+) reports\.$/, "$1 rapor hazırladı.") })) } }))
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

describe("block translation orchestration", () => {
  it("translates blocks in bounded parallel calls, uses snapshotted admin headings, and sums usage once", async () => {
    const f = fixture();
    f.master.current_content.metadata.headline = "Private headline";
    f.master.current_content.sections[0].blocks = Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(f.master.current_content.sections[0].blocks[0]), id: `job-${i}` }));
    const catalog = { code: "de", name: "Deutsch", direction: "ltr", section_titles: { experience: "Berufserfahrung" } };
    (f.service as any).cvLanguages = { listActive: async () => [catalog] };
    const releases: Array<() => void> = [];
    let active = 0, peak = 0;
    f.provider.generate.mockImplementation(async request => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      expect(request.input_payload).not.toHaveProperty("source");
      expect(JSON.stringify(request.input_payload)).not.toContain("Private headline");
      expect(JSON.stringify(request.input_payload)).not.toContain("Company Ltd");
      expect(request.input_payload.texts).toHaveLength(2);
      expect(request.prompt.system_prompt).toContain("Deutsch");
      const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
      await request.onUsage({ provider: "fixture", model_name: "fixture-model", usage });
      return { provider: "fixture", model_name: "fixture-model", usage, output_payload: { translations: request.input_payload.texts.map((item: any) => ({ ...item, text: item.text === "Analyst" ? "Analytiker" : "20 Berichte erstellt." })) } };
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "de");
    catalog.section_titles.experience = "Updated after start";
    // Fixtures use reference-backed storage; imitate JSON database serialization.
    const stored = await f.repository.findRunById(f.session.appUser.id, start.ai_run_id);
    stored.input_payload.target_catalog = { ...catalog, section_titles: { experience: "Berufserfahrung" } };
    const execution = f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    for (let i = 0; i < 40 && f.provider.generate.mock.calls.length < 4; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.provider.generate).toHaveBeenCalledTimes(4);
    while (releases.length || f.provider.generate.mock.calls.length < 9) {
      releases.splice(0).forEach(release => release());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = await execution;
    expect(peak).toBe(4);
    expect(result.output_payload).toMatchObject({ translated_blocks: 9, current_content: { language: "de", sections: [{ title: "Berufserfahrung" }] } });
    expect(f.repository.recordRunUsage).toHaveBeenCalledTimes(1);
    expect(f.repository.recordRunUsage).toHaveBeenCalledWith(f.session.appUser.id, start.ai_run_id, expect.objectContaining({ usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 } }));
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
    const created = await f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id);
    expect(created.title).toBe("Main (Deutsch)");
    expect(created.current_content.metadata).toEqual(f.master.current_content.metadata);
  });
  it("fails the whole run if one block fails, records received usage and never charges", async () => {
    const f = fixture();
    f.master.current_content.sections[0].blocks.push({ ...structuredClone(f.master.current_content.sections[0].blocks[0]), id: "second" });
    const original = f.provider.generate.getMockImplementation()!;
    f.provider.generate.mockImplementation(async request => {
      const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
      await request.onUsage({ provider: "fixture", model_name: "fixture-model", usage });
      if (request.input_payload.texts[0].path.includes("blocks/1")) throw new Error("Provider unavailable");
      return original(request);
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Provider unavailable");
    expect(f.repository.recordRunUsage).toHaveBeenCalledWith(f.session.appUser.id, start.ai_run_id, expect.objectContaining({ usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 } }));
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    expect(f.masterRepository.create).not.toHaveBeenCalled();
    await expect(f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Translation is not ready");
  });
  it("rejects disabled, unknown and same languages before inference", async () => {
    const f = fixture();
    await expect(f.service.startTranslation(f.session, f.master.id, "de")).rejects.toThrow("available CV language");
    await expect(f.service.startTranslation(f.session, f.master.id, "en")).rejects.toThrow("another language");
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it("does not infer or charge for a heading-only CV and rejects disabling before apply", async () => {
    const f = fixture();
    f.master.current_content.sections[0].blocks = [];
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const result = await f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    expect(result.status).toBe("completed");
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    (f.service as any).cvLanguages = { listActive: async () => [] };
    await expect(f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("available CV language");
  });
});

describe("translation HTTP contract", () => {
  it("previews the completed snapshot with its original template, layout and signed photo without creating or charging again", async () => {
    const [{ default: express }, { default: request }, { createAiRouter }, { AiController }, { createErrorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../src/modules/ai/ai.routes"), import("../src/modules/ai/ai.controller"), import("../src/shared/middleware/error-handler"),
    ]);
    const f = fixture();
    const templateId = randomUUID();
    f.master.template_id = templateId;
    Object.assign(f.master.current_content.metadata, { font_scale: "0.85", spacing_scale: 0.8, layout_scale: 1.1, photo: randomUUID() });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const stored = await f.repository.findRunById(f.session.appUser.id, start.ai_run_id);
    stored.input_payload = structuredClone(stored.input_payload);
    const templates = { resolveTemplateForRendering: vi.fn(async () => ({ resolution: "selected", template: { id: templateId, name: "Minimal Professional", slug: "minimal-professional", status: "inactive", preview_config: null, export_config: null } })) };
    const photos = { resolveSignedUrl: vi.fn(async () => "https://example.invalid/signed-photo") };
    const app = express();
    app.use(createAiRouter(new AiController(f.service, new RenderingService(templates as any), photos as any), (req, _res, next) => { req.auth = f.session; next(); }, (_req, _res, next) => next()));
    app.use(createErrorHandler({ appEnv: "test" } as any));
    const path = `/master-cvs/${f.master.id}/translations/${start.ai_run_id}/preview`;
    await request(app).get(path).expect(409);
    await f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    f.master.template_id = randomUUID();
    f.master.current_content.metadata.font_scale = 1.15;
    const { body } = await request(app).get(path).expect(200);
    expect(templates.resolveTemplateForRendering).toHaveBeenCalledWith({ template_id: templateId, allow_inactive_selected: true });
    expect(body.data.current_content.metadata).toMatchObject({ font_scale: "0.85", spacing_scale: 0.8, layout_scale: 1.1 });
    expect(body.data.presentation.theme.tokens.font_family).toContain("Noto Sans");
    expect(body.data.presentation.sections[0].items[0].body).toContain("20 rapor");
    expect(body.data.presentation.header.photo).toBe("https://example.invalid/signed-photo");
    expect(photos.resolveSignedUrl).toHaveBeenCalledWith(f.session.appUser.id, stored.input_payload.source.current_content.metadata.photo);
    await request(app).get(path).expect(200);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
    expect(f.masterRepository.create).not.toHaveBeenCalled();
    await request(app).get(`/master-cvs/${randomUUID()}/translations/${start.ai_run_id}/preview`).expect(404);
    const owner = f.session.appUser.id;
    f.session.appUser.id = randomUUID();
    await request(app).get(path).expect(404);
    f.session.appUser.id = owner;
    f.master.is_deleted = true;
    await request(app).get(path).expect(404);
  });
  it("lists catalog languages, accepts admin-enabled languages and executes review/apply through the real controller", async () => {
    const [{ default: express }, { default: request }, { createAiRouter }, { AiController }, { createErrorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../src/modules/ai/ai.routes"), import("../src/modules/ai/ai.controller"), import("../src/shared/middleware/error-handler"),
    ]);
    const f = fixture();
    (f.service as any).cvLanguages = { listActive: async () => [{ code: "de", name: "Deutsch", direction: "ltr", section_titles: { experience: "Berufserfahrung" } }] };
    f.provider.generate.mockImplementation(async input => ({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: input.input_payload.texts.map((item: any) => ({ ...item, text: item.text === "Analyst" ? "Analytiker" : "20 Berichte erstellt." })) } }));
    const app = express();
    app.use(express.json());
    app.use(createAiRouter(new AiController(f.service, {} as any, {} as any), (req, _res, next) => { req.auth = f.session; next(); }, (_req, _res, next) => next()));
    app.use(createErrorHandler({ appEnv: "test" } as any));
    expect((await request(app).get("/cv-languages").expect(200)).body.data.languages[0].code).toBe("de");
    await request(app).post(`/master-cvs/${f.master.id}/translations`).send({ target_language: "fr" }).expect(400);
    await request(app).post(`/master-cvs/${f.master.id}/translations`).send({ target_language: "de", section_titles: {} }).expect(400);
    const started = await request(app).post(`/master-cvs/${f.master.id}/translations`).send({ target_language: "de" }).expect(202);
    const runId = started.body.data.ai_run_id;
    await request(app).post(`/master-cvs/${f.master.id}/translations/${runId}/execute`).expect(200);
    expect((await request(app).get(`/master-cvs/${f.master.id}/translations/${runId}`).expect(200)).body.data.status).toBe("completed");
    const created = await request(app).post(`/master-cvs/${f.master.id}/translations/${runId}/apply`).expect(201);
    expect(created.body.data.current_content.sections[0].title).toBe("Berufserfahrung");
    expect(created.body.data.current_content.metadata).toEqual(f.master.current_content.metadata);
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
  });
});

describe("automatic translation block retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only retries failed blocks, keeps four parallel workers and charges once after recovery", async () => {
    const f = fixture();
    f.master.current_content.sections[0].blocks = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(f.master.current_content.sections[0].blocks[0]), id: `job-${i}` }));
    const original = f.provider.generate.getMockImplementation()!;
    const attempts = new Map<string, number>();
    let active = 0, peak = 0;
    f.provider.generate.mockImplementation(async request => {
      const path = request.input_payload.texts[0].path;
      const attempt = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, attempt);
      expect(request.single_attempt).toBe(true);
      active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 10));
        const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
        await request.onUsage({ provider: "fixture", model_name: "fixture-model", usage });
        if (path.includes("blocks/1/") && attempt < 3) throw new AiProviderError("Temporary outage", { provider_status: 503 });
        if (path.includes("blocks/4/") && attempt === 1) return { provider: "fixture", model_name: "fixture-model", usage, output_payload: { translations: [] } };
        const result = await original(request);
        return { ...result, usage };
      } finally { active--; }
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const execution = f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    await vi.runAllTimersAsync();
    const result = await execution;
    expect(peak).toBe(4);
    expect([...attempts.values()]).toEqual([1, 3, 1, 1, 2, 1]);
    expect(f.provider.generate).toHaveBeenCalledTimes(9);
    expect(result.status).toBe("completed");
    expect((result.output_payload?.current_content as CvContent).sections[0].blocks).toHaveLength(6);
    expect(f.repository.recordRunUsage).toHaveBeenCalledWith(f.session.appUser.id, start.ai_run_id, expect.objectContaining({ usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 } }));
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
    expect(f.masterRepository.create).not.toHaveBeenCalled();
    await f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    expect(f.provider.generate).toHaveBeenCalledTimes(9);
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
  });

  it.each(["missing text", "malformed JSON", "changed numbers", "wrong language"])("retries a block with %s and accounts for result-only usage on every attempt", async problem => {
    const f = fixture();
    const original = f.provider.generate.getMockImplementation()!;
    f.provider.generate.mockImplementation(async request => {
      const result = await original(request);
      const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
      if (f.provider.generate.mock.calls.length === 1) {
        const output = problem === "missing text" ? { translations: [] }
          : problem === "malformed JSON" ? { unexpected: "wrong shape" }
          : { translations: request.input_payload.texts.map((item: any) => ({ ...item, text: problem === "changed numbers" ? item.text.replace("[[CV_NUMBER_A]]", "200") : `Professional experience and education skills${item.text.match(/\[\[CV_NUMBER_[A-Z]+\]\]/g)?.join(" ") ?? ""}` })) };
        return { ...result, usage, output_payload: output };
      }
      return { ...result, usage };
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const execution = f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    await vi.runAllTimersAsync();
    expect((await execution).status).toBe("completed");
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(f.repository.recordRunUsage).toHaveBeenCalledWith(f.session.appUser.id, start.ai_run_id, expect.objectContaining({ usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }));
    expect(f.billing.recordAiActionUsage).toHaveBeenCalledTimes(1);
  });

  it("stops after three attempts and preserves successful siblings without offering a partial CV", async () => {
    const f = fixture();
    f.master.current_content.sections[0].blocks.push({ ...structuredClone(f.master.current_content.sections[0].blocks[0]), id: "second" });
    const original = f.provider.generate.getMockImplementation()!;
    f.provider.generate.mockImplementation(async request => {
      if (request.input_payload.texts[0].path.includes("blocks/1/")) throw new AiProviderError("Temporary outage", { provider_status: 503 });
      return original(request);
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const failure = expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Temporary outage");
    await vi.runAllTimersAsync();
    await failure;
    expect(f.provider.generate.mock.calls.filter(([request]) => request.input_payload.texts[0].path.includes("blocks/0/"))).toHaveLength(1);
    expect(f.provider.generate.mock.calls.filter(([request]) => request.input_payload.texts[0].path.includes("blocks/1/"))).toHaveLength(3);
    expect((await f.service.getTranslation(f.session, f.master.id, start.ai_run_id)).status).toBe("failed");
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    expect(f.masterRepository.create).not.toHaveBeenCalled();
  });

  it.each([
    { reason: "provider_refusal" },
    { reason: "Invalid key", provider_status: 401 },
    { reason: "usage_record_failed" },
    { reason: "quota exceeded", provider_status: 429, provider_hard_quota_exceeded: true },
  ])("does not retry a permanent provider error: %j", async details => {
    const f = fixture();
    f.provider.generate.mockRejectedValue(new AiProviderError("Permanent failure", details));
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    await expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Permanent failure");
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
  });

  it("rechecks AI permission before retrying and stops if consent was withdrawn", async () => {
    const f = fixture();
    const privacy = { assertAi: vi.fn(async () => 1), assertAiUnchanged: vi.fn(async () => {}) };
    (f.service as any).privacy = privacy;
    f.provider.generate.mockImplementation(async () => {
      privacy.assertAi.mockRejectedValue(new ForbiddenError("AI processing withdrawn"));
      throw new AiProviderError("Temporary outage", { provider_status: 503 });
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const failure = expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("AI processing withdrawn");
    await vi.runAllTimersAsync();
    await failure;
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
  });
});

describe("reviewable numerical validation failures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retains a comparison after three failed attempts without creating or charging a CV", async () => {
    const f = fixture();
    f.provider.generate.mockImplementation(async request => ({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: request.input_payload.texts.map((item: any) => ({ ...item, text: item.text === "Analyst" ? "Analist" : "200 rapor hazırladı." })) } }));
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const execution = f.service.executeTranslation(f.session, f.master.id, start.ai_run_id);
    await vi.runAllTimersAsync();
    const result = await execution;
    expect(f.provider.generate).toHaveBeenCalledTimes(3);
    expect(f.provider.generate.mock.calls[0][0].input_payload.texts[1].text).toContain("[[CV_NUMBER_A]]");
    expect(result).toMatchObject({ status: "failed", output_payload: { target_language: "tr", validation_issues: [{ section_title: "Work Experience", block_title: "Analyst", field_label: "Description", original_text: "Delivered 20 reports.", translated_text: "200 rapor hazırladı.", original_numbers: ["20"], translated_numbers: ["200"] }] } });
    expect(result.output_payload).not.toHaveProperty("current_content");
    const polled = await f.service.getTranslation(f.session, f.master.id, start.ai_run_id);
    expect(polled.output_payload).toEqual(result.output_payload);
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
    expect(f.masterRepository.create).not.toHaveBeenCalled();
    await expect(f.service.applyTranslationRun(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("Translation is not ready");
    await expect(f.service.getTranslation({ ...f.session, appUser: { ...f.session.appUser, id: randomUUID() } }, f.master.id, start.ai_run_id)).rejects.toThrow("Translation was not found");
  });

  it("does not retain attempted text when AI permission is withdrawn before failure is persisted", async () => {
    const f = fixture();
    const privacy = { assertAi: vi.fn(async () => 1), assertAiUnchanged: vi.fn(async () => {}) };
    (f.service as any).privacy = privacy;
    f.provider.generate.mockImplementation(async input => {
      if (f.provider.generate.mock.calls.length === 3) privacy.assertAi.mockRejectedValue(new ForbiddenError("AI processing withdrawn"));
      return { provider: "fixture", model_name: "fixture-model", output_payload: { translations: input.input_payload.texts.map((item: any) => ({ ...item, text: item.text === "Analyst" ? "Analist" : "200 rapor hazırladı." })) } };
    });
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const failure = expect(f.service.executeTranslation(f.session, f.master.id, start.ai_run_id)).rejects.toThrow("AI processing withdrawn");
    await vi.runAllTimersAsync();
    await failure;
    expect((await f.service.getTranslation(f.session, f.master.id, start.ai_run_id)).output_payload).toBeNull();
    expect(f.repository.failRun.mock.calls.at(-1)?.[4]).toBeUndefined();
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
  });

  it("returns a failed result with HTTP 200 rather than blaming the user's request with HTTP 400", async () => {
    vi.useRealTimers();
    const [{ default: express }, { default: request }, { createAiRouter }, { AiController }, { createErrorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../src/modules/ai/ai.routes"), import("../src/modules/ai/ai.controller"), import("../src/shared/middleware/error-handler"),
    ]);
    const f = fixture();
    f.provider.generate.mockImplementation(async input => ({ provider: "fixture", model_name: "fixture-model", output_payload: { translations: input.input_payload.texts.map((item: any) => ({ ...item, text: item.text === "Analyst" ? "Analist" : "200 rapor hazırladı." })) } }));
    const app = express();
    app.use(express.json());
    app.use(createAiRouter(new AiController(f.service, {} as any, {} as any), (req, _res, next) => { req.auth = f.session; next(); }, (_req, _res, next) => next()));
    app.use(createErrorHandler({ appEnv: "test" } as any));
    const start = await f.service.startTranslation(f.session, f.master.id, "tr");
    const response = await request(app).post(`/master-cvs/${f.master.id}/translations/${start.ai_run_id}/execute`).expect(200);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: "failed", output_payload: { validation_issues: [{ original_numbers: ["20"], translated_numbers: ["200"] }] } });
    expect(f.billing.recordAiActionUsage).not.toHaveBeenCalled();
  });
});
