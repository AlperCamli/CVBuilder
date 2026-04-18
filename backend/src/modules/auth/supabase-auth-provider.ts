import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthIdentity, AuthProvider } from "./auth.types";

const toSupportedLocale = (value: unknown): "en" | "tr" | null => {
  if (value === "en" || value === "tr") {
    return value;
  }

  return null;
};

export class SupabaseAuthProvider implements AuthProvider {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getIdentityFromToken(accessToken: string): Promise<AuthIdentity | null> {
    const { data, error } = await this.supabaseClient.auth.getUser(accessToken);

    if (error || !data.user) {
      return null;
    }

    const userMetadata = data.user.user_metadata ?? {};
    const fullName =
      typeof userMetadata.full_name === "string"
        ? userMetadata.full_name
        : typeof userMetadata.name === "string"
          ? userMetadata.name
          : null;

    return {
      auth_user_id: data.user.id,
      email: data.user.email ?? "",
      full_name: fullName,
      locale: toSupportedLocale(userMetadata.locale)
    };
  }
}
