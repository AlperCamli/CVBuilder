import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { SubscriptionRecord } from "../../shared/types/domain";

export interface SyncSubscriptionInput {
  user_id: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  plan_code: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingSubscriptionsRepository {
  getCurrentForUser(userId: string): Promise<SubscriptionRecord | null>;
  getLatestForUser(userId: string): Promise<SubscriptionRecord | null>;
  getCustomerIdForUser(userId: string, provider: string): Promise<string | null>;
  findByProviderSubscriptionId(
    provider: string,
    providerSubscriptionId: string
  ): Promise<SubscriptionRecord | null>;
  findByProviderCustomerId(provider: string, providerCustomerId: string): Promise<SubscriptionRecord | null>;
  ensureCustomerLink(input: {
    user_id: string;
    provider: string;
    provider_customer_id: string;
  }): Promise<SubscriptionRecord>;
  upsertProviderSubscription(input: SyncSubscriptionInput): Promise<SubscriptionRecord>;
  deactivateOtherActiveSubscriptions(
    userId: string,
    provider: string,
    keepProviderSubscriptionId: string | null
  ): Promise<void>;
}

const toSubscriptionRecord = (row: Record<string, unknown>): SubscriptionRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider: String(row.provider),
    provider_customer_id: (row.provider_customer_id as string | null) ?? null,
    provider_subscription_id: (row.provider_subscription_id as string | null) ?? null,
    plan_code: String(row.plan_code),
    status: String(row.status),
    current_period_start: (row.current_period_start as string | null) ?? null,
    current_period_end: (row.current_period_end as string | null) ?? null,
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseBillingSubscriptionsRepository implements BillingSubscriptionsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getCurrentForUser(userId: string): Promise<SubscriptionRecord | null> {
    const { data: activeRows, error: activeError } = await this.supabaseClient
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

    if (activeRows && activeRows.length > 0) {
      return toSubscriptionRecord(activeRows[0] as Record<string, unknown>);
    }

    return this.getLatestForUser(userId);
  }

  async getLatestForUser(userId: string): Promise<SubscriptionRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load latest subscription", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toSubscriptionRecord(data as Record<string, unknown>);
  }

  async getCustomerIdForUser(userId: string, provider: string): Promise<string | null> {
    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .select("provider_customer_id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .not("provider_customer_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load subscription customer linkage", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return (data.provider_customer_id as string | null) ?? null;
  }

  async findByProviderSubscriptionId(
    provider: string,
    providerSubscriptionId: string
  ): Promise<SubscriptionRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("provider", provider)
      .eq("provider_subscription_id", providerSubscriptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load provider subscription", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toSubscriptionRecord(data as Record<string, unknown>);
  }

  async findByProviderCustomerId(provider: string, providerCustomerId: string): Promise<SubscriptionRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("provider", provider)
      .eq("provider_customer_id", providerCustomerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load provider customer linkage", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toSubscriptionRecord(data as Record<string, unknown>);
  }

  async ensureCustomerLink(input: {
    user_id: string;
    provider: string;
    provider_customer_id: string;
  }): Promise<SubscriptionRecord> {
    const existing = await this.findByProviderCustomerId(input.provider, input.provider_customer_id);

    if (existing && existing.user_id === input.user_id) {
      return existing;
    }

    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .insert({
        user_id: input.user_id,
        provider: input.provider,
        provider_customer_id: input.provider_customer_id,
        provider_subscription_id: null,
        plan_code: "free",
        status: "inactive",
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to persist customer linkage", {
        reason: error.message
      });
    }

    return toSubscriptionRecord(data as Record<string, unknown>);
  }

  async deactivateOtherActiveSubscriptions(
    userId: string,
    provider: string,
    keepProviderSubscriptionId: string | null
  ): Promise<void> {
    let builder = this.supabaseClient
      .from("subscriptions")
      .update({
        status: "inactive",
        cancel_at_period_end: false
      })
      .eq("user_id", userId)
      .eq("provider", provider)
      .in("status", ["active", "trialing"]);

    if (keepProviderSubscriptionId) {
      builder = builder.neq("provider_subscription_id", keepProviderSubscriptionId);
    }

    const { error } = await builder;

    if (error) {
      throw new InternalServerError("Failed to deactivate old active subscriptions", {
        reason: error.message
      });
    }
  }

  async upsertProviderSubscription(input: SyncSubscriptionInput): Promise<SubscriptionRecord> {
    if (input.status === "active" || input.status === "trialing") {
      await this.deactivateOtherActiveSubscriptions(
        input.user_id,
        input.provider,
        input.provider_subscription_id
      );
    }

    const existing = input.provider_subscription_id
      ? await this.findByProviderSubscriptionId(input.provider, input.provider_subscription_id)
      : null;

    if (existing) {
      const { data, error } = await this.supabaseClient
        .from("subscriptions")
        .update({
          provider_customer_id: input.provider_customer_id,
          plan_code: input.plan_code,
          status: input.status,
          current_period_start: input.current_period_start,
          current_period_end: input.current_period_end,
          cancel_at_period_end: input.cancel_at_period_end
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throw new InternalServerError("Failed to update provider subscription", {
          reason: error.message
        });
      }

      return toSubscriptionRecord(data as Record<string, unknown>);
    }

    const { data, error } = await this.supabaseClient
      .from("subscriptions")
      .insert({
        user_id: input.user_id,
        provider: input.provider,
        provider_customer_id: input.provider_customer_id,
        provider_subscription_id: input.provider_subscription_id,
        plan_code: input.plan_code,
        status: input.status,
        current_period_start: input.current_period_start,
        current_period_end: input.current_period_end,
        cancel_at_period_end: input.cancel_at_period_end
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to insert provider subscription", {
        reason: error.message
      });
    }

    return toSubscriptionRecord(data as Record<string, unknown>);
  }
}
