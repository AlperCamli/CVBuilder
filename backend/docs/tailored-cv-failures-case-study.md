# Tailored CV Failures Case Study (May 2026)

## Scope

This document explains a debugging cycle where `tailored_draft` failed while other AI flows (`job_analysis`, `follow_up_questions`, `cv_parse`, `cover_letter_generation`) continued to work.

The focus is:
- what failed
- what was tried
- what result each attempt produced

This is a behavior case study, not a design spec.

## Problem Definition

The product flow `Tailor for a Job` became unstable in production-like use.
The same endpoint and payload shape were used, but outcomes changed based on content and model behavior.

Observed user-facing failures:
- "Tailoring AI run did not reach a terminal state."
- "AI returned an invalid structured response. Please retry."
- "The AI could not generate a meaningful tailored CV output from the provided context."
- Degraded output quality after success: duplicated header content, generic section titles (`Section 1`, `Section 2`), and missing work experiences.

## Why This Was Hard

- JSON validity was not enough. Some runs returned valid JSON but wrong root object.
- Schema validity was not enough. Some runs passed contract checks but had semantically empty content.
- Content variation mattered. Two structurally similar requests behaved differently due to prompt strictness and job text complexity.
- `tailored_draft` is the heaviest flow (largest output contract), so it is most sensitive to model drift.

## Evidence Snapshot

One key failed run (`f7f61b7b-1b95-4954-941c-a6a8357034d0`) failed at validation with:
- missing required root keys: `current_content`, `generation_summary`, `changed_block_ids`
- unexpected top-level keys: `full_name`, `headline`, `email`, `phone`, `location`, `social_links`, `urls`, `photo`

Interpretation:
- model output was parseable JSON
- recovered/selected JSON object did not match tailored root contract

## Attempts and Results

1. Added run-state hardening and better diagnostics.
- Attempt:
  - force terminal run handling
  - persist reason codes (`output_contract_invalid`, `output_json_unparseable`, `output_semantically_empty`)
- Result:
  - improved observability
  - stuck/non-terminal confusion reduced
  - did not fix output correctness by itself

2. Tightened tailored output contract and prompt instructions.
- Attempt:
  - strict root object requirement
  - stronger migration-backed prompt text for `tailored_draft`
- Result:
  - contract violations became explicit and traceable
  - failure rate moved from silent corruption to visible contract errors
  - strictness increased rejection of borderline outputs

3. Improved Gemini JSON recovery logic.
- Attempt:
  - balanced JSON extraction
  - trailing comma cleanup
  - deterministic one-pass repair
- Result:
  - reduced pure parse failures
  - did not fully solve wrong-object selection when multiple JSON objects were present

4. Added schema-aware JSON candidate selection.
- Attempt:
  - when response contains multiple JSON objects, prefer the one matching the flow schema
- Result:
  - reduced "invalid structured response" failures caused by wrong root candidate selection
  - tailored flow became more robust to mixed/prose-wrapped model output

5. Added tailored output coercion before validation.
- Attempt:
  - map near-valid shapes to canonical structure
  - infer missing section/block fields
- Result:
  - fewer hard schema failures
  - side effect risk introduced: generic section naming (`section_1`) and weak type inference in some outputs

6. Added semantic-empty detection and fallback hydration.
- Attempt:
  - detect content that is structurally valid but effectively empty
  - hydrate empty generated blocks from master CV where possible
- Result:
  - fewer semantic-empty hard failures
  - preserved content continuity in many cases
  - not enough for cases where whole sections were omitted or misclassified

7. Added master-baseline stabilization for tailored output.
- Attempt:
  - treat master CV as baseline
  - overlay only meaningful generated edits
  - preserve missing sections/blocks from master
- Result:
  - prevented disappearance of work experiences and other sections
  - improved continuity and reduced destructive drift

8. Added presentation-layer safeguards.
- Attempt:
  - filter header-like generic sections from body rendering
  - map generic titles to safe label (`Additional Information`)
- Result:
  - reduced duplicated header in preview/export
  - reduced user-visible `Section N` artifacts

## Key Learnings

- Tailored generation needs three gates:
  - parse gate
  - contract gate
  - semantic gate
- Strict contracts improve safety, but without stabilization they can increase user-visible failure rate.
- For high-variance generation tasks, preserving master baseline is safer than trusting full-content replacement.
- Prompt wording should enforce structure without encouraging blank/placeholder output.

## Current Status (After Fixes)

- Repository is aligned with `origin/main` as of May 2, 2026.
- Remote migration history matches local migration set through:
  - `20260502170000_phase6e_tailored_draft_prompt_resilience.sql`
- Tailored flow reliability is improved compared to initial failure state.
- Remaining risk is quality drift under hard prompts and complex job descriptions, even when runs complete successfully.

## What To Watch Next

- Frequency of:
  - `output_contract_invalid`
  - `output_semantically_empty`
  - successful runs with major section loss
- Whether generated sections regress to generic types (`section_n`, `custom`) in new content domains.
- Whether heavy-model configuration changes in environment affect tailored stability more than other flows.

## Success State Definition

The tailored flow is considered successful only when both execution reliability and content quality targets are met.

Execution success:
- run reaches terminal `completed` state (no stuck `pending`)
- no `output_contract_invalid`, `output_json_unparseable`, or `output_semantically_empty` for normal inputs
- response is produced within normal UX wait window for this flow

Content success:
- output root contract is exactly:
  - `current_content`
  - `generation_summary`
  - `changed_block_ids`
- section taxonomy is canonical (no visible `section_1`, `section_2`, `custom` artifacts in user-facing output)
- header appears exactly once in preview/export header area
- no duplicated header/contact block as body section
- master CV continuity is preserved:
  - existing work experiences are not dropped unless intentionally hidden
  - existing education/awards/references/languages are not accidentally removed
- edits are meaningful:
  - tailored wording reflects job context and selected answers
  - preserved factual integrity (no invented claims)

Preview/export parity success:
- preview, PDF, and DOCX have the same section set and order
- same header fields/social links are shown across preview and exports
- no boolean leaks (`true`/`false`) in rendered content
- no literal `Header` section title in exported documents

Operational success checks:
- recent `ai_runs` for `tailored_draft` show high completion rate with low validation failures
- debug payloads are diagnostic when failure occurs (reason codes are specific, not generic)
- regression tests for coercion, stabilization, and presentation mapping remain green

In short, success means the flow is not only "completed" but also produces a stable, recruiter-readable tailored CV that preserves core master content while applying targeted job-specific improvements.
