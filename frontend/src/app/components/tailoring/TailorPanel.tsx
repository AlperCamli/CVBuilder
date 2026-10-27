import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Circle,
  CircleDashed,
  Coins,
  Download,
  FileText,
  Loader2,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
  X,
  Zap
} from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { BackendApi } from "../../integration/backend-api";
import type { CvContent } from "../../integration/api-types";
import {
  isTailoringSuggestionStale,
  isTailoringUndoBlocked,
  tailoringSuggestionTargets
} from "../../integration/tailoring-apply";
import type {
  TailoringAnswerPayload,
  TailoringQuestion,
  TailoringRequirement,
  TailoringSessionView,
  TailoringSuggestion
} from "../../integration/tailoring-types";
import { Switch } from "../ui/switch";
import { AiStatusLine, AiWorkingBadge, ShimmerBlock } from "./ai-elements";
import { RefineArea } from "./RefineArea";
import { SuggestionCard } from "./SuggestionCard";
import { TailoringCostDialog } from "./TailoringCostDialog";
import { describeBlock, describeTask } from "./tailoring-labels";
import { orderTailoringQuestions } from "./open-metric";
import { OpenMetricQuestion, QuestionCard } from "./TailoringQuestions";
import {
  TASK_SKIP_AFTER_FAILURES,
  type TailoringIssue,
  type TailoringJobInput,
  type TailoringNotice,
  type TailoringSessionController
} from "./useTailoringSession";

const ANALYSIS_STEPS = ["Reading the job description…", "Matching your CV to each requirement…", "Preparing questions and a plan…"];

// ---------------------------------------------------------------------------
// Job input
// ---------------------------------------------------------------------------

function JobForm({
  initial,
  busy,
  heading,
  onSubmit
}: {
  initial: Partial<TailoringJobInput>;
  busy: boolean;
  heading: string;
  onSubmit: (job: TailoringJobInput) => void;
}) {
  const [role, setRole] = useState(initial.job_title ?? "");
  const [company, setCompany] = useState(initial.company_name ?? "");
  const [description, setDescription] = useState(initial.job_description ?? "");
  const tooShort = description.trim().length > 0 && description.trim().length < 80;
  const canSubmit = role.trim().length > 0 && description.trim().length >= 80 && !busy;

  const field = { fontSize: "13px", borderColor: "var(--color-border-secondary)", background: "var(--color-background-primary)" };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit({ job_title: role.trim(), company_name: company.trim(), job_description: description.trim() });
      }}
    >
      <div>
        <h3 className="font-medium" style={{ fontSize: "16px" }}>{heading}</h3>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: 4 }}>
          {t("Paste the job posting. We'll compare it with your CV and suggest changes you can review one by one.")}
        </p>
      </div>
      <label className="block">
        <span className="block mb-1.5" style={{ fontSize: "12px", fontWeight: 500 }}>{t("Role")}</span>
        <input value={role} onChange={(event) => setRole(event.target.value)} placeholder={t("e.g. Senior Product Designer")} className="w-full px-3 py-2 rounded-lg border" style={field} />
      </label>
      <label className="block">
        <span className="block mb-1.5" style={{ fontSize: "12px", fontWeight: 500 }}>{t("Company name (optional)")}</span>
        <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder={t("e.g. TechStart Inc")} className="w-full px-3 py-2 rounded-lg border" style={field} />
      </label>
      <label className="block">
        <span className="block mb-1.5" style={{ fontSize: "12px", fontWeight: 500 }}>{t("Job description")}</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={11}
          placeholder={t("Paste the full job description here...")}
          className="w-full px-3 py-2 rounded-lg border resize-y"
          style={{ ...field, lineHeight: 1.55 }}
        />
        {tooShort ? (
          <span style={{ fontSize: "11px", color: "var(--color-amber-700)" }}>{t("Paste the full job description (at least a few sentences).")}</span>
        ) : null}
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full px-4 py-2.5 rounded-lg font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
        {busy ? t("Setting up...") : t("Analyze match")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Analysis progress
// ---------------------------------------------------------------------------

function AnalysisProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, ANALYSIS_STEPS.length - 1)), 3500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="space-y-4">
      <AiStatusLine label={t(ANALYSIS_STEPS[step])} detail={t("This usually takes a few seconds.")} />
      <div className="space-y-2">
        <ShimmerBlock height={64} />
        <ShimmerBlock height={36} />
        <ShimmerBlock height={36} />
        <ShimmerBlock height={36} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score and requirements
// ---------------------------------------------------------------------------

function ScoreMeter({ view }: { view: TailoringSessionView }) {
  const { initial, current, potential } = view.score;
  if (current === null) return null;
  const gain = potential !== null && potential > current ? potential - current : 0;
  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--color-background-secondary)" }}>
      <div className="flex items-end justify-between">
        <div>
          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("Job match")}</p>
          <p style={{ fontSize: "26px", fontWeight: 600, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{current}%</p>
        </div>
        <div className="text-right" style={{ fontSize: "12px" }}>
          {initial !== null && current > initial ? (
            <p style={{ color: "var(--color-teal-700)", fontWeight: 500 }}>+{current - initial} {t("since you started")}</p>
          ) : null}
          {gain > 0 ? <p style={{ color: "var(--color-text-secondary)" }}>+{gain} {t("possible with pending suggestions")}</p> : null}
        </div>
      </div>
      <div className="relative mt-2.5 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border-tertiary)" }}>
        {potential !== null ? (
          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${potential}%`, background: "var(--color-teal-100)" }} />
        ) : null}
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${current}%`, background: "var(--color-teal-600)" }} />
      </div>
    </div>
  );
}

const STATUS_ICON = {
  covered: <CheckCircle2 size={15} style={{ color: "var(--color-teal-600)" }} />,
  weak: <CircleDashed size={15} style={{ color: "var(--color-amber-700)" }} />,
  missing: <Circle size={15} style={{ color: "var(--color-red-500)" }} />
};

function RequirementChecklist({
  view,
  content,
  improvedIds,
  defaultExpanded,
  onFocusEvidence,
  onDecision
}: {
  view: TailoringSessionView;
  content: CvContent;
  improvedIds: Set<string>;
  defaultExpanded: boolean;
  onFocusEvidence: (ids: string[] | null) => void;
  onDecision: (requirement: TailoringRequirement, relevant: boolean) => void;
}) {
  // Open while the user is answering; collapsed during review so suggestions come first.
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => setExpanded(defaultExpanded), [defaultExpanded]);
  const requirements = view.session.analysis?.requirements ?? [];
  // Requirements strengthened by accepted suggestions count as covered here too.
  const counts = {
    covered: requirements.filter((item) => item.status === "covered" || improvedIds.has(item.id)).length,
    total: requirements.length
  };
  return (
    <div>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="w-full flex items-center justify-between py-1">
        <span style={{ fontSize: "13px", fontWeight: 600 }}>
          {t("Requirements")} <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>· {counts.covered}/{counts.total} {t("covered")}</span>
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <ul className="mt-1.5 space-y-1">
          {requirements.map((requirement) => {
            const notRelevant = view.session.requirement_decisions[requirement.id] === "not_relevant";
            const evidence = requirement.evidence_block_ids;
            return (
              <li
                key={requirement.id}
                className="group rounded-lg px-2 py-1.5 flex items-start gap-2 hover:bg-[var(--color-background-secondary)]"
                style={{ opacity: notRelevant ? 0.5 : 1, cursor: evidence.length ? "pointer" : "default" }}
                onMouseEnter={() => onFocusEvidence(evidence.length ? evidence : null)}
                onMouseLeave={() => onFocusEvidence(null)}
                title={evidence.length ? `${t("Shown in")}: ${evidence.map((id) => describeBlock(content, id)).join(", ")}` : requirement.reason}
              >
                <span className="mt-0.5 shrink-0">{STATUS_ICON[requirement.status]}</span>
                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: "13px", lineHeight: 1.4, textDecoration: notRelevant ? "line-through" : undefined }}>
                    {requirement.text}
                    {requirement.importance === "must" ? (
                      <span className="ml-1.5 px-1 rounded" style={{ fontSize: "10px", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>{t("Must")}</span>
                    ) : null}
                    {improvedIds.has(requirement.id) && requirement.status !== "covered" ? (
                      <span className="ml-1.5 px-1 rounded" style={{ fontSize: "10px", background: "var(--color-teal-50)", color: "var(--color-teal-800)" }}>{t("Improved")}</span>
                    ) : null}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>{requirement.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDecision(requirement, notRelevant)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 px-1.5 py-0.5 rounded"
                  style={{ fontSize: "10px", color: "var(--color-text-secondary)", border: "1px solid var(--color-border-tertiary)" }}
                  title={notRelevant ? t("Count this requirement again") : t("Not relevant to me")}
                >
                  {notRelevant ? t("Restore") : t("Not relevant")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

// One question card: the open number question has its own form.
function QuestionItem({
  question,
  view,
  content,
  updatingBlockIds,
  onAnswer
}: {
  question: TailoringQuestion;
  view: TailoringSessionView;
  content: CvContent;
  updatingBlockIds: Set<string>;
  onAnswer: (questionId: string, payload: TailoringAnswerPayload) => Promise<boolean>;
}) {
  const answer = view.session.answers[question.id];
  if (question.kind === "metric_open") {
    return (
      <OpenMetricQuestion
        content={content}
        answer={answer}
        updating={(answer?.entries ?? []).some((entry) => updatingBlockIds.has(entry.target_block_id))}
        onAnswer={(payload) => onAnswer(question.id, payload)}
      />
    );
  }
  return <QuestionCard question={question} content={content} answer={answer} onAnswer={(payload) => onAnswer(question.id, payload)} />;
}

// Answers can be changed after the questions step (review, finished, refine); the server
// then re-queues the suggestions that used them, which update automatically.
function AnswersDisclosure({
  view,
  content,
  updatingBlockIds,
  onAnswer
}: {
  view: TailoringSessionView;
  content: CvContent;
  updatingBlockIds: Set<string>;
  onAnswer: (questionId: string, payload: TailoringAnswerPayload) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const questions = orderTailoringQuestions(view.session.analysis?.questions ?? []);
  if (questions.length === 0) return null;
  const answered = questions.filter((question) => view.session.answers[question.id]).length;
  return (
    <div>
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="w-full flex items-center justify-between py-1">
        <span style={{ fontSize: "13px", fontWeight: 600 }}>
          {t("Your answers")} <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>· {answered}/{questions.length} {t("answered")}</span>
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-2">
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("Change an answer and the suggestions that use it update automatically.")}</p>
          {questions.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              view={view}
              content={content}
              updatingBlockIds={updatingBlockIds}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warnings and notices
// ---------------------------------------------------------------------------

const TONES = {
  error: { background: "var(--color-red-50)", color: "var(--color-red-700)" },
  warning: { background: "var(--color-amber-50)", color: "var(--color-amber-700)" },
  info: { background: "var(--color-teal-50)", color: "var(--color-teal-800)" }
};

function PanelMessage({
  tone,
  text,
  action,
  secondary,
  onDismiss
}: {
  tone: keyof typeof TONES;
  text: string;
  action?: { label: string; run: () => void } | null;
  secondary?: { label: string; run: () => void } | null;
  onDismiss?: (() => void) | null;
}) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? AlertTriangle : CheckCircle2;
  return (
    <div role={tone === "info" ? "status" : "alert"} className="tailor-message rounded-lg p-2.5 flex items-start gap-2" style={{ ...TONES[tone], fontSize: "12px", lineHeight: 1.45 }}>
      <Icon size={14} className="shrink-0" style={{ marginTop: 1 }} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>{text}</p>
        {action || secondary ? (
          <div className="flex items-center gap-3">
            {action ? (
              <button type="button" onClick={action.run} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
                <RefreshCw size={12} /> {action.label}
              </button>
            ) : null}
            {secondary ? (
              <button type="button" onClick={secondary.run} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                {secondary.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label={t("Dismiss")} className="shrink-0 p-0.5 rounded">
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function IssueMessage({
  issue,
  onDismiss,
  onOpenEditor
}: {
  issue: TailoringIssue;
  onDismiss: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <PanelMessage
      tone={issue.tone}
      text={t(issue.text, issue.values)}
      action={
        issue.action
          ? {
              label: t(issue.action.label),
              run: () => {
                onDismiss();
                issue.action!.run();
              }
            }
          : null
      }
      secondary={issue.editorHint ? { label: t("Back to editor"), run: onOpenEditor } : null}
      onDismiss={onDismiss}
    />
  );
}

const noticeDuration = (notice: TailoringNotice): number =>
  notice.tone === "warning" || notice.text.length > 60 ? 7000 : 3500;

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function TailorPanel({
  api,
  controller,
  content,
  cvKind,
  prefillJob,
  currentJob,
  onHighlight,
  onExport,
  onCoverLetter,
  onClose
}: {
  api: BackendApi;
  controller: TailoringSessionController;
  content: CvContent;
  cvKind: "master" | "tailored";
  prefillJob?: Partial<TailoringJobInput> | null;
  currentJob?: { role: string; company: string } | null;
  onHighlight: (ids: string[] | null, tone?: "highlight" | "evidence") => void;
  onExport: () => void;
  onCoverLetter: (() => void) | null;
  onClose: () => void;
}) {
  const { view, busy, issue, notice } = controller;
  const [retargeting, setRetargeting] = useState(false);
  const [showCost, setShowCost] = useState(false);
  // "flow": the guided steps (questions, suggestions, ready); "refine": Refine with AI.
  const [tab, setTab] = useState<"flow" | "refine">("flow");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(controller.clearNotice, noticeDuration(notice));
    return () => window.clearTimeout(timer);
  }, [controller.clearNotice, notice]);

  const status = view?.session.status;
  const refineAvailable =
    Boolean(view?.session.analysis) && !retargeting && (status === "answering" || status === "generating" || status === "reviewing" || status === "ready");
  const showRefine = refineAvailable && tab === "refine";

  // A new session (re-tailoring) starts with the guided steps.
  const sessionKey = view?.session.id;
  useEffect(() => setTab("flow"), [sessionKey]);

  // The preview's "Refine with AI" (or any openRefine) switches to the refine area.
  const { refineTargetBlockId } = controller;
  useEffect(() => {
    if (refineTargetBlockId && refineAvailable) setTab("refine");
  }, [refineAvailable, refineTargetBlockId]);

  // Start at the top when the view changes (tab switch, or the finished summary appears);
  // status changes inside the refine area keep its scroll position.
  const bodyRef = useRef<HTMLDivElement>(null);
  const summaryShown = !showRefine && status === "ready";
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [showRefine, summaryShown]);

  const switchTab = (next: "flow" | "refine") => {
    setTab(next);
    if (next === "flow") controller.closeRefine();
  };

  const runningTaskIds = new Set(controller.runningTasks.map((task) => task.id));
  const improvedIds = useMemo(
    () => new Set(view?.suggestions.filter((item) => item.status === "applied").flatMap((item) => item.requirement_ids) ?? []),
    [view?.suggestions]
  );
  const staleIds = useMemo(
    () => new Set(view?.suggestions.filter((item) => isTailoringSuggestionStale(content, item)).map((item) => item.id) ?? []),
    [content, view?.suggestions]
  );

  const pending = view?.suggestions.filter((item) => item.status === "pending") ?? [];
  const decided = view?.suggestions.filter((item) => item.status !== "pending") ?? [];
  const questions = orderTailoringQuestions(view?.session.analysis?.questions ?? []);
  const unansweredCount = questions.filter((question) => !view?.session.answers[question.id]).length;
  const waitingTasks = view?.tasks.filter((task) => task.status === "waiting") ?? [];
  const failedTasks = controller.failedTasks.filter((item) => !runningTaskIds.has(item.task.id));
  const settledTasks = view?.tasks.filter((task) => ["done", "skipped", "failed"].includes(task.status)).length ?? 0;
  const showQuestions = status === "answering";
  const showReview = status === "generating" || status === "reviewing";
  // Auto-apply matters from the moment suggestions can arrive (they start during the questions).
  const showAutoApply = Boolean(view) && !retargeting && (showQuestions || showReview || showRefine);
  const answerPending = (taskId: string | null) => Boolean(taskId && controller.answerRerunTaskIds.has(taskId));
  // Blocks whose rewrite is being updated with an answer (shown on the open number question).
  const answerUpdatingBlockIds = new Set(
    (view?.tasks ?? []).filter((task) => task.block_id && answerPending(task.id)).map((task) => task.block_id!)
  );
  // Rerun tasks whose card is on screen show their state on the card instead.
  const pendingTaskIds = new Set(pending.map((item) => item.task_id));
  const runningCards = controller.runningTasks.filter((task) => !(answerPending(task.id) && pendingTaskIds.has(task.id)));
  const renderRunning = (task: (typeof controller.runningTasks)[number]) => (
    <div key={task.id} className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--color-border-tertiary)" }}>
      <AiWorkingBadge label={describeTask(content, task)} compact />
      {answerPending(task.id) ? (
        <p style={{ fontSize: "11px", color: "var(--color-teal-800)" }}>{t("Updating with your answer…")}</p>
      ) : null}
      <ShimmerBlock height={44} />
    </div>
  );

  const headerTitle = view ? view.session.job.job_title : t("Tailor for a job");
  const headerSubtitle = view?.session.job.company_name || (view ? null : currentJob?.company ?? null);

  const renderSuggestion = (suggestion: TailoringSuggestion) => {
    const task = view?.tasks.find((item) => item.id === suggestion.task_id) ?? null;
    return (
      <SuggestionCard
        key={suggestion.id}
        suggestion={suggestion}
        content={content}
        requirements={view?.session.analysis?.requirements ?? []}
        stale={staleIds.has(suggestion.id)}
        undoBlocked={isTailoringUndoBlocked(content, suggestion)}
        refining={Boolean(task && (runningTaskIds.has(task.id) || answerPending(task.id)))}
        answerStatus={
          task && answerPending(task.id) && suggestion.status === "pending"
            ? "updating"
            : controller.answerUpdatedSuggestionIds.has(suggestion.id)
              ? "updated"
              : null
        }
        onAccept={(edited) => void controller.decide(suggestion, "accept", edited)}
        onReject={() => void controller.decide(suggestion, "reject")}
        onUndo={() => void controller.decide(suggestion, "undo")}
        onRefine={(refinement) => task && void controller.refine(task, refinement)}
        onRegenerate={task ? () => void controller.regenerate(task) : null}
        onOpenEditor={onClose}
        onHover={(active) => onHighlight(active ? tailoringSuggestionTargets(suggestion) : null, "highlight")}
      />
    );
  };

  const body = (() => {
    if (controller.loading) {
      return <AiStatusLine label={t("Loading your tailoring session…")} />;
    }

    if (!view && controller.loadError && cvKind === "tailored") {
      // Don't offer a new job form here: submitting it would replace the session we couldn't load.
      return (
        <div className="space-y-3">
          <p className="flex items-start gap-2" style={{ fontSize: "13px", color: "var(--color-red-700)" }}>
            <AlertCircle size={15} className="shrink-0 mt-0.5" /> {t(controller.loadError)}
          </p>
          <button type="button" onClick={controller.reload} className="px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2" style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}>
            <RefreshCw size={14} /> {t("Try again")}
          </button>
        </div>
      );
    }

    if (!view || retargeting) {
      const initial = retargeting
        ? { job_title: "", company_name: "", job_description: "" }
        : prefillJob ?? (currentJob ? { job_title: currentJob.role, company_name: currentJob.company } : {});
      return (
        <JobForm
          key={retargeting ? "retarget" : "new"}
          initial={initial}
          busy={busy === "creating"}
          heading={cvKind === "tailored" ? t("Tailor this CV for a job") : t("Tailor your CV for a job")}
          onSubmit={async (job) => {
            if (await controller.start(job)) setRetargeting(false);
          }}
        />
      );
    }

    if (status === "draft" || status === "analyzing") {
      if (view.session.error_message && busy !== "analyzing") {
        return (
          <div className="space-y-3">
            <p className="flex items-start gap-2" style={{ fontSize: "13px", color: "var(--color-red-700)" }}>
              <AlertCircle size={15} className="shrink-0 mt-0.5" /> {t(view.session.error_message)}
            </p>
            <button type="button" onClick={() => void controller.analyze()} className="px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2" style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}>
              <RefreshCw size={14} /> {t("Try again")}
            </button>
          </div>
        );
      }
      // Not started (e.g. the latest edits couldn't be saved): the warning above has the retry.
      if (status === "draft" && busy !== "analyzing" && issue) return null;
      return <AnalysisProgress />;
    }

    if (showRefine) {
      return (
        <div className="space-y-4">
          <RefineArea
            view={view}
            content={content}
            controller={controller}
            runningTaskIds={runningTaskIds}
            renderSuggestion={renderSuggestion}
            onHighlight={onHighlight}
          />
          <AnswersDisclosure view={view} content={content} updatingBlockIds={answerUpdatingBlockIds} onAnswer={controller.answer} />
        </div>
      );
    }

    if (status === "ready") {
      return (
        <div className="space-y-4">
          <div className="rounded-xl p-4 text-center space-y-1" style={{ background: "var(--color-teal-50)" }}>
            <CheckCircle2 size={28} style={{ color: "var(--color-teal-600)", margin: "0 auto" }} />
            <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-teal-900)" }}>{t("Ready to apply")}</p>
            <p style={{ fontSize: "13px", color: "var(--color-teal-800)" }}>
              {t("Your CV is tailored for")} {view.session.job.job_title}
              {view.session.job.company_name ? ` · ${view.session.job.company_name}` : ""}.
            </p>
          </div>
          <ScoreMeter view={view} />
          <div className="grid gap-2">
            <button type="button" onClick={onExport} className="px-4 py-2.5 rounded-lg font-medium inline-flex items-center justify-center gap-2" style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}>
              <Download size={14} /> {t("Export CV")}
            </button>
            {onCoverLetter ? (
              <button type="button" onClick={onCoverLetter} className="px-4 py-2.5 rounded-lg border font-medium inline-flex items-center justify-center gap-2" style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)" }}>
                <FileText size={14} /> {t("Write a cover letter")}
              </button>
            ) : null}
          </div>
          {runningCards.length > 0 || pending.length > 0 ? (
            <div className="space-y-2.5">
              <h3 style={{ fontSize: "13px", fontWeight: 600 }}>
                {t("Updates")} {pending.length ? <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>· {pending.length} {t("to review")}</span> : null}
              </h3>
              {runningCards.map(renderRunning)}
              {pending.map(renderSuggestion)}
            </div>
          ) : null}
          <AnswersDisclosure view={view} content={content} updatingBlockIds={answerUpdatingBlockIds} onAnswer={controller.answer} />
          <div className="flex items-center justify-between" style={{ fontSize: "12px" }}>
            <button type="button" onClick={() => switchTab("refine")} className="inline-flex items-center gap-1" style={{ color: "var(--color-teal-700)", fontWeight: 500 }}>
              <Sparkles size={12} /> {t("Keep refining")}
            </button>
            <button type="button" onClick={() => setRetargeting(true)} style={{ color: "var(--color-text-secondary)" }}>
              {t("Tailor for another job")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <ScoreMeter view={view} />
        <RequirementChecklist
          view={view}
          content={content}
          improvedIds={improvedIds}
          defaultExpanded={showQuestions}
          onFocusEvidence={(ids) => onHighlight(ids, "evidence")}
          onDecision={(requirement, restore) =>
            void controller.setRequirementDecision(requirement.id, restore ? "relevant" : "not_relevant")
          }
        />

        {!showQuestions ? (
          <AnswersDisclosure view={view} content={content} updatingBlockIds={answerUpdatingBlockIds} onAnswer={controller.answer} />
        ) : null}

        {showQuestions ? (
          <div className="space-y-2.5">
            <div>
              <h3 style={{ fontSize: "13px", fontWeight: 600 }}>{t("A few quick questions")}</h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                {t("Your answers make the suggestions specific and truthful. Skip anything you don't want to answer.")}
              </p>
            </div>
            {questions.map((question) => (
              <QuestionItem
                key={question.id}
                question={question}
                view={view}
                content={content}
                updatingBlockIds={answerUpdatingBlockIds}
                onAnswer={controller.answer}
              />
            ))}
            {controller.runningTasks.length > 0 || settledTasks > 0 ? (
              <p className="flex items-center gap-1.5" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                <Loader2 size={11} className={controller.runningTasks.length ? "animate-spin" : ""} />
                {t("Preparing suggestions in the background")} ({settledTasks}/{view.tasks.length})
              </p>
            ) : null}
          </div>
        ) : null}

        {showReview || pending.length > 0 ? (
          <div className="space-y-2.5">
            <h3 style={{ fontSize: "13px", fontWeight: 600 }}>
              {t("Suggestions")} {pending.length ? <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>· {pending.length} {t("to review")}</span> : null}
            </h3>
            {runningCards.map(renderRunning)}
            {pending.map(renderSuggestion)}
            {failedTasks.map(({ task, message, attempts }) => (
              <div key={task.id} role="alert" className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--color-red-200)", fontSize: "12px" }}>
                <p className="flex items-start gap-1.5" style={{ color: "var(--color-red-700)", lineHeight: 1.45 }}>
                  <AlertCircle size={13} className="shrink-0" style={{ marginTop: 2 }} />
                  <span>
                    <span style={{ fontWeight: 600 }}>{describeTask(content, task)}</span>: {t(message)}
                  </span>
                </p>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => void controller.retry(task)} className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--color-teal-700)" }}>
                    <RefreshCw size={12} /> {t("Retry")}
                  </button>
                  {attempts >= TASK_SKIP_AFTER_FAILURES ? (
                    <button type="button" onClick={() => controller.skipTask(task)} className="inline-flex items-center gap-1" style={{ color: "var(--color-text-secondary)" }} title={t("Finish without this suggestion")}>
                      <X size={12} /> {t("Skip this one")}
                    </button>
                  ) : null}
                </div>
                {attempts >= TASK_SKIP_AFTER_FAILURES ? (
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{t("Still not working? Skip it and finish without this suggestion.")}</p>
                ) : null}
              </div>
            ))}
            {waitingTasks.length > 0 && !showQuestions ? (
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("Waiting for your answers…")}</p>
            ) : null}
            {decided.length > 0 ? (
              <details className="pt-1">
                <summary style={{ fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  {t("Reviewed")} ({decided.length})
                </summary>
                <div className="space-y-2 mt-2">{decided.map(renderSuggestion)}</div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  })();

  const finishButton = (
    <button
      type="button"
      onClick={async () => {
        if (await controller.finish()) switchTab("flow");
      }}
      disabled={busy === "finishing" || controller.runningTasks.length > 0}
      className="flex-1 px-4 py-2.5 rounded-lg font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
      style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}
    >
      {busy === "finishing" ? <Loader2 size={14} className="animate-spin" /> : null}
      {controller.runningTasks.length > 0 ? t("Preparing suggestions…") : t("Finish")}
    </button>
  );

  const footer = (() => {
    if (!view || retargeting || controller.loading) return null;
    if (showRefine) {
      if (status === "generating" || status === "reviewing") return <div className="flex gap-2">{finishButton}</div>;
      return (
        <button
          type="button"
          onClick={() => switchTab("flow")}
          className="w-full px-4 py-2.5 rounded-lg border font-medium inline-flex items-center justify-center gap-2"
          style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)" }}
        >
          {status === "ready" ? t("Done refining") : t("Back to the questions")}
        </button>
      );
    }
    if (status === "answering") {
      return (
        <button
          type="button"
          onClick={() => void controller.continueAfterQuestions()}
          disabled={busy === "continuing"}
          className="w-full px-4 py-2.5 rounded-lg font-medium inline-flex items-center justify-center gap-2"
          style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "white" }}
        >
          {busy === "continuing" ? <Loader2 size={14} className="animate-spin" /> : null}
          {unansweredCount === 0 ? t("Continue") : t("Skip remaining & continue")}
        </button>
      );
    }
    if (showReview) {
      const acceptable = pending.filter((item) => !staleIds.has(item.id));
      return (
        <div className="flex gap-2">
          {acceptable.length > 1 ? (
            <button
              type="button"
              onClick={() => void controller.acceptAll(acceptable)}
              className="px-3 py-2.5 rounded-lg border font-medium inline-flex items-center gap-1.5"
              style={{ fontSize: "13px", borderColor: "var(--color-border-secondary)" }}
            >
              <Check size={14} /> {t("Accept all")}
            </button>
          ) : null}
          {finishButton}
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-background-primary)" }}>
      <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5" style={{ fontSize: "11px", color: "var(--color-teal-700)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <Target size={12} /> {t("Tailoring")}
            </p>
            <p className="truncate" style={{ fontSize: "15px", fontWeight: 600 }}>{headerTitle}</p>
            {headerSubtitle ? <p className="truncate" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{headerSubtitle}</p> : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {view?.viewer.is_admin ? (
              <button type="button" onClick={() => setShowCost(true)} title={t("Session AI cost (admin)")} aria-label={t("Session AI cost (admin)")} className="p-1.5 rounded-lg" style={{ color: "var(--color-text-secondary)" }}>
                <Coins size={15} />
              </button>
            ) : null}
            {retargeting ? (
              <button type="button" onClick={() => setRetargeting(false)} title={t("Cancel")} aria-label={t("Cancel")} className="p-1.5 rounded-lg" style={{ color: "var(--color-text-secondary)" }}>
                <X size={15} />
              </button>
            ) : null}
            <button type="button" onClick={onClose} title={t("Back to editor")} aria-label={t("Back to editor")} className="p-1.5 rounded-lg" style={{ color: "var(--color-text-secondary)" }}>
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
        {showAutoApply && view ? (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2" style={{ background: "var(--color-background-secondary)" }}>
            <label htmlFor="tailor-auto-apply" className="min-w-0 cursor-pointer">
              <span className="flex items-center gap-1.5" style={{ fontSize: "12px", fontWeight: 600 }}>
                <Zap size={12} style={{ color: "var(--color-teal-600)" }} /> {t("Auto-apply")}
              </span>
              <span className="block" style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.35 }}>
                {t("Apply new suggestions as they arrive. You can undo any of them.")}
              </span>
            </label>
            <Switch id="tailor-auto-apply" checked={controller.autoApply} onCheckedChange={(checked) => void controller.setAutoApply(checked)} />
          </div>
        ) : null}
        {refineAvailable ? (
          <div className="tailor-tabs mt-2.5" role="tablist" aria-label={t("Tailoring views")}>
            <button
              type="button"
              role="tab"
              id="tailor-tab-flow"
              aria-selected={!showRefine}
              aria-controls="tailor-panel-body"
              className="tailor-tab"
              onClick={() => switchTab("flow")}
            >
              <ListChecks size={13} /> {status === "answering" ? t("Questions") : status === "ready" ? t("Summary") : t("Suggestions")}
              {pending.length > 0 && status !== "answering" ? <span className="tailor-tab-count">{pending.length}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              id="tailor-tab-refine"
              aria-selected={showRefine}
              aria-controls="tailor-panel-body"
              className="tailor-tab"
              onClick={() => switchTab("refine")}
            >
              <Sparkles size={13} /> {t("Refine with AI")}
            </button>
          </div>
        ) : null}
      </div>

      {issue || notice || controller.savePaused ? (
        <div className="px-5 pt-3 space-y-2 shrink-0">
          {controller.savePaused ? (
            <PanelMessage
              tone="warning"
              text={t("Your latest edits couldn't be saved, so new suggestions are paused.")}
              action={{ label: t("Try again"), run: controller.resumeAfterSave }}
            />
          ) : null}
          {issue ? <IssueMessage issue={issue} onDismiss={controller.dismissIssue} onOpenEditor={onClose} /> : null}
          {notice ? (
            <PanelMessage tone={notice.tone} text={t(notice.text, notice.values)} onDismiss={controller.clearNotice} />
          ) : null}
        </div>
      ) : null}

      <div
        ref={bodyRef}
        id="tailor-panel-body"
        role={refineAvailable ? "tabpanel" : undefined}
        aria-labelledby={refineAvailable ? (showRefine ? "tailor-tab-refine" : "tailor-tab-flow") : undefined}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
      >
        {body}
      </div>

      {footer ? <div className="px-5 py-3 border-t" style={{ borderColor: "var(--color-border-tertiary)" }}>{footer}</div> : null}

      {view?.viewer.is_admin ? (
        <TailoringCostDialog api={api} sessionId={view.session.id} open={showCost} onOpenChange={setShowCost} />
      ) : null}
    </div>
  );
}
