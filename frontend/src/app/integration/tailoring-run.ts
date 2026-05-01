import type { BackendApi } from "./backend-api";
import { ApiClientError } from "./api-error";
import type {
  TailoringRunFlowType,
  TailoringRunStatusResponse
} from "./api-types";

const RETRY_DELAY_MS = [800, 1800];
const POLL_INITIAL_INTERVAL_MS = 750;
const POLL_MAX_INTERVAL_MS = 5000;
const POLL_BACKOFF_FACTOR = 1.6;
const TERMINAL_WAIT_TIMEOUT_MS = 30000;

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

export const isTransientAiRequestError = (error: unknown): boolean => {
  if (error instanceof ApiClientError) {
    return error.status >= 500 || error.status === 429 || error.status === 408;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("load failed")
    );
  }
  return false;
};

export const withTransientRetry = async <T,>(
  task: () => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isTransientAiRequestError(error);
      if (!shouldRetry) {
        throw error;
      }
      const baseDelay = RETRY_DELAY_MS[Math.min(attempt - 1, RETRY_DELAY_MS.length - 1)] ?? 0;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(baseDelay + jitter);
    }
  }
  throw lastError ?? new Error("Request failed");
};

export const toFlowLabel = (flowType: TailoringRunFlowType): string => {
  if (flowType === "job_analysis") {
    return "Job analysis";
  }
  if (flowType === "follow_up_questions") {
    return "Follow-up questions";
  }
  return "Tailored CV draft";
};

export const toStageLabel = (
  flowType: TailoringRunFlowType,
  stage: TailoringRunStatusResponse["progress_stage"]
): string => {
  const flowLabel = toFlowLabel(flowType);
  switch (stage) {
    case "queued":
      return `${flowLabel}: queued`;
    case "building_prompt":
      return `${flowLabel}: preparing prompt`;
    case "calling_model":
      return `${flowLabel}: calling AI model`;
    case "parsing_output":
      return `${flowLabel}: parsing response`;
    case "validating_output":
      return `${flowLabel}: validating output`;
    case "persisting_result":
      return `${flowLabel}: saving results`;
    case "completed":
      return `${flowLabel}: completed`;
    default:
      return `${flowLabel}: failed`;
  }
};

export const toRunErrorMessage = (status: TailoringRunStatusResponse): string => {
  const raw = status.error_message?.trim();
  const normalized = raw?.toLowerCase() ?? "";

  if (normalized.includes("provider_status=429") || normalized.includes("resource_exhausted")) {
    return "AI rate limit reached. Wait a moment and try again.";
  }
  if (
    normalized.includes("provider_status=503") ||
    normalized.includes("provider_status=504") ||
    normalized.includes("unavailable") ||
    normalized.includes("timed out")
  ) {
    return "AI service is temporarily unavailable. Please retry shortly.";
  }
  if (
    normalized.includes("structured output validation failed") ||
    normalized.includes("required contract")
  ) {
    return "AI returned an invalid structured response. Please retry.";
  }
  return raw || "Tailoring AI request failed.";
};

export interface RunTailoringFlowOptions {
  api: BackendApi;
  flowType: TailoringRunFlowType;
  input: Record<string, unknown>;
  onStage?: (label: string) => void;
  signal?: AbortSignal;
}

export interface RunTailoringFlowResult<TResult> {
  ai_run_id: string;
  result: TResult;
}

const startProgressPoller = (
  api: BackendApi,
  aiRunId: string,
  flowType: TailoringRunFlowType,
  onStage: ((label: string) => void) | undefined,
  signal: AbortSignal
): Promise<void> => {
  return (async () => {
    let interval = POLL_INITIAL_INTERVAL_MS;
    while (!signal.aborted) {
      await sleep(interval, signal);
      if (signal.aborted) {
        return;
      }
      try {
        const status = await api.getTailoringRunStatus(aiRunId);
        onStage?.(toStageLabel(flowType, status.progress_stage));
      } catch {
        // Polling is best-effort UX progress only; ignore individual failures.
      }
      interval = Math.min(POLL_MAX_INTERVAL_MS, Math.floor(interval * POLL_BACKOFF_FACTOR));
    }
  })();
};

const waitForTerminalStatus = async (
  api: BackendApi,
  aiRunId: string,
  flowType: TailoringRunFlowType,
  onStage: ((label: string) => void) | undefined,
  signal?: AbortSignal
): Promise<TailoringRunStatusResponse> => {
  const deadline = Date.now() + TERMINAL_WAIT_TIMEOUT_MS;
  let interval = POLL_INITIAL_INTERVAL_MS;
  let latestStatus = await withTransientRetry(() => api.getTailoringRunStatus(aiRunId), 3);

  onStage?.(toStageLabel(flowType, latestStatus.progress_stage));
  while (latestStatus.status === "pending" && Date.now() < deadline) {
    await sleep(interval, signal);
    if (signal?.aborted) {
      break;
    }

    latestStatus = await withTransientRetry(() => api.getTailoringRunStatus(aiRunId), 3);
    onStage?.(toStageLabel(flowType, latestStatus.progress_stage));
    interval = Math.min(POLL_MAX_INTERVAL_MS, Math.floor(interval * POLL_BACKOFF_FACTOR));
  }

  return latestStatus;
};

export const runTailoringFlow = async <TResult extends Record<string, unknown>>(
  options: RunTailoringFlowOptions
): Promise<RunTailoringFlowResult<TResult>> => {
  const { api, flowType, input, onStage, signal } = options;

  const started = await withTransientRetry(
    () => api.startTailoringRun({ flow_type: flowType, input }),
    3
  );
  onStage?.(toStageLabel(flowType, started.progress_stage));

  const pollerController = new AbortController();
  const externalAbortHandler = () => pollerController.abort();
  signal?.addEventListener("abort", externalAbortHandler, { once: true });

  const pollerPromise = startProgressPoller(
    api,
    started.ai_run_id,
    flowType,
    onStage,
    pollerController.signal
  );

  let executeOutcome: { ok: true; status: TailoringRunStatusResponse["status"] } | { ok: false; error: unknown };
  try {
    const executed = await withTransientRetry(
      () => api.executeTailoringRun(started.ai_run_id),
      3
    );
    executeOutcome = { ok: true, status: executed.status };
  } catch (error) {
    executeOutcome = { ok: false, error };
  } finally {
    pollerController.abort();
    signal?.removeEventListener("abort", externalAbortHandler);
    await pollerPromise.catch(() => undefined);
  }

  // Always read final status so error_message diagnostics surface uniformly.
  const finalStatus = await waitForTerminalStatus(
    api,
    started.ai_run_id,
    flowType,
    onStage,
    signal
  );

  if (finalStatus.status === "failed") {
    throw new Error(toRunErrorMessage(finalStatus));
  }

  if (finalStatus.status !== "completed") {
    if (!executeOutcome.ok) {
      throw executeOutcome.error;
    }
    throw new Error(
      `Tailoring AI run did not reach a terminal state (status=${finalStatus.status}, stage=${finalStatus.progress_stage}).`
    );
  }

  const result = await withTransientRetry(
    () => api.getTailoringRunResult(started.ai_run_id),
    3
  );

  return {
    ai_run_id: started.ai_run_id,
    result: result.result as TResult
  };
};
