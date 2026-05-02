import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnvFile } from "dotenv";
import { z } from "zod";

const appEnvSchema = z.enum(["development", "test", "staging", "production"]);
const aiProviderSchema = z.enum(["mock", "gemini"]);

const envSchema = z
  .object({
    APP_NAME: z.string().min(1).default("cv-builder-backend"),
    APP_ENV: appEnvSchema.default("development"),
    APP_VERSION: z.string().min(1).default("0.1.0"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.string().min(1).default("info"),
    FRONTEND_APP_URL: z.string().url().default("http://localhost:5173"),
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    AI_PROVIDER: aiProviderSchema.default("mock"),
    AI_DEFAULT_MODEL: z.string().min(1).default("mock-cv-builder-v1"),
    AI_PROMPT_PROFILE: z.string().min(1).default("phase3-v1"),
    GEMINI_API_KEY: z.string().min(1).optional(),
    AI_GEMINI_MODEL_LIGHT: z.string().min(1).default("gemini-2.5-flash-preview"),
    AI_GEMINI_MODEL_HEAVY: z.string().min(1).default("gemini-3-flash"),
    AI_GEMINI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(3),
    AI_GEMINI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    AI_GEMINI_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(200).max(120_000).default(16_000),
    AI_GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(60_000),
    AI_GEMINI_MAX_OUTPUT_TOKENS_LIGHT: z.coerce.number().int().min(512).max(65_536).default(4_096),
    AI_GEMINI_MAX_OUTPUT_TOKENS_HEAVY: z.coerce.number().int().min(1_024).max(65_536).default(16_384),
    AI_RUN_STALE_AFTER_MS: z.coerce.number().int().min(60_000).max(1_800_000).default(300_000),
    AI_RUN_SWEEP_INTERVAL_MS: z.coerce.number().int().min(15_000).max(600_000).default(60_000),
    EXPORTS_STORAGE_BUCKET: z.string().min(1).default("exports"),
    EXPORT_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(600),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),
    BILLING_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
    BILLING_CHECKOUT_CANCEL_URL: z.string().url().optional(),
    BILLING_PORTAL_RETURN_URL: z.string().url().optional(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
  })
  .superRefine((value, context) => {
    if (value.AI_PROVIDER === "gemini" && !value.GEMINI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini"
      });
    }

    if (value.AI_GEMINI_RETRY_MAX_DELAY_MS < value.AI_GEMINI_RETRY_BASE_DELAY_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AI_GEMINI_RETRY_MAX_DELAY_MS"],
        message: "AI_GEMINI_RETRY_MAX_DELAY_MS must be >= AI_GEMINI_RETRY_BASE_DELAY_MS"
      });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;

export interface AppConfig {
  appName: string;
  appEnv: AppEnv;
  appVersion: string;
  port: number;
  logLevel: string;
  frontendAppUrl: string;
  corsAllowedOrigins: string[];
  ai: {
    provider: z.infer<typeof aiProviderSchema>;
    defaultModel: string;
    promptProfile: string;
    geminiApiKey: string | null;
    geminiModelLight: string;
    geminiModelHeavy: string;
    geminiMaxAttempts: number;
    geminiRetryBaseDelayMs: number;
    geminiRetryMaxDelayMs: number;
    geminiRequestTimeoutMs: number;
    geminiMaxOutputTokensLight: number;
    geminiMaxOutputTokensHeavy: number;
    runStaleAfterMs: number;
    runSweepIntervalMs: number;
  };
  exports: {
    storageBucket: string;
    downloadUrlTtlSeconds: number;
  };
  billing: {
    provider: "stripe";
    stripeSecretKey: string | null;
    stripeWebhookSecret: string | null;
    stripeProPriceId: string | null;
    checkoutSuccessUrl: string;
    checkoutCancelUrl: string;
    portalReturnUrl: string;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
}

let cachedConfig: AppConfig | null = null;
let hasLoadedEnvironmentFiles = false;

const loadEnvironmentFiles = (): void => {
  if (hasLoadedEnvironmentFiles) {
    return;
  }

  const preservedProcessEnv = new Map<string, string | undefined>();
  for (const key of Object.keys(process.env)) {
    preservedProcessEnv.set(key, process.env[key]);
  }

  const cwd = process.cwd();
  const envPath = resolve(cwd, ".env");
  const envLocalPath = resolve(cwd, ".env.local");

  if (existsSync(envPath)) {
    loadDotEnvFile({ path: envPath, override: false });
  }

  if (existsSync(envLocalPath)) {
    loadDotEnvFile({ path: envLocalPath, override: true });
  }

  // Explicit shell/runtime environment variables should always win.
  for (const [key, value] of preservedProcessEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  hasLoadedEnvironmentFiles = true;
};

export const loadConfig = (rawEnv: NodeJS.ProcessEnv): AppConfig => {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const frontendAppUrl = parsed.data.FRONTEND_APP_URL;
  const corsAllowedOrigins = (parsed.data.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    appName: parsed.data.APP_NAME,
    appEnv: parsed.data.APP_ENV,
    appVersion: parsed.data.APP_VERSION,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    frontendAppUrl,
    corsAllowedOrigins,
    ai: {
      provider: parsed.data.AI_PROVIDER,
      defaultModel: parsed.data.AI_DEFAULT_MODEL,
      promptProfile: parsed.data.AI_PROMPT_PROFILE,
      geminiApiKey: parsed.data.GEMINI_API_KEY ?? null,
      geminiModelLight: parsed.data.AI_GEMINI_MODEL_LIGHT,
      geminiModelHeavy: parsed.data.AI_GEMINI_MODEL_HEAVY,
      geminiMaxAttempts: parsed.data.AI_GEMINI_MAX_ATTEMPTS,
      geminiRetryBaseDelayMs: parsed.data.AI_GEMINI_RETRY_BASE_DELAY_MS,
      geminiRetryMaxDelayMs: parsed.data.AI_GEMINI_RETRY_MAX_DELAY_MS,
      geminiRequestTimeoutMs: parsed.data.AI_GEMINI_REQUEST_TIMEOUT_MS,
      geminiMaxOutputTokensLight: parsed.data.AI_GEMINI_MAX_OUTPUT_TOKENS_LIGHT,
      geminiMaxOutputTokensHeavy: parsed.data.AI_GEMINI_MAX_OUTPUT_TOKENS_HEAVY,
      runStaleAfterMs: parsed.data.AI_RUN_STALE_AFTER_MS,
      runSweepIntervalMs: parsed.data.AI_RUN_SWEEP_INTERVAL_MS
    },
    exports: {
      storageBucket: parsed.data.EXPORTS_STORAGE_BUCKET,
      downloadUrlTtlSeconds: parsed.data.EXPORT_DOWNLOAD_URL_TTL_SECONDS
    },
    billing: {
      provider: "stripe",
      stripeSecretKey: parsed.data.STRIPE_SECRET_KEY ?? null,
      stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET ?? null,
      stripeProPriceId: parsed.data.STRIPE_PRO_PRICE_ID ?? null,
      checkoutSuccessUrl:
        parsed.data.BILLING_CHECKOUT_SUCCESS_URL ??
        `${frontendAppUrl.replace(/\/$/, "")}/app/pricing?checkout=success`,
      checkoutCancelUrl:
        parsed.data.BILLING_CHECKOUT_CANCEL_URL ??
        `${frontendAppUrl.replace(/\/$/, "")}/app/pricing?checkout=cancel`,
      portalReturnUrl:
        parsed.data.BILLING_PORTAL_RETURN_URL ??
        `${frontendAppUrl.replace(/\/$/, "")}/app/pricing`
    },
    supabase: {
      url: parsed.data.SUPABASE_URL,
      anonKey: parsed.data.SUPABASE_ANON_KEY,
      serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY
    }
  };
};

export const getConfig = (): AppConfig => {
  loadEnvironmentFiles();

  if (!cachedConfig) {
    cachedConfig = loadConfig(process.env);
  }

  return cachedConfig;
};

export const resetConfigCacheForTests = (): void => {
  cachedConfig = null;
  hasLoadedEnvironmentFiles = false;
};
