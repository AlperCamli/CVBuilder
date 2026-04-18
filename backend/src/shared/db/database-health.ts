import type { SupabaseClient } from "@supabase/supabase-js";

export interface DatabaseHealthStatus {
  connected: boolean;
  checked_at: string;
  reason?: string;
}

export interface DatabaseHealthCheckerPort {
  check(): Promise<DatabaseHealthStatus>;
}

export class DatabaseHealthChecker implements DatabaseHealthCheckerPort {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async check(): Promise<DatabaseHealthStatus> {
    const checkedAt = new Date().toISOString();

    const { error } = await this.supabaseClient
      .from("users")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return {
        connected: false,
        checked_at: checkedAt,
        reason: error.message
      };
    }

    return {
      connected: true,
      checked_at: checkedAt
    };
  }
}
