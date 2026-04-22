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
      EXPORTS_STORAGE_BUCKET: "exports",
      EXPORT_DOWNLOAD_URL_TTL_SECONDS: "900",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service"
    });

    expect(config.appName).toBe("cv-builder-backend");
    expect(config.port).toBe(4100);
    expect(config.ai.provider).toBe("mock");
    expect(config.ai.defaultModel).toBe("mock-cv-builder-v1");
    expect(config.ai.geminiModelLight).toBe("gemini-3-flash");
    expect(config.ai.geminiModelHeavy).toBe("gemini-2.5-flash");
    expect(config.ai.geminiMaxAttempts).toBe(1);
    expect(config.ai.geminiRetryBaseDelayMs).toBe(1000);
    expect(config.ai.geminiRetryMaxDelayMs).toBe(16000);
    expect(config.exports.storageBucket).toBe("exports");
    expect(config.exports.downloadUrlTtlSeconds).toBe(900);
    expect(config.billing.provider).toBe("stripe");
    expect(config.billing.stripeSecretKey).toBeNull();
    expect(config.billing.stripeWebhookSecret).toBeNull();
    expect(config.billing.stripeProPriceId).toBeNull();
    expect(config.supabase.url).toBe("https://example.supabase.co");
    expect(config.ai.geminiApiKey).toBeNull();
  });

  it("applies export defaults when export env vars are omitted", () => {
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

    expect(config.exports.storageBucket).toBe("exports");
    expect(config.exports.downloadUrlTtlSeconds).toBe(600);
    expect(config.billing.checkoutSuccessUrl).toBe("http://localhost:5173/app/pricing?checkout=success");
    expect(config.billing.checkoutCancelUrl).toBe("http://localhost:5173/app/pricing?checkout=cancel");
    expect(config.billing.portalReturnUrl).toBe("http://localhost:5173/app/pricing");
  });

  it("validates export signed URL ttl bounds", () => {
    expect(() =>
      loadConfig({
        APP_NAME: "cv-builder-backend",
        APP_ENV: "test",
        APP_VERSION: "1.0.0",
        PORT: "4100",
        LOG_LEVEL: "info",
        FRONTEND_APP_URL: "http://localhost:5173",
        EXPORTS_STORAGE_BUCKET: "exports",
        EXPORT_DOWNLOAD_URL_TTL_SECONDS: "10",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service"
      })
    ).toThrow(/Invalid environment configuration/);
  });

  it("requires Gemini API key when provider is gemini", () => {
    expect(() =>
      loadConfig({
        APP_NAME: "cv-builder-backend",
        APP_ENV: "test",
        APP_VERSION: "1.0.0",
        PORT: "4100",
        LOG_LEVEL: "info",
        FRONTEND_APP_URL: "http://localhost:5173",
        AI_PROVIDER: "gemini",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service"
      })
    ).toThrow(/GEMINI_API_KEY/);
  });

  it("loads gemini config when API key is provided", () => {
    const config = loadConfig({
      APP_NAME: "cv-builder-backend",
      APP_ENV: "test",
      APP_VERSION: "1.0.0",
      PORT: "4100",
      LOG_LEVEL: "info",
      FRONTEND_APP_URL: "http://localhost:5173",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-key",
      AI_GEMINI_MODEL_LIGHT: "gemini-3-flash",
      AI_GEMINI_MODEL_HEAVY: "gemini-2.5-flash",
      AI_GEMINI_MAX_ATTEMPTS: "5",
      AI_GEMINI_RETRY_BASE_DELAY_MS: "1500",
      AI_GEMINI_RETRY_MAX_DELAY_MS: "30000",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service"
    });

    expect(config.ai.provider).toBe("gemini");
    expect(config.ai.geminiApiKey).toBe("gemini-key");
    expect(config.ai.geminiModelLight).toBe("gemini-3-flash");
    expect(config.ai.geminiModelHeavy).toBe("gemini-2.5-flash");
    expect(config.ai.geminiMaxAttempts).toBe(5);
    expect(config.ai.geminiRetryBaseDelayMs).toBe(1500);
    expect(config.ai.geminiRetryMaxDelayMs).toBe(30000);
  });

  it("validates Gemini retry delay bounds", () => {
    expect(() =>
      loadConfig({
        APP_NAME: "cv-builder-backend",
        APP_ENV: "test",
        APP_VERSION: "1.0.0",
        PORT: "4100",
        LOG_LEVEL: "info",
        FRONTEND_APP_URL: "http://localhost:5173",
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-key",
        AI_GEMINI_RETRY_BASE_DELAY_MS: "2000",
        AI_GEMINI_RETRY_MAX_DELAY_MS: "1000",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service"
      })
    ).toThrow(/AI_GEMINI_RETRY_MAX_DELAY_MS/);
  });
});
