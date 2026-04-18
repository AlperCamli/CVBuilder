# Import and Parsing

Import parsing stays persistence-first and contract-stable, while Phase 4A upgrades the parser path for text-based PDFs.

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

## Parser Implementation

Current parser abstraction:
- interface: `CvParser`
- implementation class: `SimpleCvParser`

Parser identities:
- `smart_pdf_parser_v2` for `application/pdf`
- `smart_docx_parser_v1` for DOCX files
- `simple_cv_parser_v1` for non-PDF text/fallback paths

### Automatic File-Type Resolution (single import button)

The parser auto-resolves parsing strategy from multiple signals:
1. MIME type
2. filename extension
3. file signature/magic bytes (for PDF/ZIP cases)

This keeps frontend UX simple with one import button while backend decides parser path reliably.

### PDF Extraction Strategy (text-based PDFs)

For `application/pdf`, extraction is layered:
1. `pdfjs_text` (primary, PDF.js)
2. `pdf_token_heuristic` fallback (token-based extraction from PDF text operators)
3. `utf8_decode` fallback (best-effort final fallback)

The parser always returns `parsed` content when technically possible; extraction quality issues are returned as warnings instead of hard failures.

### DOCX Extraction Strategy

For DOCX (`.docx`) inputs, extraction is layered:
1. `docx_xml_text` (primary, `word/document.xml` and related Word XML parts from zip container)
2. `utf8_decode` fallback (best-effort final fallback)

DOCX parser extracts text from WordprocessingML paragraphs/runs and then applies the same cleanup/section mapping pipeline as other inputs.

### Cleanup and Quality Heuristics

After extraction, text is normalized and cleaned to remove common PDF artifacts/noise:
- object/stream markers (`obj/endobj`, `stream/endstream`, `xref`, `trailer`)
- common font and CMap dictionary fragments
- Adobe/Identity-related noise lines
- repeated URL-only lines and repeated duplicate lines
- symbol-heavy/binary-looking gibberish lines

Quality scoring is computed and diagnostics are emitted in warnings:
- natural language ratio
- symbol ratio
- repeated token ratio
- entropy ratio

Policy:
- low confidence does **not** fail parsing
- parser returns `parsed` + strong warnings for manual review

## Section Detection Taxonomy (TR/EN)

Heading dictionaries and aliases cover:
- `header`
- `summary`
- `experience`
- `education`
- `skills`
- `languages`
- `certifications`
- `courses`
- `projects`
- `volunteer`
- `awards`
- `publications`
- `references`

Detection behavior:
- heading-first segmentation when headings are detected
- fallback line classification for unheaded documents

## Output Mapping (CvContent)

Parser output stays on canonical `CvContent` and normalized via `normalizeCvContent`.

Mapping behavior:
- `header`: explicit section with a `header` block
- `summary`: single summary block (`fields.text`)
- `skills`: single skills block (`fields.items` + `fields.text`)
- other sections: grouped text/item blocks with stable ordering

Metadata is also populated when possible:
- `full_name`
- `headline`
- `email`
- `phone`
- `location`
- `urls`

This preserves compatibility with existing import review/edit flow (`PATCH /imports/:importId/result`).

## Scope and Limitations

Current scope:
- text-based PDFs
- text-based DOCX (`.docx`)
- text-like files
- best-effort fallback for other binary MIME types

Still deferred:
- OCR for scanned PDFs/images
- high-fidelity layout reconstruction
- full semantic DOCX parser
- async job orchestration/retries for parsing

## Local Debugging

Use:

```bash
npm run inspect:import -- /absolute/path/to/file.pdf --full
```

Inspection output now includes:
- parser name
- warnings
- extraction stage and attempted stages
- extraction confidence/score
- low-confidence flag
- parsed sections and metadata
