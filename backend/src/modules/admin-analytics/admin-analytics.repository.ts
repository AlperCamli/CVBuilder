import type { AnalyticsQueryResult, AnalyticsSql } from "../../shared/db/analytics-db";
import type { CatalogEntry, MetricParams } from "./admin-analytics.contract";

export interface AdminAnalyticsRepository {
  listCatalog(): Promise<CatalogEntry[]>;
  callMetric(name: string, params: MetricParams): Promise<AnalyticsQueryResult>;
}

const parseMeta = (meta: unknown): CatalogEntry["meta"] =>
  (typeof meta === "string" ? JSON.parse(meta) : meta) as CatalogEntry["meta"];

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
    return {
      columns: result.columns.map((column) => column.name),
      rows: Array.from(result) as Record<string, unknown>[]
    };
  }
}
