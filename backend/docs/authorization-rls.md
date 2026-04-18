# Authorization and RLS Strategy (Phase 2)

## Backend Authorization (Primary)

Backend service layer remains the primary authorization boundary.

Implemented behavior:
- bearer token validation through Supabase Auth
- authenticated request context (`authUser`, `appUser`)
- user-scoped repository access for all protected Phase 2 resources

Protected Phase 2 resources:
- `master_cvs`
- `tailored_cvs`
- `imports`
- `jobs`
- `files`

## Ownership Rules

- users can only read/write their own rows
- soft-deleted CVs are excluded from normal list/detail reads
- tailored creation requires source Master CV ownership
- import conversion creates owned Master CV and links back through import

## Supabase RLS (Defense in Depth)

RLS is enabled on all Phase 1 + Phase 2 tables.

Phase 2 policies add self-access controls for:
- `master_cvs`
- `tailored_cvs`
- `imports`
- `jobs`
- `files`

Policy model uses:
- `public.is_current_user(user_id)` helper

## Service Role Note

Repositories use Supabase service-role client.

Implication:
- service-role bypasses RLS
- backend code must continue explicit user-scoping and ownership checks

## Deferred to Later Phases

- richer authorization around collaboration/sharing
- admin/debug actor policies
- storage signed URL hardening and export-delivery auth flows
