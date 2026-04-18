import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { BillingService } from "../src/modules/billing/billing.service";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import { SystemService } from "../src/modules/system/system.service";
import { UsageService } from "../src/modules/usage/usage.service";
import { UsersService } from "../src/modules/users/users.service";
import {
  FakeAuthProvider,
  FakeDatabaseHealthChecker,
  InMemoryDashboardRepository,
  InMemorySubscriptionsRepository,
  InMemoryUsageRepository,
  InMemoryUsersRepository,
  createTestConfig
} from "./helpers/in-memory";

const buildTestApp = (databaseConnected: boolean) => {
  const config = createTestConfig();
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const usageRepository = new InMemoryUsageRepository();
  const dashboardRepository = new InMemoryDashboardRepository();

  const authProvider = new FakeAuthProvider({
    "valid-token": {
      auth_user_id: "00000000-0000-0000-0000-000000000001",
      email: "tester@cvbuilder.dev",
      full_name: "Test User",
      locale: "en"
    }
  });

  const entitlementsService = new EntitlementsService(
    createPlanCatalog({ proStripePriceId: config.billing.stripeProPriceId })
  );
  const usageService = new UsageService(usageRepository);
  const billingService = new BillingService(
    usersRepository,
    subscriptionsRepository,
    usageService,
    entitlementsService,
    null,
    {
      provider: config.billing.provider,
      checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
      checkoutCancelUrl: config.billing.checkoutCancelUrl,
      portalReturnUrl: config.billing.portalReturnUrl,
      stripeWebhookSecret: config.billing.stripeWebhookSecret
    }
  );
  const usersService = new UsersService(usersRepository, billingService);

  const services = {
    authService: new AuthService(authProvider, usersRepository),
    usersService,
    dashboardService: new DashboardService(usersService, dashboardRepository),
    systemService: new SystemService(config, new FakeDatabaseHealthChecker({ connected: databaseConnected }))
  };

  return createApp({
    config,
    services
  });
};

describe("dashboard + system endpoints", () => {
  it("returns health and version with success envelope", async () => {
    const app = buildTestApp(true);

    const health = await request(app).get("/api/v1/health");
    const version = await request(app).get("/api/v1/version");

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      success: true,
      data: {
        status: "ok"
      }
    });

    expect(version.status).toBe(200);
    expect(version.body.success).toBe(true);
    expect(version.body.data.app_name).toBe("cv-builder-backend-test");
  });

  it("returns ready when database is connected", async () => {
    const app = buildTestApp(true);

    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("ready");
    expect(response.body.data.database.connected).toBe(true);
  });

  it("returns degraded when database is unavailable", async () => {
    const app = buildTestApp(false);

    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("degraded");
    expect(response.body.data.database.connected).toBe(false);
  });

  it("returns dashboard contract and activity placeholder", async () => {
    const app = buildTestApp(true);

    const dashboard = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", "Bearer valid-token");

    const activity = await request(app)
      .get("/api/v1/dashboard/activity")
      .set("Authorization", "Bearer valid-token");

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.success).toBe(true);
    expect(dashboard.body.data.user_summary.email).toBe("tester@cvbuilder.dev");
    expect(dashboard.body.data.master_cv_summary.total_count).toBe(0);
    expect(dashboard.body.data.tailored_cv_summary.total_count).toBe(0);
    expect(dashboard.body.data.jobs_summary.total_count).toBe(0);
    expect(dashboard.body.data.entitlements.plan_code).toBe("free");
    expect(dashboard.body.data.jobs_summary.counts_by_status).toEqual({
      saved: 0,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      archived: 0
    });
    expect(dashboard.body.data.recent_activity).toEqual([]);

    expect(activity.status).toBe(200);
    expect(activity.body.success).toBe(true);
    expect(activity.body.data.activity).toEqual([]);
  });
});
