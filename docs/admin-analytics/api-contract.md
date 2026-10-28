# Admin Analytics — HTTP & SQL contract

Shared contract between `backend/src/modules/admin-analytics`, `admin/` and the `analytics*` SQL functions. If you change it, change all three in the same commit.

## Envelope
All JSON responses use the backend's standard envelope:
- `{ "success": true, "data": … }`
- `{ "success": false, "error": { "code", "message", "details?" } }`

Every `/admin/*` response sends `Cache-Control: no-store`.

## Endpoints (prefix `/api/v1`)

| Method & path | Auth | Response `data` |
|---|---|---|
| `GET /admin/me` | signed in | `{ email: string \| null, is_admin: boolean }` (200 for non-admins too) |
| `GET /admin/catalog` | admin | `{ metrics: CatalogEntry[] }` |
| `GET /admin/metrics/:name` | admin | `{ metric: string, rows: Row[], generated_at: ISO string }`, or CSV when `format=csv` |

`CatalogEntry = { name: string, kind: "metric" | "people", meta: MetricMeta }`

`MetricMeta` is the JSON stored in `comment on function`:
```ts
{
  title: string;
  definition: string;
  unit: "count" | "currency" | "percent" | "ratio" | "seconds" | "tokens";
  shape: "timeseries" | "breakdown" | "kpi" | "table" | "funnel" | "cohort";
  breakdowns: Dimension[];          // dimensions allowed for p_breakdown ([] = none)
  filters: Dimension[];             // keys allowed in p_filters
  kb?: string;                      // KB path, e.g. "new_analysis/monetization/revenue_monthly_by_currency.md"
  consent_scoped?: boolean;         // label "of consenting users"
  alertable?: boolean;              // single-row KPI usable in alert rules
  min_group?: number;               // small-sample warning threshold (default 5)
}
```

`Dimension = "market" | "plan" | "locale" | "ai_flow" | "ai_model" | "ai_provider" | "template" | "onboarding_path" | "currency"`

## Metric query parameters (`GET /admin/metrics/:name`)

| Param | Format | Default | SQL arg |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | `to` − 29 days | `p_from date` |
| `to` | `YYYY-MM-DD` | today (UTC) | `p_to date` |
| `grain` | `day` \| `week` \| `month` | `day` | `p_grain text` |
| `currency` | `native` \| `usd` \| `try` | `usd` | `p_currency text` |
| `include_internal` | `true` \| `false` \| `1` \| `0` | `false` | `p_include_internal boolean` |
| `breakdown` | Dimension | none | `p_breakdown text` |
| `filters` | URL-encoded JSON object, Dimension → scalar or array of scalars (≤ 50 values) | `{}` | `p_filters jsonb` |
| `format` | `json` \| `csv` | `json` | — |

Validation:
- `from ≤ to`; span ≤ 1096 days; `name` matches `^[a-z][a-z0-9_]{0,62}$`.
- An unknown metric returns 404.
- SQLSTATE `22023` (invalid parameter, raised by the metric) → 400 `VALIDATION_ERROR`. `57014` (timeout) → 504 `ANALYTICS_TIMEOUT`. Analytics DB not configured → 503 `ANALYTICS_UNAVAILABLE`.

## SQL function contract

```sql
-- analytics.<metric>
create function analytics.<metric>(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb)
returns table (...)                 -- free shape; first column `bucket date` for timeseries
language sql | plpgsql stable security definer set search_path = ''
```

- **Ownership and grants:** functions are owned by `postgres`. EXECUTE goes to `analytics_api` through default privileges.
  - Each migration must end with `revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;`, because per-schema default privileges can't remove the built-in PUBLIC grant.
- **Comment:** `comment on function … is '<MetricMeta JSON>'`.
- **Timeseries columns:** a timeseries metric always returns `(bucket date, dimension text, <measures…>)`. `dimension` is `null` when no breakdown is requested, and holds the breakdown value otherwise.
- **Number types:** counts are `bigint`; money and ratios are `numeric`. The backend parses both to JS numbers. Dates are serialised as `YYYY-MM-DD` strings, timestamps as ISO strings.
- **Shared helpers** in `analytics_private`:
  - `assert_args(p_grain, p_currency, p_breakdown, p_filters, allowed_breakdowns text[], allowed_filters text[])` raises `22023`;
  - `buckets(p_from, p_to, p_grain) returns setof date` (week = ISO week starting Monday, UTC);
  - `resolve_range(p_from, p_to)` applies the defaults.
- **Contract check:** `analytics_private.contract_violations()` returns one row per violation (signature, volatility, security definer, search_path, comment JSON, grants). The SQL test and the Data health page expect zero rows.
