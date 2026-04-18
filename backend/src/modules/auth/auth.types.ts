import type { LocaleCode, UserRecord } from "../../shared/types/domain";

export interface AuthIdentity {
  auth_user_id: string;
  email: string;
  full_name: string | null;
  locale: LocaleCode | null;
}

export interface AuthenticatedRequestContext {
  authUser: AuthIdentity;
  appUser: UserRecord;
}

export interface AuthProvider {
  getIdentityFromToken(accessToken: string): Promise<AuthIdentity | null>;
}
