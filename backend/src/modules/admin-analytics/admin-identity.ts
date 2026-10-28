import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { InvalidTokenError, UnauthorizedError } from "../../shared/errors/app-error";
import type { AdminIdentity } from "../../shared/middleware/require-admin";
import { getBearerToken } from "../auth/auth.middleware";

export interface AdminIdentityProvider {
  getIdentity(accessToken: string): Promise<AdminIdentity | null>;
}

// Read only after getUser has verified the token.
const authMethodsFromToken = (accessToken: string): string[] => {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { amr?: unknown };
    if (!Array.isArray(payload.amr)) return [];
    return payload.amr
      .map((entry: unknown) => (typeof entry === "string" ? entry : (entry as { method?: unknown } | null)?.method))
      .filter((method): method is string => typeof method === "string");
  } catch {
    return [];
  }
};

export class SupabaseAdminIdentityProvider implements AdminIdentityProvider {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getIdentity(accessToken: string): Promise<AdminIdentity | null> {
    const { data, error } = await this.supabaseClient.auth.getUser(accessToken);
    if (error || !data.user) {
      return null;
    }

    const appProviders = data.user.app_metadata?.providers;
    const providers = new Set<string>([
      ...(data.user.identities ?? []).map((identity) => identity.provider),
      ...(Array.isArray(appProviders) ? appProviders.filter((provider): provider is string => typeof provider === "string") : [])
    ]);

    return {
      authUserId: data.user.id,
      email: data.user.email ?? null,
      providers: [...providers],
      authMethods: authMethodsFromToken(accessToken)
    };
  }
}

// Verifies the token only: no public.users row is created and no activity is recorded.
export const createAdminAuthMiddleware = (provider: AdminIdentityProvider): RequestHandler => {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const token = getBearerToken(request.header("authorization"));
      if (!token) {
        throw new UnauthorizedError("Missing or malformed bearer token");
      }
      const identity = await provider.getIdentity(token);
      if (!identity) {
        throw new InvalidTokenError();
      }
      request.adminIdentity = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
};
