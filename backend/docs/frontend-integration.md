# Frontend Integration Note (Phase 4C)

Frontend remains the UI source of truth (React + Vite).

Phase 4C backend adds billing and entitlement contracts for pricing/account flows without requiring frontend architecture rewrite.

## Auth

All billing/account endpoints except webhooks require:

```http
Authorization: Bearer <supabase_access_token>
```

## Pricing Page Integration

Load plan context with:
- `GET /api/v1/billing/plan`
- `GET /api/v1/billing/entitlements`
- optional `GET /api/v1/billing/usage` for detailed meter cards

Use:
- `plan_code`
- `subscription_status`
- `limits`
- `remaining`
- capability booleans (`can_*`)

## Upgrade Flow (Checkout)

1. User selects paid plan.
2. Frontend calls:
   - `POST /api/v1/billing/checkout`
3. Body:

```json
{
  "plan_code": "pro",
  "success_url": "http://localhost:5173/app/pricing?checkout=success",
  "cancel_url": "http://localhost:5173/app/pricing?checkout=cancel"
}
```

4. On success, redirect browser to `data.checkout_url`.
5. On return, refresh billing state endpoints.

## Customer Portal Flow

Call:
- `POST /api/v1/billing/portal`

Body is optional; can provide return URL:

```json
{
  "return_url": "http://localhost:5173/app/pricing"
}
```

Open `data.portal_url`.

## Entitlement Loading Flow

Recommended startup sequence for account-aware pages:
1. `GET /api/v1/me`
2. `GET /api/v1/billing/entitlements` (or use `me.entitlements`)
3. `GET /api/v1/billing/usage` when detailed counters are shown

This supports:
- button disabled states
- upgrade prompts
- remaining-usage badges

## Usage Display Behavior

Use `limits` + `remaining` from usage or entitlements payloads.

Rules:
- `null` limit => show "Unlimited"
- numeric limit => show `used / limit` and `remaining`

Counters returned:
- `tailored_cv_generations_count`
- `exports_count`
- `ai_actions_count`
- `storage_bytes_used`

## Handling Gated Action Failures

Protected action endpoints can return:
- `ENTITLEMENT_EXCEEDED`

Suggested frontend behavior:
1. show clear upgrade/limit modal
2. refresh `GET /billing/entitlements` and `GET /billing/usage`
3. keep user on current screen (do not lose draft form state)

## `/me` and `/dashboard` Integration

Phase 4C updates these payloads with real billing data:
- `/me` includes `current_plan`, `usage_summary`, `entitlements`
- `/dashboard` includes `current_plan`, `usage_summary`, `entitlements`
- `/me/usage` includes real limits + remaining

## English-Only Assumptions

Backend responses and docs are English-only in this phase.

Compatibility note:
- existing `locale` field can still appear in account payloads
- no backend localization or translation behavior should be expected
