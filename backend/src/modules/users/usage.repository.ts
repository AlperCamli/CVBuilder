import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { UsageCounterRecord } from "../../shared/types/domain";
import { getCurrentPeriodMonthUtc } from "../../shared/utils/date";

export interface UsageRepository {
  getOrCreateCurrentMonth(userId: string): Promise<UsageCounterRecord>;
}

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

    return data as UsageCounterRecord;
  }
}
