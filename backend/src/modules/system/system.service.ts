import type { AppConfig } from "../../shared/config/env";
import type { DatabaseHealthCheckerPort } from "../../shared/db/database-health";

export class SystemService {
  constructor(
    private readonly config: AppConfig,
    private readonly databaseHealthChecker: DatabaseHealthCheckerPort
  ) {}

  getHealth(): {
    status: "ok";
    service: string;
    timestamp: string;
  } {
    return {
      status: "ok",
      service: this.config.appName,
      timestamp: new Date().toISOString()
    };
  }

  async getReadiness(): Promise<{
    status: "ready" | "degraded";
    database: {
      connected: boolean;
      checked_at: string;
    };
    environment: string;
  }> {
    const databaseStatus = await this.databaseHealthChecker.check();

    return {
      status: databaseStatus.connected ? "ready" : "degraded",
      database: {
        connected: databaseStatus.connected,
        checked_at: databaseStatus.checked_at
      },
      environment: this.config.appEnv
    };
  }

  getVersion(): {
    app_name: string;
    version: string;
    environment: string;
  } {
    return {
      app_name: this.config.appName,
      version: this.config.appVersion,
      environment: this.config.appEnv
    };
  }
}
