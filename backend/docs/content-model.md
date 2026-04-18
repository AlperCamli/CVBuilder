# CV Content Model (Phase 2)

Both tables use the same model:
- `master_cvs.current_content`
- `tailored_cvs.current_content`

This is a block-oriented, editor-friendly JSON model used directly by Phase 3 revision and AI suggestion flows.

## Canonical Shape

```json
{
  "version": "v1",
  "language": "en",
  "metadata": {
    "full_name": "",
    "headline": "",
    "email": "",
    "phone": "",
    "location": ""
  },
  "sections": [
    {
      "id": "summary-<uuid>",
      "type": "summary",
      "title": "Summary",
      "order": 0,
      "meta": {},
      "blocks": [
        {
          "id": "summary-<uuid>",
          "type": "summary",
          "order": 0,
          "visibility": "visible",
          "fields": {
            "text": "..."
          },
          "meta": {
            "revision_anchor": null,
            "ai_suggestion_state": "none"
          }
        }
      ]
    }
  ]
}
```

## Design Rules

- same schema for Master and Tailored CVs
- section-level grouping with ordered blocks
- block IDs are stable identifiers for update and future revision history
- `fields` and `meta` are structured JSON records for extensibility
- `visibility` supports editor/show-hide behavior

## Stable ID Expectations

- each section must have stable `section.id`
- each block must have stable `block.id`
- `normalizeCvContent` auto-generates missing IDs
- duplicate IDs are re-generated to enforce uniqueness

## Block Update Rules

Endpoints:
- `PATCH /master-cvs/:masterCvId/blocks/:blockId`
- `PATCH /tailored-cvs/:tailoredCvId/blocks/:blockId`

Patch contract:
- `type?`
- `order?`
- `visibility?`
- `fields?`
- `meta?`
- `replace_fields?` (default merge)

Behavior:
- block is found by `blockId` across all sections
- ID is never replaced
- `fields` merge by default (shallow)
- set `replace_fields=true` for full fields replacement
- returns updated block + section + full CV detail payload

## Full Content Replacement Rules

Endpoints:
- `PUT /master-cvs/:masterCvId/content`
- `PUT /tailored-cvs/:tailoredCvId/content`

Behavior:
- validates and normalizes supplied content
- preserves canonical shape
- rehydrates missing IDs/orders if needed
- keeps model compatible for future revisions and AI workflows

## Preview Normalization

Preview endpoints return:
- `cv` metadata
- canonical `current_content`
- `preview`

`preview` includes:
- sorted sections/blocks (by `order`)
- `plain_text` aggregation for lightweight rendering/search previews
- `generated_at` timestamp

If frontend prefers, it can render directly from `current_content`. Preview payload is stable convenience output.

## Future Compatibility Hooks

Current model reserves extension space via `meta` fields and keeps block IDs stable for:
- block-level revision history
- AI suggestion diff/approval payloads
- export rendering pipelines
- localization overlays

## Phase 3 Active Usage

- manual tailored block edits create block revisions using `block.id` lookup
- AI suggestions persist `before_content` and `suggested_content` as block snapshots keyed by `block.id`
- AI apply and revision restore both replace current block content by stable `block.id`
