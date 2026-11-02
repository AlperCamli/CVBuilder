import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { UsageCounterRecord } from "../../shared/types/domain";
import { getCurrentPeriodMonthUtc } from "../../shared/utils/date";

export interface UsageCounterIncrementInput {
  tailored_cv_generations_increment?: number;
  exports_increment?: number;
  ai_actions_increment?: number;
  storage_bytes_delta?: number;
}

export type FreeTierUse = "tailoring" | "improve";

export type FreeTierMarkers = Record<FreeTierUse, string | null>;

const FREE_TIER_COLUMNS: Record<FreeTierUse, "free_tailoring_used_at" | "free_improve_used_at"> = {
  tailoring: "free_tailoring_used_at",
  improve: "free_improve_used_at"
};

export interface UsageRepository {
  getOrCreateCurrentMonth(userId: string): Promise<UsageCounterRecord>;
  incrementCurrentMonth(userId: string, input: UsageCounterIncrementInput): Promise<UsageCounterRecord>;
  getFreeTierMarkers(userId: string): Promise<FreeTierMarkers>;
  // Sets the marker only while it is unset; returns the stored time, or null when it was already used.
  claimFreeTierMarker(userId: string, use: FreeTierUse): Promise<string | null>;
  // Undoes a claim whose operation failed before it delivered anything; a later claim is left alone.
  releaseFreeTierMarker(userId: string, use: FreeTierUse, claimedAt: string): Promise<void>;
}

const mapUsageCounterRow = (row: Record<string, unknown>): UsageCounterRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    period_month: String(row.period_month),
    tailored_cv_generations_count: Number(row.tailored_cv_generations_count ?? 0),
    exports_count: Number(row.exports_count ?? 0),
    ai_actions_count: Number(row.ai_actions_count ?? 0),
    storage_bytes_used: Number(row.storage_bytes_used ?? 0),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseUsageRepository implements UsageRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getOrCreateCurrentMonth(userId: string): Promise<UsageCounterRecord> {
    const periodMonth = getCurrentPeriodMonthUtc();

    const { data, error } = await this.supabaseClient
      .from("usage_counters")
      .upsert(
        {
          user_id: userId,
          period_month: periodMonth,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "user_id,period_month"
        }
      )
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to load usage counters", {
        reason: error.message
      });
    }

    return mapUsageCounterRow(data as Record<string, unknown>);
  }

  async incrementCurrentMonth(
    userId: string,
    input: UsageCounterIncrementInput
  ): Promise<UsageCounterRecord> {
    const { data, error } = await this.supabaseClient.rpc("increment_usage_counters", {
      p_user_id: userId,
      p_period_month: getCurrentPeriodMonthUtc(),
      p_tailored_cv_generations_increment: input.tailored_cv_generations_increment ?? 0,
      p_exports_increment: input.exports_increment ?? 0,
      p_ai_actions_increment: input.ai_actions_increment ?? 0,
      p_storage_bytes_delta: input.storage_bytes_delta ?? 0
    });

    if (error) {
      throw new InternalServerError("Failed to increment usage counters", {
        reason: error.message
      });
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row || typeof row !== "object") {
      throw new InternalServerError("Usage increment did not return a counter row");
    }

    return mapUsageCounterRow(row as Record<string, unknown>);
  }

  async getFreeTierMarkers(userId: string): Promise<FreeTierMarkers> {
    const { data, error } = await this.supabaseClient
      .from("users")
      .select("free_tailoring_used_at,free_improve_used_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load free-tier usage", { reason: error.message });
    }

    return {
      tailoring: (data?.free_tailoring_used_at as string | null | undefined) ?? null,
      improve: (data?.free_improve_used_at as string | null | undefined) ?? null
    };
  }

  async claimFreeTierMarker(userId: string, use: FreeTierUse): Promise<string | null> {
    const column = FREE_TIER_COLUMNS[use];
    const claimedAt = new Date().toISOString();
    const { data, error } = await this.supabaseClient
      .from("users")
      .update({ [column]: claimedAt })
      .eq("id", userId)
      .is(column, null)
      .select("id");

    if (error) {
      throw new InternalServerError("Failed to record free-tier usage", { reason: error.message });
    }

    return Array.isArray(data) && data.length > 0 ? claimedAt : null;
  }

  async releaseFreeTierMarker(userId: string, use: FreeTierUse, claimedAt: string): Promise<void> {
    const column = FREE_TIER_COLUMNS[use];
    const { error } = await this.supabaseClient
      .from("users")
      .update({ [column]: null })
      .eq("id", userId)
      .eq(column, claimedAt);

    if (error) {
      throw new InternalServerError("Failed to release free-tier usage", { reason: error.message });
    }
  }
}
