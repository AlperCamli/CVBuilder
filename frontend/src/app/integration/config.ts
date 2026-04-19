export interface IntegrationConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  importsStorageBucket: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const rawImportsBucket = import.meta.env.VITE_SUPABASE_IMPORTS_BUCKET ?? "imports";

export const integrationConfig: IntegrationConfig = {
  apiBaseUrl: trimTrailingSlash(rawApiBaseUrl),
  supabaseUrl: rawSupabaseUrl,
  supabaseAnonKey: rawSupabaseAnonKey,
  importsStorageBucket: rawImportsBucket
};

export const hasSupabaseConfig =
  integrationConfig.supabaseUrl.trim().length > 0 &&
  integrationConfig.supabaseAnonKey.trim().length > 0;

export const ensureSupabaseConfigured = (): void => {
  if (!hasSupabaseConfig) {
    throw new Error(
      "Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }
};
