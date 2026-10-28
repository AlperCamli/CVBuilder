# CV Builder Admin

Internal analytics dashboard (`admin.jobspecificcv.com`). Specs live in [`../docs/admin-analytics`](../docs/admin-analytics); the HTTP contract with the backend is [`api-contract.md`](../docs/admin-analytics/api-contract.md).

## Local development

```bash
cp .env.example .env.local   # fill in the two Supabase values
npm install
npm run dev                  # http://localhost:5174, proxies /api to the backend on :4000
```

Run the backend (`../backend`, `npm run dev`) with your email in `ADMIN_EMAILS`. Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run preview` (serves `dist/` with the production security headers from `vercel.json`, CSP included).

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build here whenever `admin/**` changes.

## Data-era markers

Charts mark the KB's era cutoffs (`new_analysis/README.md`, "Era cutoffs") from the static list in `src/lib/eras.ts`. Each era names the metrics it affects. When the KB table changes, update that file too.

## User lookup (personal data)

`/users` and `/users/:id` call `POST /api/v1/admin/people/:name` with a JSON body (`src/lib/people.ts`), so search terms and user ids never appear in a URL. Every call, CSV exports included, is written to the audit log by the backend. The UI keeps these answers only while they're on screen (`staleTime: 0`, `gcTime: 0`) and never writes them to local or session storage. The search term lives in component state and in the `/users` history entry's state (back/forward restores it), never in the address bar; an old link with `?q=` is scrubbed on arrival. Restricted users appear as "Restricted user (no data shown)" with a shortened id and no link. Charts whose metric sets `meta.drill` open the users drawer (`drill_users`) on click instead of filtering the page.

## Metric pages

Monetization, AI cost, Engagement, Tailoring and Acquisition are declared as sections of metric names in `src/app/pages.ts`. `MetricChartCard` picks a renderer from the catalog's `meta.shape` (timeseries, breakdown, funnel, cohort, kpi, table), and every shape has a Table view. A metric the catalog doesn't list yet shows a compact "Not available yet" card and is never requested, so a page can ship before its SQL. Timeseries and cohort cards span the full width; breakdowns and funnels pair up, and a half card left alone stretches.

Optional meta keys the renderers read (see `api-contract.md`):

| Key | Shape | Effect |
|---|---|---|
| `breakdown_dimension` | breakdown, funnel | The `Dimension` held in `dimension`. Clicking a bar filters the page by it (or opens the users drawer when `drill` is set). |
| `plot` | timeseries | Measures drawn as separate series, colored in this order. Measures with different units get one chart each (never two y-axes). The page breakdown doesn't apply when there are 2+. |
| `stacked` | timeseries + `plot` | Stacked bars. Negative values (e.g. contraction, churn) stack below a zero line. |
| `flag_column` | timeseries | Boolean column. Flagged buckets get a marker, a legend key and a table column. The label comes from `measures[flag_column].label`, else the column name without `is_`. |
| `min_group` | all | Small-sample badge threshold. Muted cohort rows, badged bars and funnels. |

The first declared measure (or the column named like the metric) is the primary one. Drill-drawer filters add `step` (funnel), `cohort` + `period` (cohort), or the breakdown dimension (or `dimension` when there is none).

`VITE_FEATURE_RECOMPUTE=true` shows a disabled page-level Recompute button; Phase 4 wires it.

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Same Supabase project as the product. It must match the `connect-src` origin in the `vercel.json` CSP. |
| `VITE_SUPABASE_ANON_KEY` | Public anon key. Never put a service-role key here. |
| `VITE_API_BASE_URL` | Dev only, optional. Defaults to `/api/v1`. Production always uses `/api/v1` through the Vercel rewrite. |

## Sign-in

Google sign-in goes through Supabase Auth (PKCE). It only works on origins in the Supabase Auth redirect allow-list: `https://admin.jobspecificcv.com/**` and localhost (add `http://localhost:5174/**` if it isn't listed yet). **Vercel preview deployments can't sign in**; use localhost or production.

Signing out is local to this browser and leaves your product sessions alone. Access is decided by the backend (`GET /api/v1/admin/me` and every `/admin/*` call). The UI only reflects that decision.
