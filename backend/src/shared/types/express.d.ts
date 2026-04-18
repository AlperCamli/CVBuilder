import type { AuthenticatedRequestContext } from "../../modules/auth/auth.types";
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedRequestContext;
      log?: Logger;
    }
  }
}

export {};
