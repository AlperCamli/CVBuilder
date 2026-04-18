import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import { SystemService } from "../src/modules/system/system.service";
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

const buildTestApp = () => {
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

  const usersService = new UsersService(usersRepository, subscriptionsRepository, usageRepository);

  const services = {
    authService: new AuthService(authProvider, usersRepository),
    usersService,
    dashboardService: new DashboardService(usersService, dashboardRepository),
    systemService: new SystemService(createTestConfig(), new FakeDatabaseHealthChecker({ connected: true }))
  };

  return createApp({
    config: createTestConfig(),
    services
  });
};

describe("auth + users endpoints", () => {
  it("normalizes missing auth token errors", async () => {
    const app = buildTestApp();

    const response = await request(app).get("/api/v1/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("normalizes invalid token errors", async () => {
    const app = buildTestApp();

    const response = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("AUTH_INVALID_TOKEN");
  });

  it("creates app user on first authenticated access and returns stable me payload", async () => {
    const app = buildTestApp();

    const firstResponse = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer valid-token");

    const secondResponse = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer valid-token");

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.success).toBe(true);
    expect(firstResponse.body.data.user.email).toBe("tester@cvbuilder.dev");
    expect(firstResponse.body.data.current_plan.plan_code).toBe("free");
    expect(firstResponse.body.data.usage_summary.tailored_cv_generations_count).toBe(0);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.user.id).toBe(firstResponse.body.data.user.id);
  });

  it("rejects invalid patch me payload with normalized validation error", async () => {
    const app = buildTestApp();

    const response = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("updates /me and /me/settings", async () => {
    const app = buildTestApp();

    const mePatch = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", "Bearer valid-token")
      .send({
        full_name: "Updated Name",
        default_cv_language: "tr"
      });

    expect(mePatch.status).toBe(200);
    expect(mePatch.body.success).toBe(true);
    expect(mePatch.body.data.user.full_name).toBe("Updated Name");
    expect(mePatch.body.data.user.default_cv_language).toBe("tr");

    const settingsPatch = await request(app)
      .patch("/api/v1/me/settings")
      .set("Authorization", "Bearer valid-token")
      .send({
        locale: "tr",
        onboarding_completed: true
      });

    expect(settingsPatch.status).toBe(200);
    expect(settingsPatch.body.success).toBe(true);
    expect(settingsPatch.body.data.settings.locale).toBe("tr");
    expect(settingsPatch.body.data.settings.onboarding_completed).toBe(true);
  });

  it("returns usage summary for current month", async () => {
    const app = buildTestApp();

    const response = await request(app)
      .get("/api/v1/me/usage")
      .set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.period_month).toMatch(/^\d{4}-\d{2}-01$/);
    expect(response.body.data.plan_code).toBe("free");
    expect(response.body.data.storage_bytes_used).toBe(0);
    expect(response.body.data.limits).toEqual({
      tailored_cv_generations: null,
      exports: null,
      ai_actions: null,
      storage_bytes: null
    });
  });
});
