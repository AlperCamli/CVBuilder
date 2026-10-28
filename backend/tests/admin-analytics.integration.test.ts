import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import type { CatalogEntry, MetricParams } from "../src/modules/admin-analytics/admin-analytics.contract";
import type { AdminAnalyticsRepository } from "../src/modules/admin-analytics/admin-analytics.repository";
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
import type { AnalyticsQueryResult } from "../src/shared/db/analytics-db";
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

const CATALOG: CatalogEntry[] = [
  { name: "signups", kind: "metric", meta: { ...meta, breakdowns: [...meta.breakdowns], filters: [...meta.filters] } },
  { name: "search_users", kind: "people", meta: { ...meta, breakdowns: [], filters: [] } }
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
  options: { production?: boolean; logger?: { error: ReturnType<typeof vi.fn> } } = {}
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
  });

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
