const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const devApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1";

export const config = {
  // Production always goes through the same-origin /api rewrite in vercel.json.
  apiBaseUrl: trimTrailingSlash(import.meta.env.PROD ? "/api/v1" : devApiBaseUrl),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
};

/** Build-time feature flags (`VITE_FEATURE_*=true`). */
export const features = {
  /** Page-level "Recompute" for the heavy pre-computed metrics; a disabled placeholder until Phase 4 wires it. */
  recompute: import.meta.env.VITE_FEATURE_RECOMPUTE === "true",
};

export const hasSupabaseConfig = Boolean(config.supabaseUrl.trim() && config.supabaseAnonKey.trim());
