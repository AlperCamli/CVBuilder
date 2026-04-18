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

  return {
    appName: parsed.data.APP_NAME,
    appEnv: parsed.data.APP_ENV,
    appVersion: parsed.data.APP_VERSION,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    frontendAppUrl: parsed.data.FRONTEND_APP_URL,
    ai: {
      provider: parsed.data.AI_PROVIDER,
      defaultModel: parsed.data.AI_DEFAULT_MODEL,
      promptProfile: parsed.data.AI_PROMPT_PROFILE
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
