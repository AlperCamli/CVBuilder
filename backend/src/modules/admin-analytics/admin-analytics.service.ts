import type { AnalyticsQueryResult, AnalyticsRow } from "../../shared/db/analytics-db";
import {
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  withCause
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
import type { AlertEventStatus, AlertRuleInput, AlertRulePatch } from "./admin-alerts.contract";
import type {
  AdminAnalyticsRepository,
  AdminWriteContext,
  AuditEntry,
  PeopleSession,
  RecomputeRequestResult
} from "./admin-analytics.repository";

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

// A database message that echoes the search text (no function does today) is logged without it.
const withoutSearchText = (error: unknown, text: string | null): unknown => {
  if (!text || !(error instanceof Error) || !error.message.toLowerCase().includes(text.toLowerCase())) return error;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const redacted = new Error(error.message.replace(new RegExp(escaped, "gi"), "[search text]"));
  redacted.name = error.name;
  return Object.assign(redacted, { code: (error as { code?: unknown }).code });
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
    // Failures are not logged here: mapped errors keep the original as `cause`, and the error handler logs each failed
    // request once (name, SQLSTATE, message, route, people function or metric).
    private readonly options: { adminEmails: string[]; now?: () => number }
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
      throw await this.mapCallError(withoutSearchText(error, query.params.query), name, "people");
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 5: alerts, recompute and the audit log (api-contract.md "Phase 5")
  // ---------------------------------------------------------------------------

  listAlertRules(): Promise<AnalyticsRow[]> {
    return this.call((repository) => repository.listAlertRules());
  }

  createAlertRule(context: AdminWriteContext, rule: AlertRuleInput): Promise<AnalyticsRow> {
    return this.call((repository) => repository.createAlertRule(context, rule));
  }

  updateAlertRule(context: AdminWriteContext, id: string, patch: AlertRulePatch): Promise<AnalyticsRow> {
    return this.call((repository) => repository.updateAlertRule(context, id, patch));
  }

  deleteAlertRule(context: AdminWriteContext, id: string): Promise<void> {
    return this.call((repository) => repository.deleteAlertRule(context, id));
  }

  listAlertEvents(status: AlertEventStatus, limit: number): Promise<AnalyticsRow[]> {
    return this.call((repository) => repository.listAlertEvents(status, limit));
  }

  ackAlertEvent(context: AdminWriteContext, id: string): Promise<AnalyticsRow> {
    return this.call((repository) => repository.ackAlertEvent(context, id));
  }

  async alertSummary(): Promise<{ open_count: number; latest_fired_at: unknown }> {
    const row = await this.call((repository) => repository.alertSummary());
    return { open_count: Number(row.open_count ?? 0), latest_fired_at: row.latest_fired_at ?? null };
  }

  /** Queues a recompute; the database throttles it (5 minutes) and writes the recompute.request audit row itself. */
  requestRecompute(adminEmail: string): Promise<RecomputeRequestResult> {
    return this.call((repository) => repository.requestRecompute(adminEmail));
  }

  recomputeStatus(): Promise<AnalyticsRow | null> {
    return this.call((repository) => repository.recomputeStatus());
  }

  /** The latest audit rows, read in the transaction that writes this read's own `audit.read` row. */
  readAuditRecent(context: AdminWriteContext, limit: number): Promise<AnalyticsRow[]> {
    const audit: AuditEntry = {
      adminEmail: context.adminEmail,
      action: "audit.read",
      targetUserId: null,
      params: { limit },
      requestId: context.requestId,
      query: null
    };
    return this.call((repository) => repository.readAuditRecent(audit, limit));
  }

  private async call<T>(work: (repository: AdminAnalyticsRepository) => Promise<T>): Promise<T> {
    try {
      return await work(this.requireRepository());
    } catch (error) {
      throw this.mapError(error);
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
      return withCause(
        new InternalServerError(kind === "metric" ? "Analytics metric failed" : "Analytics people function failed"),
        error
      );
    }
    return this.mapError(error);
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

  // Unmapped errors pass through unchanged; the error handler turns them into a 500.
  private mapError(error: unknown): unknown {
    if (error instanceof AnalyticsUnavailableError) {
      return error;
    }
    const code = errorCode(error);
    if (code === "22023") {
      return new ValidationError((error as Error).message);
    }
    // Expected outcomes of the Phase 5 writes: an unknown rule / event id, a duplicate rule name.
    if (code === "P0002") {
      return new NotFoundError((error as Error).message);
    }
    if (code === "23505") {
      return new ConflictError("An alert rule with this name already exists");
    }
    if (code === "57014") {
      return withCause(new AnalyticsTimeoutError(), error);
    }
    if (code === "42501") {
      // E.g. a people function refused to run without its audit row.
      return withCause(new ForbiddenError("The analytics database refused this read"), error);
    }
    if (code && isUnavailable(code)) {
      return withCause(new AnalyticsUnavailableError("Analytics database is unavailable"), error);
    }
    return error;
  }
}
