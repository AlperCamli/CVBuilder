import pino, { type Logger } from "pino";
import pinoHttp, { type Options as PinoHttpOptions } from "pino-http";
import type { AppConfig } from "../config/env";

export const createLogger = (config: AppConfig): Logger => {
  return pino({
    name: config.appName,
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "authorization",
        "headers.authorization",
        "supabase.serviceRoleKey",
        "SUPABASE_SERVICE_ROLE_KEY"
      ],
      remove: true
    }
  });
};

export const createRequestLogger = (logger: Logger) => {
  const options: PinoHttpOptions = {
    logger,
    genReqId: (req) => {
      const incomingRequestId = req.headers["x-request-id"];
      if (typeof incomingRequestId === "string" && incomingRequestId.length > 0) {
        return incomingRequestId;
      }

      return `req_${Math.random().toString(36).slice(2, 11)}`;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) {
        return "error";
      }

      if (res.statusCode >= 400) {
        return "warn";
      }

      return "info";
    }
  };

  return pinoHttp(options);
};
