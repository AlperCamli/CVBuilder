import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { AppConfig } from "../../../shared/config/env";
import { AiProviderError } from "../../../shared/errors/app-error";
import type { AiFlowType } from "../../../shared/types/domain";
import { computeRunCostUsd, type ModelPriceTable } from "../ai-cost";
import type { AiProviderRequest, AiProviderUsage, AiUsageContext } from "./ai-provider";

// Append-only record of every provider HTTP attempt (public.ai_usage_events): retries, timeouts, errors,
// refusals and fallbacks included, so the dashboard can reconcile with the provider bill even when no ai_runs
// row exists or it was deleted later. Metadata only: never prompts, payloads or provider error text.

export type AiUsageSource = "app" | "script" | "test";

export type AiAttemptOutcome =
  | "success"
  | "refusal"
  | "truncated"
  | "empty_output"
  | "invalid_output"
  | "usage_not_recorded"
  | "http_error"
  | "timeout"
  | "network_error"
  | "error";

export interface AiUsageEvent {
  call_id: string;
  provider: string;
  flow_type: AiFlowType;
  model_requested: string;
  model_reported: string | null;
  attempt_no: number;
  is_fallback: boolean;
  outcome: AiAttemptOutcome;
  http_status: number | null;
  provider_request_id: string | null;
  usage: AiProviderUsage | null;
  started_at: Date;
  latency_ms: number;
  context?: AiUsageContext;
}

export interface AiUsageSink {
  record(event: AiUsageEvent): Promise<void>;
}

// How long an attempt waits for its ledger write. A slow or failing sink only loses the event.
const SINK_TIMEOUT_MS = 2_000;
const MAX_REQUEST_ID_LENGTH = 200;

const OUTCOME_BY_REASON: Record<string, AiAttemptOutcome> = {
  provider_refusal: "refusal",
  output_truncated_by_token_limit: "truncated",
  empty_response: "empty_output",
  output_json_unparseable: "invalid_output",
  usage_record_failed: "usage_not_recorded"
};

// The outcome of an attempt whose response arrived but was rejected afterwards.
export const outcomeOfResponseError = (error: unknown): AiAttemptOutcome => {
  if (!(error instanceof AiProviderError)) return "error";
  const reason = error.details?.reason;
  return (typeof reason === "string" && OUTCOME_BY_REASON[reason]) || "invalid_output";
};

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
};

// The outcome of an attempt whose request failed: timeouts are named by the SDKs (and by the Gemini provider's
// own timeout); anything else without an HTTP status never reached the provider's API.
export const outcomeOfRequestError = (error: unknown): { outcome: AiAttemptOutcome; http_status: number | null } => {
  const name = error instanceof Error ? error.name : "";
  if (/timeout/i.test(name)) return { outcome: "timeout", http_status: null };
  const status = statusOf(error);
  return status === null ? { outcome: "network_error", http_status: null } : { outcome: "http_error", http_status: status };
};

export const requestIdOf = (value: unknown): string | null => {
  const record = value as { _request_id?: unknown; requestID?: unknown; responseId?: unknown; id?: unknown } | null;
  const id = record?._request_id ?? record?.requestID ?? record?.responseId ?? record?.id;
  return typeof id === "string" && id ? id.slice(0, MAX_REQUEST_ID_LENGTH) : null;
};

export interface AiAttempt {
  // The response arrived (2xx); its usage and ids are kept until the attempt settles.
  received(fields: { model_reported: string | null; usage: AiProviderUsage | undefined; provider_request_id: string | null }): void;
  // Records the attempt once; later calls are no-ops. Never throws.
  settle(outcome: AiAttemptOutcome, fields?: { http_status?: number | null; provider_request_id?: string | null }): Promise<void>;
}

// One generate() call: numbers its attempts across retries and model fallback.
export class AiAttemptLedger {
  private readonly callId = randomUUID();
  private attempts = 0;

  constructor(
    private readonly sink: AiUsageSink | null | undefined,
    private readonly provider: string,
    private readonly request: Pick<AiProviderRequest, "flow_type" | "usage_context">
  ) {}

  begin(modelRequested: string, isFallback: boolean): AiAttempt {
    this.attempts += 1;
    const attemptNo = this.attempts;
    const startedAt = new Date();
    let settled = false;
    let response: { model_reported: string | null; usage: AiProviderUsage | null; provider_request_id: string | null } | null = null;
    return {
      received: (fields) => {
        response = { ...fields, usage: fields.usage ?? null };
      },
      settle: async (outcome, fields = {}) => {
        if (settled) return;
        settled = true;
        if (!this.sink) return;
        const event: AiUsageEvent = {
          call_id: this.callId,
          provider: this.provider,
          flow_type: this.request.flow_type,
          model_requested: modelRequested,
          model_reported: response?.model_reported ?? null,
          attempt_no: attemptNo,
          is_fallback: isFallback,
          outcome,
          http_status: fields.http_status !== undefined ? fields.http_status : response ? 200 : null,
          provider_request_id: fields.provider_request_id ?? response?.provider_request_id ?? null,
          usage: response?.usage ?? null,
          started_at: startedAt,
          latency_ms: Date.now() - startedAt.getTime(),
          context: this.request.usage_context
        };
        await recordQuietly(this.sink, event);
      }
    };
  }
}

const recordQuietly = async (sink: AiUsageSink, event: AiUsageEvent): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A synchronous throw or a late rejection from the sink is swallowed as well.
  const write = Promise.resolve().then(() => sink.record(event)).catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SINK_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    await Promise.race([write, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const tokenColumn = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

// Row for public.ai_usage_events. Token columns stay null when the attempt reported no usage (errors, timeouts),
// and cost_usd stays null when the model has no configured price.
export const toUsageEventRow = (
  event: AiUsageEvent,
  options: { source: AiUsageSource; environment: string; pricing: ModelPriceTable }
): Record<string, unknown> => {
  const usage = event.usage;
  return {
    occurred_at: event.started_at.toISOString(),
    source: options.source,
    environment: options.environment,
    call_id: event.call_id,
    provider: event.provider,
    flow_type: event.flow_type,
    model_requested: event.model_requested,
    model_reported: event.model_reported,
    attempt_no: event.attempt_no,
    is_fallback: event.is_fallback,
    outcome: event.outcome,
    http_status: event.http_status,
    provider_request_id: event.provider_request_id,
    input_tokens: tokenColumn(usage?.input_tokens),
    cached_input_tokens: usage ? tokenColumn(usage.cached_input_tokens) : null,
    cache_write_input_tokens: usage ? tokenColumn(usage.cache_write_input_tokens) : null,
    output_tokens: tokenColumn(usage?.output_tokens),
    reasoning_tokens: usage ? tokenColumn(usage.reasoning_tokens) : null,
    cost_usd: usage ? computeRunCostUsd(options.pricing, event.model_reported ?? event.model_requested, usage) : null,
    latency_ms: Math.max(0, Math.round(event.latency_ms)),
    ai_run_id: event.context?.ai_run_id ?? null,
    user_id: event.context?.user_id ?? null,
    subject: event.context?.subject ?? null
  };
};

export class SupabaseAiUsageSink implements AiUsageSink {
  constructor(
    private readonly db: SupabaseClient,
    private readonly options: { source: AiUsageSource; environment: string; pricing: ModelPriceTable; logger?: Pick<Logger, "warn"> }
  ) {}

  async record(event: AiUsageEvent): Promise<void> {
    try {
      const { error } = await this.db.from("ai_usage_events").insert(toUsageEventRow(event, this.options));
      if (error) this.warn(event, error.message);
    } catch (error) {
      this.warn(event, error instanceof Error ? error.message : "unknown");
    }
  }

  private warn(event: AiUsageEvent, reason: string) {
    this.options.logger?.warn(
      { code: "AI_USAGE_EVENT_NOT_RECORDED", provider: event.provider, flow_type: event.flow_type, outcome: event.outcome, reason },
      "AI usage event was not recorded"
    );
  }
}

// The app's sink: test runs are tagged so they never count as product usage.
export const createAiUsageSink = (
  config: Pick<AppConfig, "appEnv" | "ai">,
  db: SupabaseClient,
  logger?: Pick<Logger, "warn">,
  source: AiUsageSource = config.appEnv === "test" ? "test" : "app"
): AiUsageSink =>
  new SupabaseAiUsageSink(db, { source, environment: config.appEnv, pricing: config.ai.modelPricing ?? {}, logger });
