# Environment Variables

## Required (Core Runtime)

- `SUPABASE_URL`
  - Supabase project URL.

- `SUPABASE_ANON_KEY`
  - Supabase anon key, used for auth-related client contexts.

- `SUPABASE_SERVICE_ROLE_KEY`
  - Supabase service role key, used by backend repositories.

## Required for Stripe Billing Runtime (Phase 4C)

- `STRIPE_SECRET_KEY`
  - Stripe secret API key.

- `STRIPE_WEBHOOK_SECRET`
  - Stripe webhook signing secret for `/api/v1/billing/webhooks`.

- `STRIPE_PRO_PRICE_ID`
  - Stripe price id mapped to backend `pro` plan.

## Recommended / Optional

- `APP_NAME` (default: `cv-builder-backend`)
- `APP_ENV` (`development` | `test` | `staging` | `production`, default: `development`)
- `APP_VERSION` (default: `0.1.0`)
- `PORT` (default: `4000`)
- `LOG_LEVEL` (default: `info`)
- `FRONTEND_APP_URL` (default: `http://localhost:5173`)
- `AI_PROVIDER` (default: `mock`)
- supported values: `mock`, `gemini`
- Phase 5 production target is `gemini` (no silent fallback to other providers)
- `AI_DEFAULT_MODEL` (default: `mock-cv-builder-v1`)
- `AI_PROMPT_PROFILE` (default: `phase3-v1`)
- `GEMINI_API_KEY` (required when `AI_PROVIDER=gemini`)
- `AI_GEMINI_MODEL_LIGHT` (default: `gemini-3-flash`)
- `AI_GEMINI_MODEL_HEAVY` (default: `gemini-2.5-flash`)
- `AI_GEMINI_MAX_ATTEMPTS` (default: `1`, min `1`, max `8`)
- `AI_GEMINI_RETRY_BASE_DELAY_MS` (default: `1000`, min `100`, max `60000`)
- `AI_GEMINI_RETRY_MAX_DELAY_MS` (default: `16000`, min `200`, max `120000`, must be `>= AI_GEMINI_RETRY_BASE_DELAY_MS`)
- `EXPORTS_STORAGE_BUCKET` (default: `exports`)
- `EXPORT_DOWNLOAD_URL_TTL_SECONDS` (default: `600`, min `60`, max `86400`)
- `PDF_OCR_ENABLED` (default: `true`, defaults to `false` in `test` runtime)
- `PDF_OCR_LANGUAGES` (default: `eng`, passed to Tesseract OCR)
- `PDF_OCR_MAX_PAGES` (default: `2`, min `1`, max `10`)
- `PDF_OCR_RENDER_SCALE` (default: `2`, min `1`, max `4`)
- `PDF_OCR_CACHE_PATH` (default: `/tmp/cv-builder-ocr-cache`)
- `BILLING_CHECKOUT_SUCCESS_URL` (default: `${FRONTEND_APP_URL}/app/pricing?checkout=success`)
- `BILLING_CHECKOUT_CANCEL_URL` (default: `${FRONTEND_APP_URL}/app/pricing?checkout=cancel`)
- `BILLING_PORTAL_RETURN_URL` (default: `${FRONTEND_APP_URL}/app/pricing`)

## Validation Behavior

- env vars are validated at startup.
- invalid values fail startup with configuration error.
- Stripe env vars are optional for generic runtime, but billing endpoints require them to be configured at runtime.
