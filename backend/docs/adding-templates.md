# Adding New Templates to CV Builder

This guide explains how to add new CV templates to the CV Builder platform. Templates dictate the final visual layout of the CV when rendering or exporting.

## 1. Database Schema Overview

Templates are tracked in the database using the `cv_templates` table. This allows the backend to validate whether an assigned template is valid or `active` before rendering.

The schema for the `cv_templates` table includes:
- `id` (uuid): Unique identifier.
- `name` (text): Human-readable name of the template (e.g., "Modern Clean").
- `slug` (text): A unique slug used as the identifier (e.g., "modern-clean").
- `status` (text): Can be `active` or `inactive`. Only `active` templates can be selected by users.
- `preview_config` (jsonb): Frontend configurations for live preview generation.
- `export_config` (jsonb): Configurations for external export services (like PDF/DOCX exporters).

## 2. Process for Adding a Template

### Step A: Database Insertion
To add a new template, insert a new record into the `cv_templates` table. You can do this by creating a new database migration or adding to `seed.sql`.

Example SQL to add a template:
```sql
INSERT INTO public.cv_templates (name, slug, status, preview_config, export_config)
VALUES (
  'Executive Timeline',
  'executive-timeline',
  'active',
  '{"preview": "v1"}'::jsonb,
  '{"pdf": {"enabled": true}, "docx": {"enabled": true}}'::jsonb
);
```

### Step B: Frontend Implementation
The frontend receives the selected template as part of the `RenderingPreviewResponse` payload from the backend.

1. **Create the Template Component**: 
   Develop a React component (e.g. `ExecutiveTimelineTemplate.tsx`) that accepts a `document`, `sections`, and `plain_text` from the `RenderingPayload`.
2. **Handle Block Iteration**: 
   Use the `RenderingBlockDerived` object which contains pre-extracted `headline`, `subheadline`, `bullets`, `date_range`, and `location` to construct the layout seamlessly, regardless of the core data structure of the block.
3. **Register the Component**:
   Map the template's database `slug` to the corresponding React component in your template registry so the Live Preview correctly selects the new template.

### Step C: Exporter Implementation (Optional)
If your PDF or DOCX generation microservice is isolated from the React frontend, you will need to add a matching HTML/CSS template to the exporter logic. The exporter will rely on the `slug` identifier to apply the correct layout.

## 3. Creating Test Templates
During development, you may want to test the template infrastructure without impacting production. To do this, simply add a template with the `status` set to `inactive` or use a test slug (e.g., `test-template-v1`).

Current example in `supabase/seed.sql`:
- `template-playground` (`status='inactive'`) to validate registry/listing behavior without exposing it to end users.
