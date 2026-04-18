# Phase 3 Architecture Note

This document summarizes how Phase 3 extends existing backend architecture without changing frozen decisions.

## Frozen Decisions Reconfirmed

- modular monolith remains intact
- React + Vite frontend remains UI source of truth
- Supabase remains DB/auth/storage
- Vercel remains deployment target
- Master CV and Tailored CV remain separate tables
- Tailored CV remains core product object with full current snapshot storage

## New/Extended Modules

- `ai`
  - provider abstraction
  - flow registry
  - AI run lifecycle persistence
  - suggestion persistence and apply/reject coordination
- `cv-revisions`
  - block revision creation, retrieval, compare, restore
- `tailored-cv` (extended)
  - manual block edits now create revisions
- `master-cv` and `jobs` (reused)
  - source/context inputs for AI flows

## AI Architecture Summary

- `AiProvider` defines provider boundary.
- `AI_FLOW_REGISTRY` defines flow metadata and output contracts.
- `AiService.executeFlow` centralizes run persistence + output validation + failure persistence.
- Suggestion flows persist pending suggestions first; apply/reject is explicit.

## Revision Architecture Summary

- `cv_block_revisions` stores immutable block snapshots.
- revision number is generated centrally in `CvRevisionsService`.
- restore is additive (`change_source = restore`) and non-destructive.
- compare endpoint returns practical structured diff payload.

## Why Phase 3 Did Not Restructure Existing System

Phase 3 changes were additive and service-layer oriented, preserving:
- existing route conventions
- existing response/error envelopes
- existing ownership checks
- existing CV content model compatibility

For detailed endpoint/data contracts, see:
- `docs/api.md`
- `docs/database-schema.md`
- `docs/ai-flows.md`
- `docs/revision-system.md`
