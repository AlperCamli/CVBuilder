import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../errors/app-error";

// Live Supabase Auth identity, without a public.users row.
export interface AdminIdentity {
  authUserId: string;
  email: string | null;
  // Linked identity providers (identities + app_metadata.providers).
  providers: string[];
  // Authentication methods of this session (JWT amr claim).
  authMethods: string[];
}

export const isAdminEmail = (email: string | null | undefined, adminEmails: readonly string[]): boolean => {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized) && adminEmails.some((admin) => admin.trim().toLowerCase() === normalized);
};

// Google-only, so a password sign-up with an admin address never qualifies.
export const isAdminIdentity = (identity: AdminIdentity | undefined, adminEmails: readonly string[]): boolean =>
  Boolean(identity) &&
  isAdminEmail(identity!.email, adminEmails) &&
  identity!.authMethods.includes("oauth") &&
  identity!.providers.includes("google");

// Runs after the admin identity middleware.
export const createRequireAdmin = (adminEmails: readonly string[]): RequestHandler => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.adminIdentity) {
      next(new UnauthorizedError());
      return;
    }
    next(isAdminIdentity(request.adminIdentity, adminEmails) ? undefined : new ForbiddenError("Admin access is required."));
  };
};
