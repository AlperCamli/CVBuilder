import type { CvContent, CvJsonValue, MasterCvDetail, TailoredCvDetail } from "../../integration/api-types";
import type {
  TailoringAnalysis,
  TailoringScore,
  TailoringSessionView,
  TailoringSuggestion,
  TailoringTask
} from "../../integration/tailoring-types";

// In-browser stand-in for the tailoring v2 session API, so the Language Studio (and local
// UI review) can walk through the whole in-editor tailoring flow without a backend.

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

const firstBlock = (content: CvContent, type: string) =>
  content.sections.find((section) => section.type === type)?.blocks[0] ?? null;

const STATUS_VALUE = { covered: 1, weak: 0.5, missing: 0 } as const;

const scoreOf = (view: TailoringSessionView): TailoringScore => {
  const analysis = view.session.analysis;
  if (!analysis) return { initial: null, current: null, potential: null };
  const relevant = analysis.requirements.filter((item) => view.session.requirement_decisions[item.id] !== "not_relevant");
  const weight = (item: (typeof relevant)[number]) => item.weight * (item.importance === "must" ? 2 : 1);
  const total = relevant.reduce((sum, item) => sum + weight(item), 0) || 1;
  const answerFor = (requirementId: string) =>
    view.session.answers[analysis.questions.find((question) => question.requirement_id === requirementId && question.kind === "gap")?.id ?? ""]?.answer;
  const compute = (statuses: Set<string>) =>
    Math.round(
      (100 *
        relevant.reduce((sum, item) => {
          const addressed = view.suggestions.some((s) => statuses.has(s.status) && s.requirement_ids.includes(item.id));
          let status = item.status;
          if (addressed && answerFor(item.id) !== "no") {
            status = item.status === "missing" && answerFor(item.id) !== "yes" ? "weak" : "covered";
          }
          return sum + weight(item) * STATUS_VALUE[status];
        }, 0)) /
        total
    );
  return {
    initial: compute(new Set()),
    current: compute(new Set(["applied"])),
    potential: compute(new Set(["applied", "pending"]))
  };
};

export function createDemoTailoring(store: {
  masters: Map<string, MasterCvDetail>;
  tailored: Map<string, TailoredCvDetail>;
}) {
  const sessions = new Map<string, TailoringSessionView>();
  // "Also add to my main CV" writes, per suggestion, so undo can revert them.
  const masterWrites = new Map<string, { masterId: string; blockId: string; field: string; before: CvJsonValue; after: CvJsonValue }>();
  let autoApply = false;
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

  const withScore = (view: TailoringSessionView): TailoringSessionView => ({
    ...view,
    score: scoreOf(view),
    preferences: { auto_apply: autoApply }
  });

  const requireSession = (id: string) => {
    const view = sessions.get(id);
    if (!view) throw new Error("The requested item was not found.");
    return view;
  };

  const touchTask = (view: TailoringSessionView, taskId: string, patch: Partial<TailoringTask>) => {
    view.tasks = view.tasks.map((task) => (task.id === taskId ? { ...task, ...patch, updated_at: now() } : task));
  };

  const settle = (view: TailoringSessionView) => {
    if (view.session.status === "generating" && view.tasks.every((task) => ["done", "skipped", "failed"].includes(task.status))) {
      view.session.status = "reviewing";
    }
  };

  const analyze = (view: TailoringSessionView, content: CvContent) => {
    const experience = firstBlock(content, "experience");
    const summary = firstBlock(content, "summary");
    const skills = firstBlock(content, "skills");
    const tr = content.language === "tr";
    const analysis: TailoringAnalysis = {
      role_summary: `${view.session.job.job_title}`,
      requirements: [
        {
          id: "r1",
          text: tr ? "SQL ile raporlama" : "Reporting with SQL",
          keywords: ["SQL"],
          importance: "must",
          weight: 3,
          status: "covered",
          confidence: "high",
          evidence_block_ids: [experience?.id, skills?.id].filter((value): value is string => Boolean(value)),
          reason: tr ? "Deneyim ve becerilerde açıkça görülüyor." : "Clearly shown in your experience and skills."
        },
        {
          id: "r2",
          text: tr ? "Ölçülebilir iş etkisi" : "Measurable business impact",
          keywords: ["impact"],
          importance: "must",
          weight: 2,
          status: "weak",
          confidence: "medium",
          evidence_block_ids: experience ? [experience.id] : [],
          reason: tr ? "Tek bir sonuç belirtilmiş." : "Only one result is mentioned."
        },
        {
          id: "r3",
          text: tr ? "Tableau panoları" : "Tableau dashboards",
          keywords: ["Tableau"],
          importance: "nice",
          weight: 1,
          status: "missing",
          confidence: "medium",
          evidence_block_ids: [],
          reason: tr ? "CV'de geçmiyor." : "Not mentioned in your CV."
        }
      ],
      questions: [
        {
          id: "q1",
          kind: "gap",
          text: tr ? "Tableau ile pano hazırladınız mı?" : "Have you built dashboards in Tableau?",
          requirement_id: "r3",
          target_block_id: experience?.id ?? null
        },
        ...(experience
          ? [
              {
                id: "q2",
                kind: "metric" as const,
                text: tr ? "Raporlarınızı kaç kişi kullanıyordu?" : "How many people used your reports?",
                requirement_id: "r2",
                target_block_id: experience.id
              }
            ]
          : [])
      ]
    };
    const task = (kind: TailoringTask["kind"], blockId: string | null, depends: string[]): TailoringTask => ({
      id: nextId("demo-task"),
      kind,
      block_id: blockId,
      section_id: null,
      status: depends.length ? "waiting" : "ready",
      depends_on_question_ids: depends,
      error_message: null,
      updated_at: now()
    });
    view.session.analysis = analysis;
    view.session.status = "answering";
    view.tasks = [
      task("summary", summary?.id ?? null, []),
      ...(experience ? [task("block", experience.id, ["q1", "q2"])] : []),
      task("skills", skills?.id ?? null, ["q1"]),
      task("structure", null, [])
    ];
  };

  const generate = (view: TailoringSessionView, task: TailoringTask, content: CvContent, refinement?: string | null): TailoringSuggestion[] => {
    const tr = content.language === "tr";
    const block = task.block_id
      ? content.sections.flatMap((section) => section.blocks).find((item) => item.id === task.block_id) ?? null
      : null;
    const base = {
      task_id: task.id,
      section_id: null,
      add_to_main: false,
      guard_notes: [],
      status: "pending" as const,
      created_at: now()
    };
    const metric = view.session.answers.q2?.detail;
    const tableau = view.session.answers.q1?.answer;

    if (task.kind === "structure") return [];
    if (task.kind === "skills" && block) {
      const current = Array.isArray(block.fields.skills) ? block.fields.skills.map(String) : [];
      const added = tableau === "yes" || tableau === "some" ? ["Tableau"] : [];
      const next = [...new Set(["SQL", ...added, ...current])];
      if (next.join("|") === current.join("|")) return [];
      return [
        {
          ...base,
          id: nextId("demo-suggestion"),
          kind: "skills",
          block_id: block.id,
          before: { field: "skills", value: current },
          suggested: { field: "skills", value: next },
          rationale: tr ? "İlanın istediği becerileri öne alır." : "Puts the skills this job asks for first.",
          requirement_ids: added.length ? ["r1", "r3"] : ["r1"]
        }
      ];
    }
    if (task.kind === "summary" && block) {
      const role = view.session.job.job_title;
      return [
        {
          ...base,
          id: nextId("demo-suggestion"),
          kind: "rewrite",
          block_id: block.id,
          before: { field: "text", value: String(block.fields.text ?? "") },
          suggested: {
            field: "text",
            value: tr
              ? `${role} rolüne odaklanan veri analisti; satış verilerini SQL ve Excel ile karar destekleyen raporlara dönüştürür.`
              : refinement === "shorter"
                ? `Data analyst turning sales data into decision-ready ${role} reports with SQL and Excel.`
                : `Data analyst focused on ${role} work, turning sales data into decision-ready reports with SQL and Excel and partnering closely with business teams.`
          },
          rationale: tr ? "Özeti hedef role yöneltir." : "Aims your summary at the target role.",
          requirement_ids: ["r1"]
        }
      ];
    }
    if (task.kind === "block" && block) {
      const lines = [
        tr
          ? "SQL ile haftalık satış raporları hazırlayarak raporlama süresini %30 azalttı"
          : "Built weekly SQL-based sales reports, reducing reporting time by 30%",
        ...(metric ? [tr ? `Raporlar ${metric} tarafından kullanıldı` : `Reports used by ${metric}`] : []),
        ...(tableau === "yes" || tableau === "some"
          ? [tr ? "Satış ekipleri için Tableau panoları oluşturdu" : "Created Tableau dashboards for the sales teams"]
          : [])
      ];
      return [
        {
          ...base,
          id: nextId("demo-suggestion"),
          kind: "rewrite",
          block_id: block.id,
          before: { field: "description", value: String(block.fields.description ?? "") },
          suggested: { field: "description", value: lines.map((line) => `• ${line}`).join("\n") },
          rationale: tr ? "Sonuçları ve ilanın terimlerini öne çıkarır." : "Leads with results and the job's terms.",
          requirement_ids: ["r1", "r2", ...(tableau === "yes" || tableau === "some" ? ["r3"] : [])],
          add_to_main: Boolean(view.session.answers.q2?.add_to_main)
        }
      ];
    }
    return [];
  };

  const sameValue = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

  const writeMasterField = (masterId: string, blockId: string, field: string, value: CvJsonValue): boolean => {
    const master = store.masters.get(masterId);
    if (!master || !master.current_content.sections.some((section) => section.blocks.some((block) => block.id === blockId))) {
      return false;
    }
    store.masters.set(masterId, {
      ...master,
      current_content: {
        ...master.current_content,
        sections: master.current_content.sections.map((section) => ({
          ...section,
          blocks: section.blocks.map((block) => (block.id === blockId ? { ...block, fields: { ...block.fields, [field]: value } } : block))
        }))
      }
    });
    return true;
  };

  const masterField = (masterId: string, blockId: string, field: string): CvJsonValue | undefined =>
    store.masters
      .get(masterId)
      ?.current_content.sections.flatMap((section) => section.blocks)
      .find((block) => block.id === blockId)?.fields[field];

  // Mirrors the backend: accept writes the main CV block; undo reverts it only when the main
  // CV block is unchanged since, otherwise the revert is skipped.
  const syncMasterCv = (view: TailoringSessionView, previous: TailoringSuggestion, next: TailoringSuggestion, decision: string) => {
    const result = { master_cv_updated: false, master_cv_reverted: false, master_cv_revert_skipped: false };
    if (decision === "accept" && next.add_to_main && next.kind === "rewrite" && next.block_id) {
      const masterId = store.tailored.get(view.session.tailored_cv_id)?.master_cv_id;
      const field = String(next.suggested.field ?? "");
      const before = masterId && field ? masterField(masterId, next.block_id, field) : undefined;
      const after = next.suggested.value as CvJsonValue;
      if (masterId && field && before !== undefined && writeMasterField(masterId, next.block_id, field, after)) {
        masterWrites.set(next.id, { masterId, blockId: next.block_id, field, before, after });
        result.master_cv_updated = true;
      }
    }
    if (decision === "undo" && previous.status === "applied") {
      const write = masterWrites.get(next.id);
      if (write) {
        masterWrites.delete(next.id);
        if (sameValue(masterField(write.masterId, write.blockId, write.field), write.after)) {
          result.master_cv_reverted = writeMasterField(write.masterId, write.blockId, write.field, write.before);
        } else {
          result.master_cv_revert_skipped = true;
        }
      }
    }
    return result;
  };

  const handle = async (method: string, path: string, body: Record<string, unknown>): Promise<unknown> => {
    if (path === "/ai/tailoring-preferences") {
      autoApply = body.auto_apply === true;
      return { auto_apply: autoApply };
    }
    if (path === "/ai/tailoring-sessions/active") return { session: null };
    if (path === "/ai/tailoring-sessions" && method === "POST") {
      const sourceId = String(body.cv_id);
      const job = body.job as { job_title: string; company_name?: string | null; job_description: string };
      const master = store.masters.get(sourceId);
      let tailoredId = sourceId;
      if (master) {
        tailoredId = nextId("demo-tailored-new");
        store.tailored.set(tailoredId, {
          ...structuredClone(master),
          id: tailoredId,
          title: `${master.title} - ${job.company_name || job.job_title}`,
          status: "draft",
          master_cv_id: master.id,
          job_id: null,
          job: null,
          tailoring_review: null,
          ai_generation_status: null,
          last_exported_at: null,
          source_master_cv: master
        } as unknown as TailoredCvDetail);
      }
      const view: TailoringSessionView = {
        session: {
          id: nextId("demo-session"),
          tailored_cv_id: tailoredId,
          job_id: null,
          status: "draft",
          job: { job_title: job.job_title, company_name: job.company_name ?? "", job_description: job.job_description },
          analysis: null,
          requirement_decisions: {},
          answers: {},
          questions_completed: false,
          error_message: null,
          created_at: now(),
          finished_at: null
        },
        tasks: [],
        suggestions: [],
        score: { initial: null, current: null, potential: null },
        preferences: { auto_apply: autoApply },
        viewer: { is_admin: false }
      };
      sessions.set(view.session.id, view);
      return withScore(view);
    }

    const match = path.match(/^\/ai\/tailoring-sessions\/([^/]+)(?:\/(.*))?$/);
    if (!match) return undefined;
    const view = requireSession(match[1]);
    const action = match[2] ?? "";
    const content = store.tailored.get(view.session.tailored_cv_id)?.current_content;

    if (action === "" && method === "GET") return withScore(view);
    if (action === "analyze") {
      view.session.status = "analyzing";
      await wait(2200);
      analyze(view, content!);
      return withScore(view);
    }
    if (action.startsWith("requirements/")) {
      view.session.requirement_decisions[action.split("/")[1]] = body.decision as "relevant" | "not_relevant";
      return withScore(view);
    }
    if (action.startsWith("answers/")) {
      const questionId = action.split("/")[1];
      view.session.answers[questionId] = {
        answer: (body.answer as "yes" | "some" | "no" | null) ?? null,
        detail: (body.detail as string | null) ?? null,
        add_to_main: body.add_to_main === true,
        answered_at: now()
      };
      for (const task of view.tasks.filter((item) => item.status === "waiting")) {
        if (task.depends_on_question_ids.every((id) => view.session.answers[id])) touchTask(view, task.id, { status: "ready" });
      }
      return withScore(view);
    }
    if (action === "questions/complete") {
      view.session.questions_completed = true;
      view.session.status = "generating";
      for (const task of view.tasks.filter((item) => item.status === "waiting")) touchTask(view, task.id, { status: "ready" });
      settle(view);
      return withScore(view);
    }
    const taskMatch = action.match(/^tasks\/([^/]+)\/run$/);
    if (taskMatch) {
      const task = view.tasks.find((item) => item.id === taskMatch[1]);
      if (!task) throw new Error("The requested item was not found.");
      touchTask(view, task.id, { status: "running" });
      if (body.regenerate || body.refinement) {
        view.suggestions = view.suggestions.map((item) => (item.task_id === task.id && item.status === "pending" ? { ...item, status: "expired" } : item));
      }
      await wait(1400 + Math.random() * 1600);
      const created = generate(view, task, store.tailored.get(view.session.tailored_cv_id)!.current_content, body.refinement as string | null);
      view.suggestions = [...view.suggestions.filter((item) => item.status !== "expired"), ...created];
      touchTask(view, task.id, { status: created.length || task.kind !== "structure" ? "done" : "skipped" });
      settle(view);
      const scored = withScore(view);
      return {
        task: view.tasks.find((item) => item.id === task.id),
        suggestions: created,
        session_status: view.session.status,
        score: scored.score
      };
    }
    const decisionMatch = action.match(/^suggestions\/([^/]+)\/decision$/);
    if (decisionMatch) {
      const decision = body.decision as "accept" | "reject" | "undo";
      const previous = view.suggestions.find((item) => item.id === decisionMatch[1]);
      if (!previous) throw new Error("The requested item was not found.");
      view.suggestions = view.suggestions.map((item) => {
        if (item.id !== decisionMatch[1]) return item;
        const status = decision === "accept" ? "applied" : decision === "reject" ? "rejected" : "pending";
        return {
          ...item,
          status,
          suggested: body.edited_value !== undefined && body.edited_value !== null ? { ...item.suggested, value: body.edited_value } : item.suggested
        };
      });
      const suggestion = view.suggestions.find((item) => item.id === decisionMatch[1])!;
      return { suggestion, score: scoreOf(view), ...syncMasterCv(view, previous, suggestion, decision) };
    }
    if (action === "finish") {
      view.session.status = "ready";
      view.session.finished_at = now();
      return withScore(view);
    }
    return undefined;
  };

  return { handle };
}
