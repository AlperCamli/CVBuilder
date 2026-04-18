# Rendering Contract (Phase 4A)

## Goal

Provide one stable, template-aware payload that can be consumed by:
- frontend live preview
- future PDF export pipeline
- future DOCX export pipeline

without redesigning canonical stored CV content.

## Strategy

Preview endpoints return both:
- canonical `current_content` (editor state)
- normalized `rendering` payload (display/export contract)

This is applied consistently to:
- `GET /master-cvs/:masterCvId/preview`
- `GET /tailored-cvs/:tailoredCvId/preview`
- `POST /rendering/preview` (unsaved content path)

## Canonical vs Rendering Payload

Canonical:
- source of truth stored in `master_cvs.current_content` / `tailored_cvs.current_content`
- preserves full structured edit model

Rendering:
- deterministic normalized projection for display/export
- block-oriented for debugging and future export mapping
- includes derived text fields for consistent presentation

## Render Payload Shape (v1)

Top-level:
- `version: "v1"`
- `document`
  - `kind` (`master|tailored`)
  - `id`
  - `title`
  - `language`
  - `generated_at`
  - `updated_at`
  - `context` (optional route-specific metadata)
- `template`
  - `resolution` (`selected|default_active|none`)
  - `template` metadata or `null`
- `sections[]`
  - ordered by `order`
  - each section contains ordered `blocks[]`
- `plain_text` (document-level flattened text)

Section shape:
- `id`, `type`, `title`, `order`, `meta`
- `blocks[]`
- `plain_text`

Block shape:
- `id`, `type`, `order`, `visibility`, `fields`, `meta`
- `normalized_fields`:
  - per field: `raw`, `text_items`, `text`
- `derived`:
  - `headline`
  - `subheadline`
  - `bullets`
  - `date_range`
  - `location`
- `plain_text`

## Template Application Rules

Assignment endpoints:
- non-null template IDs must exist and be `active`
- `null` is allowed (unassign)

Rendering resolution:
- if explicit template is set/provided, it is used (`selected`)
- if template is null, system tries default active template (`default_active`)
- if no active template exists, resolution becomes `none`

Preview of previously assigned inactive templates:
- allowed for existing CV preview endpoints to keep old documents renderable
- marked via returned template status in `selected_template/template`

## Preview Endpoint Behavior

`GET /master-cvs/:id/preview` and `GET /tailored-cvs/:id/preview`:
- do not mutate stored records
- return canonical + rendering payload
- include resolved template summary

`POST /rendering/preview`:
- normalizes raw `current_content`
- resolves template selection
- returns rendering payload
- does not persist any data

## Assumptions for Future PDF/DOCX Phases

- Export services will consume `rendering` payload as stable input.
- Export engines should not directly parse raw editor payload in multiple places.
- Any new render-derived fields should be additive under `rendering` while preserving `version`.
- Canonical content model remains unchanged; rendering remains a transformation layer.
