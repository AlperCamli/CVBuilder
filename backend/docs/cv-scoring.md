# CV review v2

The server owns the scoring formula. An uploaded CV is reviewed once, when it is
parsed, and the review is stored in `imports.review_context.cv_review` (guest
uploads: `guest_imports.review_context.cv_review`, carried into the import by the
claim). `GET /imports/:id/result` returns that stored `review` alongside parsed
content; other states fall back to the basic review computed on read.

Five content criteria are rated by one tracked AI run (`flow_type` `cv_review`,
code-only prompt `cv-review` in `flow-registry.ts`). The model returns a level
0–4, a one-sentence assessment, a strength, an issue, a quote and a fix per
criterion. Weaknesses are meant to be read at a glance, so the prompt limits the
issue to 10 words, the fix to 12 (and it must not repeat the issue), the quote to
40 characters and the assessment to 20 words; the output schema caps them at 120,
140, 60 and 160 characters, cut at a word boundary. **It never sets a number**: `scoreAiReview` in `cv-review.ts` maps
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

- **Level 4 names no gap.** A level-4 rating that still names an issue counts as
  level 3: full credit is only for a criterion where nothing holds the CV back.

- **Impact cap.** The level cannot exceed what the statements' figures support:
  no experience statements → 1; no statement with a number, amount or count → 2;
  fewer than a quarter → 3. The dimension's `reason` says when a cap applied.
  Years and numeric dates do not count as figures; digits glued to letters (Q3,
  B2B) do not either.
- **Verified quotes.** A quote is shown only if it appears in the parsed sections
  or the extracted text of the upload (ignoring case, spacing, bullets and
  quotation marks) and is at least 8 characters long. Otherwise it is dropped; the rating itself stands.
- **Complete ratings.** A missing criterion or an output that fails the schema
  makes the caller store the basic review instead.

Weaknesses (`improvements`) are the AI issue + verified quote + fix and the
deterministic suggestions, ordered by weighted shortfall
(`weight * (100 - points) / 100`). Strengths are AI criteria at level 3 or above,
then deterministic checks at full credit.

## What the AI receives

`CV_REVIEW_INPUT` chooses what the upload's review reads (prompt `cv-review`
v3-2 describes both):

- **`raw` (default).** `buildRawReviewInput` sends the CV language and the text
  extracted from the file, line by line. The review starts as soon as the text is
  extracted, so it runs alongside the AI parse instead of after it (about 16 s less
  waiting). It is only requested for text that could be scored (at least 10 words,
  reliable extraction, no image-based PDF without OCR text). Once the parse is back,
  `scoreAiReview` applies everything that needs the parsed CV: the impact cap,
  structure, parseability and the quote check. If the parsed content is unscorable
  the AI ratings are discarded; if the parse fails the review is dropped. Emails,
  URLs and phone-like runs are removed per line, but the candidate's name and other
  header lines can remain (the AI parse receives the same text); the prompt tells
  the model to ignore the name.
- **`structured`** (rollback). `buildAiReviewInput` runs after the parse and sends
  the CV language, the headline (the stated target title), the counted statements
  with figures, and sections as blocks of heading + lines. The rest of the header,
  emails, URLs and phone-like digit runs (9+ digits) are removed; date ranges stay.
  Hidden blocks and empty sections are not sent.

Both inputs are capped at 14,000 characters (the raw text at whole lines).
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

## Improvement score

After "Improve with AI" the score must rise for every verified fix and never drop.
A fresh AI rating is too noisy for that (it may not "see" the improvement), so the
new score is anchored on the stored review and computed by
`cv-review-improvement.ts`. The scoring math above (`reviewCv`, `scoreAiReview`,
`LEVEL_POINTS`, weights, total) is reused, never changed.

**Formula.** For every dimension of the stored review whose `score` is not null:

```
gap   = 100 - before
after = before + gap * BETA * ln(1 + ALPHA * r) / ln(1 + ALPHA)
```

`IMPROVEMENT_BETA = 0.6` (r = 1 closes 60% of the gap) and `IMPROVEMENT_ALPHA = 4`
(the first fixes count most: r = 0.5 gives 68% of the r = 1 gain). `r` is clamped to
[0, 1]. The total is the usual `round(sum(score * weight) / sum(assessed weights))`
with the weights stored in the review, computed from the unrounded dimension
points (stored dimension scores are rounded to two decimals).

**r per dimension**, measured on the improved content against the stored content:

| Dimension | r |
| --- | --- |
| `impact` | Share of unique experience statements with figures (the scoring's figure rule): `max(0, (after - before) / (1 - before))`, 0 when `before = 1`. The result is also capped at `max(before points, LEVEL_POINTS[impact cap level of the improved content])`. The improve flow does not invent numbers, so this is usually 0. |
| `skills_evidence` | Of the listed skills that experience/project text did not mention before, the share mentioned there after (case-insensitive whole-term match). |
| `wording`, `depth`, `focus` | AI-verified: `none` = 0, `partial` = 0.5, `full` = 1. |
| `structure` | Not the formula: the deterministic structure check runs on the improved content and the higher of the two results is kept. |
| `ats` | Unchanged: the source file did not change. |

**AI verification** (`flow_type` `cv_review_verify`, code-only prompt
`cv-review-verify` in `flow-registry.ts`). Only criteria the stored review scored
(non-null, below 100) are sent, each with its original issue, fix and quote, plus
the before and after CV as sections built by `buildAiReviewInput` (same redaction,
14,000-character cap per side). Where the issue comes from: AI reviews store the
fix in the dimension's check `suggestion` and "assessment “quote”" in its
`evidence`; the issue only survives in `improvements` ("issue “quote” fix"), which
keeps the top six, so the assessment stands in when it was cut. Basic reviews send
their failing checks' evidence and suggestions. The model returns per criterion a
`resolution` (`none`, `partial`, `full`) and an `evidence_quote` copied from the
after text; it never outputs numbers. A resolution counts only when its quote
passes the scoring's quote rule against the after text (at least 8 characters,
ignoring case, spacing, bullets and quotation marks); otherwise it is `none`.

**Guarantees** (unit-tested with random cases): every dimension and the total stay
≥ before and ≤ 100; r = 0 changes nothing; r > 0 on an assessed dimension below 100
raises the unrounded total strictly (except impact, where the cap can hold it).
The returned `after` is never below the stored score.

**Scope and fail-safe.** A basic review (`method: "basic"`) gets the formula on the
dimensions it scored (impact, wording, structure, ats). Unscorable and image-based
(`ats_blocker`) reviews get no improvement score. If the verify run fails or its
output is invalid, wording, depth and focus use r = 0 (the deterministic r still
apply) and a warning is logged. The score never fails the improvement and never
claims or releases a free-tier use.

**API and storage.** `POST /ai/import-improve` accepts an optional `import_id`.
When the upload belongs to the user and has a stored v2 review, the response adds
`score_improvement: { before, after }` (otherwise `null`); client scores are never
read. Each result is stored in `public.cv_score_improvements` (`score_before`,
`score_after`, `review_after`: the recomputed review in the `CvReview` shape, same
`method`, with a limitation saying it was updated after an AI improvement). The
table is backend-only (RLS on, no policies, no browser grants), part of the data
download and deleted by account erasure before `imports`; deleting the upload
clears `import_id`. After saving, the improve page shows the score going from
before to after with one Continue button when `after > before`, otherwise it moves
on as before. Note that saving the improved upload (`PATCH /imports/:id/result`)
clears the import's stored review, so a retry returns `null`.

## Rollout

Apply `supabase/migrations/20261106120000_cv_review_ai_flow.sql` **before
deploying the backend**: it allows `cv_review` in `ai_runs.flow_type`. Without it
the run insert fails and every upload gets the basic review.

Apply `supabase/migrations/20261109120000_cv_score_improvements.sql` before
deploying this backend: it allows `cv_review_verify`
and creates `cv_score_improvements`. Without it the verify run insert fails (the
score falls back to r = 0 for wording, depth and focus) and storing the result
fails with a logged warning; the improvement itself still succeeds.

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
`tests/cv-review-improvement.unit.test.ts` covers the improvement formula and its
guarantees (random cases), each r rule, issue recovery, quote parity with the
scoring, the fail-safe and a worked example (66 → 75);
`tests/cv-score-improvement.integration.test.ts` runs `improveImportedContent` with
the mock provider and checks the response, the stored row, the tracked verify run and
the free-use markers; `tests/sql/cv-score-improvements.sql` checks the table's
privileges, constraints and erasure; `ScoreImprovementResult.test.tsx` checks the
result state.
