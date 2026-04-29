import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type {
  AiFlowType,
  AiRunProgressStage,
  AiRunRecord,
  AiRunStatus,
  AiSuggestionActionType,
  AiSuggestionRecord,
  AiSuggestionStatus
} from "../../shared/types/domain";

export interface CreateAiRunPayload {
  user_id: string;
  flow_type: AiFlowType;
  provider: string;
  model_name: string;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  job_id?: string | null;
  progress_stage?: AiRunProgressStage;
  input_payload: Record<string, unknown>;
}

export interface UpdateAiRunContextPayload {
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  job_id?: string | null;
}

export interface CreateAiSuggestionPayload {
  ai_run_id: string;
  user_id: string;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  block_id?: string | null;
  action_type: AiSuggestionActionType;
  before_content?: Record<string, unknown> | null;
  suggested_content: Record<string, unknown>;
  option_group_key?: string | null;
}

export interface UpdateAiSuggestionPayload {
  status: AiSuggestionStatus;
  applied_at?: string | null;
}

export interface AiRepository {
  createRun(payload: CreateAiRunPayload): Promise<AiRunRecord>;
  claimRunForExecution(userId: string, runId: string): Promise<AiRunRecord | null>;
  completeRun(
    userId: string,
    runId: string,
    outputPayload: Record<string, unknown>,
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null
  ): Promise<AiRunRecord | null>;
  failRun(
    userId: string,
    runId: string,
    errorMessage: string,
    debugPayload?: Record<string, unknown> | null
  ): Promise<AiRunRecord | null>;
  findRunById(userId: string, runId: string): Promise<AiRunRecord | null>;
  updateRunProgressStage(
    userId: string,
    runId: string,
    progressStage: AiRunProgressStage
  ): Promise<AiRunRecord | null>;
  updateRunContext(
    userId: string,
    runId: string,
    payload: UpdateAiRunContextPayload
  ): Promise<AiRunRecord | null>;
  failStaleRuns(beforeIso: string): Promise<number>;
  createSuggestions(payloads: CreateAiSuggestionPayload[]): Promise<AiSuggestionRecord[]>;
  findSuggestionById(userId: string, suggestionId: string): Promise<AiSuggestionRecord | null>;
  updateSuggestionById(
    userId: string,
    suggestionId: string,
    payload: UpdateAiSuggestionPayload,
    options?: { expected_status?: AiSuggestionStatus }
  ): Promise<AiSuggestionRecord | null>;
  listRunsByTailoredCv(userId: string, tailoredCvId: string, limit?: number): Promise<AiRunRecord[]>;
  listRunsByMasterCv(userId: string, masterCvId: string, limit?: number): Promise<AiRunRecord[]>;
  listSuggestionsByTailoredCv(
    userId: string,
    tailoredCvId: string,
    limit?: number
  ): Promise<AiSuggestionRecord[]>;
  listSuggestionsByMasterCv(userId: string, masterCvId: string, limit?: number): Promise<AiSuggestionRecord[]>;
  listAppliedSuggestionsByTailoredCv(userId: string, tailoredCvId: string): Promise<AiSuggestionRecord[]>;
  listAppliedSuggestionsByMasterCv(userId: string, masterCvId: string): Promise<AiSuggestionRecord[]>;
}

const toAiRunRecord = (row: Record<string, unknown>): AiRunRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    master_cv_id: (row.master_cv_id as string | null) ?? null,
    tailored_cv_id: (row.tailored_cv_id as string | null) ?? null,
    job_id: (row.job_id as string | null) ?? null,
    flow_type: row.flow_type as AiFlowType,
    provider: String(row.provider),
    model_name: String(row.model_name),
    status: row.status as AiRunStatus,
    progress_stage: row.progress_stage as AiRunProgressStage,
    input_payload: (row.input_payload as Record<string, unknown>) ?? {},
    output_payload: (row.output_payload as Record<string, unknown> | null) ?? null,
    error_message: (row.error_message as string | null) ?? null,
    debug_payload: (row.debug_payload as Record<string, unknown> | null) ?? null,
    input_tokens: (row.input_tokens as number | null) ?? null,
    output_tokens: (row.output_tokens as number | null) ?? null,
    total_tokens: (row.total_tokens as number | null) ?? null,
    started_at: String(row.started_at),
    completed_at: (row.completed_at as string | null) ?? null
  };
};

const toAiSuggestionRecord = (row: Record<string, unknown>): AiSuggestionRecord => {
  return {
    id: String(row.id),
    ai_run_id: String(row.ai_run_id),
    user_id: String(row.user_id),
    master_cv_id: (row.master_cv_id as string | null) ?? null,
    tailored_cv_id: (row.tailored_cv_id as string | null) ?? null,
    block_id: (row.block_id as string | null) ?? null,
    action_type: row.action_type as AiSuggestionActionType,
    before_content: (row.before_content as Record<string, unknown> | null) ?? null,
    suggested_content: (row.suggested_content as Record<string, unknown>) ?? {},
    option_group_key: (row.option_group_key as string | null) ?? null,
    status: row.status as AiSuggestionStatus,
    applied_at: (row.applied_at as string | null) ?? null,
    created_at: String(row.created_at)
  };
};

export class SupabaseAiRepository implements AiRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async createRun(payload: CreateAiRunPayload): Promise<AiRunRecord> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .insert({
        user_id: payload.user_id,
        flow_type: payload.flow_type,
        provider: payload.provider,
        model_name: payload.model_name,
        status: "pending",
        progress_stage: payload.progress_stage ?? "queued",
        master_cv_id: payload.master_cv_id ?? null,
        tailored_cv_id: payload.tailored_cv_id ?? null,
        job_id: payload.job_id ?? null,
        input_payload: payload.input_payload,
        output_payload: null,
        error_message: null,
        debug_payload: null,
        started_at: new Date().toISOString(),
        completed_at: null
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create AI run", {
        reason: error.message
      });
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async claimRunForExecution(userId: string, runId: string): Promise<AiRunRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update({
        progress_stage: "building_prompt"
      })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("progress_stage", "queued")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to claim AI run for execution", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async completeRun(
    userId: string,
    runId: string,
    outputPayload: Record<string, unknown>,
    tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null
  ): Promise<AiRunRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update({
        status: "completed",
        progress_stage: "completed",
        output_payload: outputPayload,
        error_message: null,
        debug_payload: null,
        input_tokens: tokenUsage?.input_tokens ?? null,
        output_tokens: tokenUsage?.output_tokens ?? null,
        total_tokens: tokenUsage?.total_tokens ?? null,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to complete AI run", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async failRun(
    userId: string,
    runId: string,
    errorMessage: string,
    debugPayload?: Record<string, unknown> | null
  ): Promise<AiRunRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update({
        status: "failed",
        progress_stage: "failed",
        error_message: errorMessage,
        debug_payload: debugPayload ?? null,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to fail AI run", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async failStaleRuns(beforeIso: string): Promise<number> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update({
        status: "failed",
        progress_stage: "failed",
        error_message: "AI run timed out (no terminal state recorded before deadline)",
        completed_at: new Date().toISOString()
      })
      .eq("status", "pending")
      .lt("started_at", beforeIso)
      .select("id");

    if (error) {
      throw new InternalServerError("Failed to sweep stale AI runs", {
        reason: error.message
      });
    }

    return (data ?? []).length;
  }

  async findRunById(userId: string, runId: string): Promise<AiRunRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load AI run", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async updateRunProgressStage(
    userId: string,
    runId: string,
    progressStage: AiRunProgressStage
  ): Promise<AiRunRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update({
        progress_stage: progressStage
      })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update AI run progress stage", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async updateRunContext(
    userId: string,
    runId: string,
    payload: UpdateAiRunContextPayload
  ): Promise<AiRunRecord | null> {
    const updatePayload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(payload, "master_cv_id")) {
      updatePayload.master_cv_id = payload.master_cv_id ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "tailored_cv_id")) {
      updatePayload.tailored_cv_id = payload.tailored_cv_id ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "job_id")) {
      updatePayload.job_id = payload.job_id ?? null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return this.findRunById(userId, runId);
    }

    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .update(updatePayload)
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update AI run context", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiRunRecord(data as Record<string, unknown>);
  }

  async createSuggestions(payloads: CreateAiSuggestionPayload[]): Promise<AiSuggestionRecord[]> {
    if (payloads.length === 0) {
      return [];
    }

    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .insert(
        payloads.map((payload) => ({
          ai_run_id: payload.ai_run_id,
          user_id: payload.user_id,
          master_cv_id: payload.master_cv_id ?? null,
          tailored_cv_id: payload.tailored_cv_id ?? null,
          block_id: payload.block_id ?? null,
          action_type: payload.action_type,
          before_content: payload.before_content ?? null,
          suggested_content: payload.suggested_content,
          option_group_key: payload.option_group_key ?? null,
          status: "pending",
          applied_at: null,
          created_at: new Date().toISOString()
        }))
      )
      .select("*");

    if (error) {
      throw new InternalServerError("Failed to persist AI suggestions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiSuggestionRecord(row as Record<string, unknown>));
  }

  async findSuggestionById(userId: string, suggestionId: string): Promise<AiSuggestionRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load AI suggestion", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiSuggestionRecord(data as Record<string, unknown>);
  }

  async updateSuggestionById(
    userId: string,
    suggestionId: string,
    payload: UpdateAiSuggestionPayload,
    options?: { expected_status?: AiSuggestionStatus }
  ): Promise<AiSuggestionRecord | null> {
    let builder = this.supabaseClient
      .from("ai_suggestions")
      .update({
        status: payload.status,
        applied_at: payload.applied_at ?? null
      })
      .eq("id", suggestionId)
      .eq("user_id", userId);

    if (options?.expected_status) {
      builder = builder.eq("status", options.expected_status);
    }

    const { data, error } = await builder.select("*").maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update AI suggestion", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toAiSuggestionRecord(data as Record<string, unknown>);
  }

  async listRunsByTailoredCv(userId: string, tailoredCvId: string, limit = 30): Promise<AiRunRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerError("Failed to list AI runs", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiRunRecord(row as Record<string, unknown>));
  }

  async listRunsByMasterCv(userId: string, masterCvId: string, limit = 30): Promise<AiRunRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("master_cv_id", masterCvId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerError("Failed to list AI runs", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiRunRecord(row as Record<string, unknown>));
  }

  async listSuggestionsByTailoredCv(
    userId: string,
    tailoredCvId: string,
    limit = 50
  ): Promise<AiSuggestionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerError("Failed to list AI suggestions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiSuggestionRecord(row as Record<string, unknown>));
  }

  async listSuggestionsByMasterCv(
    userId: string,
    masterCvId: string,
    limit = 50
  ): Promise<AiSuggestionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("master_cv_id", masterCvId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerError("Failed to list AI suggestions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiSuggestionRecord(row as Record<string, unknown>));
  }

  async listAppliedSuggestionsByTailoredCv(
    userId: string,
    tailoredCvId: string
  ): Promise<AiSuggestionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .eq("status", "applied")
      .not("block_id", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      throw new InternalServerError("Failed to list applied AI suggestions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiSuggestionRecord(row as Record<string, unknown>));
  }

  async listAppliedSuggestionsByMasterCv(
    userId: string,
    masterCvId: string
  ): Promise<AiSuggestionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("master_cv_id", masterCvId)
      .eq("status", "applied")
      .not("block_id", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      throw new InternalServerError("Failed to list applied AI suggestions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toAiSuggestionRecord(row as Record<string, unknown>));
  }
}
