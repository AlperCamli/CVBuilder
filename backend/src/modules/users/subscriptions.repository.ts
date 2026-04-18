import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { SubscriptionRecord } from "../../shared/types/domain";

export interface SubscriptionsRepository {
  getCurrentForUser(userId: string): Promise<SubscriptionRecord | null>;
}

export class SupabaseSubscriptionsRepository implements SubscriptionsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getCurrentForUser(userId: string): Promise<SubscriptionRecord | null> {
    const { data: activeSubscriptions, error: activeError } = await this.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1);

    if (activeError) {
      throw new InternalServerError("Failed to load active subscription", {
        reason: activeError.message
      });
    }

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      return activeSubscriptions[0] as SubscriptionRecord;
    }

    const { data: latestSubscriptions, error: latestError } = await this.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestError) {
      throw new InternalServerError("Failed to load latest subscription", {
        reason: latestError.message
      });
    }

    if (!latestSubscriptions || latestSubscriptions.length === 0) {
      return null;
    }

    return latestSubscriptions[0] as SubscriptionRecord;
  }
}
