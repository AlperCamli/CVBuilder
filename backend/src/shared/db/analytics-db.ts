import postgres from "postgres";
import { SUPABASE_ROOT_CA } from "./supabase-root-ca";

export type AnalyticsRow = Record<string, unknown>;

export interface AnalyticsQueryResult {
  columns: string[];
  rows: AnalyticsRow[];
}

// Analytics functions return small aggregates: counts (bigint) and money/ratios (numeric)
// fit a JS number, and dates stay as YYYY-MM-DD strings rather than local-time Dates.
const analyticsTypes = {
  int8: { to: 20, from: [20], serialize: (value: number) => String(value), parse: (raw: string) => Number(raw) },
  numeric: { to: 1700, from: [1700], serialize: (value: number) => String(value), parse: (raw: string) => Number(raw) },
  dateText: { to: 1082, from: [1082], serialize: (value: string) => value, parse: (raw: string) => raw }
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Verifies the server against Supabase's root CA; only a local dev database skips TLS.
export const analyticsSslOption = (url: string): false | { ca: string; rejectUnauthorized: true } => {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // An unparsable URL still gets verified TLS.
  }
  return LOCAL_HOSTS.has(hostname) ? false : { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
};

const createAnalyticsSql = (url: string) =>
  postgres(url, {
    // Supavisor transaction mode cannot keep prepared statements.
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: analyticsSslOption(url),
    connection: { application_name: "cv-builder-admin-analytics" },
    types: analyticsTypes
  });

export type AnalyticsSql = ReturnType<typeof createAnalyticsSql>;

let cached: { url: string; sql: AnalyticsSql } | null = null;

export const getAnalyticsDb = (url: string): AnalyticsSql => {
  if (!cached || cached.url !== url) {
    cached = { url, sql: createAnalyticsSql(url) };
  }
  return cached.sql;
};
