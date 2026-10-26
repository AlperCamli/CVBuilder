import { ApiClientError } from "../../integration/api-error";
import type { TailoringSessionView, TailoringTaskRunResponse } from "../../integration/tailoring-types";

// Merging server responses into the session view the Tailor panel shows.

// Tasks the server never removes once the analysis is saved (refine adds new ones). A
// snapshot taken before a refine created its task must not drop that task.
const keepsMissingTasks = (view: TailoringSessionView): boolean =>
  view.session.status !== "draft" && view.session.status !== "analyzing";

// Responses from parallel task runs can arrive out of order, so views are merged per entity:
// the newer task wins, tasks (and their cards) missing from an older snapshot are kept, and
// suggestions missing from an older snapshot are kept while our copy of their task is newer.
export const mergeTailoringViews = (
  previous: TailoringSessionView | null,
  next: TailoringSessionView
): TailoringSessionView => {
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

  const missingTasks = keepsMissingTasks(next) ? previous.tasks.filter((task) => !nextTasks.has(task.id)) : [];
  const missingTaskIds = new Set(missingTasks.map((task) => task.id));
  const tasks = [...next.tasks.map((task) => (isAhead(task.id) ? previousTasks.get(task.id)! : task)), ...missingTasks];
  const nextSuggestionIds = new Set(next.suggestions.map((suggestion) => suggestion.id));
  const kept = previous.suggestions.filter(
    (suggestion) =>
      !nextSuggestionIds.has(suggestion.id) &&
      (isAhead(suggestion.task_id) || (suggestion.task_id !== null && missingTaskIds.has(suggestion.task_id)))
  );
  return { ...next, tasks, suggestions: [...next.suggestions, ...kept] };
};

// A task run or block refine result. The task may be new (a refine creates a task for a
// block that had none); a re-run replaces the task's pending cards (the server expired them).
export const applyTailoringTaskResult = (
  view: TailoringSessionView,
  result: TailoringTaskRunResponse
): TailoringSessionView => {
  const resultIds = new Set(result.suggestions.map((suggestion) => suggestion.id));
  const known = view.tasks.some((task) => task.id === result.task.id);
  return {
    ...view,
    session: { ...view.session, status: result.session_status },
    tasks: known ? view.tasks.map((task) => (task.id === result.task.id ? result.task : task)) : [...view.tasks, result.task],
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

// A refine request the server refused with 409 while that block's task is already running
// is not an error: the running task's card arrives on its own.
export const isRefineBusyError = (error: unknown): boolean => error instanceof ApiClientError && error.status === 409;
