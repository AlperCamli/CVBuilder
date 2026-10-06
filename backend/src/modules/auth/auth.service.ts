import type { PrivacyService } from "../privacy/privacy.service";
import { ForbiddenError } from "../../shared/errors/app-error";
import { InvalidTokenError } from "../../shared/errors/app-error";
import type { UsersRepository } from "../users/users.repository";
import type { AuthenticatedRequestContext, AuthProvider } from "./auth.types";

export class AuthService {
  constructor(
    private readonly authProvider: AuthProvider,
    private readonly usersRepository: UsersRepository,
    private readonly privacy?: PrivacyService
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticatedRequestContext> {
    const identity = await this.authProvider.getIdentityFromToken(accessToken);

    if (!identity || !identity.auth_user_id || !identity.email) {
      throw new InvalidTokenError();
    }

    await this.privacy?.assertIdentityAvailable(identity.auth_user_id);
    const appUser = await this.usersRepository.ensureByAuthIdentity(identity);

    if ((appUser as unknown as { deletion_requested_at?: string }).deletion_requested_at) throw new ForbiddenError("Account deletion has been requested.");
    return {
      authUser: identity,
      appUser
    };
  }
}
