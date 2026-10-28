import type { AnalyticsQueryResult, AnalyticsRow, AnalyticsSql } from "../../shared/db/analytics-db";
import type { AlertEventStatus, AlertRuleInput, AlertRulePatch } from "./admin-alerts.contract";
import type { CatalogEntry, MetricParams, PeopleParams } from "./admin-analytics.contract";

// One admin_app.audit_log row (admin_app.log_access).
export interface AuditEntry {
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  params: Record<string, unknown>;
  requestId: string | null;
  /** Raw search text: the database stores only its HMAC (query_hmac), never the text. */
  query: string | null;
}

export interface PeopleSession {
  call(name: string, params: PeopleParams): Promise<AnalyticsQueryResult>;
}

// Who performs an audited write: the admin_app write functions write their own audit row with these.
export interface AdminWriteContext {
  adminEmail: string;
  requestId: string | null;
}

// admin_app.request_recompute(): queued, or throttled (run_id = the open run, when one is pending or running).
export interface RecomputeRequestResult {
  status: "queued" | "throttled";
  run_id: number | null;
  retry_after_seconds: number;
}

export interface AdminAnalyticsRepository {
  listCatalog(): Promise<CatalogEntry[]>;
  callMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult>;
  /**
   * Writes the audit row, then runs `work` in the same transaction: if the audit insert fails, no data is read, and
   * if the read fails, the transaction (audit row included) rolls back.
   */
  withAuditedPeople<T>(audit: AuditEntry, work: (session: PeopleSession) => Promise<T>): Promise<T>;

  // Phase 5. Every write is one admin_app function call that validates, changes the table and writes its own audit row
  // (alert.rule.create|update|delete, alert.event.ack, recompute.request) inside one read-write transaction.
  listAlertRules(): Promise<AnalyticsRow[]>;
  createAlertRule(context: AdminWriteContext, rule: AlertRuleInput): Promise<AnalyticsRow>;
  updateAlertRule(context: AdminWriteContext, id: string, patch: AlertRulePatch): Promise<AnalyticsRow>;
  deleteAlertRule(context: AdminWriteContext, id: string): Promise<void>;
  listAlertEvents(status: AlertEventStatus, limit: number): Promise<AnalyticsRow[]>;
  ackAlertEvent(context: AdminWriteContext, id: string): Promise<AnalyticsRow>;
  alertSummary(): Promise<AnalyticsRow>;
  requestRecompute(adminEmail: string): Promise<RecomputeRequestResult>;
  recomputeStatus(): Promise<AnalyticsRow | null>;
  /** Writes the audit.read row, then reads admin_app.audit_recent in the same transaction (it refuses otherwise). */
  readAuditRecent(audit: AuditEntry, limit: number): Promise<AnalyticsRow[]>;
}

const parseMeta = (meta: unknown): CatalogEntry["meta"] =>
  (typeof meta === "string" ? JSON.parse(meta) : meta) as CatalogEntry["meta"];

const toResult = (result: { columns: { name: string }[] } & Iterable<unknown>): AnalyticsQueryResult => ({
  columns: result.columns.map((column) => column.name),
  rows: Array.from(result) as Record<string, unknown>[]
});

type JsonInput = Parameters<AnalyticsSql["json"]>[0];

const firstRow = (rows: Iterable<unknown>): AnalyticsRow | null =>
  (Array.from(rows)[0] as AnalyticsRow | undefined) ?? null;

// A write function returned no row: it raises P0002 for unknown ids, so this only guards against a contract drift.
const requireRow = (row: AnalyticsRow | null): AnalyticsRow => {
  if (!row) throw Object.assign(new Error("admin_app write returned no row"), { code: "P0002" });
  return row;
};

export class PostgresAdminAnalyticsRepository implements AdminAnalyticsRepository {
  constructor(private readonly getSql: () => AnalyticsSql) {}

  // Read-write transaction under the statement timeout (the role carries the same cap).
  private write<T>(work: (sql: AnalyticsSql) => Promise<T>): Promise<T> {
    return this.getSql().begin(async (sql) => {
      await sql`set local statement_timeout = '15s'`;
      return work(sql as unknown as AnalyticsSql);
    }) as Promise<T>;
  }

  private read<T>(work: (sql: AnalyticsSql) => Promise<T>): Promise<T> {
    return this.getSql().begin("read only", async (sql) => {
      await sql`set local statement_timeout = '15s'`;
      return work(sql as unknown as AnalyticsSql);
    }) as Promise<T>;
  }

  async listCatalog(): Promise<CatalogEntry[]> {
    const rows = await this.getSql()<{ name: string; kind: CatalogEntry["kind"]; meta: unknown }[]>`
      select name, kind, meta from admin_app.metric_catalog()
    `;
    return rows.map((row) => ({ name: row.name, kind: row.kind, meta: parseMeta(row.meta) }));
  }

  async callMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult> {
    const result = await this.getSql().begin("read only", async (sql) => {
      // Second safeguard; the analytics_api role carries the same timeout.
      await sql`set local statement_timeout = '15s'`;
      return sql`
        select * from analytics.${sql(name)}(
          p_from => ${params.from}::date,
          p_to => ${params.to}::date,
          p_grain => ${params.grain}::text,
          p_currency => ${params.currency}::text,
          p_include_internal => ${params.includeInternal}::boolean,
          p_breakdown => ${params.breakdown}::text,
          p_filters => ${sql.json(params.filters)}::jsonb
        )
      `;
    });
    return toResult(result);
  }

  async withAuditedPeople<T>(audit: AuditEntry, work: (session: PeopleSession) => Promise<T>): Promise<T> {
    // Read-write because of the audit insert; every statement still runs under the timeout.
    const result = await this.getSql().begin(async (sql) => {
      await sql`set local statement_timeout = '15s'`;
      await sql`
        select admin_app.log_access(
          ${audit.adminEmail}::text,
          ${audit.action}::text,
          ${audit.targetUserId}::uuid,
          ${sql.json(audit.params as Parameters<typeof sql.json>[0])}::jsonb,
          ${audit.requestId}::text,
          ${audit.query}::text
        )
      `;
      return work({
        call: async (name, params) =>
          toResult(
            await sql`
              select * from analytics_people.${sql(name)}(
                p_user_id => ${params.userId}::uuid,
                p_query => ${params.query}::text,
                p_from => ${params.from}::date,
                p_to => ${params.to}::date,
                p_filters => ${sql.json(params.filters)}::jsonb,
                p_limit => ${params.limit}::integer,
                p_cursor => ${params.cursor}::text
              )
            `
          )
      });
    });
    return result as T;
  }

  listAlertRules(): Promise<AnalyticsRow[]> {
    return this.read(async (sql) => Array.from(await sql`select * from admin_app.list_alert_rules()`) as AnalyticsRow[]);
  }

  createAlertRule(context: AdminWriteContext, rule: AlertRuleInput): Promise<AnalyticsRow> {
    return this.write(async (sql) =>
      requireRow(firstRow(await sql`
        select * from admin_app.create_alert_rule(
          ${context.adminEmail}::text, ${sql.json(rule as JsonInput)}::jsonb, ${context.requestId}::text)
      `))
    );
  }

  updateAlertRule(context: AdminWriteContext, id: string, patch: AlertRulePatch): Promise<AnalyticsRow> {
    return this.write(async (sql) =>
      requireRow(firstRow(await sql`
        select * from admin_app.update_alert_rule(
          ${context.adminEmail}::text, ${id}::uuid, ${sql.json(patch as JsonInput)}::jsonb, ${context.requestId}::text)
      `))
    );
  }

  async deleteAlertRule(context: AdminWriteContext, id: string): Promise<void> {
    await this.write(
      (sql) => sql`select admin_app.delete_alert_rule(${context.adminEmail}::text, ${id}::uuid, ${context.requestId}::text)`
    );
  }

  listAlertEvents(status: AlertEventStatus, limit: number): Promise<AnalyticsRow[]> {
    return this.read(
      async (sql) =>
        Array.from(await sql`select * from admin_app.list_alert_events(${status}::text, ${limit}::integer)`) as AnalyticsRow[]
    );
  }

  ackAlertEvent(context: AdminWriteContext, id: string): Promise<AnalyticsRow> {
    return this.write(async (sql) =>
      requireRow(firstRow(await sql`
        select * from admin_app.ack_alert_event(${context.adminEmail}::text, ${id}::bigint, ${context.requestId}::text)
      `))
    );
  }

  alertSummary(): Promise<AnalyticsRow> {
    return this.read(async (sql) =>
      requireRow(firstRow(await sql`select open_count, latest_fired_at from admin_app.alert_summary()`))
    );
  }

  // request_recompute inserts the run and its recompute.request audit row, so it needs a read-write transaction.
  requestRecompute(adminEmail: string): Promise<RecomputeRequestResult> {
    return this.write(async (sql) => {
      const row = requireRow(firstRow(await sql`select admin_app.request_recompute(${adminEmail}::text) as result`));
      const result = (typeof row.result === "string" ? JSON.parse(row.result) : row.result) as Record<string, unknown>;
      return {
        status: result.status === "queued" ? "queued" : "throttled",
        run_id: result.run_id === null || result.run_id === undefined ? null : Number(result.run_id),
        retry_after_seconds: Number(result.retry_after_seconds ?? 0)
      };
    });
  }

  recomputeStatus(): Promise<AnalyticsRow | null> {
    return this.read(async (sql) => firstRow(await sql`select * from admin_app.recompute_status()`));
  }

  readAuditRecent(audit: AuditEntry, limit: number): Promise<AnalyticsRow[]> {
    return this.write(async (sql) => {
      await sql`
        select admin_app.log_access(
          ${audit.adminEmail}::text, ${audit.action}::text, ${audit.targetUserId}::uuid,
          ${sql.json(audit.params as JsonInput)}::jsonb, ${audit.requestId}::text, ${audit.query}::text
        )
      `;
      return Array.from(await sql`select * from admin_app.audit_recent(${limit}::integer)`) as AnalyticsRow[];
    });
  }
}
