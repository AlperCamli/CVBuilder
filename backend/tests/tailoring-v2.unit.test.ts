import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiService } from "../src/modules/ai/ai.service";
import type { AiRepository, AiRunOwner } from "../src/modules/ai/ai.repository";
import { computeRunCostUsd } from "../src/modules/ai/ai-cost";
import type { SessionContext } from "../src/modules/ai/ai.types";
import { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider, AiProviderRequest } from "../src/modules/ai/provider/ai-provider";
import { MockAiProvider } from "../src/modules/ai/provider/mock-ai-provider";
import { buildStrictOpenAiResponseJsonSchema } from "../src/modules/ai/provider/openai-ai-provider";
import { tailoringSkillsOutputSchema } from "../src/modules/ai/flows/flow-contracts";
import { AI_FLOW_REGISTRY, TAILORING_LANGUAGE_RULE } from "../src/modules/ai/flows/flow-registry";
import { buildCompactCv, toAnalysisCvPayload } from "../src/modules/tailoring/tailoring-compact-cv";
import {
  computeTailoringScore,
  guardGeneratedLines,
  guardSkills,
  normalizeAnalysisOutput
} from "../src/modules/tailoring/tailoring-rules";
import { planTailoringTasks, TailoringService } from "../src/modules/tailoring/tailoring.service";
import type { TailoringAnalysis } from "../src/modules/tailoring/tailoring.types";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import type { AiRunRecord, AiSuggestionRecord, JobRecord, MasterCvRecord, TailoredCvRecord } from "../src/shared/types/domain";
import { InMemoryTailoringRepository } from "./helpers/in-memory-tailoring";

const NOW = "2026-10-27T10:00:00.000Z";

const cvContent = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "header-s",
      type: "header",
      title: null,
      order: 0,
      meta: {},
      blocks: [{ id: "header-b", type: "header", order: 0, visibility: "visible", meta: {}, fields: { full_name: "Ada Lovelace", email: "ada@example.com" } }]
    },
    {
      id: "summary-s",
      type: "summary",
      title: "Summary",
      order: 1,
      meta: {},
      blocks: [{ id: "summary-b", type: "summary", order: 0, visibility: "visible", meta: {}, fields: { text: "Engineer with 8 years of experience." } }]
    },
    {
      id: "exp-s",
      type: "experience",
      title: "Experience",
      order: 2,
      meta: {},
      blocks: [
        {
          id: "exp-1",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          meta: {},
          fields: { role: "Backend Engineer", company: "Acme", start_date: "2020", description: "• Built payment APIs used by 3 teams\n• Ran on-call rotation" }
        },
        {
          id: "exp-2",
          type: "experience_item",
          order: 1,
          visibility: "hidden",
          meta: {},
          fields: { role: "Intern", company: "Hidden Co", description: "• Hidden work" }
        },
        { id: "exp-3", type: "experience_item", order: 2, visibility: "visible", meta: {}, fields: { role: "", company: "", description: "" } }
      ]
    },
    {
      id: "skills-s",
      type: "skills",
      title: "Skills",
      order: 3,
      meta: {},
      blocks: [{ id: "skills-b", type: "skills", order: 0, visibility: "visible", meta: {}, fields: { skills: ["Go", "PostgreSQL"] } }]
    },
    {
      id: "refs-s",
      type: "references",
      title: "References",
      order: 4,
      meta: {},
      blocks: [{ id: "ref-1", type: "reference_item", order: 0, visibility: "visible", meta: {}, fields: { name: "Bob", email: "bob@example.com" } }]
    }
  ]
});

describe("compact CV", () => {
  it("drops header, references, hidden and empty blocks and aliases block ids", () => {
    const compact = buildCompactCv(cvContent());

    expect(compact.blocks.map((block) => block.block_id)).toEqual(["summary-b", "exp-1", "skills-b"]);
    expect(compact.blocks.map((block) => block.alias)).toEqual(["b1", "b2", "b3"]);
    expect(compact.blocks[1]).toMatchObject({ kind: "item", editable_field: "description", title: "Backend Engineer", subtitle: "Acme" });
    expect(compact.blocks[2]).toMatchObject({ kind: "skills", skills: ["Go", "PostgreSQL"] });

    const payload = JSON.stringify(toAnalysisCvPayload(compact));
    expect(payload).not.toContain("ada@example.com");
    expect(payload).not.toContain("bob@example.com");
    expect(payload).not.toContain("start_date");
  });
});

const rawAnalysis = (): TailoringAnalysis => ({
  role_summary: "Builds payment systems.",
  requirements: [
    { id: "r1", text: "Payments APIs", keywords: ["payments"], importance: "must", weight: 3, status: "covered", confidence: "high", evidence_block_ids: ["b2", "b99"], reason: "Built them." },
    { id: "r2", text: "Kafka", keywords: ["Kafka"], importance: "must", weight: 2, status: "missing", confidence: "medium", evidence_block_ids: [], reason: "Not mentioned." },
    { id: "r2", text: "Mentoring", keywords: ["mentoring"], importance: "nice", weight: 1, status: "weak", confidence: "low", evidence_block_ids: [], reason: "Implied." }
  ],
  questions: [
    { id: "q1", kind: "gap", text: "Have you used Kafka?", requirement_id: "r2", target_block_id: "b2" },
    { id: "q2", kind: "gap", text: "Orphan?", requirement_id: "nope", target_block_id: null },
    { id: "q3", kind: "metric", text: "How many requests per day?", requirement_id: null, target_block_id: "b2" },
    { id: "q4", kind: "metric", text: "No target", requirement_id: null, target_block_id: null }
  ],
  block_briefs: [
    { block_id: "b2", requirement_ids: ["r1", "r2"], focus: "Payments", terms: ["payments"], avoid: "" },
    { block_id: "b3", requirement_ids: [], focus: "Skills are not narrative", terms: [], avoid: "" }
  ]
});

describe("analysis normalization", () => {
  it("translates aliases, drops invalid references and de-duplicates ids", () => {
    const analysis = normalizeAnalysisOutput(rawAnalysis(), buildCompactCv(cvContent()));

    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual(["r1", "r2", "r3"]);
    expect(analysis.requirements[0].evidence_block_ids).toEqual(["exp-1"]);
    expect(analysis.questions.map((question) => question.id)).toEqual(["q1", "q3"]);
    expect(analysis.questions[0]).toMatchObject({ requirement_id: "r2", target_block_id: "exp-1" });
    expect(analysis.block_briefs).toEqual([
      { block_id: "exp-1", requirement_ids: ["r1", "r2"], focus: "Payments", terms: ["payments"], avoid: "" }
    ]);
  });

  it("plans summary, block, skills and structure tasks with question dependencies", () => {
    const compact = buildCompactCv(cvContent());
    const analysis = normalizeAnalysisOutput(rawAnalysis(), compact);
    const tasks = planTailoringTasks(analysis, compact, { session_id: "s", user_id: "u" });

    expect(tasks.map((task) => [task.kind, task.block_id, task.status, task.depends_on_question_ids])).toEqual([
      ["summary", "summary-b", "ready", []],
      ["block", "exp-1", "waiting", ["q1", "q3"]],
      ["skills", "skills-b", "waiting", ["q1"]],
      ["structure", null, "ready", []]
    ]);
  });
});

describe("truth guards", () => {
  it("drops lines with invented numbers or denied terms", () => {
    const result = guardGeneratedLines(
      ["Built payment APIs used by 3 teams", "Cut latency by 40%", "Ran Kafka pipelines", "Mentored 2 engineers"],
      { source_texts: ["Built payment APIs used by 3 teams", "Mentored 2 engineers"], forbidden_terms: ["Kafka"] }
    );

    expect(result.lines).toEqual(["Built payment APIs used by 3 teams", "Mentored 2 engineers"]);
    expect(result.notes).toHaveLength(2);
  });

  const skill = (name: string, allowed_skill: string | null = null) => ({ name, allowed_skill });

  it("only adds skills the CV supports or the candidate confirmed", () => {
    const result = guardSkills([skill("Go"), skill("Payments"), skill("Kafka"), skill("Rust"), skill("go")], {
      current_skills: ["Go"],
      allowed_new_skills: ["Kafka"],
      cv_text: "Built payments APIs",
      forbidden_terms: [],
      max_skills: 25
    });

    expect(result.lines).toEqual(["Go", "Payments", "Kafka"]);
  });

  it("accepts an allowed skill rendered in the CV language only through its reference", () => {
    const result = guardSkills(
      [
        skill("Paydaş yönetimi", "stakeholder management"),
        skill("Kafka", "Kafka"),
        // The reference is already used: one allowed entry licenses one new skill.
        skill("Rust", "Kafka"),
        skill("Uydurma beceri", "not in the list"),
        skill("Mentorluk", "mentoring"),
        skill("Go")
      ],
      {
        current_skills: ["Go"],
        allowed_new_skills: ["stakeholder management", "Kafka", "mentoring"],
        cv_text: "Ödeme API'leri geliştirdim",
        forbidden_terms: ["mentoring"],
        max_skills: 25
      }
    );

    expect(result.lines).toEqual(["Paydaş yönetimi", "Kafka", "Go"]);
    expect(result.notes).toHaveLength(3);
  });

  it("keeps the skills output schema compatible with OpenAI strict mode", () => {
    const schema = zodToJsonSchema(tailoringSkillsOutputSchema as never, { target: "jsonSchema7", $refStrategy: "none" });
    expect(buildStrictOpenAiResponseJsonSchema(schema)).not.toBeNull();
  });

  it("tells the rewrite prompts to write in the CV language, not the job posting's", () => {
    expect(TAILORING_LANGUAGE_RULE).toMatch(/cv_language/);
    expect(TAILORING_LANGUAGE_RULE).toMatch(/Never switch to the job posting's language/);
    for (const flow of ["tailoring_block", "tailoring_skills"] as const) {
      expect(AI_FLOW_REGISTRY[flow].system_prompt).toContain(TAILORING_LANGUAGE_RULE);
    }
  });
});

describe("match score", () => {
  it("weights must-haves, ignores rejected requirements and upgrades addressed ones", () => {
    const analysis = normalizeAnalysisOutput(rawAnalysis(), buildCompactCv(cvContent()));
    const answers = { q1: { answer: "yes" as const, detail: null, add_to_main: false, answered_at: NOW } };

    const score = computeTailoringScore(analysis, { r3: "not_relevant" }, answers, [
      { status: "applied", requirement_ids: [] },
      { status: "pending", requirement_ids: ["r2"] }
    ]);
    // r1 covered (weight 6), r2 missing (weight 4) -> 60; confirming r2 -> 100.
    expect(score).toEqual({ initial: 60, current: 60, potential: 100 });
  });
});

describe("run cost", () => {
  it("prices cached input separately and matches dated model ids", () => {
    const cost = computeRunCostUsd(
      { "gpt-6-luna": { input: 1, cached_input: 0.25, output: 4 } },
      "gpt-6-luna-2026-09-01",
      { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cached_input_tokens: 400 }
    );
    expect(cost).toBe(0.0015);
    expect(computeRunCostUsd({}, "unknown", { input_tokens: 1, output_tokens: 1, total_tokens: 2 })).toBeNull();
  });
});

describe("tailoring migration", () => {
  it("creates the session tables and the cost columns", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261027120000_tailoring_v2_sessions.sql"), "utf-8");
    expect(sql).toMatch(/create table if not exists public\.tailoring_sessions/i);
    expect(sql).toMatch(/create table if not exists public\.tailoring_session_tasks/i);
    expect(sql).toMatch(/add column if not exists cost_usd numeric/i);
    expect(sql).toMatch(/'tailoring_analysis','tailoring_block','tailoring_skills','tailoring_structure'/);
    expect(sql).toMatch(/create policy tailoring_sessions_select_own/i);
  });
});

// ---------------------------------------------------------------------------
// Service flow with the real AiService pipeline and the mock model
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const session: SessionContext = {
  authUser: { auth_user_id: "auth-1", email: "admin@example.com", full_name: null, locale: "en" },
  appUser: {
    id: USER_ID,
    auth_user_id: "auth-1",
    email: "admin@example.com",
    full_name: null,
    locale: "en",
    default_cv_language: "en",
    onboarding_completed: true,
    onboarding_state: {},
    created_at: NOW,
    updated_at: NOW
  }
};

const JOB = {
  job_title: "Payments Engineer",
  company_name: "Stripe-like",
  job_description:
    "We are hiring a payments engineer to build reliable payment APIs, work with Kafka streaming and mentor teammates across squads."
};

const createHarness = (options: { language?: string } = {}) => {
  const masters = new Map<string, MasterCvRecord>();
  const tailoredCvs = new Map<string, TailoredCvRecord>();
  const jobs = new Map<string, JobRecord>();
  const runs = new Map<string, AiRunRecord>();
  const usageCalls: string[] = [];
  const masterRevisions: Array<{ block: { id: string; fields: Record<string, unknown> }; change_source: string; ai_suggestion_id: string | null }> = [];
  const aiSuggestions = new Map<string, AiSuggestionRecord>();

  masters.set("master-1", {
    id: "master-1",
    user_id: USER_ID,
    title: "Main CV",
    language: options.language ?? "en",
    template_id: null,
    module_type: "standard",
    current_content: cvContent(),
    summary_text: null,
    source_type: "scratch",
    is_deleted: false,
    created_at: NOW,
    updated_at: NOW
  });

  const findRun = (owner: AiRunOwner, id: string) => {
    const run = runs.get(id);
    return run && typeof owner === "string" && run.user_id === owner ? run : null;
  };
  const aiRepository = {
    async createRun(payload: Record<string, unknown>) {
      const run = {
        id: randomUUID(), master_cv_id: null, tailored_cv_id: null, job_id: null, status: "pending",
        progress_stage: "queued", output_payload: null, error_message: null, debug_payload: null,
        input_tokens: null, output_tokens: null, total_tokens: null, started_at: new Date().toISOString(),
        completed_at: null, ...payload
      } as AiRunRecord;
      runs.set(run.id, run);
      return run;
    },
    async updateRunProgressStage(owner: AiRunOwner, id: string, stage: AiRunRecord["progress_stage"]) {
      const run = findRun(owner, id);
      if (run?.status === "pending") run.progress_stage = stage;
      return run;
    },
    async recordRunUsage(owner: AiRunOwner, id: string, result: { provider: string; model_name: string; usage?: Record<string, unknown> }) {
      const run = findRun(owner, id);
      if (run) Object.assign(run, { provider: result.provider, model_name: result.model_name, ...(result.usage ?? {}) });
    },
    async completeRun(owner: AiRunOwner, id: string, output: Record<string, unknown>, usage: Record<string, unknown> | null) {
      const run = findRun(owner, id);
      if (run?.status !== "pending") return null;
      Object.assign(run, { status: "completed", progress_stage: "completed", output_payload: output, completed_at: new Date().toISOString(), ...(usage ?? {}) });
      return run;
    },
    async failRun(owner: AiRunOwner, id: string, error: string) {
      const run = findRun(owner, id);
      if (run?.status !== "pending") return null;
      Object.assign(run, { status: "failed", progress_stage: "failed", error_message: error, completed_at: new Date().toISOString() });
      return run;
    },
    async findRunById(owner: AiRunOwner, id: string) {
      return findRun(owner, id);
    },
    async createSuggestions(payloads: Array<Partial<AiSuggestionRecord>>) {
      return payloads.map((payload) => {
        const record = { id: randomUUID(), created_at: new Date().toISOString(), ...payload } as AiSuggestionRecord;
        aiSuggestions.set(record.id, record);
        return record;
      });
    },
    async updateSuggestionById(_userId: string, id: string, patch: Partial<AiSuggestionRecord>, opts?: { expected_status?: string }) {
      const record = aiSuggestions.get(id);
      if (!record || (opts?.expected_status && record.status !== opts.expected_status)) return null;
      Object.assign(record, patch);
      return record;
    },
    async listRunsByTailoringSession(sessionId: string) {
      return [...runs.values()].filter((run) => run.tailoring_session_id === sessionId);
    }
  } as unknown as AiRepository;

  const masterCvRepository = {
    async findById(userId: string, id: string) {
      const master = masters.get(id);
      return master && master.user_id === userId ? master : null;
    },
    async updateById(_userId: string, id: string, patch: Partial<MasterCvRecord>) {
      const master = masters.get(id);
      if (!master) return null;
      Object.assign(master, patch);
      return master;
    }
  };
  const tailoredCvRepository = {
    async create(payload: Omit<TailoredCvRecord, "id" | "is_deleted" | "created_at" | "updated_at">) {
      const record = { ...payload, id: randomUUID(), is_deleted: false, created_at: NOW, updated_at: NOW } as TailoredCvRecord;
      tailoredCvs.set(record.id, record);
      return record;
    },
    async findById(userId: string, id: string) {
      const record = tailoredCvs.get(id);
      return record && record.user_id === userId ? record : null;
    },
    async updateById(_userId: string, id: string, patch: Partial<TailoredCvRecord>) {
      const record = tailoredCvs.get(id);
      if (!record) return null;
      Object.assign(record, patch);
      return record;
    }
  };
  const jobsRepository = {
    async create(payload: Omit<JobRecord, "id" | "cover_letter_id" | "created_at" | "updated_at">) {
      const record = { cover_letter_id: null, ...payload, id: randomUUID(), created_at: NOW, updated_at: NOW } as JobRecord;
      jobs.set(record.id, record);
      return record;
    },
    async findById(_userId: string, id: string) {
      return jobs.get(id) ?? null;
    },
    async updateById(_userId: string, id: string, patch: Partial<JobRecord>) {
      const record = jobs.get(id);
      if (!record) return null;
      Object.assign(record, patch);
      return record;
    },
    async linkTailoredCv(_userId: string, jobId: string, tailoredCvId: string) {
      const record = jobs.get(jobId);
      if (!record) return null;
      record.tailored_cv_id = tailoredCvId;
      return record;
    }
  };
  const billingService = {
    async assertActionAllowed() {},
    async recordTailoredCvGenerationUsage(userId: string) {
      usageCalls.push(userId);
    }
  };
  const cvRevisionsService = {
    async createMasterBlockRevision(input: (typeof masterRevisions)[number]) {
      masterRevisions.push(structuredClone(input));
    }
  };

  // The mock model plus provider-reported usage, so cost tracking is exercised end to end.
  const mock = new MockAiProvider("gpt-6-luna-test");
  const requests: AiProviderRequest[] = [];
  const provider: AiProvider = {
    providerName: "openai",
    resolveModelName: () => "gpt-6-luna",
    async generate(request) {
      requests.push(request);
      const result = await mock.generate(request);
      return {
        ...result,
        model_name: "gpt-6-luna-2026-09-01",
        usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cached_input_tokens: 400, reasoning_tokens: 50 }
      };
    }
  };

  const aiService = new AiService(
    aiRepository,
    provider,
    masterCvRepository as never,
    tailoredCvRepository as never,
    jobsRepository as never,
    cvRevisionsService as never,
    {} as never,
    new AiPromptResolver({ listActiveByProfile: async () => [] }, "test"),
    billingService as never,
    undefined,
    undefined,
    { modelPricing: { "gpt-6-luna": { input: 1, cached_input: 0.25, output: 4 } } }
  );

  const repository = new InMemoryTailoringRepository();
  repository.userEmails.set(USER_ID, "admin@example.com");
  const service = new TailoringService(
    repository,
    aiService,
    aiRepository,
    masterCvRepository as never,
    tailoredCvRepository as never,
    jobsRepository as never,
    cvRevisionsService as never,
    billingService as never,
    { adminEmails: ["admin@example.com"] }
  );

  return { service, repository, masters, tailoredCvs, jobs, runs, usageCalls, masterRevisions, aiSuggestions, requests };
};

describe("TailoringService", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("runs a full session: copy, analysis, answers, parallel tasks, decisions and cost report", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const tailored = harness.tailoredCvs.get(created.session.tailored_cv_id)!;
    expect(tailored.master_cv_id).toBe("master-1");
    expect(harness.jobs.get(tailored.job_id!)?.tailored_cv_id).toBe(tailored.id);
    expect(created.session.status).toBe("draft");
    expect(created.viewer.is_admin).toBe(true);

    const analyzed = await harness.service.analyze(session, created.session.id);
    expect(analyzed.session.status).toBe("answering");
    expect(analyzed.session.analysis?.requirements[0].evidence_block_ids).toEqual(["exp-1"]);
    expect(harness.usageCalls).toEqual([USER_ID]);
    // The analysis prompt comes from code and never contains contact data or dates.
    const analysisRequest = harness.requests.find((request) => request.flow_type === "tailoring_analysis")!;
    expect(analysisRequest.prompt.prompt_key).toBe("tailoring-analysis");
    expect(JSON.stringify(analysisRequest.input_payload)).not.toContain("ada@example.com");

    const blockTask = analyzed.tasks.find((task) => task.kind === "block")!;
    expect(blockTask.status).toBe("waiting");
    const readyTasks = analyzed.tasks.filter((task) => task.status === "ready");
    expect(readyTasks.map((task) => task.kind).sort()).toEqual(["structure", "summary"]);

    // Tasks without open questions run while the user answers.
    await Promise.all(readyTasks.map((task) => harness.service.runTask(session, created.session.id, task.id)));

    await harness.service.answerQuestion(session, created.session.id, "q1", { answer: "no", detail: null, add_to_main: false });
    const afterMetric = await harness.service.answerQuestion(session, created.session.id, "q2", {
      answer: null,
      detail: "Served 12 merchants",
      add_to_main: true
    });
    expect(afterMetric.tasks.find((task) => task.id === blockTask.id)?.status).toBe("ready");

    const completed = await harness.service.completeQuestions(session, created.session.id);
    expect(completed.session.status).toBe("generating");
    const remaining = completed.tasks.filter((task) => task.status === "ready");
    const results = await Promise.all(
      remaining.map((task) => harness.service.runTask(session, created.session.id, task.id))
    );

    const blockResult = results.find((result) => result.task.id === blockTask.id)!;
    expect(blockResult.task.status).toBe("done");
    const rewrite = blockResult.suggestions[0];
    expect(rewrite.kind).toBe("rewrite");
    expect(rewrite.add_to_main).toBe(true);
    const value = String(rewrite.suggested.value);
    expect(value.split("\n").every((line) => line.startsWith("• "))).toBe(true);
    expect(value).toContain("Served 12 merchants");

    const view = await harness.service.getSession(session, created.session.id);
    expect(view.session.status).toBe("reviewing");
    // The candidate said no to the r3 requirement, so its term never reaches the skills.
    const skills = view.suggestions.find((suggestion) => suggestion.kind === "skills");
    const deniedTerm = view.session.analysis!.requirements.find((requirement) => requirement.id === "r3")!.keywords[0];
    expect(JSON.stringify(skills?.suggested ?? {})).not.toContain(deniedTerm);

    const originalDescription = cvContent().sections[2].blocks[0].fields.description;
    const decision = await harness.service.decideSuggestion(session, created.session.id, rewrite.id, { decision: "accept" });
    expect(decision.suggestion.status).toBe("applied");
    expect(decision).toMatchObject({ master_cv_updated: true, master_cv_reverted: false, master_cv_revert_skipped: false });
    const masterBlock = () => harness.masters.get("master-1")!.current_content.sections[2].blocks[0];
    expect(masterBlock().fields.description).toBe(value);
    // Recorded like an applied block suggestion on the main CV: its version history keeps
    // the previous block (before_content) and an "ai" revision links to it.
    const [masterSuggestion] = [...harness.aiSuggestions.values()];
    expect(masterSuggestion).toMatchObject({
      master_cv_id: "master-1",
      tailored_cv_id: null,
      block_id: "exp-1",
      action_type: "tailor",
      status: "applied",
      ai_run_id: harness.repository.suggestions.get(rewrite.id)!.ai_run_id
    });
    expect((masterSuggestion.before_content as { fields: Record<string, unknown> }).fields.description).toBe(originalDescription);
    expect((masterSuggestion.suggested_content as { fields: Record<string, unknown> }).fields.description).toBe(value);
    expect(harness.masterRevisions).toEqual([
      expect.objectContaining({ change_source: "ai", ai_suggestion_id: masterSuggestion.id, block: expect.objectContaining({ id: "exp-1" }) })
    ]);
    expect(harness.repository.suggestions.get(rewrite.id)!.meta.master_update).toMatchObject({
      master_cv_id: "master-1",
      master_suggestion_id: masterSuggestion.id,
      field: "description",
      previous_value: originalDescription,
      written_value: value
    });

    // Undo while the main CV still holds our write restores it.
    const undone = await harness.service.decideSuggestion(session, created.session.id, rewrite.id, { decision: "undo" });
    expect(undone.suggestion.status).toBe("pending");
    expect(undone).toMatchObject({ master_cv_updated: false, master_cv_reverted: true, master_cv_revert_skipped: false });
    expect(masterBlock().fields.description).toBe(originalDescription);
    expect(masterSuggestion.status).toBe("rejected");
    expect(harness.masterRevisions[1]).toMatchObject({ change_source: "restore", ai_suggestion_id: null });
    expect(harness.masterRevisions[1].block.fields.description).toBe(originalDescription);

    // Accept again, edit the main CV meanwhile: undo then leaves the user's edit alone.
    await harness.service.decideSuggestion(session, created.session.id, rewrite.id, { decision: "accept" });
    expect(masterBlock().fields.description).toBe(value);
    masterBlock().fields.description = "• Edited on the main CV";
    const skipped = await harness.service.decideSuggestion(session, created.session.id, rewrite.id, { decision: "undo" });
    expect(skipped).toMatchObject({ master_cv_reverted: false, master_cv_revert_skipped: true });
    expect(masterBlock().fields.description).toBe("• Edited on the main CV");
    expect(harness.masterRevisions).toHaveLength(3);

    await expect(
      harness.service.decideSuggestion(session, created.session.id, rewrite.id, { decision: "accept", edited_value: ["not", "text"] })
    ).rejects.toThrow("as text");

    const finished = await harness.service.finish(session, created.session.id);
    expect(finished.session.status).toBe("ready");
    expect(harness.tailoredCvs.get(tailored.id)?.tailoring_review).toBeTruthy();

    const report = await harness.service.getCostReport(created.session.id);
    expect(report.totals.run_count).toBe(harness.requests.length);
    expect(report.totals.cached_input_tokens).toBe(400 * harness.requests.length);
    expect(report.totals.cost_usd).toBeCloseTo(0.0015 * harness.requests.length, 6);
    expect(report.totals.cost_complete).toBe(true);
    expect(report.by_step.map((step) => step.step)).toContain("Match analysis");
    expect(report.runs.every((run) => run.flow_type.startsWith("tailoring_"))).toBe(true);
  });

  it("does not double-claim a running task and refines a card with a quick fix", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const analyzed = await harness.service.analyze(session, created.session.id);
    const summaryTask = analyzed.tasks.find((task) => task.kind === "summary")!;

    const [first, second] = await Promise.all([
      harness.service.runTask(session, created.session.id, summaryTask.id),
      harness.service.runTask(session, created.session.id, summaryTask.id)
    ]);
    const summaryRuns = harness.requests.filter(
      (request) => request.flow_type === "tailoring_block" && (request.input_payload.block as { kind: string }).kind === "summary"
    );
    expect(summaryRuns).toHaveLength(1);
    expect([first.task.status, second.task.status]).toContain("done");

    const refined = await harness.service.runTask(session, created.session.id, summaryTask.id, { refinement: "shorter" });
    expect(refined.suggestions).toHaveLength(1);
    expect(refined.suggestions[0].id).not.toBe(first.suggestions[0]?.id ?? second.suggestions[0]?.id);
    const view = await harness.service.getSession(session, created.session.id);
    expect(view.suggestions.filter((suggestion) => suggestion.task_id === summaryTask.id)).toHaveLength(1);
  });

  it("re-tailors an existing tailored CV for a new job and archives the old session", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const oldJobId = created.session.job_id!;

    const retailored = await harness.service.createSession(session, {
      cv_id: created.session.tailored_cv_id,
      job: { ...JOB, job_title: "Platform Engineer", job_description: `${JOB.job_description} Platform focus.` }
    });

    expect(retailored.session.tailored_cv_id).toBe(created.session.tailored_cv_id);
    expect(retailored.session.job_id).not.toBe(oldJobId);
    expect(harness.repository.unlinkedJobIds).toEqual([oldJobId]);
    expect(harness.repository.sessions.get(created.session.id)?.status).toBe("archived");
    await expect(harness.service.getSession(session, created.session.id)).rejects.toThrow("not found");
  });

  it("asks for rewrites and skills in the CV language, not the job posting's", async () => {
    harness = createHarness({ language: "tr" });
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const analyzed = await harness.service.analyze(session, created.session.id);
    await harness.service.completeQuestions(session, created.session.id);
    const tasks = (await harness.service.getSession(session, created.session.id)).tasks;
    for (const task of tasks.filter((item) => item.kind !== "structure")) {
      await harness.service.runTask(session, analyzed.session.id, task.id);
    }

    const rewriteRequests = harness.requests.filter(
      (request) => request.flow_type === "tailoring_block" || request.flow_type === "tailoring_skills"
    );
    expect(rewriteRequests.map((request) => request.flow_type).sort()).toEqual(["tailoring_block", "tailoring_block", "tailoring_skills"]);
    for (const request of rewriteRequests) {
      expect(request.input_payload.cv_language).toEqual({ code: "tr", name: "Turkish" });
      expect(request.prompt.system_prompt).toContain(TAILORING_LANGUAGE_RULE);
    }
  });

  it("settles the session and keeps the task retryable after a non-AI failure", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    await harness.service.analyze(session, created.session.id);
    const completed = await harness.service.completeQuestions(session, created.session.id);
    const [failing, ...others] = completed.tasks;
    for (const task of others) {
      await harness.service.runTask(session, created.session.id, task.id);
    }

    vi.spyOn(harness.repository, "createSuggestions").mockRejectedValueOnce(new Error("database unavailable"));
    await expect(harness.service.runTask(session, created.session.id, failing.id)).rejects.toThrow("database unavailable");

    const view = await harness.service.getSession(session, created.session.id);
    expect(view.session.status).toBe("reviewing");
    expect(view.tasks.find((task) => task.id === failing.id)).toMatchObject({
      status: "failed",
      error_message: "Something went wrong while preparing this suggestion. Try again."
    });

    const retried = await harness.service.runTask(session, created.session.id, failing.id);
    expect(retried.task.status).toBe("done");
  });

  it("keeps pending cards when a regenerate fails", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const analyzed = await harness.service.analyze(session, created.session.id);
    const summaryTask = analyzed.tasks.find((task) => task.kind === "summary")!;
    const first = await harness.service.runTask(session, created.session.id, summaryTask.id);
    expect(first.suggestions).toHaveLength(1);

    vi.spyOn(harness.repository, "createSuggestions").mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      harness.service.runTask(session, created.session.id, summaryTask.id, { refinement: "shorter" })
    ).rejects.toThrow();
    const view = await harness.service.getSession(session, created.session.id);
    expect(view.suggestions.filter((suggestion) => suggestion.task_id === summaryTask.id).map((item) => item.id)).toEqual([
      first.suggestions[0].id
    ]);
  });

  it("does not duplicate tasks when a failed analysis is retried", async () => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    vi.spyOn(harness.repository, "updateSession").mockRejectedValueOnce(new Error("database unavailable"));
    await expect(harness.service.analyze(session, created.session.id)).rejects.toThrow("database unavailable");
    const failed = await harness.service.getSession(session, created.session.id);
    expect(failed.session.status).toBe("draft");
    expect(failed.session.error_message).toBeTruthy();

    const retried = await harness.service.analyze(session, created.session.id);
    expect(retried.session.status).toBe("answering");
    expect(retried.tasks.map((task) => task.kind)).toEqual(["summary", "block", "skills", "structure"]);
    expect(harness.repository.tasks.size).toBe(4);
    // Usage is recorded once, for the analysis that was saved.
    expect(harness.usageCalls).toEqual([USER_ID]);
  });

  it("restricts admin access by email", () => {
    const other = { ...session, appUser: { ...session.appUser, email: "someone@example.com" } };
    expect(harness.service.isAdmin(session)).toBe(true);
    expect(harness.service.isAdmin(other)).toBe(false);
  });
});
