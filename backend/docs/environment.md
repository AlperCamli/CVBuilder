# Environment Variables

Required:

- `SUPABASE_URL`
  - Supabase project URL.

- `SUPABASE_ANON_KEY`
  - Supabase anon key, used for auth-related client contexts.

- `SUPABASE_SERVICE_ROLE_KEY`
  - Supabase service role key, used by backend repositories.

Recommended:

- `APP_NAME` (default: `cv-builder-backend`)
- `APP_ENV` (`development` | `test` | `staging` | `production`, default: `development`)
- `APP_VERSION` (default: `0.1.0`)
- `PORT` (default: `4000`)
- `LOG_LEVEL` (default: `info`)
- `FRONTEND_APP_URL` (default: `http://localhost:5173`)
- `AI_PROVIDER` (default: `mock`)
- `AI_DEFAULT_MODEL` (default: `mock-cv-builder-v1`)
- `AI_PROMPT_PROFILE` (default: `phase3-v1`)

Validation behavior:
- env vars are validated at startup.
- process exits with configuration error if required vars are missing or invalid.
