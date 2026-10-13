import { createClient } from "@supabase/supabase-js";
import { integrationConfig } from "./config";
import { isStudioPreviewFrame } from "./studio-runtime";

const fallbackUrl = "https://invalid.localhost";
const fallbackAnonKey = "invalid-anon-key";

export const supabase = createClient(
  integrationConfig.supabaseUrl || fallbackUrl,
  integrationConfig.supabaseAnonKey || fallbackAnonKey,
  {
    auth: {
      persistSession: !isStudioPreviewFrame(),
      autoRefreshToken: !isStudioPreviewFrame(),
      detectSessionInUrl: !isStudioPreviewFrame()
    }
  }
);
