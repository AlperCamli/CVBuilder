# CV Tailoring v2 — Design

> Status: **Designed, not implemented.** Implementation starts only on explicit go-ahead.
> The current flow (`/app/tailor/:id` → `/app/tailoring-flow/:id`, `tailored_draft` AI flow)
> stays as **legacy** until v2 is proven, then it is removed (see §9).

---

## 1. Why we are redesigning

Findings from the analysis of the current flow:

- **Context loss.** The draft model never sees the job description; job analysis never sees
  the CV; follow-up questions see neither. Tailoring is driven by a role title plus chips.
- **Untruthful skills.** Every selected keyword is injected into Skills by code, even if the
  user answered "no". This also inflates the review score and defeats the
  "unchanged output" guard.
- **No real review.** The draft is written straight into the CV; "you review every AI
  change" is not true. Changed block ids are computed and discarded.
- **Fragile flow.** State lives in router navigation state (refresh loses paid work);
  failed drafts leave a master-identical CV and an orphan job behind; only 3 of up to
  20 questions are shown.
- **Prompt override bug.** DB `user_prompt_template` silently replaces the code-built user
  prompt (drops personalization guidance).

Goals for v2: **fast** (users tailor many applications per day), **truthful** (human in the
loop for facts and numbers), **engaging** (user watches their CV improve), **in-editor**
(no page change).

## 2. UX

### Layout — three panes, two visible (laptop only for now)

```
Normal mode:     [ Editor | Preview ]   Tailor →
Tailoring mode:  ← Editor   [ Preview | Tailor ]
```

- Entering tailoring mode slides the editor out to the left, the preview to the left
  slot, and the Tailor panel in from the right. Smooth transition — it must never feel
  like a page change.
- **Edge handles:** thin always-visible tabs on the left/right edge that expand on hover
  ("Editor" / "Tailor"). Keyboard shortcut for switching.
- **Pencil on hover** over a preview section → slides back to the editor scrolled to that
  block.
- Switching panes is navigation, **not** an exit. The session ends only on "Finish".
- Mobile is out of scope; it will follow the same model later.

### Steps (guided by the Tailor panel)

1. **Job input** — role, job description, company (optional). No auto-prefill, no Job
   Tracker picker (future).
2. **Match analysis** — one AI call. Panel shows progress; preview highlights evidence
   blocks as results arrive.
3. **Match results** — match score + requirement checklist (covered / weak / missing).
   Clicking an item jumps to its evidence. User can approve/reject a requirement as
   relevant.
4. **Gap questions (skippable)** — Yes / Some exposure / No for missing or weak
   must-haves, plus **numeric questions** ("How many users / what % / team size?") for the
   most relevant experiences. Numbers come from the human, never the model. Optional
   "Also add to my main CV" per answer.
5. **Generate (parallel)** — one call per relevant block + one structure call. Blocks not
   affected by an open question start **while the user is still answering**.
   Sections in progress show an "AI working" marker and are locked.
6. **Review** — suggestion cards (accept / reject / inline edit / quick-fix chips via the
   existing block-suggest call). **Auto-apply** toggle: off by default, remembered per
   user. Score updates live.
7. **Ready** — clear "Ready to apply" state with final score and export. The user can
   still request adjustments.

**Re-tailoring** for another job restarts from step 2 on the **current tailored copy**
(rebase), not the main CV.

### Components

Use shadcn-based AI UI components (e.g. the AI Elements registry) for familiar
signals: working markers, shimmer/loader states, suggestion cards. Not installed today —
`frontend/src/app/components/ui/` has base shadcn only.

### Prerequisite: section referencing in the preview

The rendering presentation already carries CV block ids (`PresentationItem.id` =
block id, [rendering-presentation.ts](../src/modules/rendering/rendering-presentation.ts)).
[CVPresentationPreview.tsx](../../frontend/src/app/components/CVPresentationPreview.tsx)
only uses them as React keys; expose them as `data-block-id` / `data-section-id` for
highlighting, markers, hover pencil and evidence links.

## 3. AI architecture

A **fixed workflow, not an agent loop.** The steps are known in advance; an orchestrator
agent would re-read context every turn (≈3–5× tokens), be slower and less predictable.
The analysis call plays the orchestrator role by producing per-block briefs; code fans
out the block calls.

All new flows are defined **in code only** (flow registry). No `ai_prompt_configs` rows,
so the DB template override cannot apply. Model: **gpt-6-luna** via the OpenAI provider.

### 3.1 `tailoring_analysis` (1 call)

**Input — compact CV** (built by code, header/contact excluded, empty blocks/fields
omitted, block ids aliased like today):
- each experience/project-like block: title, subtitle, description/bullets
- professional summary, skills, education (degree + field of study)
- no dates (trade-off: "N+ years" requirements are judged as weak, not verified)

plus role, company, job description.

**Output:**
- `requirements[]`: `id`, `text`, `importance` (must / nice), `weight` (1–3),
  `status` (covered / weak / missing), `confidence`, `evidence_block_ids[]`
- `questions[]`: gap questions (`requirement_id`, `target_block_id`, type
  yes_some_no) and numeric questions (`target_block_id`, what to quantify)
- `block_briefs[]`: per relevant block — requirements to target, terms to use, what not to
  repeat from other blocks
- `structure_hints`: candidate reorder / hide

### 3.2 Match score

The model judges, code computes. Score = weighted share of requirement statuses
(covered = 1, weak = 0.5, missing = 0), weighted by `weight`, excluding requirements the
user rejected. Accepting a suggestion upgrades the requirements in its `requirement_ids`
(e.g. weak → covered) — live update without extra calls. Optional cheap re-check call at
"Finish".

### 3.3 `tailoring_block` (N calls, parallel)

Only for blocks that are evidence or question targets, plus summary and skills.

**Input:** the block's full fields, its brief, role, full requirement list, user answers
relevant to the block, and every other block's title + first bullet (for consistency and
no repetition). The job description + requirements are an identical prefix across calls
to benefit from OpenAI automatic prompt caching.

**Output:** `changed` (bool), new narrative fields, `rationale`, `requirement_ids`.
`changed = false` → no card.

Missing summary → a `new_summary` suggestion. Skills → a `skills` suggestion
(add / reorder, constrained by §3.5).

### 3.4 `tailoring_structure` (1 call)

Section order and hide suggestions from requirements + block titles.

### 3.5 Deterministic guards (code, after every block output)

- **Number guard** — any number not present in the source block or the user's answers is
  rejected (suggestion dropped or field reverted).
- **"No" guard** — terms from requirements answered "No" cannot be newly introduced.
- **Read-only facts** — titles, companies, institutions, dates are not editable; only
  narrative fields are applied.
- **Bullets** — all narrative output passes the existing bullet normalizer
  (`bulletizeNarrativeFields`, `shared/cv-content/bullet-text.ts`).
- Schema validation as today; **no** blanket keyword injection into Skills.

## 4. Data model

### 4.1 New `tailoring_sessions`

| column | notes |
|---|---|
| `id`, `user_id`, `tailored_cv_id`, `job_id` | one **active** session per tailored CV |
| `status` | `analyzing` → `answering` → `generating` → `reviewing` → `ready`; `archived` on re-tailor |
| `analysis` jsonb | requirements, questions, briefs, structure hints |
| `requirement_decisions` jsonb | approve/reject relevance |
| `answers` jsonb | gap + numeric answers, `add_to_main` flag each |
| `tasks` jsonb | per block: `block_id`, `status` (waiting / ready / running / done / failed), `depends_on_question_ids` |
| `base_snapshot` jsonb | content at session start — "before" score and "Revert all" |
| `created_at`, `updated_at`, `finished_at` | |

### 4.2 `ai_suggestions` (extend)

Add `tailoring_session_id`, `kind` (rewrite / new_summary / skills / reorder / hide),
`rationale`, `requirement_ids`, `base_hash` (block content hash at generation time).
Add status `stale`; extend the `action_type` check with a tailoring value. Existing
apply/reject endpoints are reused.

### 4.3 `ai_runs` (extend) — cost tracking

Already stores `input_tokens`, `output_tokens`, `total_tokens`. Add:
- `tailoring_session_id`, `parent_run_id` (block runs → analysis run)
- `cached_input_tokens`, `reasoning_tokens` (billed differently)
- `cost_usd` — computed at write time from a price table in config (historic costs stay
  correct when prices change)

The OpenAI provider currently reads only `prompt_tokens` / `completion_tokens`; it must
also read `prompt_tokens_details.cached_tokens` and
`completion_tokens_details.reasoning_tokens`.

Session **total** = sum of its runs; **breakdown** = grouped by step (analysis, each block,
structure, quick fixes). Failed and retried runs are included (we pay for them).

### 4.4 `users` (extend)

`preferences` jsonb — e.g. `tailoring_auto_apply`.

## 5. API

| endpoint | purpose |
|---|---|
| `POST /tailoring-sessions` | from master CV: create tailored copy + job + session; from tailored CV: re-tailor (archive old session, update job) |
| `GET /tailoring-sessions/:id` | full state; refresh/reopen resumes and continues pending tasks |
| `POST /tailoring-sessions/:id/analyze` | run analysis; returns analysis + tasks ready to start now |
| `PATCH /tailoring-sessions/:id/requirements/:reqId` | approve / reject relevance |
| `POST /tailoring-sessions/:id/answers` | save answers; unlock dependent tasks; apply `add_to_main` |
| `POST /tailoring-sessions/:id/tasks/:taskId/run` | generate one block; returns its suggestion(s) |
| `POST /tailoring-sessions/:id/apply-all` · `revert-all` · `finish` | bulk actions, final score |
| `GET /tailoring-sessions/:id/cost` | token + cost breakdown and total (visibility: see §10) |
| existing `/ai/suggestions/:id/apply` · `reject` | per-card actions |

## 6. Execution model

- The backend runs on Vercel serverless (`maxDuration: 300`). **Each block task is its own
  request**; the frontend runs ~5 concurrently. This gives true parallelism, per-block
  retry, and cards arriving one by one. A block's "AI working" marker = its task is
  `running`.
- **Auto-apply** is applied server-side when a task completes (no UI race); still
  undoable.
- **Locking:** while a task runs, the UI blocks editing that block and the backend rejects
  block edits with 409. If a block changes after its suggestion was created
  (`base_hash` mismatch), the suggestion becomes `stale`.
- **"Also add to main CV":** the tailored copy keeps master block ids, so the accepted
  change is also applied to the same master block if it still exists.
- **Rate limiting:** the per-user AI limiter would throttle parallel tasks; task runs use a
  per-session budget instead (e.g. ≤ 25 tasks).
- **Usage limits:** none for now (tracked, not enforced).

## 7. Speed

- One analysis call instead of three sequential calls.
- Compact CV input; unrelated blocks are never sent to generation.
- Generation for unaffected blocks starts during the question step.
- Shared prompt prefix → cached input tokens.
- Rough estimate (to be validated by §4.3 tracking): ~20–25k tokens per session
  (analysis ≈ 6k, ~8 blocks × 2k, structure ≈ 2k).

## 8. Edge cases

- **Refresh / close mid-session** → `GET` session resumes; `running` tasks older than the
  request timeout are retried (reuse the AI run watchdog).
- **Abandoned session with no accepted changes** → tailored CV listed as
  "Draft — resume tailoring", not as a finished CV.
- **Analysis fails** → session stays at job input with retry; the copy is kept (job +
  content intact).
- **Block task fails** → that card shows retry; other tasks continue.

## 9. Legacy and removal

1. v2 ships alongside the legacy flow (entry points switch to v2).
2. After a successful transition, delete: `TailorCV.tsx`, `TailoringFlow.tsx`,
   `tailoring-run.ts` usage for tailoring, the `job_analysis` / `follow_up_questions` /
   `tailored_draft` flows, their routes, and their `ai_prompt_configs` rows.

## 10. Open decisions

- **Cost visibility:** internal/admin only, or also shown to the user? (Default
  assumption: internal only.)

## 11. Suggested implementation order

1. Preview section referencing (`data-block-id`) — unblocks all UI work.
2. Migrations: `tailoring_sessions`, `ai_suggestions` + `ai_runs` + `users` extensions;
   OpenAI usage parsing for cached/reasoning tokens; cost calculation.
3. Backend: compact-CV builder, `tailoring_analysis`, score computation, session API.
4. Backend: `tailoring_block` + `tailoring_structure`, guards, task execution, auto-apply.
5. Frontend: three-pane sliding layout, edge handles, Tailor panel steps 1–4.
6. Frontend: generation markers/locks, suggestion cards, auto-apply, ready state.
7. Cost breakdown view; switch entry points to v2; keep legacy behind the old routes.
