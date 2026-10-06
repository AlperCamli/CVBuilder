# CV review v1

The server owns the scoring formula. `GET /imports/:id/result` returns `review`
alongside parsed content. No extra AI request is made for this review. It runs
against the parsed document in memory, avoiding a second model latency or cost.
Existing AI parsing and tailoring remain in use. Tailoring priorities from the
AI job analysis can supply keywords, but only terms present in the actual job
description are accepted. An AI response cannot directly set numerical scores.

## Formula

Each dimension is scored from 0–100 using the sum of its awarded check points
divided by its available check points. Round the dimension score, then compute:

`total = round(sum(dimension score * weight) / sum(assessed weights))`

| Dimension | Weight | Checks |
| --- | ---: | --- |
| Parseability / ATS compatibility | 20 | Extraction quality (60), direct text extraction (40) |
| Section completeness | 15 | Name/contact (30), experience or projects (30), education/qualifications (20), skills (20) |
| Job-description relevance | 20 | Job terms in contextual summary/experience/projects (80), target role terms (20) |
| Keyword coverage | 15 | Unique matched job terms / unique target terms |
| Content quality | 15 | Statements with 6–45 words (40), recognized initial action verbs (30), absence of checked generic phrases (30) |
| Measurable achievements | 10 | Fraction of unique experience statements with measurable scope/results; full credit at 50% |
| Text structure and formatting | 5 | Distinct headings (40), no empty visible placeholders (30), no detected broken replacement/null characters (30) |

The actual checks, points, evidence with short CV excerpts, missing keywords and suggestions are returned
in the API. Improvements are ordered by the weighted shortfall of their checks.
Empty section types, hidden blocks and duplicated narrative statements do not
earn additional completeness, wording or achievement credit. Dates, phone
numbers and grades outside experience narratives do not count as achievements.
Projects and medical sections count alongside conventional experience and skills.
An optional professional summary is not required for full completeness credit.

## Partial reviews and failures

- An upload without a job description excludes relevance and keyword coverage,
  leaving 65% of the rubric available when extraction diagnostics exist.
- Historical uploads without saved diagnostics exclude parseability too. The
  API explains that re-upload is needed to assess the source file.
- Native tailored content is not an uploaded file; parseability is unassessed.
- English wording rules are not applied to other languages.
- Unavailable dimensions get `score: null`, rather than fabricated scores or
  automatic penalties. `assessed_weight` and `status: partial` explain scope.
- Failed/pending imports, absent or nearly empty readable content, low-confidence
  extraction, binary decoding, heuristic PDF recovery and OCR all withhold the
  numerical score (`status: unscorable`). OCR recovery is useful for editing, but
  it does not prove that an ATS can read the original scanned file.
- A failed re-parse clears stale content and extraction evidence so a previous
  successful parse cannot produce a misleading score.
- Editing recovered content does not erase the source-file extraction evidence.

The UI describes unreadable uploads as a **potential ATS compatibility issue**
and also acknowledges possible parser failure. It offers re-upload and, when
content was recovered, review in the editor. It avoids encouraging AI improvement
or immediate tailoring of unreliable recovered content.

This is a product rubric, not an industry-standard ATS scoring formula, a hiring
prediction or verified semantic qualification matching. Keyword matching is
case-insensitive and boundary-aware (including C++, C#, .NET and Node.js).
Target terms combine validated AI/user priorities and a deterministic list of
up to 30 frequent non-stopword job-description terms. Repeating a keyword does
not increase coverage. Generic task verbs are excluded from extracted keywords.
Terms in summaries or experience count toward contextual
relevance; a skills list alone is not equivalent to contextual evidence.

No visual layout, columns, fonts, headers or exported-file compatibility is
inferred from normalized text. The formatting dimension explicitly reviews
text structure only. Parsing difficulty as a possible compatibility issue is
consistent with [Greenhouse's documented parsing limitations](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse);
the scoring weights and thresholds are our own product policy.

## Tailoring comparison and persistence

Both synchronous draft generation and asynchronous tailoring runs save
`tailoring_review` with the final stabilized CV. The same target job and keywords
are used for both sides. Each comparison includes before/after scores, changes
by dimension with evidence, added/removed covered terms, and changed sections.
Scores may increase, decrease or remain unchanged. Incomparable/unscorable
reviews have a null delta. The editor's **Tailoring review** button opens this
summary and the detailed after-review.

This is a snapshot at generation time, explicitly labeled in the UI. Later edits
do not silently rewrite the original comparison. No scores are backfilled for
older tailored drafts.

Apply `supabase/migrations/20261006120000_cv_review_evidence.sql` **before deploying
the backend**. It adds nullable `imports.review_context` and
`tailored_cvs.tailoring_review` JSONB columns. Diagnostics are stored separately
from editable CV JSON. Existing ownership-scoped repository reads/writes and
table access policies apply; no new public endpoint or permission is introduced.

## Verification

`tests/cv-review.unit.test.ts` covers formula consistency, excluded dimensions,
unsafe extraction, empty/hidden content, repeated statements, false numerical
impact, contextual versus skills-only matching, technical term boundaries,
medical/project CVs, language support, and positive/negative/unchanged tailoring.
Import service tests check persistence across fresh service instances and stale
content cleanup after failure. Frontend render tests check failure presentation,
partial scoring, evidence visibility and honest decreases. AI service tests verify
that both draft generation paths persist and return the review of the final
post-processed content, including inserted skills sections.
