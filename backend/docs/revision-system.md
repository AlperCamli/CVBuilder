# Revision System Documentation (Phase 3)

## Purpose

Phase 3 introduces block-level immutable revision history for CV edits.

Primary storage:
- `cv_block_revisions`

## Revision Creation Rules

A new revision is created when:
- manual tailored block patch is accepted (`PATCH /tailored-cvs/:tailoredCvId/blocks/:blockId`)
- AI suggestion is applied (`POST /ai/suggestions/:suggestionId/apply`)
- prior revision is restored (`POST /revisions/:revisionId/restore`)

Current Phase 3 write paths use:
- `change_source = manual`
- `change_source = ai`
- `change_source = restore`

Reserved for later use:
- `import`
- `system`

## Stored Snapshot

Each revision stores:
- `block_id`
- `block_type`
- `revision_number` (per block scope)
- `content_snapshot` (full block JSON at commit time)
- metadata (`change_source`, optional `ai_suggestion_id`, created timestamps/users)

## Revision Numbering

Revision number is allocated centrally in `CvRevisionsService` using repository lookup of latest number in the block scope.

Current active scope in Phase 3 flows:
- `cv_kind = tailored`
- keyed by `(tailored_cv_id, block_id)`

Database also keeps schema compatibility for future `master` block revisions.

## Manual vs AI vs Restore Behavior

Manual block patch:
- block is updated in current tailored content
- new revision row created (`manual`)

AI apply:
- suggestion must be `pending`
- backend checks block applicability (before-snapshot consistency)
- block updated to `suggested_content`
- new revision row created (`ai`) with `ai_suggestion_id`
- suggestion marked `applied`

AI reject:
- suggestion marked `rejected`
- no current content change
- no revision created

Restore:
- selected historical snapshot is loaded
- current block replaced with restored snapshot
- new revision row created (`restore`)
- previous revisions remain untouched

## Restore Rules

- restore is block-level only
- restore is additive and non-destructive
- history is never overwritten/deleted by restore endpoint
- if target block no longer exists in current content, restore returns applicability error

## Revision Endpoints

- `GET /tailored-cvs/:tailoredCvId/revisions`
- `GET /tailored-cvs/:tailoredCvId/blocks/:blockId/revisions`
- `GET /revisions/:revisionId`
- `POST /revisions/:revisionId/restore`
- `POST /revisions/compare`

## Compare Endpoint Behavior

Phase 3 compare endpoint returns practical diff payload:
- same CV/block checks
- changed block type/visibility/order flags
- changed `fields` keys
- changed `meta` keys
- full before/after snapshots

Limitations:
- not a semantic text diff engine
- not a visual/export diff

## Frontend Notes

Frontend can:
- show revision timeline per CV or per block
- load detail snapshot for inspection
- run compare for inline "what changed" indicators
- restore prior block versions safely

`change_source` is persisted now even if current UI does not expose it yet.
