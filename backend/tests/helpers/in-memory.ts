import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../src/shared/config/env";
import { getCurrentPeriodMonthUtc } from "../../src/shared/utils/date";
import type { AuthIdentity, AuthProvider } from "../../src/modules/auth/auth.types";
import type { SubscriptionsRepository } from "../../src/modules/users/subscriptions.repository";
import type { UsageRepository } from "../../src/modules/users/usage.repository";
import type { UsersRepository } from "../../src/modules/users/users.repository";
import type {
  SubscriptionRecord,
  UsageCounterRecord,
  UserRecord
} from "../../src/shared/types/domain";
import type {
  DashboardActivityItem,
  DashboardCounts
} from "../../src/modules/dashboard/dashboard.types";
import type { DashboardRepository } from "../../src/modules/dashboard/dashboard.repository";
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

export class InMemorySubscriptionsRepository implements SubscriptionsRepository {
  private readonly subscriptionsByUser = new Map<string, SubscriptionRecord[]>();

  seed(subscription: SubscriptionRecord): void {
    const existing = this.subscriptionsByUser.get(subscription.user_id) ?? [];
    this.subscriptionsByUser.set(subscription.user_id, [...existing, subscription]);
  }

  async getCurrentForUser(userId: string): Promise<SubscriptionRecord | null> {
    const subscriptions = this.subscriptionsByUser.get(userId) ?? [];

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

    const latest = [...subscriptions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return latest[0] ?? null;
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
}

export class FakeAuthProvider implements AuthProvider {
  constructor(private readonly tokenMap: Record<string, AuthIdentity>) {}

  async getIdentityFromToken(accessToken: string): Promise<AuthIdentity | null> {
    return this.tokenMap[accessToken] ?? null;
  }
}

export class InMemoryDashboardRepository implements DashboardRepository {
  private countsByUser = new Map<string, DashboardCounts>();
  private activityByUser = new Map<string, DashboardActivityItem[]>();

  setCounts(userId: string, counts: DashboardCounts): void {
    this.countsByUser.set(userId, counts);
  }

  setActivity(userId: string, activity: DashboardActivityItem[]): void {
    this.activityByUser.set(userId, activity);
  }

  async getPlaceholderCounts(userId: string): Promise<DashboardCounts> {
    return (
      this.countsByUser.get(userId) ?? {
        master_cvs: 0,
        tailored_cvs: 0,
        jobs: 0,
        exports: 0
      }
    );
  }

  async getRecentActivity(userId: string): Promise<DashboardActivityItem[]> {
    return this.activityByUser.get(userId) ?? [];
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
    supabase: {
      url: "https://example.supabase.co",
      anonKey: "anon_key",
      serviceRoleKey: "service_role_key"
    }
  };
};
