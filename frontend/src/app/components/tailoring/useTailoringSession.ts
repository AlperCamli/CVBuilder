import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { BackendApi } from "../../integration/backend-api";
import { ApiClientError } from "../../integration/api-error";
import type { CvContent, CvJsonValue } from "../../integration/api-types";
import {
  applyTailoringSuggestion,
  isTailoringSuggestionStale,
  planTailoringAutoApply,
  revertTailoringSuggestion
} from "../../integration/tailoring-apply";
import type {
  RequirementDecision,
  TailoringAnswerChoice,
  TailoringRefinement,
  TailoringSessionView,
  TailoringSuggestion,
  TailoringSuggestionDecisionResponse,
  TailoringSuggestionStatus,
  TailoringTask,
  TailoringTaskRunResponse
} from "../../integration/tailoring-types";

// Bridge to the editor, read through a ref so async work always sees the latest state.
export interface TailoringEditorBridge {
  getContent: () => CvContent;
  applyContent: (next: CvContent) => void;
  // Resolves false when the editor could not save its pending edits.
  flushEdits: () => Promise<boolean>;
}

export interface TailoringJobInput {
  job_title: string;
  company_name: string;
  job_description: string;
}

// English text, translated (with values) where it is shown.
export interface TailoringMessage {
  text: string;
  values?: Record<string, string | number>;
}

// A problem the user can act on; shown as a warning in the panel until dismissed or fixed.
export interface TailoringIssue extends TailoringMessage {
  tone: "error" | "warning";
  action?: { label: string; run: () => void };
  // Offer a way back to the editor (block history lives there).
  editorHint?: boolean;
}

// Short-lived confirmation or heads-up.
export interface TailoringNotice extends TailoringMessage {
  tone: "info" | "warning";
}

export interface TailoringFailedTask {
  task: TailoringTask;
  message: string;
  // Failed runs in a row in this tab.
  attempts: number;
}

const MAX_PARALLEL_TASKS = 5;
const STALE_RUNNING_TASK_MS = 3 * 60_000 + 5_000;
const STALE_ANALYSIS_MS = 3 * 60_000 + 5_000;
const ANALYSIS_POLL_MS = 5_000;
// After this many failed runs in a row, a task can be skipped so the user can still finish.
export const TASK_SKIP_AFTER_FAILURES = 2;

const TASK_FAILED = "This suggestion couldn't be prepared.";
const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

// Server validation/conflict messages are written for users (and already localized);
// server errors and network failures get our own wording.
const describeError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiClientError) {
    return error.status > 0 && error.status < 500 && error.code !== "UNKNOWN_ERROR" && error.message ? error.message : fallback;
  }
  return error instanceof TypeError ? OFFLINE : fallback;
};

const DECISION_STATUS: Record<"accept" | "reject" | "undo", TailoringSuggestionStatus> = {
  accept: "applied",
  reject: "rejected",
  undo: "pending"
};

const DECISION_FAILED: Record<"accept" | "reject" | "undo", string> = {
  accept: "Couldn't apply the suggestion. Your CV wasn't changed.",
  reject: "Couldn't dismiss the suggestion.",
  undo: "Couldn't undo the suggestion. Your CV wasn't changed."
};

const saveFailedIssue = (text: string, retry: () => void): TailoringIssue => ({
  tone: "warning",
  text,
  action: { label: "Try again", run: retry }
});

// Responses from parallel task runs can arrive out of order, so views are merged per entity:
// the newer task wins, and suggestions missing from an older snapshot are kept.
const mergeViews = (previous: TailoringSessionView | null, next: TailoringSessionView): TailoringSessionView => {
  if (!previous || previous.session.id !== next.session.id) {
    return next;
  }
  const previousTasks = new Map(previous.tasks.map((task) => [task.id, task]));
  const nextTasks = new Map(next.tasks.map((task) => [task.id, task]));
  // True when our copy of the task is newer than the snapshot we just received.
  const isAhead = (taskId: string | null): boolean => {
    const ours = taskId ? previousTasks.get(taskId) : undefined;
    const theirs = taskId ? nextTasks.get(taskId) : undefined;
    return Boolean(ours && theirs && ours.updated_at > theirs.updated_at);
  };

  const tasks = next.tasks.map((task) => (isAhead(task.id) ? previousTasks.get(task.id)! : task));
  const nextSuggestionIds = new Set(next.suggestions.map((suggestion) => suggestion.id));
  const kept = previous.suggestions.filter(
    (suggestion) => !nextSuggestionIds.has(suggestion.id) && isAhead(suggestion.task_id)
  );
  return { ...next, tasks, suggestions: [...next.suggestions, ...kept] };
};

const applyTaskResult = (view: TailoringSessionView, result: TailoringTaskRunResponse): TailoringSessionView => {
  const resultIds = new Set(result.suggestions.map((suggestion) => suggestion.id));
  return {
    ...view,
    session: { ...view.session, status: result.session_status },
    tasks: view.tasks.map((task) => (task.id === result.task.id ? result.task : task)),
    // A re-run replaces the task's pending cards (the server expired them).
    suggestions: [
      ...view.suggestions.filter(
        (suggestion) =>
          !resultIds.has(suggestion.id) && !(suggestion.task_id === result.task.id && suggestion.status === "pending")
      ),
      ...result.suggestions
    ],
    score: result.score
  };
};

// The local content change of a suggestion, undone again after its decision failed.
// Works on the current content so changes made meanwhile (other cards) are kept.
const rollbackLocalChange = (
  content: CvContent,
  suggestion: TailoringSuggestion,
  decision: "accept" | "undo",
  editedValue: CvJsonValue | undefined
): CvContent | null => {
  if (decision === "accept") {
    const applied: TailoringSuggestion = {
      ...suggestion,
      status: "applied",
      suggested: editedValue !== undefined ? { ...suggestion.suggested, value: editedValue } : suggestion.suggested
    };
    return revertTailoringSuggestion(content, applied);
  }
  return applyTailoringSuggestion(content, suggestion);
};

export function useTailoringSession(options: {
  api: BackendApi;
  open: boolean;
  cvKind: "master" | "tailored";
  cvId: string | null;
  bridge: MutableRefObject<TailoringEditorBridge>;
  onTailoredCvCreated: (tailoredCvId: string) => Promise<void> | void;
  onMasterCvUpdated?: () => void;
}) {
  const { api, open, cvKind, cvId, bridge, onTailoredCvCreated, onMasterCvUpdated } = options;
  const [view, setView] = useState<TailoringSessionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "creating" | "analyzing" | "continuing" | "finishing">(null);
  const [issue, setIssue] = useState<TailoringIssue | null>(null);
  const [notice, setNotice] = useState<TailoringNotice | null>(null);
  const [inflightTaskIds, setInflightTaskIds] = useState<string[]>([]);
  // Task runs that failed in this tab (HTTP error or a "failed" result), shown with Retry.
  const [taskFailures, setTaskFailures] = useState<Record<string, { message: string; attempts: number }>>({});
  const [skippedTaskIds, setSkippedTaskIds] = useState<string[]>([]);
  // The runner waits while the editor can't save (it must not generate from stale content).
  const [savePaused, setSavePaused] = useState(false);
  // The toggle wins for the rest of the session even if saving the preference failed.
  const [autoApplyOverride, setAutoApplyOverride] = useState<{ sessionId: string; value: boolean } | null>(null);
  const inflight = useRef(new Set<string>());
  const failureCounts = useRef(new Map<string, number>());
  const failedRef = useRef(taskFailures);
  failedRef.current = taskFailures;
  const skippedRef = useRef(skippedTaskIds);
  skippedRef.current = skippedTaskIds;
  const runnerFlushing = useRef(false);
  const analyzing = useRef(false);
  const analyzingSince = useRef<{ sessionId: string; at: number; warned: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const loadedForCv = useRef<string | null>(null);

  const autoApply = view
    ? autoApplyOverride?.sessionId === view.session.id
      ? autoApplyOverride.value
      : view.preferences.auto_apply
    : false;
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;

  // Latest callbacks, for retry actions created inside earlier callbacks.
  const latest = useRef<{
    analyze: () => Promise<void>;
    start: (job: TailoringJobInput) => Promise<boolean>;
    finish: () => Promise<boolean>;
    decide: (suggestion: TailoringSuggestion, decision: "accept" | "reject" | "undo", editedValue?: string | string[]) => Promise<boolean>;
    runTask: (task: TailoringTask, payload?: { regenerate?: boolean; refinement?: TailoringRefinement | null }) => Promise<void>;
    answer: (questionId: string, payload: { answer: TailoringAnswerChoice | null; detail?: string | null; add_to_main?: boolean }) => Promise<void>;
    continueAfterQuestions: () => Promise<void>;
    setRequirementDecision: (requirementId: string, decision: RequirementDecision) => Promise<void>;
    savePreference: (enabled: boolean) => Promise<void>;
  } | null>(null);

  // Responses only update the session they belong to: a late response for a session that
  // was replaced (re-tailoring) or closed (failed navigation) is ignored.
  const updateView = useCallback((next: TailoringSessionView | ((current: TailoringSessionView) => TailoringSessionView)) => {
    setView((current) => {
      if (!current) return current;
      if (typeof next === "function") return next(current);
      return current.session.id === next.session.id ? mergeViews(current, next) : current;
    });
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    try {
      return await bridge.current.flushEdits();
    } catch {
      return false;
    }
  }, [bridge]);

  const refetch = useCallback(
    async (sessionId: string): Promise<TailoringSessionView | null> => {
      try {
        return await api.getTailoringSession(sessionId);
      } catch {
        return null;
      }
    },
    [api]
  );

  const clearTaskFailure = useCallback((taskId: string) => {
    if (!failedRef.current[taskId]) return;
    const { [taskId]: _removed, ...rest } = failedRef.current;
    failedRef.current = rest;
    setTaskFailures(rest);
  }, []);

  const recordTaskFailure = useCallback((taskId: string, message: string) => {
    const attempts = (failureCounts.current.get(taskId) ?? 0) + 1;
    failureCounts.current.set(taskId, attempts);
    const next = { ...failedRef.current, [taskId]: { message, attempts } };
    failedRef.current = next;
    setTaskFailures(next);
  }, []);

  // Per-session state starts over when another session is shown.
  useEffect(() => {
    failureCounts.current.clear();
    failedRef.current = {};
    setTaskFailures({});
    setSkippedTaskIds([]);
    analyzingSince.current = null;
  }, [view?.session.id]);

  // Load the active session of a tailored CV when tailoring mode opens on it.
  const load = useCallback(
    (targetCvId: string) => {
      loadedForCv.current = targetCvId;
      setLoading(true);
      setLoadError(null);
      // A newer load (another CV) wins; closing the panel does not cancel this one.
      const current = () => loadedForCv.current === targetCvId;
      void api
        .getActiveTailoringSession(targetCvId)
        .then(({ session }) => {
          if (current()) setView(session);
        })
        .catch((loadFailure) => {
          if (current()) setLoadError(describeError(loadFailure, "Couldn't load your tailoring session."));
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    },
    [api]
  );

  useEffect(() => {
    if (!open || !cvId) return;
    if (cvKind === "master") {
      if (loadedForCv.current !== cvId) {
        loadedForCv.current = cvId;
        setView(null);
        setLoading(false);
        setLoadError(null);
      }
      return;
    }
    if (loadedForCv.current === cvId || viewRef.current?.session.tailored_cv_id === cvId) {
      loadedForCv.current = cvId;
      return;
    }
    load(cvId);
  }, [cvId, cvKind, load, open]);

  const reload = useCallback(() => {
    if (cvId && cvKind === "tailored") load(cvId);
  }, [cvId, cvKind, load]);

  const analyze = useCallback(async () => {
    const current = viewRef.current;
    if (!current || analyzing.current) return;
    analyzing.current = true;
    analyzingSince.current = null;
    setBusy("analyzing");
    setIssue(null);
    try {
      if (!(await flush())) {
        setIssue(
          saveFailedIssue("Your latest edits couldn't be saved, so the analysis hasn't started.", () => void latest.current?.analyze())
        );
        return;
      }
      updateView(await api.analyzeTailoringSession(current.session.id));
    } catch (analyzeError) {
      const refreshed = await refetch(current.session.id);
      if (refreshed) updateView(refreshed);
      // A failed analysis is recorded on the session and shown with "Try again"; a session
      // still analyzing is polled. Anything else (e.g. no connection) is warned about here.
      if (!refreshed || (refreshed.session.status === "draft" && !refreshed.session.error_message)) {
        setIssue({
          tone: "error",
          text: describeError(analyzeError, "The job analysis couldn't be completed."),
          action: { label: "Try again", run: () => void latest.current?.analyze() }
        });
      }
    } finally {
      analyzing.current = false;
      setBusy(null);
    }
  }, [api, flush, refetch, updateView]);

  // A new (draft) session is analyzed right away; a failed one waits for "Try again".
  useEffect(() => {
    if (open && view?.session.status === "draft" && !view.session.error_message && !analyzing.current && !issue) {
      void analyze();
    }
  }, [analyze, issue, open, view?.session.error_message, view?.session.id, view?.session.status]);

  // An analysis running elsewhere (another tab, or a request that lost its response) is
  // polled; when it takes longer than the server's timeout, offer to start it again.
  const analysisStatus = view?.session.status;
  const sessionId = view?.session.id;
  useEffect(() => {
    if (!open || !sessionId || analysisStatus !== "analyzing" || busy === "analyzing") return;
    if (analyzingSince.current?.sessionId !== sessionId) {
      analyzingSince.current = { sessionId, at: Date.now(), warned: false };
    }
    const timer = window.setInterval(() => {
      void refetch(sessionId).then((refreshed) => {
        if (refreshed) updateView(refreshed);
        const since = analyzingSince.current;
        if (since && !since.warned && refreshed?.session.status === "analyzing" && Date.now() - since.at > STALE_ANALYSIS_MS) {
          since.warned = true;
          setIssue({
            tone: "warning",
            text: "The analysis is taking longer than expected.",
            action: { label: "Try again", run: () => void latest.current?.analyze() }
          });
        }
      });
    }, ANALYSIS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [analysisStatus, busy, open, refetch, sessionId, updateView]);

  const openTailoredCv = useCallback(
    async (tailoredCvId: string, created: TailoringSessionView | null): Promise<boolean> => {
      if (created) {
        loadedForCv.current = tailoredCvId;
        setView(created);
      }
      try {
        await onTailoredCvCreated(tailoredCvId);
        return true;
      } catch {
        // Stay on the current CV without a session, so nothing is applied to the wrong CV.
        loadedForCv.current = cvId;
        setView(null);
        setIssue({
          tone: "error",
          text: "Your tailored CV was created but couldn't be opened.",
          action: { label: "Open it", run: () => void openTailoredCv(tailoredCvId, null) }
        });
        return false;
      }
    },
    [cvId, onTailoredCvCreated]
  );

  const start = useCallback(
    async (job: TailoringJobInput): Promise<boolean> => {
      if (!cvId) return false;
      setBusy("creating");
      setIssue(null);
      const retry = () => void latest.current?.start(job);
      try {
        if (!(await flush())) {
          setIssue(saveFailedIssue("Your latest edits couldn't be saved, so tailoring hasn't started.", retry));
          return false;
        }
        let created: TailoringSessionView;
        try {
          created = await api.createTailoringSession({
            cv_id: cvId,
            job: { job_title: job.job_title, company_name: job.company_name || null, job_description: job.job_description }
          });
        } catch (startError) {
          setIssue({
            tone: "error",
            text: describeError(startError, "Couldn't start tailoring."),
            action: { label: "Try again", run: retry }
          });
          return false;
        }
        if (created.session.tailored_cv_id !== cvId) {
          return await openTailoredCv(created.session.tailored_cv_id, created);
        }
        loadedForCv.current = cvId;
        setView(created);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [api, cvId, flush, openTailoredCv]
  );

  const announceMasterCv = useCallback(
    (response: TailoringSuggestionDecisionResponse) => {
      if (response.master_cv_updated) {
        setNotice({ tone: "info", text: "Also added to your main CV (you can restore the previous version from block history)." });
        onMasterCvUpdated?.();
      } else if (response.master_cv_reverted) {
        setNotice({ tone: "info", text: "Also removed from your main CV." });
        onMasterCvUpdated?.();
      } else if (response.master_cv_revert_skipped) {
        setNotice({
          tone: "warning",
          text: "Your main CV block was edited since, so it was left as is. You can restore it from block history."
        });
      }
    },
    [onMasterCvUpdated]
  );

  const staleIssue = useCallback((suggestion: TailoringSuggestion): TailoringIssue => {
    const task = viewRef.current?.tasks.find((item) => item.id === suggestion.task_id) ?? null;
    return {
      tone: "warning",
      text: task
        ? "This part of your CV changed since the suggestion was made. Regenerate it to continue."
        : "This part of your CV changed since the suggestion was made, so it can't be applied.",
      action: task ? { label: "Regenerate", run: () => void latest.current?.runTask(task, { regenerate: true }) } : undefined
    };
  }, []);

  // "auto": a stale suggestion is skipped quietly (the caller reports it); "manual" warns.
  const decideSuggestion = useCallback(
    async (
      suggestion: TailoringSuggestion,
      decision: "accept" | "reject" | "undo",
      editedValue: string | string[] | undefined,
      mode: "manual" | "auto"
    ): Promise<"ok" | "stale" | "failed"> => {
      const current = viewRef.current;
      if (!current) return "failed";
      if (mode === "manual") setIssue(null);

      // Accept/undo change the editor content locally first; the editor's autosave persists it.
      const before = bridge.current.getContent();
      const value = editedValue as CvJsonValue | undefined;
      let localChange: CvContent | null = null;
      if (decision === "accept") {
        localChange = isTailoringSuggestionStale(before, suggestion) ? null : applyTailoringSuggestion(before, suggestion, value);
        if (!localChange) {
          if (mode === "manual") setIssue(staleIssue(suggestion));
          return "stale";
        }
      } else if (decision === "undo" && suggestion.status === "applied") {
        localChange = revertTailoringSuggestion(before, suggestion);
        if (!localChange) {
          setIssue({
            tone: "warning",
            text: "You edited this part after applying the suggestion, so it can't be undone automatically. You can restore an earlier version from block history in the editor.",
            editorHint: true
          });
          return "failed";
        }
      }
      if (localChange) bridge.current.applyContent(localChange);

      try {
        const response = await api.decideTailoringSuggestion(current.session.id, suggestion.id, {
          decision,
          ...(editedValue !== undefined ? { edited_value: editedValue } : {})
        });
        updateView((latestView) => ({
          ...latestView,
          suggestions: latestView.suggestions.map((item) => (item.id === response.suggestion.id ? response.suggestion : item)),
          score: response.score
        }));
        announceMasterCv(response);
        return "ok";
      } catch (decideError) {
        // The decision may have reached the server even though the response was lost.
        const refreshed = await refetch(current.session.id);
        const onServer = refreshed?.suggestions.find((item) => item.id === suggestion.id) ?? null;
        if (refreshed && onServer?.status === DECISION_STATUS[decision]) {
          updateView(refreshed);
          return "ok";
        }
        if (localChange && decision !== "reject") {
          const now = bridge.current.getContent();
          const rolledBack = rollbackLocalChange(now, suggestion, decision, value) ?? (now === localChange ? before : null);
          if (rolledBack) bridge.current.applyContent(rolledBack);
        }
        if (refreshed) updateView(refreshed);
        const retryWith = onServer ?? suggestion;
        setIssue({
          tone: "error",
          text: describeError(decideError, DECISION_FAILED[decision]),
          action: { label: "Retry", run: () => void latest.current?.decide(retryWith, decision, editedValue) }
        });
        return "failed";
      }
    },
    [announceMasterCv, api, bridge, refetch, staleIssue, updateView]
  );

  const decide = useCallback(
    async (suggestion: TailoringSuggestion, decision: "accept" | "reject" | "undo", editedValue?: string | string[]) =>
      (await decideSuggestion(suggestion, decision, editedValue, "manual")) === "ok",
    [decideSuggestion]
  );

  // Accepts pending suggestions one by one, skipping (and reporting) the ones whose part of
  // the CV was edited after they were generated. Stops at the first failed request.
  const acceptSequentially = useCallback(
    async (candidates: TailoringSuggestion[], source: "auto" | "all") => {
      const { accept, skipped } = planTailoringAutoApply(bridge.current.getContent(), candidates);
      let skippedCount = skipped.length;
      for (const suggestion of accept) {
        if (source === "auto" && !autoApplyRef.current) break;
        const known = viewRef.current?.suggestions.find((item) => item.id === suggestion.id);
        if (known && known.status !== "pending") continue;
        const outcome = await decideSuggestion(suggestion, "accept", undefined, "auto");
        if (outcome === "stale") skippedCount += 1;
        if (outcome === "failed") break;
      }
      if (skippedCount === 0) return;
      const single = skippedCount === 1;
      setNotice({
        tone: "warning",
        text:
          source === "auto"
            ? single
              ? "Auto-apply skipped a suggestion because you edited that part of your CV. Review it below."
              : "Auto-apply skipped {{count}} suggestions because you edited those parts of your CV. Review them below."
            : single
              ? "A suggestion was skipped because you edited that part of your CV. Review it below."
              : "{{count}} suggestions were skipped because you edited those parts of your CV. Review them below.",
        values: { count: skippedCount }
      });
    },
    [bridge, decideSuggestion]
  );

  const runTask = useCallback(
    async (task: TailoringTask, payload: { regenerate?: boolean; refinement?: TailoringRefinement | null } = {}) => {
      const current = viewRef.current;
      if (!current || inflight.current.has(task.id)) return;
      inflight.current.add(task.id);
      setInflightTaskIds([...inflight.current]);
      clearTaskFailure(task.id);
      try {
        const result = await api.runTailoringTask(current.session.id, task.id, payload);
        updateView((latestView) => applyTaskResult(latestView, result));
        if (result.task.status === "failed") {
          recordTaskFailure(task.id, result.task.error_message ?? TASK_FAILED);
        } else {
          failureCounts.current.delete(task.id);
        }
        if (autoApplyRef.current) await acceptSequentially(result.suggestions, "auto");
      } catch (taskError) {
        // Show what the server knows: the run may have finished (response lost), failed, or
        // never started. Only a finished run clears the warning; anything else offers Retry.
        const refreshed = await refetch(current.session.id);
        const onServer = refreshed?.tasks.find((item) => item.id === task.id) ?? null;
        if (refreshed) updateView(refreshed);
        if (refreshed && (onServer?.status === "done" || onServer?.status === "skipped")) {
          failureCounts.current.delete(task.id);
          if (autoApplyRef.current) {
            await acceptSequentially(refreshed.suggestions.filter((item) => item.task_id === task.id), "auto");
          }
        } else {
          recordTaskFailure(
            task.id,
            onServer?.status === "failed" && onServer.error_message ? onServer.error_message : describeError(taskError, TASK_FAILED)
          );
        }
      } finally {
        inflight.current.delete(task.id);
        setInflightTaskIds([...inflight.current]);
      }
    },
    [acceptSequentially, api, clearTaskFailure, recordTaskFailure, refetch, updateView]
  );

  // Runner: start ready tasks (up to MAX_PARALLEL_TASKS at once) whenever the view changes.
  // Tasks that failed in this tab wait for Retry instead of being re-run in a loop.
  useEffect(() => {
    if (!open || !view || savePaused || runnerFlushing.current) return;
    const pickReady = (): TailoringTask[] => {
      // A task left "running" by a closed tab is reclaimable on the server after 3 minutes.
      const staleBefore = new Date(Date.now() - STALE_RUNNING_TASK_MS).toISOString();
      return (viewRef.current?.tasks ?? []).filter(
        (task) =>
          !inflight.current.has(task.id) &&
          !failedRef.current[task.id] &&
          !skippedRef.current.includes(task.id) &&
          (task.status === "ready" || (task.status === "running" && task.updated_at < staleBefore))
      );
    };
    if (pickReady().length === 0 || inflight.current.size >= MAX_PARALLEL_TASKS) return;
    runnerFlushing.current = true;
    void (async () => {
      const saved = await flush();
      runnerFlushing.current = false;
      if (!saved) {
        // Generating now would use the server's older copy of the CV. The panel shows the
        // paused state with "Try again" (resumeAfterSave).
        setSavePaused(true);
        return;
      }
      pickReady()
        .slice(0, Math.max(0, MAX_PARALLEL_TASKS - inflight.current.size))
        .forEach((task) => void runTask(task));
    })();
  }, [flush, open, runTask, savePaused, view, inflightTaskIds, taskFailures, skippedTaskIds]);

  const answer = useCallback(
    async (questionId: string, payload: { answer: TailoringAnswerChoice | null; detail?: string | null; add_to_main?: boolean }) => {
      const current = viewRef.current;
      if (!current) return;
      setIssue(null);
      updateView((latestView) => ({
        ...latestView,
        session: {
          ...latestView.session,
          answers: {
            ...latestView.session.answers,
            [questionId]: {
              answer: payload.answer,
              detail: payload.detail ?? null,
              add_to_main: payload.add_to_main ?? false,
              answered_at: new Date().toISOString()
            }
          }
        }
      }));
      try {
        updateView(await api.answerTailoringQuestion(current.session.id, questionId, payload));
      } catch (answerError) {
        // Drop the optimistic answer so the card shows what was really saved.
        const refreshed = await refetch(current.session.id);
        if (refreshed) updateView(refreshed);
        setIssue({
          tone: "error",
          text: describeError(answerError, "Couldn't save your answer."),
          action: { label: "Retry", run: () => void latest.current?.answer(questionId, payload) }
        });
      }
    },
    [api, refetch, updateView]
  );

  const continueAfterQuestions = useCallback(async () => {
    const current = viewRef.current;
    if (!current) return;
    setBusy("continuing");
    setIssue(null);
    try {
      updateView(await api.completeTailoringQuestions(current.session.id));
    } catch (continueError) {
      setIssue({
        tone: "error",
        text: describeError(continueError, "Couldn't continue to the suggestions."),
        action: { label: "Try again", run: () => void latest.current?.continueAfterQuestions() }
      });
    } finally {
      setBusy(null);
    }
  }, [api, updateView]);

  const setRequirementDecision = useCallback(
    async (requirementId: string, decision: RequirementDecision) => {
      const current = viewRef.current;
      if (!current) return;
      try {
        updateView(await api.setTailoringRequirementDecision(current.session.id, requirementId, decision));
      } catch (decisionError) {
        setIssue({
          tone: "error",
          text: describeError(decisionError, "Couldn't update the requirement."),
          action: { label: "Retry", run: () => void latest.current?.setRequirementDecision(requirementId, decision) }
        });
      }
    },
    [api, updateView]
  );

  const savePreference = useCallback(
    async (enabled: boolean) => {
      try {
        await api.updateTailoringPreferences({ auto_apply: enabled });
        updateView((latestView) => ({ ...latestView, preferences: { ...latestView.preferences, auto_apply: enabled } }));
      } catch {
        setIssue({
          tone: "warning",
          text: enabled
            ? "Couldn't save this setting, so auto-apply is on for this session only."
            : "Couldn't save this setting, so auto-apply is off for this session only.",
          action: { label: "Retry", run: () => void latest.current?.savePreference(enabled) }
        });
      }
    },
    [api, updateView]
  );

  const setAutoApply = useCallback(
    async (enabled: boolean) => {
      const current = viewRef.current;
      if (!current) return;
      setAutoApplyOverride({ sessionId: current.session.id, value: enabled });
      autoApplyRef.current = enabled;
      void savePreference(enabled);
      if (enabled) await acceptSequentially(current.suggestions, "auto");
    },
    [acceptSequentially, savePreference]
  );

  const acceptAll = useCallback(
    async (suggestions: TailoringSuggestion[]) => {
      setIssue(null);
      await acceptSequentially(suggestions, "all");
    },
    [acceptSequentially]
  );

  const finish = useCallback(async (): Promise<boolean> => {
    const current = viewRef.current;
    if (!current) return false;
    setBusy("finishing");
    setIssue(null);
    const retry = () => void latest.current?.finish();
    try {
      if (!(await flush())) {
        setIssue(saveFailedIssue("Your latest edits couldn't be saved, so tailoring isn't finished yet.", retry));
        return false;
      }
      updateView(await api.finishTailoringSession(current.session.id));
      return true;
    } catch (finishError) {
      setIssue({
        tone: "error",
        text: describeError(finishError, "Couldn't finish tailoring."),
        action: { label: "Try again", run: retry }
      });
      return false;
    } finally {
      setBusy(null);
    }
  }, [api, flush, updateView]);

  latest.current = {
    analyze,
    start,
    finish,
    decide,
    runTask,
    answer,
    continueAfterQuestions,
    setRequirementDecision,
    savePreference
  };

  const skipTask = useCallback(
    (task: TailoringTask) => {
      clearTaskFailure(task.id);
      setSkippedTaskIds((ids) => (ids.includes(task.id) ? ids : [...ids, task.id]));
    },
    [clearTaskFailure]
  );

  const resumeAfterSave = useCallback(() => setSavePaused(false), []);
  const dismissIssue = useCallback(() => setIssue(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // Tasks that failed in this tab and server-side failures; skipped ones are hidden.
  const failedTasks = useMemo<TailoringFailedTask[]>(
    () =>
      (view?.tasks ?? [])
        .filter(
          (task) =>
            !inflightTaskIds.includes(task.id) &&
            !skippedTaskIds.includes(task.id) &&
            (Boolean(taskFailures[task.id]) || task.status === "failed")
        )
        .map((task) => ({
          task,
          message: taskFailures[task.id]?.message ?? task.error_message ?? TASK_FAILED,
          attempts: taskFailures[task.id]?.attempts ?? 1
        })),
    [inflightTaskIds, skippedTaskIds, taskFailures, view?.tasks]
  );

  // Running = in flight here, or running on the server (another tab) unless it failed here.
  const runningTasks = useMemo(() => {
    const ids = new Set(inflightTaskIds);
    return (
      view?.tasks.filter(
        (task) =>
          ids.has(task.id) ||
          (task.status === "running" && !taskFailures[task.id] && !skippedTaskIds.includes(task.id))
      ) ?? []
    );
  }, [inflightTaskIds, skippedTaskIds, taskFailures, view?.tasks]);

  return {
    view,
    loading,
    loadError,
    reload,
    busy,
    issue,
    dismissIssue,
    notice,
    clearNotice,
    runningTasks,
    failedTasks,
    autoApply,
    savePaused,
    resumeAfterSave,
    start,
    retarget: start,
    analyze,
    answer,
    continueAfterQuestions,
    setRequirementDecision,
    decide,
    acceptAll,
    refine: (task: TailoringTask, refinement: TailoringRefinement) => runTask(task, { refinement }),
    regenerate: (task: TailoringTask) => runTask(task, { regenerate: true }),
    retry: (task: TailoringTask) => runTask(task),
    skipTask,
    setAutoApply,
    finish,
    reset: () => {
      loadedForCv.current = null;
      setView(null);
      setIssue(null);
      setLoadError(null);
    }
  };
}

export type TailoringSessionController = ReturnType<typeof useTailoringSession>;
