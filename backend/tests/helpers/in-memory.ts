import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../src/shared/config/env";
import { getCurrentPeriodMonthUtc } from "../../src/shared/utils/date";
import type { AuthIdentity, AuthProvider } from "../../src/modules/auth/auth.types";
import type {
  BillingSubscriptionsRepository,
  SyncSubscriptionInput
} from "../../src/modules/billing/subscriptions.repository";
import type {
  UsageCounterIncrementInput,
  UsageRepository
} from "../../src/modules/usage/usage.repository";
import type { UsersRepository } from "../../src/modules/users/users.repository";
import type {
  SubscriptionRecord,
  UsageCounterRecord,
  UserRecord
} from "../../src/shared/types/domain";
import type {
  DashboardActivityItem,
  DashboardJobItem,
  DashboardJobStatusCounts,
  DashboardMasterCvItem,
  DashboardTailoredCvItem
} from "../../src/modules/dashboard/dashboard.types";
import type {
  DashboardRepository,
  DashboardSummarySnapshot
} from "../../src/modules/dashboard/dashboard.repository";
import type {
  DatabaseHealthCheckerPort,
  DatabaseHealthStatus
} from "../../src/shared/db/database-health";

const nowIso = (): string => new Date().toISOString();

export class InMemoryUsersRepository implements UsersRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly authUserIdToId = new Map<string, string>();

  async ensureByAuthIdentity(identity: AuthIdentity): Promise<UserRecord> {
    const existing = await this.getByAuthUserId(identity.auth_user_id);
    if (existing) {
      return existing;
    }

    const user: UserRecord = {
      id: randomUUID(),
      auth_user_id: identity.auth_user_id,
      email: identity.email,
      full_name: identity.full_name,
      locale: identity.locale ?? "en",
      default_cv_language: null,
      onboarding_completed: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    this.byId.set(user.id, user);
    this.authUserIdToId.set(user.auth_user_id, user.id);

    return user;
  }

  async getById(userId: string): Promise<UserRecord | null> {
    return this.byId.get(userId) ?? null;
  }

  async getByAuthUserId(authUserId: string): Promise<UserRecord | null> {
    const userId = this.authUserIdToId.get(authUserId);
    if (!userId) {
      return null;
    }

    return this.byId.get(userId) ?? null;
  }

  async updateProfile(
    userId: string,
    payload: { full_name?: string; default_cv_language?: string }
  ): Promise<UserRecord> {
    const user = this.byId.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updated: UserRecord = {
      ...user,
      ...payload,
      updated_at: nowIso()
    };

    this.byId.set(userId, updated);
    return updated;
  }

  async updateSettings(
    userId: string,
    payload: { locale?: "en" | "tr"; default_cv_language?: string; onboarding_completed?: boolean }
  ): Promise<UserRecord> {
    const user = this.byId.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updated: UserRecord = {
      ...user,
      ...payload,
      updated_at: nowIso()
    };

    this.byId.set(userId, updated);
    return updated;
  }
}

export class InMemorySubscriptionsRepository implements BillingSubscriptionsRepository {
  private readonly subscriptionsByUser = new Map<string, SubscriptionRecord[]>();

  seed(subscription: SubscriptionRecord): void {
    const existing = this.subscriptionsByUser.get(subscription.user_id) ?? [];
    this.subscriptionsByUser.set(subscription.user_id, [...existing, subscription]);
  }

  private listByUser(userId: string): SubscriptionRecord[] {
    return [...(this.subscriptionsByUser.get(userId) ?? [])];
  }

  private save(userId: string, subscriptions: SubscriptionRecord[]): void {
    this.subscriptionsByUser.set(userId, subscriptions);
  }

  async getCurrentForUser(userId: string): Promise<SubscriptionRecord | null> {
    const subscriptions = this.listByUser(userId);

    const active = subscriptions
      .filter((item) => item.status === "active" || item.status === "trialing")
      .sort((a, b) => {
        const aTime = a.current_period_end ? Date.parse(a.current_period_end) : 0;
        const bTime = b.current_period_end ? Date.parse(b.current_period_end) : 0;
        return bTime - aTime;
      });

    if (active.length > 0) {
      return active[0];
    }

    return this.getLatestForUser(userId);
  }

  async getLatestForUser(userId: string): Promise<SubscriptionRecord | null> {
    const latest = this.listByUser(userId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return latest[0] ?? null;
  }

  async getCustomerIdForUser(userId: string, provider: string): Promise<string | null> {
    const subscriptions = this.listByUser(userId)
      .filter((item) => item.provider === provider && item.provider_customer_id)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

    return subscriptions[0]?.provider_customer_id ?? null;
  }

  async findByProviderSubscriptionId(
    provider: string,
    providerSubscriptionId: string
  ): Promise<SubscriptionRecord | null> {
    for (const subscriptions of this.subscriptionsByUser.values()) {
      const found = subscriptions.find(
        (item) =>
          item.provider === provider && item.provider_subscription_id === providerSubscriptionId
      );

      if (found) {
        return found;
      }
    }

    return null;
  }

  async findByProviderCustomerId(provider: string, providerCustomerId: string): Promise<SubscriptionRecord | null> {
    const matches: SubscriptionRecord[] = [];

    for (const subscriptions of this.subscriptionsByUser.values()) {
      for (const row of subscriptions) {
        if (row.provider === provider && row.provider_customer_id === providerCustomerId) {
          matches.push(row);
        }
      }
    }

    matches.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    return matches[0] ?? null;
  }

  async ensureCustomerLink(input: {
    user_id: string;
    provider: string;
    provider_customer_id: string;
  }): Promise<SubscriptionRecord> {
    const existing = this
      .listByUser(input.user_id)
      .find(
        (row) =>
          row.provider === input.provider && row.provider_customer_id === input.provider_customer_id
      );

    if (existing) {
      return existing;
    }

    const created: SubscriptionRecord = {
      id: randomUUID(),
      user_id: input.user_id,
      provider: input.provider,
      provider_customer_id: input.provider_customer_id,
      provider_subscription_id: null,
      plan_code: "free",
      status: "inactive",
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    this.save(input.user_id, [...this.listByUser(input.user_id), created]);

    return created;
  }

  async upsertProviderSubscription(input: SyncSubscriptionInput): Promise<SubscriptionRecord> {
    const rows = this.listByUser(input.user_id);
    const existingIndex = rows.findIndex(
      (row) =>
        row.provider === input.provider &&
        row.provider_subscription_id === input.provider_subscription_id
    );

    if (existingIndex >= 0) {
      const existing = rows[existingIndex];
      const updated: SubscriptionRecord = {
        ...existing,
        provider_customer_id: input.provider_customer_id,
        plan_code: input.plan_code,
        status: input.status,
        current_period_start: input.current_period_start,
        current_period_end: input.current_period_end,
        cancel_at_period_end: input.cancel_at_period_end,
        updated_at: nowIso()
      };

      rows[existingIndex] = updated;
      this.save(input.user_id, rows);
      return updated;
    }

    const created: SubscriptionRecord = {
      id: randomUUID(),
      user_id: input.user_id,
      provider: input.provider,
      provider_customer_id: input.provider_customer_id,
      provider_subscription_id: input.provider_subscription_id,
      plan_code: input.plan_code,
      status: input.status,
      current_period_start: input.current_period_start,
      current_period_end: input.current_period_end,
      cancel_at_period_end: input.cancel_at_period_end,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    this.save(input.user_id, [...rows, created]);
    return created;
  }

  async deactivateOtherActiveSubscriptions(
    userId: string,
    provider: string,
    keepProviderSubscriptionId: string | null
  ): Promise<void> {
    const updatedRows = this.listByUser(userId).map((row) => {
      if (row.provider !== provider) {
        return row;
      }

      if (row.status !== "active" && row.status !== "trialing") {
        return row;
      }

      if (keepProviderSubscriptionId && row.provider_subscription_id === keepProviderSubscriptionId) {
        return row;
      }

      return {
        ...row,
        status: "inactive",
        updated_at: nowIso()
      };
    });

    this.save(userId, updatedRows);
  }
}

export class InMemoryUsageRepository implements UsageRepository {
  private readonly rows = new Map<string, UsageCounterRecord>();

  async getOrCreateCurrentMonth(userId: string): Promise<UsageCounterRecord> {
    const periodMonth = getCurrentPeriodMonthUtc();
    const key = `${userId}:${periodMonth}`;
    const existing = this.rows.get(key);

    if (existing) {
      const updatedExisting = {
        ...existing,
        updated_at: nowIso()
      };
      this.rows.set(key, updatedExisting);
      return updatedExisting;
    }

    const created: UsageCounterRecord = {
      id: randomUUID(),
      user_id: userId,
      period_month: periodMonth,
      tailored_cv_generations_count: 0,
      exports_count: 0,
      ai_actions_count: 0,
      storage_bytes_used: 0,
      updated_at: nowIso()
    };

    this.rows.set(key, created);
    return created;
  }

  async incrementCurrentMonth(
    userId: string,
    input: UsageCounterIncrementInput
  ): Promise<UsageCounterRecord> {
    const current = await this.getOrCreateCurrentMonth(userId);

    const updated: UsageCounterRecord = {
      ...current,
      tailored_cv_generations_count:
        current.tailored_cv_generations_count + (input.tailored_cv_generations_increment ?? 0),
      exports_count: current.exports_count + (input.exports_increment ?? 0),
      ai_actions_count: current.ai_actions_count + (input.ai_actions_increment ?? 0),
      storage_bytes_used: current.storage_bytes_used + (input.storage_bytes_delta ?? 0),
      updated_at: nowIso()
    };

    this.rows.set(`${updated.user_id}:${updated.period_month}`, updated);
    return updated;
  }
}

export class FakeAuthProvider implements AuthProvider {
  constructor(private readonly tokenMap: Record<string, AuthIdentity>) {}

  async getIdentityFromToken(accessToken: string): Promise<AuthIdentity | null> {
    return this.tokenMap[accessToken] ?? null;
  }
}

export class InMemoryDashboardRepository implements DashboardRepository {
  private summaryByUser = new Map<string, DashboardSummarySnapshot>();
  private activityByUser = new Map<string, DashboardActivityItem[]>();

  setSummary(userId: string, summary: DashboardSummarySnapshot): void {
    this.summaryByUser.set(userId, summary);
  }

  setActivity(userId: string, activity: DashboardActivityItem[]): void {
    this.activityByUser.set(userId, activity);
  }

  async getSummarySnapshot(userId: string): Promise<DashboardSummarySnapshot> {
    return (
      this.summaryByUser.get(userId) ??
      {
        master_total_count: 0,
        primary_master_cv: null as DashboardMasterCvItem | null,
        tailored_total_count: 0,
        recent_tailored_cvs: [] as DashboardTailoredCvItem[],
        jobs_total_count: 0,
        jobs_counts_by_status: {
          saved: 0,
          applied: 0,
          interview: 0,
          offer: 0,
          rejected: 0,
          archived: 0
        } as DashboardJobStatusCounts,
        recent_jobs: [] as DashboardJobItem[]
      }
    );
  }

  async getRecentActivity(userId: string, limit: number): Promise<DashboardActivityItem[]> {
    return (this.activityByUser.get(userId) ?? []).slice(0, limit);
  }
}

export class FakeDatabaseHealthChecker implements DatabaseHealthCheckerPort {
  constructor(private readonly status: Pick<DatabaseHealthStatus, "connected">) {}

  async check(): Promise<DatabaseHealthStatus> {
    return {
      connected: this.status.connected,
      checked_at: nowIso()
    };
  }
}

export const createTestConfig = (): AppConfig => {
  return {
    appName: "cv-builder-backend-test",
    appEnv: "test",
    appVersion: "0.1.0-test",
    port: 9999,
    logLevel: "silent",
    frontendAppUrl: "http://localhost:5173",
    ai: {
      provider: "mock",
      defaultModel: "mock-cv-builder-v1",
      promptProfile: "phase3-v1"
    },
    exports: {
      storageBucket: "exports",
      downloadUrlTtlSeconds: 600
    },
    billing: {
      provider: "stripe",
      stripeSecretKey: null,
      stripeWebhookSecret: null,
      stripeProPriceId: "price_pro_monthly",
      checkoutSuccessUrl: "http://localhost:5173/pricing?checkout=success",
      checkoutCancelUrl: "http://localhost:5173/pricing?checkout=cancel",
      portalReturnUrl: "http://localhost:5173/account/billing"
    },
    supabase: {
      url: "https://example.supabase.co",
      anonKey: "anon_key",
      serviceRoleKey: "service_role_key"
    }
  };
};
