import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnvFile } from "dotenv";
import { z } from "zod";

const appEnvSchema = z.enum(["development", "test", "staging", "production"]);
const aiProviderSchema = z.enum(["mock"]);

const envSchema = z.object({
  APP_NAME: z.string().min(1).default("cv-builder-backend"),
  APP_ENV: appEnvSchema.default("development"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().min(1).default("info"),
  FRONTEND_APP_URL: z.string().url().default("http://localhost:5173"),
  AI_PROVIDER: aiProviderSchema.default("mock"),
  AI_DEFAULT_MODEL: z.string().min(1).default("mock-cv-builder-v1"),
  AI_PROMPT_PROFILE: z.string().min(1).default("phase3-v1"),
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
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export interface AppConfig {
  appName: string;
  appEnv: AppEnv;
  appVersion: string;
  port: number;
  logLevel: string;
  frontendAppUrl: string;
  ai: {
    provider: z.infer<typeof aiProviderSchema>;
    defaultModel: string;
    promptProfile: string;
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

  return {
    appName: parsed.data.APP_NAME,
    appEnv: parsed.data.APP_ENV,
    appVersion: parsed.data.APP_VERSION,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    frontendAppUrl,
    ai: {
      provider: parsed.data.AI_PROVIDER,
      defaultModel: parsed.data.AI_DEFAULT_MODEL,
      promptProfile: parsed.data.AI_PROMPT_PROFILE
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
