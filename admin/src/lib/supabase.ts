import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(
  config.supabaseUrl || "https://invalid.localhost",
  config.supabaseAnonKey || "invalid-anon-key",
  { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const getAccessToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};
