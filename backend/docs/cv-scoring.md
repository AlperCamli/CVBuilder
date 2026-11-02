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
  numerical score (`status: unscorable`), and no AI review is requested, unless
  the upload is an image-based PDF (next section), which always gets a low score.
  OCR recovery is useful for editing, but it does not prove that an ATS can read
  the original file.
- A failed re-parse clears stale content and extraction evidence so a previous
  successful parse cannot produce a misleading score.
- Stored reviews are used only when their `version` is `cv-review-v2`; anything
  older is recomputed as a basic review on read.

## Image-based CVs

Some PDFs are pictures of text, typically exports from design tools such as Canva:
no text layer, or a garbled one. An ATS reads the text layer, so it sees an almost
empty page. These uploads get a low score that says so, instead of a failure or
"Score unavailable", and the UI pushes the user to rebuild the CV in the editor.

**Detection** (`simple-cv-parser.ts`, `classifyPdfTextLayer`). Decided from the
PDF.js result only, before OCR, so it never depends on OCR succeeding:

- Only a PDF that PDF.js opened can be image-based. DOCX, text files and PDFs that
  PDF.js cannot open (corrupt files, timeouts) are never flagged and keep the
  existing behavior, including the guest failure message.
- `text_layer` is `missing` when PDF.js found no words, `ok` when its text is
  reliable (the same rule that makes it the final text) and has at least
  `max(MIN_TEXT_LAYER_WORDS = 40, MIN_TEXT_LAYER_WORDS_PER_PAGE = 20 × pages)`
  words (pages counted up to 5), and `poor` otherwise. Every text PDF stored in
  production when this was added had at least 120 words.
- `image_based = text_layer !== "ok"`. The diagnostics also store `page_count` and
  `ocr` (`recovered`, `no_text`, `failed`, `timed_out`, `disabled`, `skipped_large`).
- For an image-based PDF, token-heuristic and UTF-8 output is binary noise: it is
  discarded (`raw_extracted_text` is empty) unless the text is a reliable PDF.js
  layer or usable OCR.

**Scoring** (`cv-review.ts`). The only change to the formula; every other path is
unchanged.

| Case | Score | Review |
| --- | --- | --- |
| Image-based, OCR recovered usable text (`ocr: "recovered"`) | Content scored as usual (AI or basic), then the total is capped at `IMAGE_BASED_SCORE_CAP = 30` | `ats` dimension score 0 with a reason; ATS improvement first; summary leads with the ATS problem |
| Image-based, no usable text (OCR failed, timed out, disabled, skipped, or found nothing usable) | Fixed `IMAGE_BASED_NO_TEXT_SCORE = 10` | `method: "basic"`, `status: "partial"`, `assessed_weight: 5`, `ats` = 0, every other dimension `score: null` "Not assessed"; no AI review is requested |

Both set `ats_blocker: "image_based"`, which the API, the guest preview and the
frontend read. `status: "partial"` (not `unscorable`) makes the UI show the number:
the score page and the pre-signup preview show "Score unavailable" only when
`score` is null. The fixed 10 is a product floor, not the weighted average of the
assessed weight (which would be 0): it signals "very low" without claiming that
the content itself is worthless.

Why: the ATS problem dominates whatever the content is, so a well-written CV saved
as an image still has to read as a low score; and an upload we cannot read is
exactly the user who needs the editor, so it must not end in a dead end. Uploads
without usable text are parsed with the empty sections of a new CV
(`createEmptyCvContent`) and `needs_language_confirmation`, so signup, the claim
(`claim_guest_import` needs `status = 'parsed'` and non-null `parsed_content`), the
score page and "continue to editor" work unchanged. Neither the AI parse nor the
AI review runs for them, also when AI analysis is required.

**Version.** `CV_REVIEW_VERSION` stays `cv-review-v2`. The rule only applies to new
diagnostics (`image_based` is absent from older uploads, so recomputing them gives
the same review), and bumping the version would discard every stored AI review and
recompute it as a basic review. `ats_blocker` is optional, so older stored reviews
remain valid.

**OCR.** OCR (tesseract.js in a worker thread, pages rendered with
`@napi-rs/canvas`) is optional: an image-based PDF gets its review without it.
It is capped by `PDF_OCR_TIMEOUT_MS` (30 s) and the worker thread is terminated on
timeout; it is skipped for image-based PDFs above `PDF_OCR_MAX_BYTES` (8 MB), and
skipped up front when its runtime files are missing from the deployment.
`PDF_OCR_ENABLED=false` turns it off. See `environment.md`.

## Presentation

The CV score page shows the score, up to three strengths and up to three
weaknesses. The method (score breakdown, per-dimension evidence, formula and
limitations) stays inside the collapsed "How we evaluate your CV" section.

For an image-based review, the score page and the pre-signup preview show an
"ATS systems can't read your CV" block above the score, and the primary action is
"Rebuild as an ATS-friendly CV" (opens the editor with any recovered content, or
the empty sections, and starts the onboarding tutorial; a free action). The
pre-signup funnel counts these previews as `onboarding_score_preview` with detail
`image_based` instead of `scored`.

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

`tests/image-based-cv.unit.test.ts` covers detection (the real parser in a Node
child process, with OCR off), both image-based branches and that text PDFs score
exactly as before; `tests/imports.service.integration.test.ts` and
`tests/guest-imports.integration.test.ts` check that an image-based upload is
parsed with a low score, without AI calls, can be claimed and converted, and that
the guest deadline still fails a parse that never finishes.
`tests/cv-review.unit.test.ts` covers the level curve and weights, the average
calibration, the impact cap, quote verification, ordering, incomplete ratings,
contact redaction in the AI input, unscorable content and the basic fallback
(dates versus figures, repeated statements, hidden content, other languages,
medical and project CVs). `tests/imports.service.integration.test.ts` runs a parse
through the real AI service and mock provider and checks the stored review, the
tracked run and the fallback when the AI review fails. Guest tests check that the
review computed during processing is the one persisted. Frontend render tests
check that weaknesses with quotes are visible and the method stays collapsed.
