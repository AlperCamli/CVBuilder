import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { UserRecord } from "../../shared/types/domain";
import { isUniqueViolation, type SupabaseLikeError } from "../../shared/utils/supabase-error";
import type { AuthIdentity } from "../auth/auth.types";

export interface UsersRepository {
  ensureByAuthIdentity(identity: AuthIdentity): Promise<UserRecord>;
  getById(userId: string): Promise<UserRecord | null>;
  getByAuthUserId(authUserId: string): Promise<UserRecord | null>;
  updateProfile(userId: string, payload: { full_name?: string; default_cv_language?: string }): Promise<UserRecord>;
  updateSettings(
    userId: string,
    payload: { locale?: "en" | "tr"; default_cv_language?: string; onboarding_completed?: boolean }
  ): Promise<UserRecord>;
}

export class SupabaseUsersRepository implements UsersRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async ensureByAuthIdentity(identity: AuthIdentity): Promise<UserRecord> {
    const existing = await this.getByAuthUserId(identity.auth_user_id);

    if (existing) {
      return existing;
    }

    const { data, error } = await this.supabaseClient
      .from("users")
      .insert({
        auth_user_id: identity.auth_user_id,
        email: identity.email,
        full_name: identity.full_name,
        locale: identity.locale ?? "en",
        onboarding_completed: false
      })
      .select("*")
      .single();

    if (error) {
      if (isUniqueViolation(error as SupabaseLikeError)) {
        const row = await this.getByAuthUserId(identity.auth_user_id);
        if (row) {
          return row;
        }
      }

      throw new InternalServerError("Failed to ensure application user", {
        reason: error.message
      });
    }

    return data as UserRecord;
  }

  async getById(userId: string): Promise<UserRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load user profile", {
        reason: error.message
      });
    }

    return (data as UserRecord | null) ?? null;
  }

  async getByAuthUserId(authUserId: string): Promise<UserRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("users")
      .select("*")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load user by auth user id", {
        reason: error.message
      });
    }

    return (data as UserRecord | null) ?? null;
  }

  async updateProfile(
    userId: string,
    payload: { full_name?: string; default_cv_language?: string }
  ): Promise<UserRecord> {
    const { data, error } = await this.supabaseClient
      .from("users")
      .update(payload)
      .eq("id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update user profile", {
        reason: error.message
      });
    }

    if (!data) {
      throw new InternalServerError("Failed to update user profile", {
        reason: "user_not_found"
      });
    }

    return data as UserRecord;
  }

  async updateSettings(
    userId: string,
    payload: { locale?: "en" | "tr"; default_cv_language?: string; onboarding_completed?: boolean }
  ): Promise<UserRecord> {
    const { data, error } = await this.supabaseClient
      .from("users")
      .update(payload)
      .eq("id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update user settings", {
        reason: error.message
      });
    }

    if (!data) {
      throw new InternalServerError("Failed to update user settings", {
        reason: "user_not_found"
      });
    }

    return data as UserRecord;
  }
}
