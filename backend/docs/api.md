# API Documentation (Phase 4C)

Base path:
- `/api/v1`

## Response Envelope

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

## Common Error Codes

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `AUTH_INVALID_TOKEN`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `BILLING_PLAN_INVALID`
- `BILLING_NOT_CONFIGURED`
- `BILLING_PROVIDER_ERROR`
- `BILLING_WEBHOOK_SIGNATURE_INVALID`
- `ENTITLEMENT_EXCEEDED`
- `EXPORT_GENERATION_FAILED`
- `EXPORT_STORAGE_FAILED`
- `EXPORT_NOT_READY`
- `INTERNAL_ERROR`

## Auth Rules

Protected endpoints require:

```http
Authorization: Bearer <supabase_access_token>
```

Only Stripe webhook endpoint is unprotected:
- `POST /billing/webhooks`

---

## Billing Endpoints (Phase 4C)

### 1) `GET /billing/plan`

Auth:
- required

Purpose:
- return effective current plan + subscription/provider summary + resolved entitlements

Response `200`:

```json
{
  "plan_code": "free|pro",
  "subscription_status": "inactive|active|trialing|...",
  "current_period_start": "iso|null",
  "current_period_end": "iso|null",
  "cancel_at_period_end": false,
  "provider": {
    "provider": "stripe",
    "provider_customer_id": "string|null",
    "provider_subscription_id": "string|null"
  },
  "entitlement_summary": {
    "plan_code": "free|pro",
    "can_generate_tailored_cv": true,
    "can_export_pdf": true,
    "can_export_docx": true,
    "can_use_ai_actions": true,
    "limits": {
      "tailored_cv_generations": 3,
      "exports": 5,
      "ai_actions": 20,
      "storage_bytes": 26214400
    },
    "remaining": {
      "tailored_cv_generations": 3,
      "exports": 5,
      "ai_actions": 20,
      "storage_bytes": 26214400
    }
  }
}
```

### 2) `GET /billing/usage`

Auth:
- required

Purpose:
- return current month usage counters with resolved limits and remaining

Response `200`:

```json
{
  "period_month": "YYYY-MM-01",
  "tailored_cv_generations_count": 0,
  "exports_count": 0,
  "ai_actions_count": 0,
  "storage_bytes_used": 0,
  "plan_code": "free|pro",
  "limits": {
    "tailored_cv_generations": 3,
    "exports": 5,
    "ai_actions": 20,
    "storage_bytes": 26214400
  },
  "remaining": {
    "tailored_cv_generations": 3,
    "exports": 5,
    "ai_actions": 20,
    "storage_bytes": 26214400
  }
}
```

### 3) `GET /billing/entitlements`

Auth:
- required

Purpose:
- return resolved entitlement booleans + limits + remaining for frontend gating

Response `200`:

```json
{
  "plan_code": "free|pro",
  "can_generate_tailored_cv": true,
  "can_export_pdf": true,
  "can_export_docx": true,
  "can_use_ai_actions": true,
  "limits": {
    "tailored_cv_generations": 3,
    "exports": 5,
    "ai_actions": 20,
    "storage_bytes": 26214400
  },
  "remaining": {
    "tailored_cv_generations": 3,
    "exports": 5,
    "ai_actions": 20,
    "storage_bytes": 26214400
  }
}
```

### 4) `POST /billing/checkout`

Auth:
- required

Body:

```json
{
  "plan_code": "pro",
  "success_url": "https://optional-success-url",
  "cancel_url": "https://optional-cancel-url"
}
```

Behavior:
- validates requested plan
- ensures Stripe customer linkage
- creates Stripe Checkout session for subscription mode

Response `200`:

```json
{
  "checkout_url": "https://checkout.stripe.com/...",
  "checkout_session_id": "cs_...",
  "plan_code": "pro",
  "plan_name": "Pro"
}
```

### 5) `POST /billing/portal`

Auth:
- required

Body:

```json
{
  "return_url": "https://optional-return-url"
}
```

Behavior:
- requires existing Stripe customer linkage
- creates Stripe Billing Portal session

Response `200`:

```json
{
  "portal_url": "https://billing.stripe.com/..."
}
```

### 6) `POST /billing/webhooks`

Auth:
- none

Headers:
- `stripe-signature: <signature>`

Body:
- raw Stripe JSON payload (signature is validated against webhook secret)

Behavior:
- processes relevant Stripe lifecycle events
- syncs subscription state into `subscriptions`

Response `200`:

```json
{
  "received": true,
  "event_id": "evt_...",
  "event_type": "customer.subscription.updated",
  "processed": true
}
```

Possible errors:
- `BILLING_WEBHOOK_SIGNATURE_INVALID`
- `BILLING_NOT_CONFIGURED`

---

## Updated Existing Endpoints

### 7) `GET /me`

Auth:
- required

Phase 4C response additions:
- `entitlements`
- real `current_plan` and `usage_summary` from billing resolution

### 8) `GET /me/usage`

Auth:
- required

Phase 4C behavior:
- returns real usage + limits + remaining (not placeholder null limits)

### 9) `GET /dashboard`

Auth:
- required

Phase 4C response additions:
- real `current_plan`
- real `usage_summary`
- `entitlements`

---

## Backend Enforcement Points

Even if frontend pre-checks entitlements, backend remains source of truth.

Protected action enforcement:
- `POST /ai/tailored-cv-draft`
- `POST /ai/blocks/suggest`
- `POST /ai/blocks/options`
- `POST /tailored-cvs/:tailoredCvId/exports/pdf`
- `POST /tailored-cvs/:tailoredCvId/exports/docx`

Exceeded access returns:
- `ENTITLEMENT_EXCEEDED`

Ownership behavior remains user-scoped for protected resources.
