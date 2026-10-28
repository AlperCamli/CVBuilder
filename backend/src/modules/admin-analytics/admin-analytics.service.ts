import type { Logger } from "pino";
import type { AnalyticsQueryResult, AnalyticsRow } from "../../shared/db/analytics-db";
import {
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  ValidationError
} from "../../shared/errors/app-error";
import { isAdminIdentity, type AdminIdentity } from "../../shared/middleware/require-admin";
import {
  PEOPLE_CSV_MAX_ROWS,
  PEOPLE_MAX_LIMIT,
  type CatalogEntry,
  type MetricParams,
  type PeopleParams,
  type PeopleQuery
} from "./admin-analytics.contract";
import type { AdminAnalyticsRepository, AuditEntry, PeopleSession } from "./admin-analytics.repository";

const CATALOG_TTL_MS = 60_000;
const CURSOR_COLUMN = "cursor";

export interface PeopleResult {
  columns: string[];
  rows: AnalyticsRow[];
  nextCursor: string | null;
  /** CSV only: the export stopped at PEOPLE_CSV_MAX_ROWS and more rows may exist. */
  truncated: boolean;
}

export interface PeopleRequestContext {
  adminEmail: string;
  requestId: string | null;
}

// Audit params: what shaped the read. The user is the row's target_user_id, the search text goes to log_access
// separately (the database keeps only its keyed hash), and a cursor is recorded only as present.
const auditParams = (name: string, query: PeopleQuery): Record<string, unknown> => {
  const { params, format } = query;
  return {
    function: name,
    format,
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    ...(Object.keys(params.filters).length > 0 ? { filters: params.filters } : {}),
    ...(format === "csv" ? { max_rows: PEOPLE_CSV_MAX_ROWS } : { limit: params.limit }),
    ...(params.cursor ? { has_cursor: true } : {})
  };
};

// The cursor column of the last row when the page is full, otherwise null.
const nextCursorOf = (page: AnalyticsQueryResult, limit: number): string | null => {
  if (page.rows.length !== limit || !page.columns.includes(CURSOR_COLUMN)) return null;
  const cursor = page.rows[page.rows.length - 1]?.[CURSOR_COLUMN];
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
};

const withoutCursor = (rows: AnalyticsRow[]): AnalyticsRow[] =>
  rows.map(({ [CURSOR_COLUMN]: _cursor, ...row }) => row);

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
    await this.assertEntry(name, "metric");
    try {
      return await this.requireRepository().callMetric(name, params);
    } catch (error) {
      throw await this.mapCallError(error, name, "metric");
    }
  }

  /**
   * Audits the call and reads analytics_people.<name> in one transaction. JSON returns one page; CSV pages through the
   * function on the server (up to PEOPLE_CSV_MAX_ROWS) under a single `export.csv` audit row.
   */
  async runPeople(name: string, query: PeopleQuery, context: PeopleRequestContext): Promise<PeopleResult> {
    await this.assertEntry(name, "people");
    const audit: AuditEntry = {
      adminEmail: context.adminEmail,
      action: query.format === "csv" ? "export.csv" : `people.${name}`,
      targetUserId: query.params.userId,
      params: auditParams(name, query),
      requestId: context.requestId,
      query: query.params.query
    };
    try {
      return await this.requireRepository().withAuditedPeople(audit, (session) =>
        query.format === "csv" ? this.exportPeople(session, name, query.params) : this.pagePeople(session, name, query.params)
      );
    } catch (error) {
      throw await this.mapCallError(error, name, "people");
    }
  }

  private async pagePeople(session: PeopleSession, name: string, params: PeopleParams): Promise<PeopleResult> {
    const page = await session.call(name, params);
    return {
      columns: page.columns.filter((column) => column !== CURSOR_COLUMN),
      rows: withoutCursor(page.rows),
      nextCursor: nextCursorOf(page, params.limit),
      truncated: false
    };
  }

  private async exportPeople(session: PeopleSession, name: string, params: PeopleParams): Promise<PeopleResult> {
    const rows: AnalyticsRow[] = [];
    let columns: string[] = [];
    let cursor = params.cursor;
    let next: string | null = null;
    do {
      const limit = Math.min(PEOPLE_MAX_LIMIT, PEOPLE_CSV_MAX_ROWS - rows.length);
      const page = await session.call(name, { ...params, limit, cursor });
      columns = page.columns.filter((column) => column !== CURSOR_COLUMN);
      rows.push(...withoutCursor(page.rows));
      next = nextCursorOf(page, limit);
      cursor = next;
    } while (next !== null && rows.length < PEOPLE_CSV_MAX_ROWS);
    return { columns, rows, nextCursor: next, truncated: next !== null };
  }

  private async mapCallError(error: unknown, name: string, kind: CatalogEntry["kind"]): Promise<unknown> {
    if (errorCode(error) === "42883") {
      // Either the function was dropped after caching, or its body calls a missing function.
      this.catalog = null;
      await this.assertEntry(name, kind);
      this.logFailure(error, name);
      return new InternalServerError(kind === "metric" ? "Analytics metric failed" : "Analytics people function failed");
    }
    return this.mapError(error, name);
  }

  private async assertEntry(name: string, kind: CatalogEntry["kind"]): Promise<void> {
    const catalog = await this.getCatalog();
    if (!catalog.some((entry) => entry.kind === kind && entry.name === name)) {
      throw new NotFoundError(kind === "metric" ? `Unknown metric: ${name}` : `Unknown people function: ${name}`);
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
    if (code === "42501") {
      // E.g. a people function refused to run without its audit row.
      return new ForbiddenError("The analytics database refused this read");
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
