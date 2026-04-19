import { createClient } from "@supabase/supabase-js";
import { integrationConfig } from "./config";

const fallbackUrl = "https://invalid.localhost";
const fallbackAnonKey = "invalid-anon-key";

export const supabase = createClient(
  integrationConfig.supabaseUrl || fallbackUrl,
  integrationConfig.supabaseAnonKey || fallbackAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
