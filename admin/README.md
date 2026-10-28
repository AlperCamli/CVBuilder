# CV Builder Admin

Internal analytics dashboard (`admin.jobspecificcv.com`). Specs live in [`../docs/admin-analytics`](../docs/admin-analytics); the HTTP contract with the backend is [`api-contract.md`](../docs/admin-analytics/api-contract.md).

## Local development

```bash
cp .env.example .env.local   # fill in the two Supabase values
npm install
npm run dev                  # http://localhost:5174, proxies /api to the backend on :4000
```

Run the backend (`../backend`, `npm run dev`) with your email in `ADMIN_EMAILS`. Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run preview` (serves `dist/` with the production security headers from `vercel.json`, CSP included).

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Same Supabase project as the product. It must match the `connect-src` origin in the `vercel.json` CSP. |
| `VITE_SUPABASE_ANON_KEY` | Public anon key. Never put a service-role key here. |
| `VITE_API_BASE_URL` | Dev only, optional. Defaults to `/api/v1`. Production always uses `/api/v1` through the Vercel rewrite. |

## Sign-in

Google sign-in goes through Supabase Auth (PKCE). It only works on origins in the Supabase Auth redirect allow-list: `https://admin.jobspecificcv.com/**` and localhost (add `http://localhost:5174/**` if it isn't listed yet). **Vercel preview deployments can't sign in**; use localhost or production.

Signing out is local to this browser and leaves your product sessions alone. Access is decided by the backend (`GET /api/v1/admin/me` and every `/admin/*` call). The UI only reflects that decision.
