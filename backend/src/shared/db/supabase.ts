import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env";
import { fetchWithRequestDeadline } from "../utils/request-deadline";

export interface SupabaseClients {
  serviceRoleClient: SupabaseClient;
  anonClient: SupabaseClient;
}

export const createSupabaseClients = (config: AppConfig): SupabaseClients => {
  const serviceRoleClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    global: { fetch: fetchWithRequestDeadline },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const anonClient = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return {
    serviceRoleClient,
    anonClient
  };
};
