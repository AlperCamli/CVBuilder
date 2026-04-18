import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env";

export interface SupabaseClients {
  serviceRoleClient: SupabaseClient;
  anonClient: SupabaseClient;
}

export const createSupabaseClients = (config: AppConfig): SupabaseClients => {
  const serviceRoleClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
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
