import type { Logger } from "pino";
import type { AnalyticsQueryResult } from "../../shared/db/analytics-db";
import {
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
  InternalServerError,
  NotFoundError,
  ValidationError
} from "../../shared/errors/app-error";
import { isAdminIdentity, type AdminIdentity } from "../../shared/middleware/require-admin";
import type { CatalogEntry, MetricParams } from "./admin-analytics.contract";
import type { AdminAnalyticsRepository } from "./admin-analytics.repository";

const CATALOG_TTL_MS = 60_000;

const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

// Connection, pool, TLS and server-availability failures, not a fault of the query.
const isUnavailable = (code: string): boolean =>
  code === "CONNECT_TIMEOUT" ||
  code.startsWith("CONNECTION_") ||
  /^E[A-Z_]+$/.test(code) ||
  /^(SELF_SIGNED|UNABLE_TO_|CERT_|DEPTH_ZERO)/.test(code) ||
  /^(08|28)[0-9A-Z]{3}$/.test(code) ||
  code === "53300" ||
  /^57P0[0-9]$/.test(code);

export class AdminAnalyticsService {
  private catalog: { entries: CatalogEntry[]; expiresAt: number } | null = null;

  constructor(
    private readonly repository: AdminAnalyticsRepository | null,
    private readonly options: { adminEmails: string[]; logger?: Pick<Logger, "error">; now?: () => number }
  ) {}

  getMe(identity: AdminIdentity): { email: string | null; is_admin: boolean } {
    return { email: identity.email, is_admin: isAdminIdentity(identity, this.options.adminEmails) };
  }

  async getCatalog(): Promise<CatalogEntry[]> {
    const now = this.options.now?.() ?? Date.now();
    if (this.catalog && this.catalog.expiresAt > now) {
      return this.catalog.entries;
    }
    let entries: CatalogEntry[];
    try {
      entries = await this.requireRepository().listCatalog();
    } catch (error) {
      throw this.mapError(error);
    }
    this.catalog = { entries, expiresAt: now + CATALOG_TTL_MS };
    return entries;
  }

  async runMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult> {
    await this.assertMetric(name);
    try {
      return await this.requireRepository().callMetric(name, params);
    } catch (error) {
      if (errorCode(error) === "42883") {
        // Either the metric was dropped after caching, or its body calls a missing function.
        this.catalog = null;
        await this.assertMetric(name);
        this.logFailure(error, name);
        throw new InternalServerError("Analytics metric failed");
      }
      throw this.mapError(error, name);
    }
  }

  private async assertMetric(name: string): Promise<void> {
    const catalog = await this.getCatalog();
    if (!catalog.some((entry) => entry.kind === "metric" && entry.name === name)) {
      throw new NotFoundError(`Unknown metric: ${name}`);
    }
  }

  private requireRepository(): AdminAnalyticsRepository {
    if (!this.repository) {
      throw new AnalyticsUnavailableError();
    }
    return this.repository;
  }

  private mapError(error: unknown, metric?: string): unknown {
    if (error instanceof AnalyticsUnavailableError) {
      return error;
    }
    const code = errorCode(error);
    if (code === "22023") {
      return new ValidationError((error as Error).message);
    }
    this.logFailure(error, metric);
    if (code === "57014") {
      return new AnalyticsTimeoutError();
    }
    if (code && isUnavailable(code)) {
      return new AnalyticsUnavailableError("Analytics database is unavailable");
    }
    return error;
  }

  private logFailure(error: unknown, metric?: string): void {
    this.options.logger?.error(
      { code: errorCode(error) ?? null, message: error instanceof Error ? error.message : String(error), metric: metric ?? null },
      "Admin analytics query failed"
    );
  }
}
