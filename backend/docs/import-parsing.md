# Import and Parsing (Phase 2)

Phase 2 implements an MVP import pipeline that is persistence-first and contract-stable.

## Lifecycle

`imports.status` values:
- `uploaded`
- `parsing`
- `parsed`
- `reviewed`
- `converted`
- `failed`

Typical flow:
1. `POST /imports`
2. `POST /imports/:importId/upload-complete`
3. `POST /imports/:importId/parse`
4. `GET /imports/:importId/result`
5. `PATCH /imports/:importId/result` (optional manual correction)
6. `POST /imports/:importId/create-master-cv`

## Persistence Guarantees

For each import session:
- source file metadata is saved in `files` (`file_type=source_upload`)
- import session row saved in `imports`
- parser output stores:
  - `raw_extracted_text`
  - `parsed_content`
  - `parser_name`
  - `error_message` (on failure)
- conversion links `imports.target_master_cv_id`

Original file metadata and parse results remain available after conversion.

## Parser Implementation (MVP)

Current parser abstraction:
- interface: `CvParser`
- implementation: `simple_cv_parser_v1`

Current behavior:
- attempts text extraction from uploaded source bytes
- uses heuristic section detection (`summary`, `experience`, `education`, `skills`, `projects`)
- builds normalized CV content model (`CvContent`)
- stores parser warnings for low-confidence extraction

## Supported/Practical Input Behavior

- text-like MIME types work best (`text/plain`, markdown, etc.)
- PDF uses heuristic text extraction fallback
- non-text binaries are parsed with best-effort fallback decoding

## Known Limitations (Documented)

- no OCR
- no high-fidelity PDF layout parsing
- no robust DOCX semantic parsing
- no asynchronous job queue/orchestration yet
- parser focuses on contract continuity over perfect extraction accuracy

## Review Before Conversion

`PATCH /imports/:importId/result` allows frontend/manual correction of `parsed_content` before creating Master CV.

This preserves the frozen product decision that parsed output must be reviewable/editable before conversion.

## Future Extension Path

Without API contract churn, future phases can:
- swap parser implementation
- add richer model mapping
- add AI-assisted cleanup
- add async parse workers/retries/observability
