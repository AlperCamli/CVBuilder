import pino from "pino";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import type { AlertEventStatus, AlertRuleInput, AlertRulePatch } from "../src/modules/admin-analytics/admin-alerts.contract";
import type { CatalogEntry, MetricParams, PeopleParams } from "../src/modules/admin-analytics/admin-analytics.contract";
import type {
  AdminAnalyticsRepository,
  AdminWriteContext,
  AuditEntry,
  PeopleSession,
  RecomputeRequestResult
} from "../src/modules/admin-analytics/admin-analytics.repository";
import { AdminAnalyticsService } from "../src/modules/admin-analytics/admin-analytics.service";
import { SupabaseAdminIdentityProvider, type AdminIdentityProvider } from "../src/modules/admin-analytics/admin-identity";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { SystemService } from "../src/modules/system/system.service";
import { UsageService } from "../src/modules/usage/usage.service";
import { UsersService } from "../src/modules/users/users.service";
import type { AnalyticsQueryResult, AnalyticsRow } from "../src/shared/db/analytics-db";
import { analyticsSslOption } from "../src/shared/db/analytics-db";
import { SUPABASE_ROOT_CA } from "../src/shared/db/supabase-root-ca";
import { isAdminEmail, isAdminIdentity, type AdminIdentity } from "../src/shared/middleware/require-admin";
import { X509Certificate } from "node:crypto";
import {
  FakeAuthProvider,
  FakeDatabaseHealthChecker,
  InMemoryDashboardRepository,
  InMemorySubscriptionsRepository,
  InMemoryUsageRepository,
  InMemoryUsersRepository,
  createTestConfig
} from "./helpers/in-memory";

const meta = {
  title: "Signups",
  definition: "New accounts",
  unit: "count",
  shape: "timeseries",
  breakdowns: ["market"],
  filters: ["market", "plan"]
} as const;

const RULE_ID = "6c1d2b0e-3f4a-4b5c-8d9e-0f1a2b3c4d5e";

const CATALOG: CatalogEntry[] = [
  { name: "signups", kind: "metric", meta: { ...meta, breakdowns: [...meta.breakdowns], filters: [...meta.filters] } },
  { name: "search_users", kind: "people", meta: { ...meta, breakdowns: [], filters: [] } },
  { name: "user_timeline", kind: "people", meta: { ...meta, breakdowns: [], filters: [] } }
];

class FakeAnalyticsRepository implements AdminAnalyticsRepository {
  catalogCalls = 0;
  calls: { name: string; params: MetricParams }[] = [];
  result: AnalyticsQueryResult = {
    columns: ["bucket", "users"],
    rows: [{ bucket: "2026-01-01", users: 3 }]
  };
  error: unknown = null;

  catalog: CatalogEntry[] = CATALOG;

  async listCatalog(): Promise<CatalogEntry[]> {
    this.catalogCalls += 1;
    return this.catalog;
  }

  async callMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult> {
    this.calls.push({ name, params });
    if (this.error) throw this.error;
    return this.result;
  }

  // People: records the transaction steps in order.
  events: string[] = [];
  audits: AuditEntry[] = [];
  peopleCalls: { name: string; params: PeopleParams }[] = [];
  auditError: unknown = null;
  peopleError: unknown = null;
  peopleResult: (params: PeopleParams) => AnalyticsQueryResult = () => ({
    columns: ["user_id", "email", "cursor"],
    rows: [{ user_id: "u1", email: "a@example.invalid", cursor: "1~5|u1" }]
  });

  async withAuditedPeople<T>(audit: AuditEntry, work: (session: PeopleSession) => Promise<T>): Promise<T> {
    this.events.push("begin");
    try {
      this.events.push("audit");
      this.audits.push(audit);
      if (this.auditError) throw this.auditError;
      const result = await work({
        call: async (name, params) => {
          this.events.push(`call:${name}`);
          this.peopleCalls.push({ name, params });
          if (this.peopleError) throw this.peopleError;
          return this.peopleResult(params);
        }
      });
      this.events.push("commit");
      return result;
    } catch (error) {
      this.events.push("rollback");
      throw error;
    }
  }

  // Phase 5: each write is one admin_app call that validates, writes and audits in one transaction.
  writes: { op: string; context: AdminWriteContext | { adminEmail: string }; args: unknown[] }[] = [];
  writeError: unknown = null;
  readError: unknown = null;
  rules: AnalyticsRow[] = [{ id: RULE_ID, name: "AI failure rate", window: "1d", threshold: 0.1 }];
  alertEvents: AnalyticsRow[] = [{ id: 7, rule_id: RULE_ID, rule_name: "AI failure rate", metric: "kpi_health" }];
  eventCalls: { status: AlertEventStatus; limit: number }[] = [];
  summary: AnalyticsRow = { open_count: 2, latest_fired_at: new Date("2026-11-15T10:00:00Z") };
  recompute: RecomputeRequestResult = { status: "queued", run_id: 12, retry_after_seconds: 0 };
  status: AnalyticsRow | null = { run_id: 12, kind: "recompute", status: "pending", open_run_id: 12, retry_after_seconds: 300 };
  auditRows: AnalyticsRow[] = [
    {
      id: 2,
      at: new Date("2026-11-15T10:00:00Z"),
      admin_email: "admin@cvbuilder.dev",
      action: "export.csv",
      target_user_id: null,
      params: { function: "search_users", query_hmac: "abc" },
      request_id: "req-1",
      people_function: "search_users"
    }
  ];
  auditLimits: number[] = [];

  private async inWrite<T>(op: string, context: AdminWriteContext | { adminEmail: string }, args: unknown[], result: () => T): Promise<T> {
    this.events.push("begin", `write:${op}`);
    this.writes.push({ op, context, args });
    if (this.writeError) {
      this.events.push("rollback");
      throw this.writeError;
    }
    this.events.push("commit");
    return result();
  }

  private async inRead<T>(op: string, result: () => T): Promise<T> {
    this.events.push(`read:${op}`);
    if (this.readError) throw this.readError;
    return result();
  }

  listAlertRules() {
    return this.inRead("list_alert_rules", () => this.rules);
  }
  createAlertRule(context: AdminWriteContext, rule: AlertRuleInput) {
    return this.inWrite("create_alert_rule", context, [rule], () => ({ id: RULE_ID, ...rule }) as AnalyticsRow);
  }
  updateAlertRule(context: AdminWriteContext, id: string, patch: AlertRulePatch) {
    return this.inWrite("update_alert_rule", context, [id, patch], () => ({ ...this.rules[0], ...patch, id }) as AnalyticsRow);
  }
  async deleteAlertRule(context: AdminWriteContext, id: string) {
    await this.inWrite("delete_alert_rule", context, [id], () => undefined);
  }
  listAlertEvents(status: AlertEventStatus, limit: number) {
    this.eventCalls.push({ status, limit });
    return this.inRead("list_alert_events", () => this.alertEvents);
  }
  ackAlertEvent(context: AdminWriteContext, id: string) {
    return this.inWrite("ack_alert_event", context, [id], () => ({ id: Number(id), acknowledged_by: context.adminEmail.toLowerCase() }) as AnalyticsRow);
  }
  alertSummary() {
    return this.inRead("alert_summary", () => this.summary);
  }
  requestRecompute(adminEmail: string) {
    return this.inWrite("request_recompute", { adminEmail }, [], () => this.recompute);
  }
  recomputeStatus() {
    return this.inRead("recompute_status", () => this.status);
  }
  async readAuditRecent(audit: AuditEntry, limit: number) {
    this.events.push("begin", "audit");
    this.audits.push(audit);
    this.auditLimits.push(limit);
    try {
      if (this.auditError) throw this.auditError;
      this.events.push("read:audit_recent");
      if (this.readError) throw this.readError;
      this.events.push("commit");
      return this.auditRows;
    } catch (error) {
      this.events.push("rollback");
      throw error;
    }
  }
}

const pgError = (code: string, message: string) => Object.assign(new Error(message), { name: "PostgresError", code });

const ADMIN_EMAIL = "admin@cvbuilder.dev";

const identity = (email: string, providers: string[], authMethods: string[]): AdminIdentity => ({
  authUserId: `auth-${email}-${providers.join("+")}-${authMethods.join("+")}`,
  email,
  providers,
  authMethods
});

const ADMIN_IDENTITIES: Record<string, AdminIdentity> = {
  "admin-token": identity("Admin@CVBuilder.dev", ["google"], ["oauth"]),
  "user-token": identity("tester@cvbuilder.dev", ["google"], ["oauth"]),
  "password-admin-token": identity(ADMIN_EMAIL, ["email"], ["password"]),
  "linked-password-token": identity(ADMIN_EMAIL, ["email", "google"], ["password"]),
  "github-admin-token": identity(ADMIN_EMAIL, ["github"], ["oauth"]),
  // The product account still carries the old admin address; the live identity does not.
  "stale-token": identity("former@cvbuilder.dev", ["google"], ["oauth"])
};

class FakeAdminIdentityProvider implements AdminIdentityProvider {
  calls = 0;

  async getIdentity(accessToken: string): Promise<AdminIdentity | null> {
    this.calls += 1;
    return ADMIN_IDENTITIES[accessToken] ?? null;
  }
}

const buildTestApp = (
  repository: AdminAnalyticsRepository | null,
  options: { production?: boolean; logger?: { error: ReturnType<typeof vi.fn> }; appLogger?: pino.Logger } = {}
) => {
  const config = createTestConfig();
  config.adminEmails = [ADMIN_EMAIL];
  if (options.production) config.appEnv = "production";
  const usersRepository = new InMemoryUsersRepository();
  const ensureByAuthIdentity = vi.spyOn(usersRepository, "ensureByAuthIdentity");
  const authProvider = new FakeAuthProvider({
    "stale-token": {
      auth_user_id: "00000000-0000-0000-0000-0000000000c3",
      email: ADMIN_EMAIL,
      full_name: "Former Admin",
      locale: "en"
    }
  });
  const identityProvider = new FakeAdminIdentityProvider();
  const entitlementsService = new EntitlementsService(
    createPlanCatalog({
      proStripePriceId: config.billing.stripeProPriceId,
      lifetimeStripePriceId: config.billing.stripeLifetimePriceId
    })
  );
  const billingService = new BillingService(
    usersRepository,
    new InMemorySubscriptionsRepository(),
    new UsageService(new InMemoryUsageRepository()),
    entitlementsService,
    null,
    {
      provider: config.billing.provider,
      checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
      checkoutCancelUrl: config.billing.checkoutCancelUrl,
      portalReturnUrl: config.billing.portalReturnUrl,
      stripeWebhookSecret: config.billing.stripeWebhookSecret,
      trialPeriodDays: config.billing.trialPeriodDays
    }
  );
  const usersService = new UsersService(usersRepository, billingService);

  const app = createApp({
    config,
    ...(options.appLogger ? { logger: options.appLogger } : {}),
    services: {
      authService: new AuthService(authProvider, usersRepository),
      usersService,
      dashboardService: new DashboardService(usersService, new InMemoryDashboardRepository()),
      systemService: new SystemService(config, new FakeDatabaseHealthChecker({ connected: true })),
      adminAnalyticsService: new AdminAnalyticsService(repository, { adminEmails: config.adminEmails, logger: options.logger }),
      adminIdentityProvider: identityProvider
    }
  });
  return Object.assign(app, { ensureByAuthIdentity, identityProvider });
};

const asAdmin = (app: ReturnType<typeof buildTestApp>, path: string) =>
  request(app).get(`/api/v1${path}`).set("Authorization", "Bearer admin-token");

describe("isAdminEmail", () => {
  it("compares trimmed, lowercased emails", () => {
    expect(isAdminEmail(" Admin@Example.com ", ["admin@example.com"])).toBe(true);
    expect(isAdminEmail("admin@example.com", [" ADMIN@example.com"])).toBe(true);
    expect(isAdminEmail("other@example.com", ["admin@example.com"])).toBe(false);
    expect(isAdminEmail("", [""])).toBe(false);
    expect(isAdminEmail(null, ["admin@example.com"])).toBe(false);
    expect(isAdminEmail(undefined, [])).toBe(false);
  });
});

describe("isAdminIdentity", () => {
  it("requires an admin email, an OAuth session and a linked Google identity", () => {
    const admins = [ADMIN_EMAIL];
    expect(isAdminIdentity(identity(" ADMIN@cvbuilder.dev ", ["email", "google"], ["oauth"]), admins)).toBe(true);
    expect(isAdminIdentity(identity(ADMIN_EMAIL, ["google"], ["password"]), admins)).toBe(false);
    expect(isAdminIdentity(identity(ADMIN_EMAIL, ["github"], ["oauth"]), admins)).toBe(false);
    expect(isAdminIdentity(identity("someone@cvbuilder.dev", ["google"], ["oauth"]), admins)).toBe(false);
    expect(isAdminIdentity(undefined, admins)).toBe(false);
  });
});

describe("SupabaseAdminIdentityProvider", () => {
  const token = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
  const client = (result: unknown) => {
    const getUser = vi.fn(async () => result);
    return { getUser, provider: new SupabaseAdminIdentityProvider({ auth: { getUser } } as never) };
  };

  it("reads the verified user's providers and the session's amr methods", async () => {
    const { getUser, provider } = client({
      data: {
        user: {
          id: "auth-1",
          email: "Admin@CVBuilder.dev",
          app_metadata: { provider: "email", providers: ["email", "google"] },
          identities: [{ provider: "email" }]
        }
      },
      error: null
    });
    const accessToken = token({ amr: [{ method: "oauth", timestamp: 1 }, "password"] });

    expect(await provider.getIdentity(accessToken)).toEqual({
      authUserId: "auth-1",
      email: "Admin@CVBuilder.dev",
      providers: ["email", "google"],
      authMethods: ["oauth", "password"]
    });
    expect(getUser).toHaveBeenCalledWith(accessToken);
  });

  it("returns null when Supabase rejects the token", async () => {
    const { provider } = client({ data: { user: null }, error: { message: "invalid JWT" } });
    expect(await provider.getIdentity(token({ amr: [{ method: "oauth" }] }))).toBeNull();
  });

  it("treats an unreadable amr claim as no methods", async () => {
    const { provider } = client({ data: { user: { id: "auth-2", email: "a@b.c", app_metadata: {}, identities: [] } }, error: null });
    expect((await provider.getIdentity("not-a-jwt"))?.authMethods).toEqual([]);
  });
});

describe("analytics database TLS", () => {
  it("pins Supabase's root CA for remote hosts and skips TLS only locally", () => {
    expect(analyticsSslOption("postgres://analytics_api.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")).toEqual({
      ca: SUPABASE_ROOT_CA,
      rejectUnauthorized: true
    });
    expect(analyticsSslOption("postgres://u:p@localhost:5432/postgres")).toBe(false);
    expect(analyticsSslOption("postgres://u:p@127.0.0.1:5432/postgres")).toBe(false);
    expect(analyticsSslOption("not a url")).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
  });

  it("embeds the expected Supabase Root 2021 CA", () => {
    expect(new X509Certificate(SUPABASE_ROOT_CA).fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
    );
  });
});

describe("admin analytics endpoints", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("requires a token on every admin route", async () => {
    const app = buildTestApp(new FakeAnalyticsRepository());
    for (const path of ["/admin/me", "/admin/catalog", "/admin/metrics/signups"]) {
      const response = await request(app).get(`/api/v1${path}`);
      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("reports admin status from the live identity without creating a product account", async () => {
    const app = buildTestApp(null);

    const admin = await asAdmin(app, "/admin/me");
    expect(admin.status).toBe(200);
    expect(admin.headers["cache-control"]).toBe("no-store");
    expect(admin.body).toEqual({ success: true, data: { email: "Admin@CVBuilder.dev", is_admin: true } });

    const user = await request(app).get("/api/v1/admin/me").set("Authorization", "Bearer user-token");
    expect(user.status).toBe(200);
    expect(user.body.data).toEqual({ email: "tester@cvbuilder.dev", is_admin: false });

    expect((await request(app).get("/api/v1/admin/me").set("Authorization", "Bearer bad-token")).status).toBe(401);
    expect(app.ensureByAuthIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ["a password session", "password-admin-token"],
    ["a password session on a Google-linked account", "linked-password-token"],
    ["a non-Google OAuth session", "github-admin-token"]
  ])("does not treat %s with an admin email as admin", async (_label, token) => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);

    const me = await request(app).get("/api/v1/admin/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ email: ADMIN_EMAIL, is_admin: false });

    for (const path of ["/admin/catalog", "/admin/metrics/signups"]) {
      const response = await request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(403);
    }
    expect(repository.calls).toHaveLength(0);
  });

  it("ignores a stale admin email on the product account", async () => {
    const app = buildTestApp(new FakeAnalyticsRepository());

    // A product request creates public.users with the old admin address.
    await request(app).get("/api/v1/dashboard").set("Authorization", "Bearer stale-token");
    expect(app.ensureByAuthIdentity).toHaveBeenCalledTimes(1);

    const me = await request(app).get("/api/v1/admin/me").set("Authorization", "Bearer stale-token");
    expect(me.body.data).toEqual({ email: "former@cvbuilder.dev", is_admin: false });
    const metrics = await request(app).get("/api/v1/admin/metrics/signups").set("Authorization", "Bearer stale-token");
    expect(metrics.status).toBe(403);
    expect(app.ensureByAuthIdentity).toHaveBeenCalledTimes(1);
  });

  it("rate-limits /admin by IP before verifying the token", async () => {
    vi.stubEnv("VERCEL", "");
    const app = buildTestApp(new FakeAnalyticsRepository(), { production: true });
    for (let index = 0; index < 300; index++) {
      expect((await request(app).get("/api/v1/admin/me")).status).toBe(401);
    }
    const limited = await request(app).get("/api/v1/admin/me").set("Authorization", "Bearer admin-token");
    expect(limited.status).toBe(429);
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(app.identityProvider.calls).toBe(0);
  }, 30_000);

  it("forbids non-admins from catalog and metrics", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    for (const path of ["/admin/catalog", "/admin/metrics/signups"]) {
      const response = await request(app).get(`/api/v1${path}`).set("Authorization", "Bearer user-token");
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(repository.catalogCalls).toBe(0);
    expect(repository.calls).toHaveLength(0);
  });

  it("returns the catalog and caches it per instance", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);

    const first = await asAdmin(app, "/admin/catalog");
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toEqual({ success: true, data: { metrics: CATALOG } });

    await asAdmin(app, "/admin/catalog");
    await asAdmin(app, "/admin/metrics/signups");
    expect(repository.catalogCalls).toBe(1);
  });

  it("applies the documented defaults", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T23:30:00Z"));
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);

    const response = await asAdmin(app, "/admin/metrics/signups");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      success: true,
      data: { metric: "signups", rows: [{ bucket: "2026-01-01", users: 3 }], generated_at: "2026-03-10T23:30:00.000Z" }
    });
    expect(repository.calls).toEqual([
      {
        name: "signups",
        params: {
          from: "2026-02-09",
          to: "2026-03-10",
          grain: "day",
          currency: "usd",
          includeInternal: false,
          breakdown: null,
          filters: {}
        }
      }
    ]);
  });

  it("passes explicit parameters through", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const filters = encodeURIComponent(JSON.stringify({ market: ["TR", "US"], plan: "monthly" }));

    const response = await asAdmin(
      app,
      `/admin/metrics/signups?from=2023-01-01&to=2026-01-01&grain=week&currency=try&include_internal=1&breakdown=market&filters=${filters}`
    );

    expect(response.status).toBe(200);
    expect(repository.calls[0]?.params).toEqual({
      from: "2023-01-01",
      to: "2026-01-01",
      grain: "week",
      currency: "try",
      includeInternal: true,
      breakdown: "market",
      filters: { market: ["TR", "US"], plan: "monthly" }
    });
  });

  it.each([
    ["from after to", "/admin/metrics/signups?from=2026-02-01&to=2026-01-01"],
    ["span over 1096 days", "/admin/metrics/signups?from=2022-12-31&to=2026-01-01"],
    ["impossible date", "/admin/metrics/signups?from=2026-02-30&to=2026-03-01"],
    ["malformed date", "/admin/metrics/signups?to=20260101"],
    ["bad grain", "/admin/metrics/signups?grain=hour"],
    ["bad currency", "/admin/metrics/signups?currency=eur"],
    ["bad include_internal", "/admin/metrics/signups?include_internal=yes"],
    ["bad breakdown", "/admin/metrics/signups?breakdown=country"],
    ["bad format", "/admin/metrics/signups?format=xlsx"],
    ["filters not JSON", "/admin/metrics/signups?filters=%7Bmarket"],
    ["filters not an object", `/admin/metrics/signups?filters=${encodeURIComponent("[\"TR\"]")}`],
    ["bad filters key", `/admin/metrics/signups?filters=${encodeURIComponent(JSON.stringify({ country: "TR" }))}`],
    ["nested filter value", `/admin/metrics/signups?filters=${encodeURIComponent(JSON.stringify({ market: { eq: "TR" } }))}`],
    ["empty filter array", `/admin/metrics/signups?filters=${encodeURIComponent(JSON.stringify({ market: [] }))}`],
    ["too many filter values", `/admin/metrics/signups?filters=${encodeURIComponent(JSON.stringify({ market: Array.from({ length: 51 }, (_, i) => `M${i}`) }))}`],
    ["filters as a query object", "/admin/metrics/signups?filters[market]=TR"],
    ["repeated param", "/admin/metrics/signups?grain=day&grain=week"],
    ["bad name (uppercase)", "/admin/metrics/Signups"],
    ["bad name (symbols)", "/admin/metrics/sign-ups"],
    ["bad name (too long)", `/admin/metrics/a${"b".repeat(63)}`]
  ])("rejects %s with 400", async (_label, path) => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);

    const response = await asAdmin(app, path);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(repository.calls).toHaveLength(0);
  });

  it("accepts exactly 50 filter values", async () => {
    const repository = new FakeAnalyticsRepository();
    const filters = encodeURIComponent(JSON.stringify({ market: Array.from({ length: 50 }, (_, i) => `M${i}`) }));
    const response = await asAdmin(buildTestApp(repository), `/admin/metrics/signups?filters=${filters}`);
    expect(response.status).toBe(200);
  });

  it("returns 404 for metrics missing from the catalog or of another kind", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    for (const name of ["unknown_metric", "search_users"]) {
      const response = await asAdmin(app, `/admin/metrics/${name}`);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
    expect(repository.calls).toHaveLength(0);
  });

  it.each([
    ["22023", 400, "VALIDATION_ERROR"],
    ["57014", 504, "ANALYTICS_TIMEOUT"],
    ["08006", 503, "ANALYTICS_UNAVAILABLE"],
    ["28P01", 503, "ANALYTICS_UNAVAILABLE"],
    ["53300", 503, "ANALYTICS_UNAVAILABLE"],
    ["57P01", 503, "ANALYTICS_UNAVAILABLE"],
    ["CONNECT_TIMEOUT", 503, "ANALYTICS_UNAVAILABLE"],
    ["CONNECTION_CLOSED", 503, "ANALYTICS_UNAVAILABLE"],
    ["ECONNREFUSED", 503, "ANALYTICS_UNAVAILABLE"],
    ["ENOTFOUND", 503, "ANALYTICS_UNAVAILABLE"],
    ["SELF_SIGNED_CERT_IN_CHAIN", 503, "ANALYTICS_UNAVAILABLE"],
    ["XX000", 500, "INTERNAL_ERROR"]
  ])("maps error code %s to %s", async (code, status, errorCode) => {
    const repository = new FakeAnalyticsRepository();
    const logger = { error: vi.fn() };
    repository.error = pgError(code, "Unsupported breakdown: plan");
    const response = await asAdmin(buildTestApp(repository, { logger }), "/admin/metrics/signups");

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(errorCode);
    expect(response.headers["cache-control"]).toBe("no-store");
    if (code === "22023") {
      expect(response.body.error.message).toBe("Unsupported breakdown: plan");
      expect(logger.error).not.toHaveBeenCalled();
    } else {
      expect(logger.error).toHaveBeenCalledWith(
        { code, message: "Unsupported breakdown: plan", metric: "signups" },
        "Admin analytics query failed"
      );
    }
  });

  it("logs and returns 503 when the catalog cannot be reached", async () => {
    const repository = new FakeAnalyticsRepository();
    const logger = { error: vi.fn() };
    repository.listCatalog = async () => {
      throw pgError("ECONNRESET", "read ECONNRESET");
    };
    const response = await asAdmin(buildTestApp(repository, { logger }), "/admin/catalog");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ANALYTICS_UNAVAILABLE");
    expect(logger.error).toHaveBeenCalledWith({ code: "ECONNRESET", message: "read ECONNRESET", metric: null }, "Admin analytics query failed");
  });

  it("returns 404 on 42883 when the metric was dropped", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    await asAdmin(app, "/admin/catalog");
    repository.catalog = CATALOG.filter((entry) => entry.name !== "signups");
    repository.error = pgError("42883", "function analytics.signups(...) does not exist");

    const response = await asAdmin(app, "/admin/metrics/signups");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(repository.catalogCalls).toBe(2);
  });

  it("returns 500 on 42883 raised inside a metric that still exists", async () => {
    const repository = new FakeAnalyticsRepository();
    const logger = { error: vi.fn() };
    repository.error = pgError("42883", "function analytics_private.missing_helper() does not exist");

    const response = await asAdmin(buildTestApp(repository, { logger }), "/admin/metrics/signups");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(repository.catalogCalls).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      { code: "42883", message: "function analytics_private.missing_helper() does not exist", metric: "signups" },
      "Admin analytics query failed"
    );
  });

  it("returns 503 when the analytics database is not configured", async () => {
    const app = buildTestApp(null);
    for (const path of ["/admin/catalog", "/admin/metrics/signups"]) {
      const response = await asAdmin(app, path);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("ANALYTICS_UNAVAILABLE");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("exports CSV with RFC 4180 quoting and formula neutralisation", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.result = {
      columns: ["bucket", "label", "amount", "at", "extra"],
      rows: [
        { bucket: "2026-01-01", label: "plain", amount: -5, at: new Date("2026-01-02T03:04:05Z"), extra: null },
        { bucket: "2026-01-02", label: "a,b", amount: 1.5, at: null, extra: { k: "v" } },
        { bucket: "2026-01-03", label: "say \"hi\"", amount: 0, at: null, extra: "line1\nline2" },
        { bucket: "2026-01-04", label: "=SUM(A1:A2)", amount: 2, at: null, extra: "+1" },
        { bucket: "2026-01-05", label: "-2", amount: 3, at: null, extra: "@cmd" },
        { bucket: "2026-01-06", label: "\tTab", amount: 4, at: null, extra: "\rCR" },
        { bucket: "2026-01-07", label: "=1,\"x\"", amount: 5, at: null, extra: true }
      ]
    };

    const response = await asAdmin(
      buildTestApp(repository),
      "/admin/metrics/signups?from=2026-01-01&to=2026-01-31&format=csv"
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="signups_2026-01-01_2026-01-31.csv"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).toBe(
      [
        "\uFEFFbucket,label,amount,at,extra",
        "2026-01-01,plain,-5,2026-01-02T03:04:05.000Z,",
        "2026-01-02,\"a,b\",1.5,,\"{\"\"k\"\":\"\"v\"\"}\"",
        "2026-01-03,\"say \"\"hi\"\"\",0,,\"line1\nline2\"",
        "2026-01-04,'=SUM(A1:A2),2,,'+1",
        "2026-01-05,'-2,3,,'@cmd",
        "2026-01-06,'\tTab,4,,\"'\rCR\"",
        "2026-01-07,\"'=1,\"\"x\"\"\",5,,true",
        ""
      ].join("\r\n")
    );
  });

  it("writes a header row for an empty CSV result", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.result = { columns: ["bucket", "users"], rows: [] };
    const response = await asAdmin(buildTestApp(repository), "/admin/metrics/signups?format=csv");
    expect(response.status).toBe(200);
    expect(response.text).toBe("\uFEFFbucket,users\r\n");
  });
});

describe("admin people endpoint", () => {
  const SEARCH = "/admin/people/search_users";
  const TIMELINE = "/admin/people/user_timeline";
  const USER_ID = "4f2b8a8e-8a51-4a7c-9d1e-2b4b3f1c9a10";

  const page = (count: number, start = 0): AnalyticsQueryResult => ({
    columns: ["user_id", "value", "cursor"],
    rows: Array.from({ length: count }, (_, index) => ({ user_id: `u${start + index}`, value: start + index, cursor: `c${start + index}` }))
  });

  const post = (app: ReturnType<typeof buildTestApp>, path: string, body: unknown, token = "admin-token") =>
    request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body as object);

  it("requires a token and an admin, and audits nothing for them", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const anonymous = await request(app).post(`/api/v1${SEARCH}`).send({ q: "findme" });
    expect(anonymous.status).toBe(401);
    const user = await post(app, SEARCH, { q: "findme" }, "user-token");
    expect(user.status).toBe(403);
    expect(user.body.error.code).toBe("FORBIDDEN");
    expect(user.headers["cache-control"]).toBe("no-store");
    expect(repository.events).toEqual([]);
  });

  it("no longer serves people functions over GET", async () => {
    const repository = new FakeAnalyticsRepository();
    const response = await asAdmin(buildTestApp(repository), `${SEARCH}?q=findme`);
    expect(response.status).toBe(404);
    expect(repository.events).toEqual([]);
  });

  it("audits first, then reads, in one transaction, and returns the page without the cursor column", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.peopleResult = () => page(2);
    const app = buildTestApp(repository);

    const response = await post(app, SEARCH, { q: " FindMe ", limit: 2, filters: { market: "TR" } }).set("X-Request-Id", "req-abc_123");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toEqual({
      name: "search_users",
      rows: [
        { user_id: "u0", value: 0 },
        { user_id: "u1", value: 1 }
      ],
      next_cursor: "c1",
      generated_at: expect.any(String)
    });
    expect(repository.events).toEqual(["begin", "audit", "call:search_users", "commit"]);
    expect(repository.audits).toEqual([
      {
        adminEmail: "Admin@CVBuilder.dev",
        action: "people.search_users",
        targetUserId: null,
        params: { function: "search_users", format: "json", filters: { market: "TR" }, limit: 2 },
        requestId: "req-abc_123",
        // Handed to log_access, which stores only its HMAC.
        query: "FindMe"
      }
    ]);
    expect(JSON.stringify(repository.audits[0]?.params).toLowerCase()).not.toContain("findme");
    expect(repository.peopleCalls[0]?.params).toEqual({
      userId: null,
      query: "FindMe",
      from: null,
      to: null,
      filters: { market: "TR" },
      limit: 2,
      cursor: null
    });
  });

  it("keeps the user in target_user_id and records only that a cursor was used", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.peopleResult = () => page(3);
    const app = buildTestApp(repository);

    const response = await post(app, TIMELINE, {
      user_id: USER_ID,
      from: "2026-01-01",
      to: "2026-01-31",
      cursor: "2026-01-02T00:00:00.000000Z|ai_run|" + USER_ID,
      filters: { event_type: ["ai_run"], failures_only: true },
      q: null
    });

    expect(response.status).toBe(200);
    expect(response.body.data.next_cursor).toBeNull();
    expect(response.body.data.rows).toHaveLength(3);
    expect(repository.audits[0]).toEqual({
      adminEmail: "Admin@CVBuilder.dev",
      action: "people.user_timeline",
      targetUserId: USER_ID,
      params: {
        function: "user_timeline",
        format: "json",
        from: "2026-01-01",
        to: "2026-01-31",
        filters: { event_type: ["ai_run"], failures_only: true },
        limit: 50,
        has_cursor: true
      },
      requestId: expect.any(String),
      query: null
    });
    expect(JSON.stringify(repository.audits[0]?.params)).not.toContain(USER_ID);
    expect(repository.peopleCalls[0]?.params).toMatchObject({ userId: USER_ID, limit: 50, cursor: expect.stringContaining("|ai_run|") });

    // A function without a cursor column (user_summary) never has a next page.
    repository.peopleResult = () => ({ columns: ["user_id"], rows: [{ user_id: USER_ID }] });
    const single = await post(app, TIMELINE, { user_id: USER_ID, limit: 1 });
    expect(single.body.data.next_cursor).toBeNull();
  });

  it("returns no data when the audit insert fails", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.auditError = pgError("23514", "audit_log check violated");
    const response = await post(buildTestApp(repository, { logger: { error: vi.fn() } }), SEARCH, { q: "findme" });
    expect(response.status).toBe(500);
    expect(response.body.data).toBeUndefined();
    expect(repository.events).toEqual(["begin", "audit", "rollback"]);
    expect(repository.peopleCalls).toHaveLength(0);
  });

  it.each([
    ["q too short", { q: "ab" }],
    ["q too short after trimming", { q: " ab " }],
    ["q too long", { q: "a".repeat(201) }],
    ["q not a string", { q: 123 }],
    ["user_id not a uuid", { user_id: "123" }],
    ["limit 0", { q: "findme", limit: 0 }],
    ["limit 201", { q: "findme", limit: 201 }],
    ["limit as a string", { q: "findme", limit: "10" }],
    ["fractional limit", { q: "findme", limit: 1.5 }],
    ["cursor too long", { q: "findme", cursor: "c".repeat(201) }],
    ["empty cursor", { q: "findme", cursor: "" }],
    ["impossible date", { user_id: USER_ID, from: "2026-02-30" }],
    ["from after to", { user_id: USER_ID, from: "2026-02-02", to: "2026-02-01" }],
    ["filters as a string", { q: "findme", filters: '{"market":"TR"}' }],
    ["filters as an array", { q: "findme", filters: [1] }],
    ["bad filter key", { q: "findme", filters: { "Bad-Key": 1 } }],
    ["nested filter value", { q: "findme", filters: { metric: { a: 1 } } }],
    ["filters too large", { q: "findme", filters: { event_type: Array.from({ length: 50 }, () => "x".repeat(100)) } }],
    ["bad format", { q: "findme", format: "xlsx" }],
    ["unknown body key", { q: "findme", query: "findme" }],
    ["body not an object", ["findme"]]
  ])("rejects %s with 400 before auditing", async (_label, body) => {
    const repository = new FakeAnalyticsRepository();
    const response = await post(buildTestApp(repository), SEARCH, body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(repository.events).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain("x".repeat(100));
  });

  it("rejects a bad function name with 400", async () => {
    const repository = new FakeAnalyticsRepository();
    const response = await post(buildTestApp(repository), "/admin/people/Search-Users", { q: "findme" });
    expect(response.status).toBe(400);
    expect(repository.events).toEqual([]);
  });

  it("keeps people functions and metrics apart (404)", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    for (const name of ["unknown_fn", "signups"]) {
      const response = await post(app, `/admin/people/${name}`, { q: "findme" });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
    expect((await asAdmin(app, "/admin/metrics/user_timeline")).status).toBe(404);
    expect(repository.events).toEqual([]);
    expect(repository.calls).toHaveLength(0);
  });

  it.each([
    ["22023", 400, "VALIDATION_ERROR"],
    ["42501", 403, "FORBIDDEN"],
    ["57014", 504, "ANALYTICS_TIMEOUT"],
    ["08006", 503, "ANALYTICS_UNAVAILABLE"]
  ])("maps people error %s to %s and rolls back", async (code, status, errorCode) => {
    const repository = new FakeAnalyticsRepository();
    repository.peopleError = pgError(code, "malformed cursor");
    const response = await post(buildTestApp(repository, { logger: { error: vi.fn() } }), SEARCH, { q: "findme", cursor: "zzz" });
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(errorCode);
    expect(repository.events).toEqual(["begin", "audit", "call:search_users", "rollback"]);
  });

  it("never logs the raw search text", async () => {
    const lines: string[] = [];
    const appLogger = pino({ level: "trace" }, { write: (line: string) => lines.push(line) });
    const repository = new FakeAnalyticsRepository();
    const serviceLogger = { error: vi.fn() };
    const app = buildTestApp(repository, { appLogger, logger: serviceLogger });

    expect((await post(app, SEARCH, { q: "Secret.Person@example.com" })).status).toBe(200);
    expect((await post(app, SEARCH, { q: "Secret.Person@example.com", limit: 999 })).status).toBe(400);
    repository.peopleError = pgError("XX000", "boom");
    expect((await post(app, SEARCH, { q: "Secret.Person@example.com" })).status).toBe(500);

    const logged = [...lines, JSON.stringify(serviceLogger.error.mock.calls), JSON.stringify(repository.audits.map((audit) => audit.params))]
      .join("\n")
      .toLowerCase();
    expect(lines.some((line) => line.includes("Admin people served"))).toBe(true);
    expect(logged).not.toContain("secret.person");
  });

  it("exports CSV by paging on the server under one export.csv audit row", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.peopleResult = (params) => {
      const start = params.cursor ? Number(params.cursor.slice(1)) + 1 : 0;
      return page(Math.min(params.limit, 213 - start), start);
    };

    const response = await post(buildTestApp(repository), TIMELINE, { user_id: USER_ID, format: "csv", limit: 5 });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="user_timeline_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers["x-export-truncated"]).toBe("false");
    expect(response.headers["cache-control"]).toBe("no-store");
    const lines = response.text.split("\r\n");
    expect(lines[0]).toBe("﻿user_id,value");
    expect(lines).toHaveLength(1 + 213 + 1);
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0]).toMatchObject({
      action: "export.csv",
      targetUserId: USER_ID,
      params: { function: "user_timeline", format: "csv", max_rows: 50_000 }
    });
    expect(repository.events).toEqual(["begin", "audit", "call:user_timeline", "call:user_timeline", "commit"]);
    expect(repository.peopleCalls.map((call) => [call.params.limit, call.params.cursor])).toEqual([
      [200, null],
      [200, "c199"]
    ]);
  });

  it("caps a CSV export at 50,000 rows", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.peopleResult = (params) => {
      const start = params.cursor ? Number(params.cursor.slice(1)) + 1 : 0;
      return page(params.limit, start);
    };

    const response = await post(buildTestApp(repository), SEARCH, { q: "findme", format: "csv" });

    expect(response.status).toBe(200);
    expect(response.headers["x-export-truncated"]).toBe("true");
    expect(response.text.split("\r\n")).toHaveLength(1 + 50_000 + 1);
    expect(repository.peopleCalls).toHaveLength(250);
    expect(repository.audits.map((audit) => audit.action)).toEqual(["export.csv"]);
  });

  it("limits CSV exports to 10 a minute per admin without limiting JSON reads", async () => {
    vi.stubEnv("VERCEL", "");
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository, { production: true });
    for (let index = 0; index < 10; index++) {
      expect((await post(app, SEARCH, { q: "findme", format: "csv" })).status).toBe(200);
    }
    const limited = await post(app, SEARCH, { q: "findme", format: "csv" });
    expect(limited.status).toBe(429);
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect((await post(app, SEARCH, { q: "findme" })).status).toBe(200);
    expect(repository.audits.filter((audit) => audit.action === "export.csv")).toHaveLength(10);
    vi.unstubAllEnvs();
  });
});

describe("admin alerts, recompute and audit endpoints (Phase 5)", () => {
  const RULE = {
    name: "AI failure rate",
    metric: "kpi_health",
    measure: "ai_failure_rate",
    window: "1d",
    condition: "gt",
    threshold: 0.1
  };

  const send = (
    app: ReturnType<typeof buildTestApp>,
    method: "post" | "patch" | "delete" | "get",
    path: string,
    body?: unknown,
    token = "admin-token"
  ) => {
    const call = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
    return body === undefined ? call : call.send(body as object);
  };

  it("requires an admin on every Phase 5 route and touches nothing for others", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const routes: ["get" | "post" | "patch" | "delete", string, unknown?][] = [
      ["get", "/admin/alerts/rules"],
      ["post", "/admin/alerts/rules", RULE],
      ["patch", `/admin/alerts/rules/${RULE_ID}`, { enabled: false }],
      ["delete", `/admin/alerts/rules/${RULE_ID}`],
      ["get", "/admin/alerts/events"],
      ["post", "/admin/alerts/events/7/ack", {}],
      ["get", "/admin/alerts/summary"],
      ["post", "/admin/recompute", {}],
      ["get", "/admin/recompute/status"],
      ["get", "/admin/audit/recent"]
    ];
    for (const [method, path, body] of routes) {
      const anonymous = await request(app)[method](`/api/v1${path}`);
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      const user = await send(app, method, path, body, "user-token");
      expect(user.status, `${method} ${path}`).toBe(403);
      expect(user.body.error.code).toBe("FORBIDDEN");
      expect(user.headers["cache-control"]).toBe("no-store");
    }
    expect(repository.events).toEqual([]);
    expect(repository.audits).toEqual([]);
  });

  it("creates a rule in one audited write and returns 201 with the rule", async () => {
    const repository = new FakeAnalyticsRepository();
    const response = await send(buildTestApp(repository), "post", "/admin/alerts/rules", {
      ...RULE,
      name: "  AI failure rate ",
      params: { currency: "try", include_internal: true, filters: { market: ["TR"] } },
      cooldown_hours: 6
    }).set("X-Request-Id", "req-rule_1");

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toMatchObject({ id: RULE_ID, name: "AI failure rate", cooldown_hours: 6 });
    expect(repository.events).toEqual(["begin", "write:create_alert_rule", "commit"]);
    expect(repository.writes).toEqual([
      {
        op: "create_alert_rule",
        context: { adminEmail: "Admin@CVBuilder.dev", requestId: "req-rule_1" },
        args: [
          {
            ...RULE,
            params: { currency: "try", include_internal: true, filters: { market: ["TR"] } },
            cooldown_hours: 6
          }
        ]
      }
    ]);
  });

  it.each([
    ["missing metric", { ...RULE, metric: undefined }],
    ["bad metric name", { ...RULE, metric: "Kpi-Health" }],
    ["bad measure name", { ...RULE, measure: "AI rate" }],
    ["empty name", { ...RULE, name: "   " }],
    ["name too long", { ...RULE, name: "x".repeat(121) }],
    ["unknown window", { ...RULE, window: "2d" }],
    ["unknown condition", { ...RULE, condition: "gte" }],
    ["threshold as text", { ...RULE, threshold: "0.1" }],
    ["threshold null", { ...RULE, threshold: null }],
    ["cooldown 0", { ...RULE, cooldown_hours: 0 }],
    ["cooldown 721", { ...RULE, cooldown_hours: 721 }],
    ["fractional cooldown", { ...RULE, cooldown_hours: 1.5 }],
    ["% change on today", { ...RULE, window: "today", condition: "pct_change_gt" }],
    ["unknown params key", { ...RULE, params: { grain: "week" } }],
    ["bad currency", { ...RULE, params: { currency: "eur" } }],
    ["non-dimension filter", { ...RULE, params: { filters: { event_type: "x" } } }],
    ["nested filter value", { ...RULE, params: { filters: { market: { a: 1 } } } }],
    ["unknown body key", { ...RULE, id: RULE_ID }],
    ["body not an object", [RULE]]
  ])("rejects a rule with %s (400) before any write", async (_label, body) => {
    const repository = new FakeAnalyticsRepository();
    const response = await send(buildTestApp(repository), "post", "/admin/alerts/rules", body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(repository.events).toEqual([]);
  });

  it("patches a rule partially and validates the id and the patch", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const response = await send(app, "patch", `/admin/alerts/rules/${RULE_ID}`, { enabled: false, threshold: 0.2 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: RULE_ID, enabled: false, threshold: 0.2 });
    expect(repository.writes[0]).toMatchObject({ op: "update_alert_rule", args: [RULE_ID, { enabled: false, threshold: 0.2 }] });

    for (const [path, body] of [
      ["/admin/alerts/rules/not-a-uuid", { enabled: false }],
      [`/admin/alerts/rules/${RULE_ID}`, {}],
      [`/admin/alerts/rules/${RULE_ID}`, { created_by: "x@y.z" }],
      [`/admin/alerts/rules/${RULE_ID}`, { window: "today", condition: "pct_change_lt" }],
      [`/admin/alerts/rules/${RULE_ID}`, { enabled: "no" }]
    ] as const) {
      expect((await send(app, "patch", path, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(repository.writes).toHaveLength(1);
  });

  it("deletes with 204 and acknowledges events", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const deleted = await send(app, "delete", `/admin/alerts/rules/${RULE_ID}`).set("X-Request-Id", "req-del");
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe("");
    const acked = await send(app, "post", "/admin/alerts/events/7/ack", {});
    expect(acked.status).toBe(200);
    expect(acked.body.data).toEqual({ id: 7, acknowledged_by: "admin@cvbuilder.dev" });
    expect(repository.writes.map((write) => [write.op, write.args])).toEqual([
      ["delete_alert_rule", [RULE_ID]],
      ["ack_alert_event", ["7"]]
    ]);
    expect(repository.writes[0]?.context).toEqual({ adminEmail: "Admin@CVBuilder.dev", requestId: "req-del" });
    for (const id of ["0", "abc", "-1", "1.5", "1".repeat(19)]) {
      expect((await send(app, "post", `/admin/alerts/events/${id}/ack`, {})).status, id).toBe(400);
    }
    expect(repository.writes).toHaveLength(2);
  });

  it.each([
    ["22023", 400, "VALIDATION_ERROR"],
    ["P0002", 404, "NOT_FOUND"],
    ["23505", 409, "CONFLICT"],
    ["42501", 403, "FORBIDDEN"],
    ["57014", 504, "ANALYTICS_TIMEOUT"],
    ["08006", 503, "ANALYTICS_UNAVAILABLE"]
  ])("maps write error %s to %s and rolls the write (and its audit row) back", async (code, status, errorCode) => {
    const repository = new FakeAnalyticsRepository();
    repository.writeError = pgError(code, "metric kpi_overview is not alertable");
    const response = await send(buildTestApp(repository, { logger: { error: vi.fn() } }), "post", "/admin/alerts/rules", RULE);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(errorCode);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(repository.events).toEqual(["begin", "write:create_alert_rule", "rollback"]);
  });

  it("lists rules and events and serves the summary", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const rules = await send(app, "get", "/admin/alerts/rules");
    expect(rules.status).toBe(200);
    expect(rules.headers["cache-control"]).toBe("no-store");
    expect(rules.body.data).toEqual({ rules: repository.rules });

    const events = await send(app, "get", "/admin/alerts/events");
    expect(events.body.data).toEqual({ events: repository.alertEvents });
    await send(app, "get", "/admin/alerts/events?status=all&limit=200");
    expect(repository.eventCalls).toEqual([
      { status: "open", limit: 50 },
      { status: "all", limit: 200 }
    ]);
    for (const query of ["status=closed", "limit=0", "limit=201", "limit=abc"]) {
      expect((await send(app, "get", `/admin/alerts/events?${query}`)).status, query).toBe(400);
    }
    expect(repository.eventCalls).toHaveLength(2);

    const summary = await send(app, "get", "/admin/alerts/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({ open_count: 2, latest_fired_at: "2026-11-15T10:00:00.000Z" });
    repository.summary = { open_count: 0, latest_fired_at: null };
    expect((await send(app, "get", "/admin/alerts/summary")).body.data).toEqual({ open_count: 0, latest_fired_at: null });
    // Reads write nothing.
    expect(repository.writes).toEqual([]);
    expect(repository.audits).toEqual([]);
  });

  it("queues a recompute with 202 and reports a throttle as 429 with Retry-After", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const queued = await send(app, "post", "/admin/recompute", {});
    expect(queued.status).toBe(202);
    expect(queued.body.data).toEqual({ status: "queued", run_id: 12 });
    // request_recompute writes its own audit row: the backend logs nothing itself.
    expect(repository.events).toEqual(["begin", "write:request_recompute", "commit"]);
    expect(repository.writes[0]?.context).toEqual({ adminEmail: "Admin@CVBuilder.dev" });
    expect(repository.audits).toEqual([]);

    repository.recompute = { status: "throttled", run_id: 12, retry_after_seconds: 240 };
    const throttled = await send(app, "post", "/admin/recompute", {});
    expect(throttled.status).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("240");
    expect(throttled.headers["cache-control"]).toBe("no-store");
    expect(throttled.body).toEqual({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: expect.any(String),
        details: { status: "throttled", run_id: 12, retry_after_seconds: 240 }
      }
    });

    const status = await send(app, "get", "/admin/recompute/status");
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual(repository.status);
  });

  it("limits recompute requests to 5 a minute per admin", async () => {
    vi.stubEnv("VERCEL", "");
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository, { production: true });
    for (let index = 0; index < 5; index++) {
      expect((await send(app, "post", "/admin/recompute", {})).status).toBe(202);
    }
    const limited = await send(app, "post", "/admin/recompute", {});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(repository.writes).toHaveLength(5);
    expect((await send(app, "get", "/admin/recompute/status")).status).toBe(200);
    vi.unstubAllEnvs();
  });

  it("audits audit-log reads as audit.read in the same transaction as the read", async () => {
    const repository = new FakeAnalyticsRepository();
    const app = buildTestApp(repository);
    const response = await send(app, "get", "/admin/audit/recent?limit=20").set("X-Request-Id", "req-audit");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toEqual({
      entries: [
        {
          id: 2,
          at: "2026-11-15T10:00:00.000Z",
          admin_email: "admin@cvbuilder.dev",
          action: "export.csv",
          target_user_id: null,
          people_function: "search_users",
          request_id: "req-1"
        }
      ],
      generated_at: expect.any(String)
    });
    expect(JSON.stringify(response.body)).not.toContain("query_hmac");
    expect(repository.events).toEqual(["begin", "audit", "read:audit_recent", "commit"]);
    expect(repository.audits).toEqual([
      { adminEmail: "Admin@CVBuilder.dev", action: "audit.read", targetUserId: null, params: { limit: 20 }, requestId: "req-audit", query: null }
    ]);
    await send(app, "get", "/admin/audit/recent");
    expect(repository.auditLimits).toEqual([20, 50]);
    for (const query of ["limit=0", "limit=501", "limit=x"]) {
      expect((await send(app, "get", `/admin/audit/recent?${query}`)).status, query).toBe(400);
    }
    expect(repository.audits).toHaveLength(2);
  });

  it("returns no audit rows when the audit.read insert fails", async () => {
    const repository = new FakeAnalyticsRepository();
    repository.auditError = pgError("22023", "admin_email is required");
    const response = await send(buildTestApp(repository), "get", "/admin/audit/recent");
    expect(response.status).toBe(400);
    expect(response.body.data).toBeUndefined();
    expect(repository.events).toEqual(["begin", "audit", "rollback"]);
  });

  it("returns 503 for Phase 5 routes when the analytics database is not configured", async () => {
    const app = buildTestApp(null);
    expect((await send(app, "get", "/admin/alerts/summary")).status).toBe(503);
    expect((await send(app, "post", "/admin/recompute", {})).status).toBe(503);
  });
});
