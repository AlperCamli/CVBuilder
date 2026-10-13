# CV translation

CV document languages are independent of English/Turkish interface locales. Admins configure them in Language Studio. Users choose **Translate** in My CVs, select an active document language, review the result, then create an independent master CV. The source remains unchanged. Standard CVs retain the existing one-master-per-language rule; UK medical CVs are excluded.

## Admin workflow

1. Run the frontend dev server and open `/designs/guided-journey/languages` (or a review build with `VITE_ENABLE_DESIGN_TOOLS=true`).
2. Select or add a language. Choose **CV languages & headings**, enable it for CV translation, and fill every standard section heading. For example, set Turkish `experience` to `Deneyimler`. Interface copy remains separate.
3. **Export workspace** backs up both interface edits and CV settings. **Export CV languages** creates `cv-languages.json`; active languages require complete headings. New languages begin disabled. Existing version-1 workspaces acquire the seeded English/Turkish CV settings when loaded.
4. Apply `backend/supabase/migrations/20261013120000_cv_language_catalog.sql` after the existing migrations. It seeds English/Turkish, adds the protected catalog, and replaces the hardcoded language insert guard. It does not modify existing documents.
5. From `backend`, run `npm run languages:import -- /absolute/path/to/cv-languages.json` with administrator `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured in the environment or backend `.env`. This validates the entire file and atomically upserts its languages. Unlisted languages remain unchanged; disable a listed language explicitly to remove it from user choices. The key stays on the administrator's machine.

Studio changes are browser-local drafts until this import is run. There is no public write endpoint or browser admin credential. The existing app has no administrator role model, so publishing follows its catalog-export workflow. Only the authenticated read endpoint `GET /api/v1/cv-languages` exposes active catalog entries. Database privileges/RLS prevent ordinary users from changing the catalog.

Section titles are keyed by canonical section type, not English source text. Standard sections use exact administrator headings. Unknown/custom section types preserve their source title unless an administrator adds that type to `section_titles` in the exported catalog. Header/contact section titles and fields stay unchanged. Direction is included in the translation preview. Before enabling a new script, verify fonts, shaping, and right-to-left export layout; the catalog does not add font/rendering support.

## AI and reconstruction

- At start, verify ownership, standard module, enabled target language, a different source language, consent and quota. Save the source snapshot, target catalog and resolved prompt with the run. Heading/prompt edits do not alter an in-flight result.
- Plan one request per non-empty block, using the Improve CV bounded worker pattern with a concurrency limit of four. Hidden narrative blocks are translated too so they remain consistent if shown later. Empty blocks need no request.
- Send only translatable field values, their paths, source/target language codes, and section/block types. Exclude document metadata, photos, layouts, the header/contact aliases (`header`, `contact`, `contact_info`, `personal_info`), organizations, institutions, dates, names, URLs and IDs. Section headings never go to AI.
- Translate summaries, descriptions, notes, responsibilities/achievement bullets, skill lists, job titles, roles, degrees/fields of study, qualifications, spoken language names and proficiency labels. Unknown fields remain unchanged. Within structured narrative lists, only known narrative keys are selected.
- Validate strict JSON, exact path coverage, no duplicate/extra/missing paths, nonblank text, numerical facts and embedded links/emails. Numbers may change position but retain their original text and multiplicity. The existing English/Turkish heuristic rejects conclusively wrong-language output; other languages rely on the target-language prompt and human review.
- Reconstruct from a clone of the source using server-selected paths, then assign the snapshotted administrator headings and target language. Preserve stable IDs, section/block order, visibility, meta, metadata and fixed fields.
- Retry only the failed block, up to three total attempts (initial attempt plus two retries), within its existing worker slot. Successful siblings keep their results and continue through the remaining queue. Retry temporary transport/provider errors and invalid block output (schema, path coverage, numbers, links, or conclusively wrong English/Turkish text). Wait approximately 0.75–1 seconds and 1.5–2 seconds between attempts, honoring longer provider retry hints up to 30 seconds. Longer cooldowns, permanent authentication/request errors, provider refusals, hard quota exhaustion, accounting failures and privacy/permission failures stop that block without further inference. Check AI permission again before each attempt and validate every result.
- Translation requests use a single provider attempt without model fallback so the block retry loop does not multiply the providers' own retry budgets. Other AI flows keep their configured retries/fallbacks.
- Wait for all workers and their retries. A block that still fails after its retry budget fails the whole run; no partial document is offered. Provider token usage is aggregated across workers/retries and recorded once, including received usage on failed calls. A successful inference consumes one AI action through the existing atomic completion/quota transaction. A CV with no translatable fields only changes headings and uses no AI action. Start still requires an available AI allowance.
- Applying an owned completed run rechecks active language, source ownership and duplicate master availability. Concurrent applications remain serialized by the database guard. Disabled languages can still be edited in existing CVs; disabling prevents new translations. Regional codes are compared in full (`pt-br` and `pt-pt` are separate). Later AI editing retains arbitrary document codes instead of falling back to English.

Provider timeouts and pending-run watchdog mechanisms remain unchanged. Automatic retries retain successful blocks in memory for the current execution; starting a new translation run still starts fresh. This is request-bound processing, not a durable background job. A provider response still requires factual and language review by the user; schema validation cannot prove semantic accuracy or preservation of every proper name within free text.

## Verification

Run backend/frontend tests and typechecks. `npm --prefix backend run test:privacy-sql` applies every migration to temporary PostgreSQL and verifies catalog access, disabled-language rejection, regional uniqueness, existing-document edits, translation atomic completion and quotas.

With the frontend dev server running:

```sh
node frontend/scripts/verify-cv-translation.mjs
node frontend/scripts/verify-language-studio.mjs
```

Set `LANGUAGE_STUDIO_URL` if the server uses another port. The translation browser check uses isolated demo data and fixture API contracts; it exercises admin heading export and the actual language-selection/review/apply dialog. Backend HTTP tests exercise the real controller/routes/service with an in-memory provider. No test calls paid AI or publishes a live catalog. Real-provider quality and hosted deployment checks require the configured environment.
