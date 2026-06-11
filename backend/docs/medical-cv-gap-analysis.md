# Medical CV Gap Analysis: Generic CV Builder vs UK Medical (NHS) CVs

This document compares the CV structure our builder produces today with the structure expected of a UK medical doctor's CV (NHS applications, specialty training, GMC specialist/GP registration). It is the requirements input for the medical CV module described in `cv-modules-implementation-guide.md`.

## Purpose and Sources

The medical module targets UK medical doctor CVs first. The expected structure below is synthesized from:

- GMC — *Structuring your CV for a specialist or GP registration application* (gmc-uk.org)
- BMA — *Writing your medical CV* (bma.org.uk)
- NHS Health Careers — *Preparing your medical CV* (healthcareers.nhs.uk)
- BDI Resourcing — *How to structure an effective medical CV* and the NHS medical CV template for IMGs (bdiresourcing.com)
- HEE London — *Guide to Medical CVs and Cover Letters* (london.hee.nhs.uk)

Research date: June 2026.

## Summary of Findings

| # | Gap | Severity | Resolution strategy |
|---|-----|----------|---------------------|
| 1 | No regulatory identity section (GMC number, licence status, NTN) | High | New `medical_registration` section type |
| 2 | Employment lacks UK grade taxonomy (FY1/2, CT/ST, SpR, SAS, Consultant), on-call, patient demographics | High | New `clinical_experience` section type with grade enum |
| 3 | Clinical audit / quality improvement is not a section type at all | High | New `audit_qi` section type — heavily weighted in NHS shortlisting |
| 4 | Teaching experience is not a section type | High | New `teaching` section type |
| 5 | Clinical/procedural skills need competency levels (independent vs supervised) and frequency | High | New `clinical_skills` section type (current `skills` is a flat string list) |
| 6 | Qualifications need primary vs postgraduate vs English-language (PLAB/IELTS/OET) classification | Medium | New `medical_qualifications` section type |
| 7 | Mandatory training (ALS/ATLS) with expiry dates is not distinguishable from generic courses | Medium | New `courses_training` section type with `is_mandatory` and `expiry_date` |
| 8 | Career gaps must be explicitly explained (GMC expectation) | Medium | New optional `career_gap` section type |
| 9 | Professional memberships / post-nominals (BMA, royal colleges) have no home | Medium | New `memberships` section type |
| 10 | Management & leadership is not a section type | Medium | New `management_leadership` section type |
| 11 | AI prompts assume generic professional CVs (tone, ATS framing, skills synthesis) | High | New `medical_uk` prompt profile in `ai_prompt_configs` |
| 12 | Parser heading aliases/keywords don't recognise medical headings ("Clinical Audit", "GMC Registration", "Procedures") | Medium | Module parser hints merged into `SimpleCvParser` |
| 13 | Templates are modern/creative; medical CVs need conservative, multi-page, no-photo layouts | Medium | New `medical-classic` / `medical-professional` template profiles |
| 14 | Editor hardcodes the generic section list and per-type components | High | Module-aware editor config (registry lookup with fall-through) |
| 15 | Photo support conflicts with UK medical convention (no photo, no DOB) | Low | Module validation rule (soft warning) |

What does **not** need to change is just as important — see [What Does NOT Need to Change](#what-does-not-need-to-change).

## The Current Generic CV Model

### Content model recap

Defined in `backend/src/shared/cv-content/cv-content.types.ts` and stored as `jsonb` in `master_cvs.current_content` / `tailored_cvs.current_content`:

```typescript
interface CvContent {
  version: "v1";
  language: string;
  metadata: Record<string, CvJsonValue>;   // full_name, headline, email, phone, location, photo
  sections: CvSection[];
}

interface CvSection {
  id: string;
  type: string;          // free-form string
  title: string | null;
  order: number;
  blocks: CvBlock[];
  meta: Record<string, CvJsonValue>;
}

interface CvBlock {
  id: string;
  type: string;          // free-form string
  order: number;
  visibility: "visible" | "hidden";
  fields: Record<string, CvJsonValue>;     // arbitrary field-level content
  meta: Record<string, CvJsonValue>;
}
```

The critical property: **section and block `type` values are free-form strings** (validated only as non-empty strings, max 64 chars). The storage layer, block update endpoints, suggestion lifecycle, and revision history are all type-agnostic. New section taxonomies require no content-model or schema change.

### Current section taxonomy

Twelve generic section types, defined as a static list in `frontend/src/app/components/AddContentModal.tsx`:

`summary`, `experience`, `education`, `skills`, `languages`, `certifications`, `courses`, `projects`, `volunteer`, `awards`, `publications`, `references` (plus the implicit `header`).

### Where the taxonomy is interpreted

The content model is type-agnostic, but six layers *interpret* the type strings. These are the places a new taxonomy must plug into:

| Layer | Location | How types are used |
|-------|----------|--------------------|
| Section picker | `frontend/src/app/components/AddContentModal.tsx` | Hardcoded `contentTypes` array (id, name, icon, essential, description) |
| Editor defaults & rendering | `frontend/src/app/pages/CVEditor.tsx` | `sectionDefaultData(type)` switch; `switch (section.type)` mapping to components in `frontend/src/app/components/CVSections.tsx`, with `GenericSection` fallback |
| Editor ↔ content mapping | `frontend/src/app/integration/cv-mappers.ts` | Per-type parsing/serialization heuristics between `CvContent` and editor state |
| Import parsing | `backend/src/modules/imports/parsers/simple-cv-parser.ts` | Hardcoded `SECTION_DEFINITIONS` (type, aliases, keywords) for heuristic heading detection; AI `cv_parse` flow prompt describes the generic taxonomy |
| AI prompts | `ai_prompt_configs` table (resolved by `backend/src/modules/ai/prompts/prompt-resolver.ts`); in-code fallbacks in `backend/src/modules/ai/flows/flow-registry.ts` | Prompts describe generic CV conventions (skills synthesis, ATS phrasing, professional summary style) |
| Templates & rendering | `backend/src/modules/rendering/rendering-presentation.ts` (`TEMPLATE_PROFILES`); `cv_templates` table | Generic layouts; section rendering derives headline/date_range/bullets generically |

## UK Medical CV Requirements

### Document conventions

- **Length:** 2–3 sides of A4 for training applications (BMA); IMG and consultant CVs routinely run far longer — BDI notes 10+ pages is normal for NHS IMG applications. Content completeness outranks brevity; this is the opposite of the one-page generic-CV convention.
- **Order:** reverse chronological in every dated section.
- **Formatting:** conservative — professional serif/sans fonts, no graphics, no skill bars, single column.
- **Excluded by convention:** photo, date of birth, marital status, religion (NHS recruitment is anonymised-friendly).
- **Career gaps:** must be explained, not hidden (GMC expectation for registration applications).
- **References:** typically three named senior clinicians covering the last three years of work, with titles, departments, and contact details — not "available on request".

### Required section structure

The synthesized full structure, in conventional order:

1. **Personal details & professional registration** — name, contact details; **GMC registration number and licence status**; National Training Number (NTN) if in training; visa/right-to-work status if relevant (IMGs). No DOB/photo.
2. **Professional qualifications** — primary medical qualification (MBBS/MBChB: institution, year); postgraduate qualifications (MRCP, MRCS, FRCA, MRCGP…); for IMGs: PLAB results and IELTS/OET English-language results.
3. **Personal summary / career goals** — two short paragraphs: current role, grade, and experience; then career aspirations and motivation for the target role.
4. **Current employment** — job title with UK-equivalent grade, dates, hospital/trust, department, duties, hospital size/type, patient demographics, on-call frequency and rota.
5. **Previous employment** — reverse chronological; grade, specialty, and location for every post.
6. **Clinical skills & procedural competencies** — procedures split by competency level (**independent vs assisted/supervised**) with frequency performed. Especially important for IMGs and anaesthetics/surgery/acute specialties.
7. **Clinical audit & quality improvement** — project title, your specific role, standard audited, outcomes, whether the audit loop was closed, where presented. Heavily weighted in training-post shortlisting.
8. **Teaching experience** — what was taught, setting, audience and size, format (one-to-one / small group / lectures / simulation), frequency, how it was evaluated.
9. **Research & publications** — full journal citations with all authors; presentations and posters (oral vs poster, conference).
10. **Management & leadership** — rota coordination, committee membership, departmental roles.
11. **Courses, conferences & mandatory training** — name, provider, date; mandatory certifications (ALS, ATLS, APLS…) with validity/expiry.
12. **Professional memberships** — BMA, royal colleges, specialty societies; post-nominal letters and membership status.
13. **Awards & prizes** — awarding body, reason, date.
14. **Interests** (optional) — non-clinical interests demonstrating personality.
15. **References** — three senior clinicians as above.

### Regulatory and identity content

The GMC number is the doctor's primary professional identifier and appears prominently (often in the header of every page). There is no equivalent concept in the generic model — `metadata` carries name/headline/contact only. The medical module treats registration as a first-class section (`medical_registration`) rather than overloading `metadata`, so it survives parsing, AI flows, and rendering through the standard section pipeline.

### Grade-based employment taxonomy

UK medical careers progress through named grades: **FY1, FY2** (foundation), **CT1–CT3 / ST1–ST8** (core/specialty training), **SpR** (legacy registrar), **Specialty Doctor / SAS**, **Consultant**, plus Trust-grade and locum posts. Recruiters filter on grade; IMGs are expected to state UK-equivalent grades. The generic `experience` block (`title`, `company`, dates, `description`) cannot express this — grade, specialty, trust/hospital, and on-call commitments are distinct, structured facts.

### First-class sections absent today

Audit & QI, teaching, competency-graded clinical skills, mandatory training currency, and professional memberships are *scored shortlisting criteria* in NHS recruitment — they cannot be buried inside a generic "experience" description. Each needs its own section type with structured fields so AI improvement, rendering, and (later) person-specification tailoring can reason about them.

## Gap-by-Gap Analysis

### Section taxonomy gaps

| Medical section | Closest generic type | Gap | New type needed? |
|---|---|---|---|
| Registration (GMC/NTN/visa) | — (none) | No concept of regulatory identity | Yes — `medical_registration` |
| Professional qualifications | `education` / `certifications` | No primary/postgrad/English-language classification; MRCP etc. are neither degrees nor generic certificates | Yes — `medical_qualifications` |
| Personal summary / career goals | `summary` | Structure differs (2 paragraphs: current grade → aspirations) but fields match | No — reuse `summary` with medical prompts |
| Current + previous employment | `experience` | Missing grade, specialty, trust, on-call, patient demographics | Yes — `clinical_experience` |
| Career gaps | — (none) | Gaps must be declared and explained | Yes — `career_gap` (optional) |
| Clinical skills / procedures | `skills` | Flat string list vs competency level + frequency + context | Yes — `clinical_skills` |
| Audit & QI | — (none) | Entirely absent | Yes — `audit_qi` |
| Teaching | — (none) | Entirely absent | Yes — `teaching` |
| Research & publications | `publications` | Fields broadly fit; conventions enforced via prompts (full citations, all authors) | No — reuse `publications` |
| Management & leadership | — (none) | Entirely absent | Yes — `management_leadership` |
| Courses / mandatory training | `courses` | No mandatory flag, no expiry/currency | Yes — `courses_training` |
| Memberships / post-nominals | — (none) | Entirely absent | Yes — `memberships` |
| Awards & prizes | `awards` | Fits | No — reuse `awards` |
| Interests | — (none generic) | Simple free text | Yes (trivial) — `interests` |
| References | `references` | Generic fields thinner than medical convention (3 named senior clinicians, relationship, years known) | No — reuse `references` with extended field descriptors |

Net: roughly ten new section types, five reused.

### Field schema gaps

Representative structured fields the generic model has no vocabulary for:

- `gmc_number`, `licence_status` (full / provisional / none), `ntn`, `visa_status`
- `grade` as an enum (FY1, FY2, CT1–3, ST1–8, SpR, Specialty Doctor, SAS, Consultant, Other)
- `competency_level` (independent / supervised / assisted / observed) and `frequency` on skills
- `loop_closed` (boolean), `standard_audited`, `outcomes` on audit projects
- `audience_size`, `format`, `evaluation` on teaching
- `is_mandatory`, `expiry_date` on courses (ALS/ATLS currency)
- `on_call_frequency`, `patient_demographics` on employment

All of these fit inside `CvBlock.fields` without schema changes; the gap is in field *descriptors* (editor form generation, defaults, AI awareness), not storage.

### AI prompt gaps

Current prompts (profile `phase3-v1` and successors in `ai_prompt_configs`) assume generic professional CVs. For medical CVs they would actively harm quality:

- **Tone/register:** generic "impact statement" coaching vs the factual, conservative clinical register expected by NHS panels; UK English spelling.
- **Safety-critical truthfulness:** a generic "improve" might inflate "performed under supervision" toward "performed" — for clinical competencies this is a probity issue. Medical prompts need explicit guardrails: never upgrade competency levels, never invent procedure frequencies, audit outcomes, loop closure, or GMC data.
- **Skills synthesis:** `import_improve` synthesizes a generic skills list; medical CVs need competency-graded procedures instead.
- **`ats_optimize`:** generic ATS keyword framing vs NHS person-specification (essential/desirable criteria) and Oriel/TRAC conventions.
- **`cv_parse`:** the parse prompt describes the generic taxonomy; it must instead emit the medical taxonomy, recognise GMC numbers and grade vocabulary, and never truncate long CVs (long is normal).
- **`professional_summary`:** must produce the two-paragraph current-role/aspirations format.

Resolved by a separate `medical_uk` prompt profile — see the implementation guide.

### Parser gaps

`SimpleCvParser`'s `SECTION_DEFINITIONS` aliases cover generic headings ("Work Experience", "Skills"). Medical CVs use headings like "GMC Registration", "Clinical Experience", "Practical Procedures", "Clinical Audit", "Quality Improvement", "Teaching Experience", "Courses Attended", "Mandatory Training", "Professional Memberships", "Prizes". Medical keyword signals (gmc, mbbs, mrcp, plab, registrar, consultant, rotation, on-call, nhs trust, deanery, royal college) are also absent. Without module hints, heuristic parsing would misfile most medical sections into `experience`/`skills` or drop them.

### Template gaps

The seven existing `TEMPLATE_PROFILES` target modern professional CVs (accent colors, compact/creative layouts, photo support). Medical convention requires: conservative single-column layouts, serif or muted-sans typography, no photo region, graceful multi-page flow (10+ pages), and ideally name + GMC number in a running header. None of the existing profiles fit; two new conservative profiles are needed.

### Editor UX gaps

- `AddContentModal` offers only the generic twelve types.
- `sectionDefaultData` and the render switch in `CVEditor.tsx` know nothing about medical types (they would fall to `GenericSection` — workable as a starting point, but with no field descriptors the forms would be empty/unstructured).
- `cv-mappers.ts` has per-type heuristics for generic types only; medical types need a descriptor-driven generic mapping path.
- Profile photo controls are always offered; medical convention excludes photos (soft warning, not a hard block).

## What Does NOT Need to Change

The architecture absorbs the medical module without touching:

- **Content model & storage** — `CvContent`/`CvSection`/`CvBlock`, jsonb columns, block PATCH endpoints, stable-ID rules (`content-model.md`).
- **Suggestion lifecycle** — `ai_runs`, `ai_suggestions`, apply/reject endpoints, auto-apply pipeline; all block-ID based and type-agnostic.
- **Revision history** — `cv_block_revisions` records before/after jsonb regardless of type (`revision-system.md`).
- **AI provider layer** — Gemini provider, retries, model tiering (`ai-flows.md`); medical specialization is prompt-level only.
- **Prompt resolution mechanism** — `ai_prompt_configs` + `AiPromptResolver` already support profiles; it needs a per-request profile parameter (additive), not a redesign.
- **Import pipeline shape** — file → text extraction → `cv_parse` → `import_improve`; medical variants slot in via parser hints and prompt rows (`import-parsing.md`).
- **Export pipeline** — PDF/DOCX generation renders whatever the presentation layer produces (`export-system.md`).
- **Auth, billing, dashboard** — untouched.

## Implications

Closing these gaps generically — a module registry, a `module_type` column, per-module prompt profiles, parser hints, and module-filtered templates — turns "add a medical CV" into "add the first job-specific CV module", with future modules (academic, legal, …) reduced to writing one module definition, one prompt-seed migration, and templates.

The design and phased rollout are specified in **`cv-modules-implementation-guide.md`**.
