import type { AnalyticsQueryResult, AnalyticsSql } from "../../shared/db/analytics-db";
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

export interface AdminAnalyticsRepository {
  listCatalog(): Promise<CatalogEntry[]>;
  callMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult>;
  /**
   * Writes the audit row, then runs `work` in the same transaction: if the audit insert fails, no data is read, and
   * if the read fails, the transaction (audit row included) rolls back.
   */
  withAuditedPeople<T>(audit: AuditEntry, work: (session: PeopleSession) => Promise<T>): Promise<T>;
}

const parseMeta = (meta: unknown): CatalogEntry["meta"] =>
  (typeof meta === "string" ? JSON.parse(meta) : meta) as CatalogEntry["meta"];

const toResult = (result: { columns: { name: string }[] } & Iterable<unknown>): AnalyticsQueryResult => ({
  columns: result.columns.map((column) => column.name),
  rows: Array.from(result) as Record<string, unknown>[]
});

export class PostgresAdminAnalyticsRepository implements AdminAnalyticsRepository {
  constructor(private readonly getSql: () => AnalyticsSql) {}

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
}
