# CV Modules: Job-Specific CV Infrastructure and Implementation Guide

This document specifies the infrastructure for **job-specific CV modules** — bundles of section taxonomy, AI prompts, parser hints, templates, and validation rules that coexist with the standard CV builder — and walks through the first module, `medical_uk` (UK medical doctor / NHS CVs). It is written to be reused as the playbook for future modules (academic, legal, …).

Requirements input: `medical-cv-gap-analysis.md`.

## Overview and Goals

- **Coexistence, not replacement.** Modules live alongside the standard builder. The standard experience must remain byte-identical — every module hook is additive with a fall-through to existing code.
- **One abstraction, many modules.** The medical module must not be a medical-specific fork. Everything medical-shaped lives in one module definition; the infrastructure is generic.
- **Entry-point agnostic.** How users reach a module (separate landing page, dashboard toggle, dedicated flow) is deliberately undecided. A CV *knows its module* (`module_type` on the row); the editor and all services read it from the loaded CV. Any future entry point only needs to create a CV with the right `module_type`.
- **Full feature parity.** A module CV supports the same lifecycle: create from scratch, import + parse, AI improve (import-improve and block suggestions), edit, preview, export — and later tailoring and cover letters.

## Architecture

### The `CvModuleDefinition` contract

A module is a typed, code-defined bundle. Backend home: `backend/src/shared/cv-modules/`.

```typescript
// backend/src/shared/cv-modules/cv-module.types.ts
import type { CvJsonValue } from "../cv-content/cv-content.types";

export interface CvModuleDefinition {
  id: string;                              // "standard" | "medical_uk" | future ids
  label: string;                           // display name
  promptProfile: string | null;            // ai_prompt_configs.profile; null => env profile (standard)
  sectionCatalog: SectionTypeDefinition[];
  parserSectionHints: ParserSectionHint[]; // merged into SimpleCvParser
  templateSlugs: string[];                 // gallery filter
  defaultTemplateSlug: string;
  validation?: ModuleValidationRules;      // e.g. discourage photo for medical
}

export interface SectionTypeDefinition {
  type: string;                            // CvSection.type value
  title: string;                           // default section title
  essential: boolean;                      // mirrors AddContentModal semantics
  description: string;
  defaultOrder: number;
  blockType: string;                       // CvBlock.type for new blocks
  fieldSchema: FieldDescriptor[];          // drives generic editor forms + AI awareness
  defaultBlockFields: Record<string, CvJsonValue>;
}

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "select" | "bullets" | "boolean";
  options?: string[];                      // for kind: "select"
  required?: boolean;
}

export interface ParserSectionHint {
  type: string;                            // section type to emit
  aliases: string[];                       // heading matches (SimpleCvParser shape)
  keywords: string[];                      // content signals (SimpleCvParser shape)
}

export interface ModuleValidationRules {
  discouragePhoto?: boolean;               // soft warning only
  discouragedMetadataFields?: string[];    // e.g. date_of_birth
}
```

Files:

- `backend/src/shared/cv-modules/cv-module.types.ts` — the contract above.
- `backend/src/shared/cv-modules/standard.module.ts` — encodes today's twelve generic types. Exists for completeness and documentation; **no existing code path is rewired through it** (see the no-change guarantee below).
- `backend/src/shared/cv-modules/medical-uk.module.ts` — the medical definition (worked example below).
- `backend/src/shared/cv-modules/module-registry.ts`:

```typescript
export const DEFAULT_MODULE_ID = "standard";
export function getCvModule(id: string | null | undefined): CvModuleDefinition; // unknown/null -> standard
export function isKnownCvModule(id: string): boolean;                           // app-level validation
```

### Code vs DB responsibilities

| Concern | Lives in | Rationale |
|---|---|---|
| Module definition (catalog, field schemas, defaults, parser hints, profile name, template slugs) | **Code** (TS registry, backend + frontend mirror) | Versioned with code, type-checked, needed at build time by editor components and validation |
| Which module a CV belongs to | **DB** — `module_type` column on `master_cvs` / `tailored_cvs` | Queryable; survives AI content regeneration; drives prompt/template/parser selection per request |
| AI prompts | **DB** — `ai_prompt_configs` rows under the module's `profile` | Already DB-driven; prompts iterate without deploys |
| Template metadata | **DB** (`cv_templates` + `module_type` column) and code (`TEMPLATE_PROFILES` entries) | Matches the existing metadata/profile split (`adding-templates.md`) |

### Frontend mirror registry

There is no shared package between `frontend/` and `backend/`, and the frontend registry must bind things an API cannot deliver (lucide icons, React section components). So the registry is **mirrored**:

- `frontend/src/app/modules/cv-module.types.ts` — same contract plus UI bindings (`icon`, `sectionComponents: Record<string, ComponentType>`).
- `frontend/src/app/modules/standard.module.ts` — catalog equals the current `AddContentModal` `contentTypes` list.
- `frontend/src/app/modules/medical-uk.module.ts`
- `frontend/src/app/modules/module-registry.ts` — also resolves `(moduleId, sectionType) → component`, with `GenericSection` as the final fallback.

**Drift guard:** the shared contract is the set of section-type ids and field descriptor keys per module. Keep a JSON fixture (e.g. `*/cv-modules/fixtures/<module>.sections.json`) asserted by a unit test on each side so the mirrors cannot silently diverge. A `GET /api/v1/cv-modules` endpoint can replace the mirror later if definitions ever need to be dynamic; the design does not require it.

### The `standard` module identity and the no-change guarantee

The reserved id `standard` represents today's behavior. The guarantee that existing users see zero change is enforced structurally:

1. **DB defaults**: `module_type text not null default 'standard'` — every existing row becomes `standard` with no backfill.
2. **"Not consulted" guard**: every module hook is written as `if (moduleType !== "standard") { /* registry lookup */ } /* existing code unchanged */`. For standard CVs the registry is not even consulted, making the no-change property trivially auditable in review.
3. **Prompt resolver**: when no per-request profile is passed, behavior is byte-identical to today (same constructor profile, same cache path).
4. **Template gallery**: list endpoints default their filter to `standard`.
5. **Fallback identity**: `getCvModule(null | unknown)` returns `standard`, so missing/garbage values degrade to current behavior, never to errors.

### Database: `module_type` columns

Next migration in sequence (current head is `20260603170000_phase12_...`):

```sql
-- 20260611120000_phase13_cv_modules.sql
alter table public.master_cvs   add column module_type text not null default 'standard';
alter table public.tailored_cvs add column module_type text not null default 'standard';
alter table public.cv_templates add column module_type text not null default 'standard';
```

Decisions:

- **No CHECK constraint** on allowed values — the app validates against the registry (`isKnownCvModule`), so adding a module needs no DB migration for the column.
- **Column over `CvContent.metadata`**: AI flows regenerate `current_content` wholesale and could drop a metadata marker; a column is also queryable (dashboard filters, analytics). Optionally mirror it into `metadata` informationally for exports.
- **Column over inference from section types**: inference is fragile (mixed/partial CVs) and circular (the parser needs the module before sections exist).
- **Tailored CVs inherit** `module_type` from their master at creation (one line in the tailored-cv creation service).

## Subsystem Integration

### AI prompts per module

Current state (`backend/src/modules/ai/prompts/prompt-resolver.ts`): one `AiPromptResolver` instance is constructed with the env profile (`AI_PROMPT_PROFILE`, e.g. `phase3-v1`) and a single `cacheState`; `ai.service.ts` resolves per flow/action with in-code fallbacks from `backend/src/modules/ai/flows/flow-registry.ts`. One global profile per deployment cannot serve coexisting module types.

Additive changes:

1. **Per-request profile** — `ResolveAiPromptInput` gains optional `profile?: string`; the single `cacheState` becomes `Map<string, PromptCacheState>` keyed by profile. When `profile` is absent, the constructor profile is used — today's behavior exactly.
2. **Cross-profile fallback chain** — when a profile *is* passed: module profile row → constructor (env) profile row → in-code flow-registry fallback. Consequences: a module CV can use *every* flow (job analysis, tailoring, cover letters) before module-specific prompts exist for them, and a missing module prompt can never break a request.
3. **Threading** — `resolvePromptForFlow(...)` in `ai.service.ts` gains optional `prompt_profile?: string | null`. Call sites that operate on a CV already load the CV row; they look up `getCvModule(cv.module_type).promptProfile` and pass it. Repositories add `module_type` to their row mappers. Standard CVs pass `null`.
4. **Seeding** — module prompts are inserted into `ai_prompt_configs` by migration, with `profile = '<module profile>'` and `provider = 'any'` (the resolver's wildcard). Prompt iteration thereafter happens in the DB, consistent with `ai-flows.md`.
5. **Observability** — record the resolved profile in `ai_runs` debug/metadata payloads so module prompt usage is auditable.

Flows a module typically specializes first: `cv_parse`, `import_improve` (and its fan-out children `summary` / `improve` / `professional_summary`), `block_suggest` (action types: `summarize`, `improve`, `ats_optimize`, `expand` — see `AiSuggestionActionType` in `backend/src/shared/types/domain.ts`). Later: `job_analysis`, `tailored_draft`, `cover_letter_generation`.

### Parsing and import

`SimpleCvParser` (`backend/src/modules/imports/parsers/simple-cv-parser.ts`) detects sections via the hardcoded `SECTION_DEFINITIONS` array (`{ type, aliases, keywords }`).

- Add an optional parameter (constructor or parse options) `extraSectionDefinitions: ParserSectionHint[]`, **merged ahead of** the defaults so module headings win ties. Existing definitions are never edited.
- `imports.service.ts` passes `getCvModule(moduleType).parserSectionHints` when the import carries a module type; the imports start endpoint accepts optional `module_type` (default `standard`) and threads it through to the created `master_cv` row.
- **AI parse is prompt-only specialization**: `cvParseOutputSchema` wraps the generic content schema with free-string types, so no schema change — the module profile's `cv_parse` row instructs the model to emit the module taxonomy.

### Templates and rendering

- `templates.service.ts` / `templates.repository.ts`: list endpoints gain a `module_type` filter, defaulting to `standard` (existing gallery unchanged). `TemplateGalleryDialog` passes the loaded CV's module type.
- `rendering-presentation.ts`: module templates are new slug-keyed entries in `TEMPLATE_PROFILES` — purely additive; the existing `DEFAULT_PROFILE` fallback protects unknown slugs.
- Section rendering is already generic (title + ordered blocks). Where a module block type needs bespoke layout (e.g. a competency table for `clinical_skills`), extend the presentation mapper with per-block-type formatting keyed off `block.type`, falling through to the generic rendering. Follow `rendering-contract.md` and `preview-export-parity.md` for parity obligations.

### Frontend editor

**Decision: reuse `CVEditor` on the existing route**, module-aware via the loaded CV's `module_type`. A separate wrapper route was rejected: `CVEditor.tsx` carries autosave, the suggestion lifecycle, revision handling, and the AI guard — a wrapper would duplicate or re-export all of it for no gain, and the CV row already knows its module.

Additive touch points (each with the standard fall-through):

| File | Change |
|---|---|
| `frontend/src/app/components/AddContentModal.tsx` | Accept optional `contentTypes` prop; default = current static array. `CVEditor` passes the module catalog (mapped to the modal's shape) for non-standard modules. |
| `frontend/src/app/pages/CVEditor.tsx` — `sectionDefaultData` | For non-standard modules, look up `defaultBlockFields` in the module catalog first; fall through to the existing switch. |
| `frontend/src/app/pages/CVEditor.tsx` — section render switch | Before the switch, consult the module component registry for `(moduleId, section.type)`; on miss, the existing switch runs; `GenericSection` remains the final fallback. |
| `frontend/src/app/integration/cv-mappers.ts` | Add a descriptor-driven generic mapping path (`FieldDescriptor[]` → editor form state → block fields) for module section types. Per-type heuristics for standard types are untouched. **Highest-risk touch point** — see Risks. |
| `frontend/src/app/integration/api-types.ts`, `backend-api.ts` | Add `module_type` to CV payload types; pass-through only. |

**`GenericSection`-first strategy:** modules ship with descriptor-driven generic forms for all their section types; bespoke components are a later polish phase registered per type in the module's component map. This keeps "add a module" cheap.

### APIs

- `master-cv` create and `imports` start endpoints: optional `module_type` (Zod `.default("standard")`, validated via `isKnownCvModule`) in `master-cv.schemas.ts` / `imports.schemas.ts`.
- CV detail responses include `module_type`.
- Tailored CV creation copies `module_type` from the master.

## Worked Example: the `medical_uk` Module

### Module definition

```typescript
// backend/src/shared/cv-modules/medical-uk.module.ts (sketch)
export const medicalUkModule: CvModuleDefinition = {
  id: "medical_uk",
  label: "UK Medical CV",
  promptProfile: "medical_uk",
  templateSlugs: ["medical-classic", "medical-professional"],
  defaultTemplateSlug: "medical-classic",
  validation: { discouragePhoto: true, discouragedMetadataFields: ["date_of_birth"] },
  sectionCatalog: [ /* table below */ ],
  parserSectionHints: [ /* listed below */ ]
};
```

### Section catalog

Default order as listed; reverse chronological inside every dated section. "Reuse" = an existing generic type, specialized by prompts and field descriptors only.

| # | `type` | Reuse? | Key block fields |
|---|---|---|---|
| 1 | `medical_registration` | new | `gmc_number`, `licence_status` (select: full / provisional / none), `registration_date`, `ntn`, `visa_status`, `additional_registrations` |
| 2 | `medical_qualifications` | new | `qualification`, `qualification_type` (select: primary / postgraduate / english_language), `institution`, `year`, `notes` |
| 3 | `summary` | reuse | existing `text`; medical prompts enforce the two-paragraph current-role/aspirations format |
| 4 | `clinical_experience` | new | `job_title`, `grade` (select: FY1, FY2, CT1–CT3, ST1–ST8, SpR, Specialty Doctor, SAS, Consultant, Other), `specialty`, `hospital`, `department`, `start_date`, `end_date`, `is_current`, `duties` (bullets), `on_call_frequency`, `patient_demographics` |
| 5 | `career_gap` | new, optional | `start_date`, `end_date`, `explanation` |
| 6 | `clinical_skills` | new | `skill`, `competency_level` (select: independent / supervised / assisted / observed), `frequency`, `context` |
| 7 | `audit_qi` | new | `title`, `project_type` (select: audit / quality_improvement), `role`, `setting`, `dates`, `standard_audited`, `outcomes` (bullets), `loop_closed` (boolean), `presented_at` |
| 8 | `teaching` | new | `topic`, `setting`, `audience`, `audience_size`, `format` (select: one_to_one / small_group / lecture / simulation / e_learning), `frequency`, `evaluation` |
| 9 | `publications` | reuse | existing fields; prompts enforce full citations with all authors; posters/orals noted per entry |
| 10 | `management_leadership` | new | `role`, `organization`, `dates`, `description` (bullets) |
| 11 | `courses_training` | new | `name`, `provider`, `date`, `expiry_date`, `is_mandatory` (boolean) |
| 12 | `memberships` | new | `organization`, `membership_status`, `post_nominals`, `member_since` |
| 13 | `awards` | reuse | existing fields |
| 14 | `interests` | new (trivial) | `description` |
| 15 | `references` | reuse | descriptors extended: `referee_name`, `position`, `hospital`, `relationship`, `years_known`, `contact` (convention: 3 senior clinicians covering the last 3 years) |

### Prompt set (`profile = 'medical_uk'`)

Seeded by migration (e.g. `20260611130000_phase13_medical_prompts.sql`), `provider = 'any'`.

Shared guardrail principles, embedded in every medical system prompt:

- **Competency honesty**: never upgrade a competency level (supervised → independent), never invent procedure frequencies, audit outcomes, loop closure, publications, or GMC/registration data. These are probity issues for doctors, not stylistic choices.
- **Register**: factual, conservative clinical English; UK spelling; grade nomenclature kept exact.
- **Length**: long CVs are normal; never discard content to shorten.

Per flow:

| Flow / action | Medical specialization |
|---|---|
| `cv_parse` | Emit the medical taxonomy above; detect GMC numbers and grade vocabulary; classify qualifications (primary/postgrad/English-language); split skills by supervision level; distinguish audit vs QI; separate mandatory training |
| `import_improve` (+ children) | Clinical register; action–outcome phrasing for audits/QI; no generic skills-list synthesis — preserve competency-graded procedures |
| `professional_summary` | Two short paragraphs: current grade + specialty + setting; then aspirations grounded in CV signals only |
| `block_suggest` × `summarize` / `improve` / `expand` | Per-action variants sharing the guardrails; `expand` may only elaborate stated facts |
| `block_suggest` × `ats_optimize` | Target NHS person-specification (essential/desirable criteria) and Oriel/TRAC phrasing rather than generic ATS keywords |
| Later: `job_analysis`, `tailored_draft`, `cover_letter_generation` | NHS person-specification mapping; supporting-statement style cover letters. Until seeded, the cross-profile fallback serves the standard prompts |

### Parser hints

Aliases (headings): gmc registration; professional registration; registration details; professional qualifications; postgraduate qualifications; career goals / personal statement / career aim; current post / current appointment / current employment; previous posts / previous appointments / employment history / clinical experience; clinical skills / procedural skills / procedures / practical procedures / competencies; clinical audit / audits / quality improvement / qip / service improvement; teaching / teaching experience / medical education; research / publications / presentations / posters; management / leadership / management and leadership; courses attended / conferences / mandatory training / study days; professional memberships / memberships; prizes / awards and prizes.

Keywords (content signals): gmc, mbbs, mbchb, mrcp, mrcs, mrcgp, frca, plab, ielts, oet, foundation, registrar, consultant, rotation, on-call, audit, nhs, trust, deanery, royal college, clinic, ward.

### Templates

Two conservative profiles added to `TEMPLATE_PROFILES` plus `cv_templates` seed rows with `module_type = 'medical_uk'`:

1. **`medical-classic`** — single column, serif headings, black on white, rule lines under section titles, generous spacing, page-break-aware. The BMA/deanery look.
2. **`medical-professional`** — single column, sans-serif, muted navy headings, compact table-like layouts for courses and clinical skills.

Both: no photo region, no graphics/skill bars, multi-page friendly. Desirable: running header with name + GMC number — **verify export-engine support first** (see Risks and `export-system.md`).

### Editor components plan

Phase B ships entirely on descriptor-driven `GenericSection`. The polish phase adds bespoke components only where structure earns it, registered in `frontend/src/app/modules/medical-uk.module.ts`:

- `RegistrationSection` (single labeled block), `ClinicalExperienceSection` (grade select), `ClinicalSkillsSection` (competency select + frequency), `AuditQiSection` (loop-closed toggle, outcome bullets) — e.g. in `frontend/src/app/components/medical/MedicalSections.tsx`. Everything else stays generic.

## Phased Rollout

Each phase is independently shippable; every ship-gate includes the standard regression (create, edit, import, AI improve, tailor, export a standard CV — unchanged).

| Phase | Scope | Ship-gate |
|---|---|---|
| **A — Module infrastructure** | `cv-modules/` registries (both sides), phase13 migration, `module_type` pass-through in repositories/schemas/API types, resolver per-profile support + `resolvePromptForFlow` param, parser `extraSectionDefinitions` hook, templates module filter | No visible change anywhere; standard regression green |
| **B — Medical catalog + editor** | `medical-uk.module.ts` (both sides), `AddContentModal` prop, `sectionDefaultData` + render-switch lookups, cv-mappers descriptor path, create-from-scratch via `module_type: "medical_uk"` | Medical CV creatable/editable/savable end-to-end on `GenericSection` |
| **C — Medical AI** | Prompt seed migration (`block_suggest` actions, `professional_summary`, `import_improve` children), AI call sites pass module profile | Block suggestions on a medical CV use medical prompts; standard CVs resolve exactly as before |
| **D — Medical templates** | `TEMPLATE_PROFILES` entries, `cv_templates` seed, gallery filter wired, per-block-type presentation for `clinical_skills` / `audit_qi` | Preview/export parity for both medical templates |
| **E — Medical parsing/import** | `cv_parse` medical prompt row, parser hints threaded through imports, upload accepts `module_type` (API-level until the entry point is decided) | A real registrar CV imports into the medical taxonomy; `import_improve` output is medical-toned |
| **F — Polish (iterative)** | Bespoke `MedicalSections` components, medical `job_analysis` / `tailored_draft` / cover-letter prompts, validation warnings (photo/DOB), entry-point UX when decided | Per-item |

## Checklist: Adding a New Job Module

The medical module is the template. For a new module (`legal_uk`, `academic`, …):

1. **Research the taxonomy.** Produce a gap analysis like `medical-cv-gap-analysis.md`: target sections, field schemas, document conventions, which generic types are reusable.
2. **Write the module definition** — `backend/src/shared/cv-modules/<module>.module.ts` and the frontend mirror `frontend/src/app/modules/<module>.module.ts`; register both; add the drift-guard fixture.
3. **Seed the prompt profile** — one migration inserting `ai_prompt_configs` rows under `profile = '<module>'` (`provider = 'any'`), starting with `cv_parse`, `import_improve` children, `professional_summary`, and `block_suggest` actions. Anything unseeded falls back to standard prompts automatically.
4. **Add parser hints** in the module definition (aliases + keywords) — no parser code changes.
5. **Add templates** — `TEMPLATE_PROFILES` entries + `cv_templates` seed rows with the module's `module_type`.
6. **(Optional) bespoke section components** — only where field structure earns it; register in the frontend module definition.
7. **Regression-test standard** — the full standard lifecycle must be unchanged; module hooks must all carry the `!== "standard"` guard.

No DB schema change, no new endpoints, no editor rewiring per module — steps 2–5 are data/definition work.

## Risks and Open Questions

- **`cv-mappers.ts` heuristic depth (highest risk).** The per-type mapping heuristics may make the "generic descriptor path" harder than it looks; the GenericSection mapping path partially exists but must be verified against autosave and revision flows early in Phase B.
- **`import_improve` fan-out assumptions.** The import-improve orchestration (skills-pool synthesis, professional-summary generation) embeds generic-CV assumptions; needs a module guard so it doesn't synthesize a flat skills list for medical CVs (Phase C/E).
- **Resolver cache change.** Moving to a per-profile cache map must be covered by tests proving the no-profile path is byte-identical (Phase A ship-gate).
- **Export running headers.** Name + GMC number on every page depends on export-engine capabilities (`export-system.md`); if unsupported, omit rather than hack.
- **Tailoring validation.** `tailored_draft` output validation may assume generic section types; out of scope until Phase F, but flagged.
- **Entry point TBD (by design).** Until decided, medical CVs are created via API `module_type`; all designs above are independent of the eventual UX.

## Related Docs

- `medical-cv-gap-analysis.md` — requirements input for `medical_uk`
- `content-model.md` — CvContent/CvSection/CvBlock contract and stable-ID rules
- `ai-flows.md` — flow types, prompt resolution, provider behavior
- `import-parsing.md` — import pipeline and parser stages
- `adding-templates.md` — template metadata + profile workflow
- `rendering-contract.md`, `preview-export-parity.md` — rendering obligations
- `export-system.md` — PDF/DOCX pipeline capabilities
