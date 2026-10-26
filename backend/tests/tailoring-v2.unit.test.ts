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
import {
  AI_FLOW_REGISTRY,
  TAILORING_CONFIRMED_FACTS_RULE,
  TAILORING_LANGUAGE_RULE,
  TAILORING_REFINEMENT_RULE
} from "../src/modules/ai/flows/flow-registry";
import { buildCompactCv, isDateLike, toAnalysisCvPayload } from "../src/modules/tailoring/tailoring-compact-cv";
import { refineBlockSchema, runTaskSchema, tailoringBlockParamsSchema } from "../src/modules/tailoring/tailoring.schemas";
import { ConflictError, NotFoundError, ValidationError } from "../src/shared/errors/app-error";
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

const createHarness = (
  options: {
    language?: string;
    content?: CvContent;
    // Replaces the mock model's output for matching requests (undefined = use the mock).
    override?: (request: AiProviderRequest) => Record<string, unknown> | undefined;
  } = {}
) => {
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
    current_content: options.content ? structuredClone(options.content) : cvContent(),
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
      const overridden = options.override?.(request);
      return {
        ...result,
        ...(overridden ? { output_payload: overridden } : {}),
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
    // Finishing no longer computes a tailoring review.
    expect(harness.tailoredCvs.get(tailored.id)?.ai_generation_status).toBe("completed");
    expect(harness.tailoredCvs.get(tailored.id)).not.toHaveProperty("tailoring_review");

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

// ---------------------------------------------------------------------------
// Real CV shapes (block types and fields as found in master_cvs)
// ---------------------------------------------------------------------------

const block = (id: string, type: string, fields: Record<string, unknown>, order = 0) =>
  ({ id, type, order, visibility: "visible", meta: {}, fields }) as CvContent["sections"][number]["blocks"][number];
const section = (id: string, type: string, order: number, blocks: CvContent["sections"][number]["blocks"]) =>
  ({ id, type, title: type, order, meta: {}, blocks }) as CvContent["sections"][number];

const realCv = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    section("hdr", "header", 0, [block("hdr-1", "profile", { full_name: "Ada", email: "ada@example.com", headline: "Engineer" })]),
    section("sum", "summary", 1, [block("sum-1", "text", { text: "Data engineer with 3 years of pipeline work." })]),
    section("exp", "experience", 2, [
      block("exp-a", "experience", { role: "Data Engineer", company: "Acme", start_date: "Jan 2024", end_date: "", location: "Istanbul", description: "• Built ETL pipelines in Python\n• Maintained dashboards", current_role: true }, 0),
      block("exp-b", "position", { role: "Analyst", job_title: "Analyst", company: "Beta", employer: "Beta", start_date: "2022", end_date: "2023", description: "Prepared weekly sales reports." }, 1),
      block("exp-c", "work", { position: "Intern", company: "Gamma", start_date: "2021", end_date: "2021", description: "Cleaned survey data." }, 2),
      block("exp-d", "entry", { role: "Developer", company: "Delta", dates: "2020", bullets: ["Shipped 4 features"] }, 3),
      block("exp-e", "text", { role: "Assistant", company: "Epsilon" }, 4)
    ]),
    section("edu", "education", 3, [
      block("edu-a", "education", { field_of_study: "Computer Science", institution: "Sabanci University", start_date: "Sep 2021", end_date: "DEC 2025", description: "Thesis on graph learning.", exchange_program: false, expected_graduation: true }, 0),
      block("edu-b", "degree", { degree: "BSc", field_of_study: "Mathematics", institution: "METU", end_date: "2020" }, 1),
      block("edu-c", "education", { degree: "İnşaat Mühendisliği", field_of_study: "İnşaat Mühendisliği", institution: "UWM", summary: "Exchange semester on structures.", start_date: "Şubat 2025", end_date: "Haziran 2025" }, 2)
    ]),
    section("prj", "projects", 4, [
      block("prj-a", "projects", { title: "Apr 2026", subtitle: "AutoBEME", start_date: "Apr 2026", description: "Built an NLP market ensemble." }, 0),
      block("prj-b", "academic_project", { name: "Graph study", description: ["Analysed 2 networks"] }, 1)
    ]),
    section("vol", "volunteer", 5, [
      block("vol-a", "volunteer", { role: "Mentor", organization: "Code Club", description: "Mentored students weekly.", current_role: true }, 0),
      block("vol-b", "organization_role", { role: "Lead", organization: "IEEE", description: ["Ran events"] }, 1)
    ]),
    section("skl", "skills", 6, [
      block("skl-a", "skill_group", { category: "Technical", skills: ["Python", "SQL"] }, 0),
      block("skl-b", "list", { items: ["Airflow"] }, 1),
      block("skl-c", "skill", { name: "Excel", level: "Advanced" }, 2)
    ]),
    section("lang", "languages", 7, [block("lang-a", "language", { language: "English", proficiency: "C1" })]),
    section("ref", "references", 8, [block("ref-a", "entry", { name: "Bob", email: "bob@example.com", organization: "Acme" })])
  ]
});

describe("compact CV with real block types", () => {
  const byId = () => new Map(buildCompactCv(realCv()).blocks.map((item) => [item.block_id, item]));

  it("classifies narrative blocks by section and field shape, not by *_item block types", () => {
    const blocks = byId();
    expect(blocks.get("exp-a")).toMatchObject({ kind: "item", editable_field: "description", title: "Data Engineer", subtitle: "Acme" });
    expect(blocks.get("exp-b")).toMatchObject({ kind: "item", editable_field: "description", title: "Analyst", subtitle: "Beta" });
    expect(blocks.get("exp-c")).toMatchObject({ kind: "item", editable_field: "description", title: "Intern", subtitle: "Gamma" });
    expect(blocks.get("vol-a")).toMatchObject({ kind: "item", title: "Mentor", subtitle: "Code Club" });
    expect(blocks.get("prj-a")).toMatchObject({ kind: "item", title: "AutoBEME" });
    // Narrative kept only in arrays, or no narrative at all: read-only context.
    expect(blocks.get("exp-d")).toMatchObject({ kind: "other", editable_field: null, title: "Developer", text: "Shipped 4 features" });
    expect(blocks.get("exp-e")).toMatchObject({ kind: "other", editable_field: null, title: "Assistant" });
    expect(blocks.get("prj-b")).toMatchObject({ kind: "other", editable_field: null });
    expect(blocks.get("vol-b")).toMatchObject({ kind: "other", editable_field: null });
  });

  it("titles education by degree and field of study and never by a date", () => {
    const blocks = byId();
    expect(blocks.get("edu-a")).toMatchObject({ kind: "item", editable_field: "description", title: "Computer Science", subtitle: "Sabanci University" });
    expect(blocks.get("edu-b")).toMatchObject({ kind: "other", title: "BSc, Mathematics", subtitle: "METU" });
    expect(blocks.get("edu-c")).toMatchObject({ kind: "item", editable_field: "summary", title: "İnşaat Mühendisliği", subtitle: "UWM" });
    for (const info of blocks.values()) {
      expect(info.title).not.toMatch(/^(DEC 2025|Apr 2026|2020|Haziran 2025)$/);
    }
  });

  it("recognises summary and skills by section type and keeps header, contact and references out", () => {
    const blocks = byId();
    expect(blocks.get("sum-1")).toMatchObject({ kind: "summary", editable_field: "text" });
    expect(blocks.get("skl-a")).toMatchObject({ kind: "skills", editable_field: "skills", skills: ["Python", "SQL"] });
    expect(blocks.get("skl-b")).toMatchObject({ kind: "skills", editable_field: "items", skills: ["Airflow"] });
    expect(blocks.get("skl-c")).toMatchObject({ kind: "other", editable_field: null, title: "Excel" });
    expect(blocks.get("lang-a")).toMatchObject({ kind: "other", editable_field: null, title: "English", subtitle: "C1" });
    expect(blocks.has("hdr-1")).toBe(false);
    expect(blocks.has("ref-a")).toBe(false);
    const payload = JSON.stringify(toAnalysisCvPayload(buildCompactCv(realCv())));
    expect(payload).not.toContain("ada@example.com");
    expect(payload).not.toContain("bob@example.com");

    const paragraph = realCv();
    paragraph.sections[1].blocks = [block("sum-p", "paragraph", { content: "Operations lead." })];
    expect(buildCompactCv(paragraph).blocks[0]).toMatchObject({ kind: "summary", editable_field: "content", text: "Operations lead." });
  });

  it("keeps the model's briefs and metric targets for real experience blocks and plans their tasks", () => {
    const compact = buildCompactCv(realCv());
    const alias = (id: string) => compact.block_id_to_alias[id];
    const analysis = normalizeAnalysisOutput(
      {
        role_summary: "Data role.",
        requirements: [{ id: "r1", text: "Pipelines", keywords: ["ETL"], importance: "must", weight: 3, status: "weak", confidence: "high", evidence_block_ids: [alias("exp-a")], reason: "" }],
        questions: [
          { id: "q1", kind: "metric", text: "How many pipelines?", requirement_id: null, target_block_id: alias("exp-a") },
          { id: "q2", kind: "metric", text: "How many reports?", requirement_id: null, target_block_id: alias("exp-b") },
          { id: "q3", kind: "metric", text: "Read-only?", requirement_id: null, target_block_id: alias("exp-d") }
        ],
        block_briefs: [
          { block_id: alias("exp-a"), requirement_ids: ["r1"], focus: "ETL", terms: ["ETL"], avoid: "" },
          { block_id: alias("exp-c"), requirement_ids: [], focus: "Data", terms: [], avoid: "" },
          { block_id: alias("edu-a"), requirement_ids: [], focus: "Thesis", terms: [], avoid: "" },
          { block_id: alias("exp-d"), requirement_ids: [], focus: "Read-only", terms: [], avoid: "" }
        ]
      },
      compact
    );
    expect(analysis.block_briefs.map((brief) => brief.block_id)).toEqual(["exp-a", "exp-c", "edu-a"]);
    expect(analysis.questions.map((question) => question.target_block_id)).toEqual(["exp-a", "exp-b", null]);

    const tasks = planTailoringTasks(analysis, compact, { session_id: "s", user_id: "u" });
    expect(tasks.filter((task) => task.kind === "block").map((task) => [task.block_id, task.depends_on_question_ids])).toEqual([
      ["exp-a", ["q1"]],
      ["exp-c", []],
      ["edu-a", []],
      ["exp-b", ["q2"]]
    ]);
    expect(tasks.find((task) => task.kind === "skills")?.block_id).toBe("skl-a");
  });

  it("does not plan a new skills section when the existing one cannot be rewritten", () => {
    const content = realCv();
    content.sections[6].blocks = [block("skl-c", "skill", { name: "Excel", level: "Advanced" })];
    const compact = buildCompactCv(content);
    const analysis = normalizeAnalysisOutput({ role_summary: "", requirements: [], questions: [], block_briefs: [] }, compact);
    expect(planTailoringTasks(analysis, compact, { session_id: "s", user_id: "u" }).map((task) => task.kind)).not.toContain("skills");
  });

  it("recognises dates in English and Turkish", () => {
    for (const value of ["DEC 2025", "Apr 2026", "2022/2026", "Sept 2024 – Present", "Haziran 2025", "Feb. 2026", "Present", "Devam ediyor", "12/2020"]) {
      expect(isDateLike(value), value).toBe(true);
    }
    for (const value of ["Data Engineer", "March Networks", "Computer Science", "AutoBEME"]) {
      expect(isDateLike(value), value).toBe(false);
    }
  });
});

describe("number guard with the candidate's own number formats", () => {
  const guard = (line: string, source: string) =>
    guardGeneratedLines([line], { source_texts: [source], forbidden_terms: [] }).lines.length === 1;

  it("accepts equivalent forms of a number from the sources", () => {
    expect(guard("Onboarded 1,500 merchants", "about 1.5K merchants")).toBe(true);
    expect(guard("Onboarded 1.5K merchants", "1,500 merchants")).toBe(true);
    expect(guard("1500 kullanıcıya ulaştı", "1.500 kullanıcı")).toBe(true);
    expect(guard("Cut costs by 30 %", "30%")).toBe(true);
    expect(guard("Maliyetleri %30 azalttı", "30%")).toBe(true);
    expect(guard("Grew revenue to 2 million", "€2M revenue")).toBe(true);
    expect(guard("Reached 3 bin users", "3000 users")).toBe(true);
  });

  it("still rejects numbers whose value is not in the sources", () => {
    expect(guard("Onboarded 2K merchants", "2 merchants")).toBe(false);
    expect(guard("Cut costs by 45%", "30%")).toBe(false);
    expect(guard("Onboarded 1,600 merchants", "1.5K merchants")).toBe(false);
    // A lowercase "m" is a unit, not "million".
    expect(guard("Laid 5 m of cable", "5000000 cables")).toBe(false);
    expect(guard("Laid 5 m of cable", "5 m cable runs")).toBe(true);
    expect(guard("Built 12 dashboards", "Built dashboards")).toBe(false);
  });
});

describe("block prompt and confirmed facts", () => {
  it("requires every confirmed fact and exact metric figures, and bounds candidate requests", () => {
    const prompt = AI_FLOW_REGISTRY.tailoring_block.system_prompt;
    expect(prompt).toContain(TAILORING_CONFIRMED_FACTS_RULE);
    expect(prompt).toContain(TAILORING_REFINEMENT_RULE);
    expect(TAILORING_CONFIRMED_FACTS_RULE).toMatch(/Reflect every confirmed fact/);
    expect(TAILORING_CONFIRMED_FACTS_RULE).toMatch(/exact figure/);
    expect(TAILORING_CONFIRMED_FACTS_RULE).toMatch(/Never invent/);
    expect(TAILORING_REFINEMENT_RULE).toMatch(/never overrides the truth and language rules/);
    expect(AI_FLOW_REGISTRY.tailoring_skills.system_prompt).toContain(TAILORING_REFINEMENT_RULE);
    expect(AI_FLOW_REGISTRY.tailoring_block.prompt_version).toBe("v2-3");
  });
});

describe("TailoringService with real CV shapes, answers and refine", () => {
  const start = async (harness: ReturnType<typeof createHarness>) => {
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    const analyzed = await harness.service.analyze(session, created.session.id);
    return { sessionId: created.session.id, analyzed };
  };
  const runReady = async (harness: ReturnType<typeof createHarness>, sessionId: string) => {
    const view = await harness.service.getSession(session, sessionId);
    return Promise.all(
      view.tasks.filter((task) => task.status === "ready").map((task) => harness.service.runTask(session, sessionId, task.id))
    );
  };

  it("rewrites real experience blocks and puts a metric answer into the lines, surviving the guard", async () => {
    // The model writes the candidate's "1.5K" as "1,500": an equivalent figure, kept.
    const harness = createHarness({
      content: realCv(),
      override: (request) => {
        if (request.flow_type !== "tailoring_block") return undefined;
        const block = request.input_payload.block as { kind: string; current_text: string };
        if (block.kind !== "item") return undefined;
        const facts = request.input_payload.confirmed_facts as Array<{ kind: string; detail: string | null }>;
        return {
          changed: true,
          lines: [
            "Built ETL pipelines in Python for analytics teams",
            ...(facts.some((fact) => fact.detail?.includes("1.5K")) ? ["Onboarded 1,500 merchants onto the pipelines"] : []),
            "Cut processing time by 40%"
          ],
          rationale: "Adds the figure you confirmed.",
          requirement_ids: ["r1"]
        };
      }
    });
    const { sessionId, analyzed } = await start(harness);
    const blockTask = analyzed.tasks.find((task) => task.kind === "block" && task.block_id === "exp-a")!;
    expect(blockTask.status).toBe("waiting");
    const metric = analyzed.session.analysis!.questions.find((question) => question.kind === "metric")!;
    expect(metric.target_block_id).toBe("exp-a");

    await harness.service.answerQuestion(session, sessionId, metric.id, { answer: null, detail: "About 1.5K merchants", add_to_main: false });
    await harness.service.completeQuestions(session, sessionId);
    const results = await runReady(harness, sessionId);
    const blockResult = results.find((result) => result.task.id === blockTask.id)!;
    const value = String(blockResult.suggestions[0].suggested.value);
    expect(blockResult.suggestions[0].suggested.field).toBe("description");
    expect(value).toContain("• Onboarded 1,500 merchants onto the pipelines");
    expect(value).not.toContain("40%");
    expect(blockResult.suggestions[0].guard_notes).toHaveLength(1);

    const request = harness.requests.find(
      (item) => item.flow_type === "tailoring_block" && (item.input_payload.block as { title: string }).title === "Data Engineer"
    )!;
    expect(request.input_payload.confirmed_facts).toEqual([
      { kind: "metric", question: metric.text, answer: null, detail: "About 1.5K merchants" }
    ]);
  });

  it("accepts a new skills section with the skills the candidate picked", async () => {
    const content = realCv();
    content.sections = content.sections.filter((item) => item.type !== "skills");
    const harness = createHarness({
      content,
      override: (request) =>
        request.flow_type === "tailoring_skills"
          ? {
              changed: true,
              skills: [{ name: "Python", allowed_skill: null }, { name: "ETL", allowed_skill: null }],
              rationale: "Lists the tools your experience shows.",
              requirement_ids: []
            }
          : undefined
    });
    const { sessionId } = await start(harness);
    await harness.service.completeQuestions(session, sessionId);
    await runReady(harness, sessionId);
    const view = await harness.service.getSession(session, sessionId);
    const card = view.suggestions.find((item) => item.kind === "new_section")!;
    expect((card.suggested.section as { type: string }).type).toBe("skills");

    const decided = await harness.service.decideSuggestion(session, sessionId, card.id, {
      decision: "accept",
      edited_value: ["ETL", "Looker"]
    });
    expect(decided.suggestion.status).toBe("applied");
    expect(decided.suggestion.suggested.value).toEqual(["ETL", "Looker"]);
    const section = decided.suggestion.suggested.section as { blocks: Array<{ fields: Record<string, unknown> }> };
    expect(section.blocks[0].fields.skills).toEqual(["ETL", "Looker"]);
  });

  it("writes the summary into the field the block uses", async () => {
    const content = realCv();
    content.sections[1].blocks = [block("sum-p", "paragraph", { content: "Operations lead for data teams." })];
    const harness = createHarness({ content });
    const { sessionId, analyzed } = await start(harness);
    const summaryTask = analyzed.tasks.find((task) => task.kind === "summary")!;
    const result = await harness.service.runTask(session, sessionId, summaryTask.id);
    expect(result.suggestions[0]).toMatchObject({ kind: "rewrite", block_id: "sum-p", before: { field: "content", value: "Operations lead for data teams." } });
    expect(result.suggestions[0].suggested.field).toBe("content");
  });

  it("re-queues finished tasks when an answer arrives or changes and returns the session to reviewing", async () => {
    const harness = createHarness();
    const { sessionId, analyzed } = await start(harness);
    const blockTask = analyzed.tasks.find((task) => task.kind === "block")!;
    const metric = analyzed.session.analysis!.questions.find((question) => question.kind === "metric")!;

    // Skip the questions: everything runs without the answers.
    await harness.service.completeQuestions(session, sessionId);
    await runReady(harness, sessionId);
    let view = await harness.service.getSession(session, sessionId);
    expect(view.session.status).toBe("reviewing");
    const firstCard = view.suggestions.find((suggestion) => suggestion.task_id === blockTask.id)!;
    expect(String(firstCard.suggested.value)).not.toContain("Served 12 merchants");

    // The candidate answers afterwards: the block task is re-queued for the answer.
    view = await harness.service.answerQuestion(session, sessionId, metric.id, { answer: null, detail: "Served 12 merchants", add_to_main: false });
    expect(view.session.status).toBe("generating");
    expect(view.tasks.find((task) => task.id === blockTask.id)).toMatchObject({ status: "ready", rerun_for_answer: true });
    expect(view.tasks.filter((task) => task.rerun_for_answer).map((task) => task.kind)).toEqual(["block"]);
    // Until it runs, the old card is still there.
    expect(view.suggestions.map((suggestion) => suggestion.id)).toContain(firstCard.id);

    const [rerun] = await runReady(harness, sessionId);
    expect(rerun.task).toMatchObject({ id: blockTask.id, status: "done", rerun_for_answer: false });
    expect(String(rerun.suggestions[0].suggested.value)).toContain("• Served 12 merchants");
    expect(rerun.session_status).toBe("reviewing");
    view = await harness.service.getSession(session, sessionId);
    expect(view.suggestions.map((suggestion) => suggestion.id)).not.toContain(firstCard.id);

    // The same answer again changes nothing.
    view = await harness.service.answerQuestion(session, sessionId, metric.id, { answer: null, detail: "Served 12 merchants", add_to_main: true });
    expect(view.tasks.every((task) => !task.rerun_for_answer)).toBe(true);
    expect(view.session.status).toBe("reviewing");
  });

  it("keeps applied cards, uses the current text as before, and returns a finished session to ready", async () => {
    const harness = createHarness();
    const { sessionId, analyzed } = await start(harness);
    const blockTask = analyzed.tasks.find((task) => task.kind === "block")!;
    const gap = analyzed.session.analysis!.questions.find((question) => question.kind === "gap")!;
    const metric = analyzed.session.analysis!.questions.find((question) => question.kind === "metric")!;
    await harness.service.completeQuestions(session, sessionId);
    await runReady(harness, sessionId);

    let view = await harness.service.getSession(session, sessionId);
    const applied = view.suggestions.find((suggestion) => suggestion.task_id === blockTask.id)!;
    await harness.service.decideSuggestion(session, sessionId, applied.id, { decision: "accept" });
    // The editor writes the accepted text; the rerun must start from it.
    const tailored = harness.tailoredCvs.get(view.session.tailored_cv_id)!;
    tailored.current_content.sections[2].blocks[0].fields.description = String(applied.suggested.value);
    await harness.service.finish(session, sessionId);

    // A gap answer re-queues the block it targets and the skills list (it changes their inputs).
    view = await harness.service.answerQuestion(session, sessionId, gap.id, { answer: "yes", detail: null, add_to_main: false });
    expect(view.session.status).toBe("generating");
    expect(view.tasks.filter((task) => task.rerun_for_answer).map((task) => task.kind).sort()).toEqual(["block", "skills"]);
    await harness.service.answerQuestion(session, sessionId, metric.id, { answer: null, detail: "Served 12 merchants", add_to_main: false });

    const results = await runReady(harness, sessionId);
    const rerun = results.find((result) => result.task.id === blockTask.id)!;
    expect(rerun.suggestions.find((suggestion) => suggestion.status === "pending")?.before).toEqual({
      field: "description",
      value: String(applied.suggested.value)
    });
    view = await harness.service.getSession(session, sessionId);
    expect(view.suggestions.find((suggestion) => suggestion.id === applied.id)?.status).toBe("applied");
    expect(view.session.status).toBe("ready");
  });

  it("re-queues a task that was running when the answer arrived", async () => {
    const harness = createHarness();
    const { sessionId, analyzed } = await start(harness);
    const blockTask = analyzed.tasks.find((task) => task.kind === "block")!;
    const metric = analyzed.session.analysis!.questions.find((question) => question.kind === "metric")!;
    await harness.service.completeQuestions(session, sessionId);

    // The answer lands while the block's generation is in flight.
    const original = harness.repository.createSuggestions.bind(harness.repository);
    vi.spyOn(harness.repository, "createSuggestions").mockImplementationOnce(async (payloads) => {
      await harness.service.answerQuestion(session, sessionId, metric.id, { answer: null, detail: "Served 12 merchants", add_to_main: false });
      return original(payloads);
    });
    const first = await harness.service.runTask(session, sessionId, blockTask.id);
    expect(first.task).toMatchObject({ status: "ready", rerun_for_answer: true });

    const second = await harness.service.runTask(session, sessionId, blockTask.id);
    expect(second.task).toMatchObject({ status: "done", rerun_for_answer: false });
    expect(String(second.suggestions[0].suggested.value)).toContain("Served 12 merchants");
  });

  it("refines a block with a preset or the candidate's request, creating a task for an unplanned block", async () => {
    const harness = createHarness({ content: realCv() });
    const { sessionId, analyzed } = await start(harness);
    // The mock analysis plans at most 3 item blocks; the volunteer block is not among them.
    expect(analyzed.tasks.some((task) => task.block_id === "vol-a")).toBe(false);
    await harness.service.completeQuestions(session, sessionId);
    await runReady(harness, sessionId);
    await harness.service.finish(session, sessionId);

    const refined = await harness.service.refineBlock(session, sessionId, "vol-a", { instruction: "  Mention mentoring leadership  " });
    expect(refined.task).toMatchObject({ kind: "block", block_id: "vol-a", section_id: "vol", status: "done" });
    expect(refined.suggestions).toHaveLength(1);
    expect(String(refined.suggestions[0].suggested.value)).toContain("refined as requested");
    expect(refined.session_status).toBe("ready");
    const request = harness.requests.at(-1)!;
    expect(request.input_payload.candidate_request).toBe("Mention mentoring leadership");

    // A second refine reuses the task and replaces its pending card.
    const again = await harness.service.refineBlock(session, sessionId, "vol-a", { refinement: "more_professional" });
    expect(again.task.id).toBe(refined.task.id);
    expect(harness.requests.at(-1)!.input_payload.refinement).toMatch(/professional wording/);
    const view = await harness.service.getSession(session, sessionId);
    expect(view.suggestions.filter((suggestion) => suggestion.task_id === refined.task.id)).toHaveLength(1);

    // Skills and summary blocks can be refined as well.
    const skills = await harness.service.refineBlock(session, sessionId, "skl-b", { instruction: "Lead with tools" });
    expect(skills.task).toMatchObject({ kind: "skills", block_id: "skl-b" });
    expect(skills.suggestions[0]?.suggested.field).toBe("items");
    const summary = await harness.service.refineBlock(session, sessionId, "sum-1", { refinement: "improve" });
    expect(summary.task.kind).toBe("summary");
    const after = await harness.service.getSession(session, sessionId);
    expect(after.tasks.filter((task) => task.kind === "summary").map((task) => task.id)).toEqual([summary.task.id]);

    // Cost report labels the runs.
    const report = await harness.service.getCostReport(sessionId);
    const steps = report.runs.map((run) => run.step);
    expect(steps).toContain("Block: Mentor · Code Club (refine)");
    expect(steps).toContain("Block: Mentor · Code Club (quick fix)");
    expect(steps).toContain("Skills (refine)");
    expect(report.by_step.map((step) => step.step)).toEqual(expect.arrayContaining(["Refinements", "Quick fixes"]));

    await expect(harness.service.refineBlock(session, sessionId, "hdr-1", { instruction: "x" })).rejects.toThrow(NotFoundError);
    await expect(harness.service.refineBlock(session, sessionId, "exp-d", { instruction: "x" })).rejects.toThrow(NotFoundError);
    await expect(harness.service.refineBlock(session, sessionId, "nope", { instruction: "x" })).rejects.toThrow(NotFoundError);
    await expect(harness.service.refineBlock(session, sessionId, "vol-a", { instruction: "   " })).rejects.toThrow(ValidationError);
  });

  it("refuses to refine before the analysis and passes an instruction through runTask", async () => {
    const harness = createHarness();
    const created = await harness.service.createSession(session, { cv_id: "master-1", job: JOB });
    await expect(harness.service.refineBlock(session, created.session.id, "exp-1", { refinement: "shorter" })).rejects.toThrow(ConflictError);

    const analyzed = await harness.service.analyze(session, created.session.id);
    const summaryTask = analyzed.tasks.find((task) => task.kind === "summary")!;
    const result = await harness.service.runTask(session, created.session.id, summaryTask.id, { instruction: "Mention payments" });
    expect(result.suggestions).toHaveLength(1);
    expect(harness.requests.at(-1)!.input_payload).toMatchObject({ candidate_request: "Mention payments" });
  });
});

describe("tailoring request schemas", () => {
  it("accepts the refine contract and rejects empty or oversized requests", () => {
    expect(runTaskSchema.parse({ regenerate: true, refinement: "more_professional", instruction: "  tighter  " })).toEqual({
      regenerate: true,
      refinement: "more_professional",
      instruction: "tighter"
    });
    expect(runTaskSchema.parse({ refinement: "improve", instruction: "" })).toMatchObject({ instruction: null });
    expect(() => runTaskSchema.parse({ instruction: "x".repeat(501) })).toThrow();
    expect(() => runTaskSchema.parse({ refinement: "louder" })).toThrow();
    expect(refineBlockSchema.parse({ instruction: "Mention Kafka" })).toEqual({ instruction: "Mention Kafka" });
    expect(() => refineBlockSchema.parse({})).toThrow();
    expect(() => refineBlockSchema.parse({ refinement: null, instruction: "  " })).toThrow();
    expect(tailoringBlockParamsSchema.parse({ sessionId: randomUUID(), blockId: "experience-1712345" }).blockId).toBe("experience-1712345");
    expect(() => tailoringBlockParamsSchema.parse({ sessionId: randomUUID(), blockId: "x".repeat(129) })).toThrow();
  });

  it("adds the rerun_for_answer column in an additive migration", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261028120000_tailoring_task_rerun_for_answer.sql"), "utf-8");
    expect(sql).toMatch(/add column if not exists rerun_for_answer boolean not null default false/i);
    expect(sql).not.toMatch(/drop|delete|update /i);
  });
});
