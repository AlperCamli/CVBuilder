import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CvBlock, CvContent, CvSection, MasterCvDetail, TailoredCvDetail } from "../../integration/api-types";
import { ApiClientError } from "../../integration/api-error";
import type { TailoringQuestion, TailoringSessionView, TailoringTaskRunResponse } from "../../integration/tailoring-types";
import { createDemoTailoring } from "../../localization/studio/demo-tailoring";
import {
  buildOpenMetricEntries,
  changedEntryBlockIds,
  editableItemBlockIds,
  hasOpenMetricTargets,
  isSkippedAnswer,
  openMetricBlockOptions,
  orderTailoringQuestions,
  sameAnswerEntries,
  validateAnswerEntries
} from "./open-metric";

const block = (id: string, type: string, fields: CvBlock["fields"]): CvBlock => ({ id, type, order: 0, visibility: "visible", meta: {}, fields });
const section = (id: string, type: string, blocks: CvBlock[], order: number): CvSection => ({
  id,
  type,
  title: null,
  order,
  meta: {},
  blocks: blocks.map((item, index) => ({ ...item, order: index }))
});
const cv = (sections: CvSection[]): CvContent => ({ version: "v1", language: "en", metadata: {}, sections });

const fullCv = cv([
  section("s", "summary", [block("s1", "summary", { text: "Analyst." })], 0),
  section("e", "experience", [
    block("e1", "position", { role: "Data Analyst", company: "Acme", description: "• Built reports" }),
    block("e2", "job", { title: "Intern", employer: "Beta", description: "" })
  ], 1),
  section("ed", "education", [block("ed1", "degree", { degree: "BSc", institution: "Uni", description: "" })], 2),
  section("p", "projects", [block("p1", "project", { name: "Dashboard", description: "Built it" })], 3),
  section("v", "volunteer", [block("v1", "volunteer", { role: "Mentor", organization: "Code Club", description: "Taught" })], 4),
  section("sk", "skills", [block("sk1", "skills", { skills: ["SQL"] })], 5)
]);

describe("open number question: selectable blocks", () => {
  it("lists experience, project and volunteering items, never summary, skills or education", () => {
    expect(openMetricBlockOptions(fullCv).map((option) => [option.blockId, option.title, option.subtitle])).toEqual([
      ["e1", "Data Analyst", "Acme"],
      ["e2", "Intern", "Beta"],
      ["p1", "Dashboard", ""],
      ["v1", "Mentor", "Code Club"]
    ]);
    expect(hasOpenMetricTargets(fullCv)).toBe(true);
    // Every editable item is a valid target on the server.
    expect([...editableItemBlockIds(fullCv)]).toEqual(["e1", "e2", "ed1", "p1", "v1"]);
  });

  it("falls back to the other items when the CV has no experience, project or volunteering item", () => {
    const onlyEducation = cv([
      section("s", "summary", [block("s1", "summary", { text: "Analyst." })], 0),
      section("ed", "education", [block("ed1", "degree", { degree: "BSc", institution: "Uni", description: "" })], 1)
    ]);
    expect(openMetricBlockOptions(onlyEducation).map((option) => option.blockId)).toEqual(["ed1"]);
    expect(hasOpenMetricTargets(onlyEducation)).toBe(false);
    expect(openMetricBlockOptions(cv([section("s", "summary", [block("s1", "summary", { text: "x" })], 0)]))).toEqual([]);
  });
});

describe("open number question: building entries", () => {
  const allowed = ["e1", "p1"];

  it("trims figures, leaves out empty rows and caps at five", () => {
    const drafts = [
      { key: "a", target_block_id: "e1", detail: "  ~40   shipments a week " },
      { key: "b", target_block_id: "p1", detail: "   " },
      { key: "c", target_block_id: "", detail: "" },
      ...Array.from({ length: 6 }, (_, index) => ({ key: `x${index}`, target_block_id: "p1", detail: `${index + 1} clients` }))
    ];
    const result = buildOpenMetricEntries(drafts, allowed);
    expect(result.problems).toEqual({});
    expect(result.entries).toHaveLength(5);
    expect(result.entries[0]).toEqual({ target_block_id: "e1", detail: "~40 shipments a week" });
  });

  it("flags figures without an entry, with an entry that is gone, or that are too long", () => {
    const result = buildOpenMetricEntries(
      [
        { key: "a", target_block_id: "", detail: "12 people" },
        { key: "b", target_block_id: "deleted", detail: "3 offices" },
        { key: "c", target_block_id: "e1", detail: "x".repeat(301) },
        { key: "d", target_block_id: "p1", detail: "x".repeat(300) }
      ],
      allowed
    );
    expect(result.problems).toEqual({ a: "missing_block", b: "unknown_block", c: "too_long" });
    expect(result.entries).toEqual([{ target_block_id: "p1", detail: "x".repeat(300) }]);
  });

  it("validates a request body like the server", () => {
    const ids = new Set(["e1"]);
    expect(validateAnswerEntries([{ target_block_id: "e1", detail: " 5 people " }], ids)).toEqual({
      entries: [{ target_block_id: "e1", detail: "5 people" }],
      error: null
    });
    expect(validateAnswerEntries([], ids)).toEqual({ entries: [], error: null });
    expect(validateAnswerEntries("x", ids).error).toBeTruthy();
    expect(validateAnswerEntries(Array.from({ length: 6 }, () => ({ target_block_id: "e1", detail: "1" })), ids).error).toMatch(/at most 5/);
    expect(validateAnswerEntries([{ target_block_id: "e1", detail: "" }], ids).error).toBeTruthy();
    expect(validateAnswerEntries([{ target_block_id: "e1", detail: "x".repeat(301) }], ids).error).toBeTruthy();
    expect(validateAnswerEntries([{ target_block_id: "s1", detail: "4" }], ids).error).toMatch(/entry of your CV/);
  });

  it("finds the blocks whose figures changed", () => {
    const before = [
      { target_block_id: "e1", detail: "40 a week" },
      { target_block_id: "p1", detail: "3 clients" }
    ];
    expect(changedEntryBlockIds(undefined, before)).toEqual(["e1", "p1"]);
    expect(changedEntryBlockIds(before, [before[0], { target_block_id: "p1", detail: "4 clients" }])).toEqual(["p1"]);
    expect(changedEntryBlockIds(before, [before[0]])).toEqual(["p1"]);
    expect(changedEntryBlockIds(before, [{ target_block_id: "v1", detail: "40 a week" }, before[1]])).toEqual(["e1", "v1"]);
    expect(changedEntryBlockIds(before, [...before])).toEqual([]);
    expect(sameAnswerEntries(before, [...before])).toBe(true);
    expect(sameAnswerEntries(before, [before[1], before[0]])).toBe(false);
    expect(sameAnswerEntries(undefined, [])).toBe(true);
  });
});

describe("question order and skipped answers", () => {
  const q = (id: string, kind: TailoringQuestion["kind"]): TailoringQuestion => ({ id, kind, text: id, requirement_id: null, target_block_id: null });

  it("shows yes/no questions, then specific numbers, then the open number question", () => {
    const ordered = orderTailoringQuestions([q("open", "metric_open"), q("m1", "metric"), q("g1", "gap"), q("m2", "metric"), q("g2", "gap")]);
    expect(ordered.map((item) => item.id)).toEqual(["g1", "g2", "m1", "m2", "open"]);
  });

  it("treats a number answer without a figure as skipped", () => {
    const answer = (patch: object) => ({ answer: null, detail: null, add_to_main: false, answered_at: "", ...patch });
    expect(isSkippedAnswer(q("m", "metric"), undefined)).toBe(false);
    expect(isSkippedAnswer(q("m", "metric"), answer({}))).toBe(true);
    expect(isSkippedAnswer(q("m", "metric"), answer({ detail: "about 40" }))).toBe(false);
    expect(isSkippedAnswer(q("o", "metric_open"), answer({ entries: [] }))).toBe(true);
    expect(isSkippedAnswer(q("o", "metric_open"), answer({ entries: [{ target_block_id: "e1", detail: "4" }] }))).toBe(false);
    expect(isSkippedAnswer(q("g", "gap"), answer({ answer: "no" }))).toBe(false);
  });
});

describe("demo backend: open number question", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = async () => {
    const content = structuredClone(fullCv);
    const master = { id: "m1", current_content: content } as unknown as MasterCvDetail;
    const demo = createDemoTailoring({ masters: new Map([["m1", master]]), tailored: new Map<string, TailoredCvDetail>() });
    const call = async <T,>(method: string, path: string, body: Record<string, unknown> = {}): Promise<T> => {
      const pending = demo.handle(method, path, body);
      pending.catch(() => undefined); // rejections are awaited below
      await vi.advanceTimersByTimeAsync(5000);
      return (await pending) as T;
    };
    const created = await call<TailoringSessionView>("POST", "/ai/tailoring-sessions", {
      cv_id: "m1",
      job: { job_title: "Analyst", job_description: "SQL" }
    });
    const base = `/ai/tailoring-sessions/${created.session.id}`;
    const analyzed = await call<TailoringSessionView>("POST", `${base}/analyze`);
    return { call, base, analyzed };
  };

  it("asks at most 3 gap and 2 number questions plus the open question", async () => {
    const { analyzed } = await setup();
    const questions = analyzed.session.analysis!.questions;
    expect(questions.filter((item) => item.kind === "gap").length).toBeLessThanOrEqual(3);
    expect(questions.filter((item) => item.kind === "metric").length).toBeLessThanOrEqual(2);
    expect(questions.filter((item) => item.kind === "metric_open")).toEqual([
      expect.objectContaining({ id: "q_open_metric", requirement_id: null, target_block_id: null })
    ]);
    // No task waits on the open question.
    expect(analyzed.tasks.some((task) => task.depends_on_question_ids.includes("q_open_metric"))).toBe(false);
  });

  it("rejects invalid entries, re-runs the block of a changed figure and creates a task for a block without one", async () => {
    const { call, base, analyzed } = await setup();
    const experienceTask = analyzed.tasks.find((task) => task.kind === "block" && task.block_id === "e1")!;
    await call<TailoringSessionView>("POST", `${base}/questions/complete`);
    const run = await call<TailoringTaskRunResponse>("POST", `${base}/tasks/${experienceTask.id}/run`);
    expect(run.task.status).toBe("done");

    await expect(
      call("PUT", `${base}/answers/q_open_metric`, { answer: null, detail: null, entries: [{ target_block_id: "s1", detail: "4" }] })
    ).rejects.toBeInstanceOf(ApiClientError);

    const saved = await call<TailoringSessionView>("PUT", `${base}/answers/q_open_metric`, {
      answer: null,
      detail: null,
      entries: [
        { target_block_id: "e1", detail: "~40 shipments a week" },
        { target_block_id: "p1", detail: "used by 3 teams" }
      ]
    });
    expect(saved.session.answers.q_open_metric.entries).toHaveLength(2);
    expect(saved.tasks.find((task) => task.id === experienceTask.id)).toMatchObject({ status: "ready", rerun_for_answer: true });
    const projectTask = saved.tasks.find((task) => task.block_id === "p1");
    expect(projectTask).toMatchObject({ kind: "block", status: "ready" });

    const rerun = await call<TailoringTaskRunResponse>("POST", `${base}/tasks/${experienceTask.id}/run`);
    expect(String(rerun.suggestions[0].suggested.value)).toContain("• ~40 shipments a week");
    const project = await call<TailoringTaskRunResponse>("POST", `${base}/tasks/${projectTask!.id}/run`);
    expect(String(project.suggestions[0].suggested.value)).toContain("• Used by 3 teams");

    // The same figures again change nothing.
    const again = await call<TailoringSessionView>("PUT", `${base}/answers/q_open_metric`, {
      answer: null,
      detail: null,
      entries: saved.session.answers.q_open_metric.entries
    });
    expect(again.tasks.filter((task) => task.block_id === "e1" || task.block_id === "p1").map((task) => task.status)).toEqual(["done", "done"]);
  });
});
