import type { AuthenticatedRequestContext } from "../../modules/auth/auth.types";
import type { Logger } from "pino";
import type { AdminIdentity } from "../middleware/require-admin";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedRequestContext;
      adminIdentity?: AdminIdentity;
      log?: Logger;
    }
  }
}

export {};
