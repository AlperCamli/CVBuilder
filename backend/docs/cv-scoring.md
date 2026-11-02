# CV review v2

The server owns the scoring formula. An uploaded CV is reviewed once, when it is
parsed, and the review is stored in `imports.review_context.cv_review` (guest
uploads: `guest_imports.review_context.cv_review`, carried into the import by the
claim). `GET /imports/:id/result` returns that stored `review` alongside parsed
content; other states fall back to the basic review computed on read.

Five content criteria are rated by one tracked AI run (`flow_type` `cv_review`,
code-only prompt `cv-review` in `flow-registry.ts`). The model returns a level
0–4, a one-sentence assessment, a strength, an issue, a quote and a fix per
criterion. **It never sets a number**: `scoreAiReview` in `cv-review.ts` maps
levels to points and applies the weights. Structure and parseability are
deterministic checks.

## Formula

`total = round(sum(dimension score * weight) / sum(assessed weights))`

AI levels map onto a concave curve so full credit needs excellent evidence:
level 0 → 0, 1 → 35, 2 → 60, 3 → 80, 4 → 100. The prompt is calibrated so an
average CV earns mostly level 2; with clean structure and parsing that is a total
of 66.

| Dimension | Weight | Scored by |
| --- | ---: | --- |
| Measurable results (`impact`) | 25 | AI level, capped by figures in experience statements (below) |
| Wording and clarity (`wording`) | 20 | AI level |
| Experience depth (`depth`) | 15 | AI level |
| Role focus (`focus`) | 15 | AI level |
| Skills backed by experience (`skills_evidence`) | 10 | AI level |
| Structure and completeness (`structure`) | 10 | Name/contact (25), experience or projects (25), education (15), skills (15), distinct headings (10), no empty placeholders (5), no broken characters (5) |
| Parseability / ATS compatibility (`ats`) | 5 | Extraction quality (60), direct text extraction (40) |

Guards on the AI ratings:

- **Impact cap.** The level cannot exceed what the statements' figures support:
  no experience statements → 1; no statement with a number, amount or count → 2;
  fewer than a quarter → 3. The dimension's `reason` says when a cap applied.
  Years and numeric dates do not count as figures; digits glued to letters (Q3,
  B2B) do not either.
- **Verified quotes.** A quote is shown only if it appears in the text the model
  received (ignoring case, spacing, bullets and quotation marks) and is at least
  8 characters long. Otherwise it is dropped; the rating itself stands.
- **Complete ratings.** A missing criterion or an output that fails the schema
  makes the caller store the basic review instead.

Weaknesses (`improvements`) are the AI issue + verified quote + fix and the
deterministic suggestions, ordered by weighted shortfall
(`weight * (100 - points) / 100`). Strengths are AI criteria at level 3 or above,
then deterministic checks at full credit.

## What the AI receives

`buildAiReviewInput` sends the CV language, the counted statements with figures,
and sections as blocks of heading + lines. Header/contact sections, emails, URLs
and phone-like digit runs (9+ digits) are removed; date ranges stay. Input is
capped at 14,000 characters. Hidden blocks and empty sections are not sent.
Feedback text follows the request's interface language (`languagePolicy`); quotes
stay in the CV language. The run is linked to the import (or guest import, then
relinked by the claim), so its cost appears in the AI analytics.

## Basic review (fallback)

`reviewCv` is used when the AI review is not permitted (no AI consent when AI is
optional), the provider is unavailable or fails, for content edited after the
upload, and for older uploads. It scores impact (share of experience statements
with figures; full credit at 50%), wording (English: length, initial action
verbs, absence of checked generic phrases; other languages: length only, with a
`reason`), structure and parseability. Depth, focus and skills evidence get
`score: null` with a reason, so the status is `partial` and the summary says it is
a basic review. A failed AI review never fails the upload.

## Partial reviews and failures

- Historical uploads without saved diagnostics exclude parseability. The API
  explains that re-upload is needed to assess the source file.
- Unavailable dimensions get `score: null`, rather than fabricated scores or
  automatic penalties. `assessed_weight` and `status: partial` explain scope.
- Failed/pending imports, absent or nearly empty readable content, low-confidence
  extraction, binary decoding, heuristic PDF recovery and OCR all withhold the
  numerical score (`status: unscorable`), and no AI review is requested. OCR
  recovery is useful for editing, but it does not prove that an ATS can read the
  original scanned file.
- A failed re-parse clears stale content and extraction evidence so a previous
  successful parse cannot produce a misleading score.
- Stored reviews are used only when their `version` is `cv-review-v2`; anything
  older is recomputed as a basic review on read.

## Presentation

The CV score page shows the score, up to three strengths and up to three
weaknesses. The method (score breakdown, per-dimension evidence, formula and
limitations) stays inside the collapsed "How we evaluate your CV" section.

This is a product rubric, not an industry-standard ATS scoring formula or a
hiring prediction. No visual layout, columns, fonts, headers or exported-file
compatibility is inferred from normalized text. Parsing difficulty as a possible
compatibility issue is consistent with [Greenhouse's documented parsing limitations](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse);
the weights, curve and thresholds are our own product policy.

## Rollout

Apply `supabase/migrations/20261106120000_cv_review_ai_flow.sql` **before
deploying the backend**: it allows `cv_review` in `ai_runs.flow_type`. Without it
the run insert fails and every upload gets the basic review.

## Tailoring comparison (removed)

The before/after **tailoring review** (`reviewTailoring`, the `TailoringReview` type
and the editor's Tailoring review panel) was removed on 2026-10-27. Neither the
tailoring v2 `finish` step nor the legacy draft flows compute it any more, and
`tailoring_review` is no longer part of tailored CV or draft API responses. The
`tailored_cvs.tailoring_review` column is left in place (no destructive migration);
it is neither written nor read. Legacy `__server_tailoring_review` envelopes in CV
JSON are still stripped on every read and write. Tailoring v2 reports its own
requirement-based match score instead (see `tailoring-v2-design.md`).

## Evidence storage

`supabase/migrations/20261006120000_cv_review_evidence.sql` added the nullable
`imports.review_context` and `tailored_cvs.tailoring_review` JSONB columns (the
latter is now unused). Diagnostics are stored separately from editable CV JSON.
If the API schema cache cannot see the column during a rollout, repository writes
retry only that specific missing-column error and temporarily store evidence in
reserved server metadata inside the CV JSONB column; reads extract and strip it.

## Verification

`tests/cv-review.unit.test.ts` covers the level curve and weights, the average
calibration, the impact cap, quote verification, ordering, incomplete ratings,
contact redaction in the AI input, unscorable content and the basic fallback
(dates versus figures, repeated statements, hidden content, other languages,
medical and project CVs). `tests/imports.service.integration.test.ts` runs a parse
through the real AI service and mock provider and checks the stored review, the
tracked run and the fallback when the AI review fails. Guest tests check that the
review computed during processing is the one persisted. Frontend render tests
check that weaknesses with quotes are visible and the method stays collapsed.
