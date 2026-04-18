import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/shared/config/env";

describe("environment config", () => {
  it("fails when required Supabase variables are missing", () => {
    expect(() =>
      loadConfig({
        APP_ENV: "test",
        APP_VERSION: "1.0.0",
        SUPABASE_ANON_KEY: "anon"
      })
    ).toThrow(/Invalid environment configuration/);
  });

  it("loads valid config", () => {
    const config = loadConfig({
      APP_NAME: "cv-builder-backend",
      APP_ENV: "test",
      APP_VERSION: "1.0.0",
      PORT: "4100",
      LOG_LEVEL: "info",
      FRONTEND_APP_URL: "http://localhost:5173",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service"
    });

    expect(config.appName).toBe("cv-builder-backend");
    expect(config.port).toBe(4100);
    expect(config.ai.provider).toBe("mock");
    expect(config.ai.defaultModel).toBe("mock-cv-builder-v1");
    expect(config.supabase.url).toBe("https://example.supabase.co");
  });
});
