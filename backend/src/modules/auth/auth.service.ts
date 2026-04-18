import { InvalidTokenError } from "../../shared/errors/app-error";
import type { UsersRepository } from "../users/users.repository";
import type { AuthenticatedRequestContext, AuthProvider } from "./auth.types";

export class AuthService {
  constructor(
    private readonly authProvider: AuthProvider,
    private readonly usersRepository: UsersRepository
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticatedRequestContext> {
    const identity = await this.authProvider.getIdentityFromToken(accessToken);

    if (!identity || !identity.auth_user_id || !identity.email) {
      throw new InvalidTokenError();
    }

    const appUser = await this.usersRepository.ensureByAuthIdentity(identity);

    return {
      authUser: identity,
      appUser
    };
  }
}
