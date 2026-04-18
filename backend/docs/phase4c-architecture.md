# Architecture Note (Phase 4C)

## Frozen Decisions Reconfirmed

- Frontend remains React + Vite and is the UI source of truth.
- Backend remains TypeScript.
- Supabase remains database/auth/storage.
- Vercel remains deployment target.
- Backend remains modular monolith.
- Master CV and Tailored CV remain separate concepts/tables.
- Tailored CV remains the core product object.
- Tailored CV snapshots remain full current snapshots.
- Block-level revision compatibility remains unchanged.
- Stripe is the only payment provider.
- Backend support is English-only in this phase.

## How Phase 4C Extends Earlier Phases

Phase 4C extends Phase 1-4B without redesign:
- keeps route/controller/service/repository layering
- keeps centralized error envelope and auth/session model
- keeps existing AI, rendering, export, and dashboard modules
- adds billing + entitlements + usage as additive modules
- injects entitlement enforcement into existing AI/export service boundaries

No microservices were introduced.

## Module Responsibilities (Phase 4C)

### `billing`
- Stripe Checkout session creation
- Stripe customer portal session creation
- Stripe webhook signature validation + lifecycle handling
- subscription state synchronization into `subscriptions`
- user-to-Stripe customer linkage persistence
- current plan/usage/entitlement API responses

### `entitlements`
- centralized plan definitions (`free`, `pro`)
- effective plan resolution from subscription status
- limit + remaining resolution from usage counters
- action-level entitlement decisions for backend enforcement

### `usage`
- current period usage loading from `usage_counters`
- atomic monthly counter increments through DB function
- increment helpers for:
  - tailored CV generation
  - exports
  - AI actions

### `users` (extended)
- `/me` now returns real billing-aware `current_plan`, `usage_summary`, and `entitlements`
- `/me/usage` returns real limits + remaining values

### `dashboard` (extended)
- dashboard payload now includes real `current_plan`, `usage_summary`, and `entitlements`

## Stripe Integration Rationale

Chosen approach:
- central Stripe gateway abstraction in `billing`
- webhook-driven subscription synchronization
- provider IDs persisted in `subscriptions` rows
- pricing plan mapping by Stripe `price_id`

This keeps payment complexity centralized and avoids provider calls scattered across modules.

## Freemium Gating Strategy

Plan logic is centralized in `entitlements`.

Backend gating is enforced server-side for:
- AI tailored draft generation (`/ai/tailored-cv-draft`)
- AI block suggestion actions (`/ai/blocks/suggest`, `/ai/blocks/options`)
- export generation (`/tailored-cvs/:id/exports/pdf`, `/tailored-cvs/:id/exports/docx`)

Usage consumption rules:
- consume tailored generation usage only when draft generation succeeds
- consume AI action usage only when suggestions are successfully created
- consume export usage only when export reaches completed state
- failed operations do not consume usage

## English-Only Backend Decision

Phase 4C keeps backend contracts and behavior English-only:
- no multilingual response system added
- no translation framework added
- existing `locale` field compatibility remains unchanged for low-cost backward compatibility

## Forward Compatibility

Phase 4C keeps interfaces ready for later hardening phases:
- observability: centralized billing service and webhook handler are clear instrumentation points
- security/privacy: centralized provider integration and entitlement checks are easy to audit
- launch hardening: plan catalog and gating logic are centralized and extensible
