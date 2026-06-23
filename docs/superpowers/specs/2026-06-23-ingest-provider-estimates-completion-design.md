# Ingestion: provider choice, accurate estimates, and completion gating — Design

**Date:** 2026-06-23
**Status:** Proposed (brainstorming-approved 2026-06-23; supersedes nothing)
**Surface:** CourseCapture triage/ingest step (`app/capture/[code]/TriageStep.tsx`), the in-process ingest worker (`lib/capture/ingest-queue.ts`), the estimate model (`lib/capture/ingest-estimate.ts`), the AI provider layer (`lib/ai/*`), and `POST /api/admin/v2-backfill`.

---

## 1. Motivation

Three operator-reported gaps on the Step-2 "Triage materials → Ingest" screen:

1. **Time estimates don't clearly track choices.** The estimate should recompute when materials move between High/Middle/Background tiers (and, new, when the provider changes).
2. **No way to choose a free/on-prem provider.** Ingestion always runs on OpenAI (`AI_PROVIDER=openai`): vision transcription on `gpt-5.4`, digest + contextualize on `gpt-5.4-mini`. That costs money and sends slide content off-device. A 2026-06-23 bench (`~/.local/share/gc-curriculum-tool/vision-bench/README.md`) established that **omlx `Qwen3.6-35B-A3B` (thinking off) does image/slide transcription cleanly and completely (~9–23 s/slide), comparable to OpenAI** — so a local path is now viable for vision. A follow-up 2026-06-23 text bench validated the digest + contextualize steps too: **Clemson campus `gptoss-120b` matches OpenAI `gpt-5.4-mini` quality and is faster (digest 5.8s vs 6.6s; contextualize 0.6s vs 1.3s), free.** (The campus `qwen3.6-*` models were rejected — they default to thinking-mode and returned empty content for these JSON tasks without `enable_thinking:false`.) We want an opt-in "use local/free" toggle.
3. **Ingestion completion is invisible.** "Ingest & continue" fires the background queue and *immediately* advances to the interview (`onIngested()` → `landingStep='interview'`), so the user proceeds while extraction/indexing is still running, with no signal that it isn't done.

All three are being built together as one increment.

## 2. Goals / non-goals

**Goals**
- Estimate recomputes on tier move **and** on provider toggle, using provider-calibrated constants.
- An opt-in **"use local/free models"** checkbox beside the Ingest button that routes the run's LLM calls to free providers (per-task best-fit) and re-estimates.
- A **hard completion gate**: the user cannot advance to the interview until every material reaches a terminal indexing state.

**Non-goals**
- Changing the global default provider (stays OpenAI; local is opt-in per run).
- Embeddings provider choice (always campus Qwen, unchanged).
- A general per-function provider-routing UI (out of scope; this is one ingest-run toggle).
- Further tuning of local text quality beyond the 2026-06-23 validation (campus `gptoss-120b` confirmed comparable to OpenAI for both text steps); the profile map remains the retune point if a better model emerges.

## 3. Design

### 3.A — Provider-aware estimates (`lib/capture/ingest-estimate.ts`)

`estimateSeconds` / `estimateTotal` gain a `provider: 'openai' | 'local'` parameter (default `'openai'` to preserve current numbers). Internals select one of two constant sets:

| constant | openai | local | notes |
|---|---|---|---|
| `VISION_S_PER_SLIDE` | 1 | 12 | local Qwen-VL bench midpoint (~9–23 s, text-density dependent) |
| `DOCLING_S_PER_PAGE` | 3 | 3 | extraction is Docling either way (provider-independent) |
| `DIGEST_S` | 2 | 3 | campus Qwen digest ≈ OpenAI-mini, slightly slower |
| `CTX_S_PER_CHUNK` | 0.5 | 0.6 | campus Qwen contextualize |
| `SLIDE_CONCURRENCY` | 4 | 2 | local vision is memory-bound; less intra-material parallelism |

These are coarse decision-support numbers (the UI already shows a ±range and "rough estimate"), recalibratable from `[ingest]` stage logs. `TriageStep` passes the live checkbox state into `estimateTotal(rows, provider)` and into each row's `estimateSeconds(row, provider)`; React already recomputes on every render, so both tier moves (which mutate `rows`) and the checkbox toggle trigger a fresh estimate. **Tier-move recalc is verified as already working; this change only makes the numbers provider-correct.**

### 3.B — "Use local/free" checkbox + free-provider profile

**UI.** A checkbox in the Triage footer, beside "Ingest & continue":
> ☐ Use local/free models — slower, no API cost

Default **unchecked** (OpenAI, the fast current path). Its boolean lives in `TriageStep` state, feeds the estimate (3.A), and is sent in the ingest request body.

**Free-provider profile (per-task routing).** A single config map (`lib/ai/ingest-provider-profile.ts`) defines, for the `'local'` profile, which provider+model handles each ingest sub-task:

| task | openai profile (default) | local/free profile |
|---|---|---|
| vision transcription | openai `gpt-5.4` | **omlx** `Qwen3.6-35B-A3B-UD-MLX-4bit` (thinking off) |
| material digest | openai `gpt-5.4-mini` | **campus** `gptoss-120b` |
| chunk contextualize | openai `gpt-5.4-mini` | **campus** `gptoss-120b` |
| embeddings | campus (unchanged) | campus (unchanged) |

The map is the single retune point if a different model fits better (e.g. swap omlx vision for Clemson `gemma-4-31b`).

**Local `transcribeDocument` (currently stubbed/throws).** Implement it for the local provider:
1. Render the PDF/slide bytes to PNG page images via the existing `renderToImages(bytes, mimeType, fileName)` in `lib/capture/render-pages.ts` (the `pdftoppm` path), capped at the existing `MAX_SLIDES`.
2. For each page image (bounded concurrency), call the omlx OpenAI-compatible chat endpoint (`LOCAL_BASE_URL`, `LOCAL_API_KEY`) with the configured vision model, `chat_template_kwargs:{enable_thinking:false}`, and the standard transcription prompt; concatenate page texts in reading order.
3. Return `{ text, method:'vision', status, costUsdCents: 0 }`. Reuse the existing `low_text`/`failed` thresholds in `extract-text.ts`.

**Per-run provider plumbing (restart-safe).** Add a nullable `ingest_provider` (text: `'openai' | 'local' | null`) column to `course_materials` (new Drizzle migration `0045`). Flow:
- `POST /api/admin/v2-backfill` accepts `{ provider?: 'openai' | 'local' }` (validated; default `'openai'`).
- For each material it enqueues, it stamps `ingest_provider` = the chosen value (a new field on `enqueue`/the queued-status update).
- The worker (`processMaterial`) reads `row.ingestProvider`; `extractText` and the digest/contextualize calls resolve their provider via `resolveIngestProvider(task, row.ingestProvider ?? globalDefault)` instead of the bare `getProvider()`.
- `null` → global default, so a worker restart that re-queues stuck rows (boot recovery) never silently downgrades a paid run; a `'local'` run stays local across restarts.

This is the restart-safe choice over an in-memory `materialId→provider` map (which would revert to paid OpenAI on restart).

### 3.C — Completion hard-gate (`TriageStep.tsx`)

Replace the immediate `onIngested()` with an in-step ingest lifecycle:
- On "Ingest & continue" click: POST `v2-backfill` (with `provider`), then enter an **`ingesting`** state on the step (don't call `onIngested`).
- Poll material statuses every 3 s (reuse `fetchCourseMaterials` already imported in `TriageStep`; the same mechanism `MaterialsPanel` uses) until **every non-ignored material is terminal** (`ready` | `failed` | `skipped`).
- Render a progress bar: *"Ingesting 4 of 8…"* with a per-tier/percent indicator; show counts of done / failed / skipped.
- **"Continue to interview" is disabled until all terminal**, then enabled with a ✓ "Ingestion complete (N ready, M skipped, K failed)" state; clicking it calls `onIngested()`.
- The "← Back to materials" button (added 2026-06-22) stays enabled throughout, so a user who sees failures can go fix/re-tier materials.
- Failures don't block the gate (terminal = ready **or** failed **or** skipped), so a single bad material can't trap the user; the failed count is surfaced.

## 4. Data flow

```
TriageStep (checkbox: useLocal)
  └─ estimateTotal(rows, useLocal ? 'local' : 'openai')         [3.A]
  └─ POST /api/admin/v2-backfill { courseCode, slug, provider } [3.B]
       └─ for each material w/ ingestAction()=='queue':
            updateIndexingStatus(status:'queued', ingestProvider: provider)
            enqueue(id) → worker
  └─ poll fetchCourseMaterials() every 3s → progress bar        [3.C]
       └─ all terminal? enable Continue → onIngested()

worker.processMaterial(row)
  └─ provider = resolveIngestProvider('vision', row.ingestProvider)   [3.B]
  └─ extractText(...) → provider.transcribeDocument(...)              [local impl: render-pages + omlx]
  └─ digest/contextualize via resolveIngestProvider('digest'|'ctx', row.ingestProvider)
  └─ embeddings: campus (unchanged)
```

## 5. Schema change

Migration `0045` (Drizzle-generated): `ALTER TABLE course_materials ADD COLUMN ingest_provider text;` — nullable, no backfill (null = global default). Drizzle schema (`lib/db/schema.ts`) `courseMaterials` gains `ingestProvider: text('ingest_provider')`. The queue-status query helpers (`updateIndexingStatus`) gain an optional `ingestProvider` arg; `CourseMaterialRow` gains the field.

## 6. Error handling

- **omlx down / model won't load (507/connection error)** during a local run: `transcribeDocument` throws → `extract-text` catches → material marked `failed` (existing path). The hard gate treats `failed` as terminal, so the user isn't trapped; the failed count is shown. (We do **not** auto-fall-back to paid OpenAI — that would defeat the "free" intent silently; the user re-runs with the box unchecked if they want.)
- **Campus endpoint slow/unavailable** for digest/contextualize: same `failed`-terminal behavior.
- **Worker restart mid-run:** boot recovery re-queues stuck `indexing` rows; `ingest_provider` persists, so the provider choice survives.
- **Estimate is advisory:** no correctness dependency; mislabeled time never blocks anything.

## 7. Testing

- `ingest-estimate.test.ts`: extend with provider param — assert local vision constants produce a larger total than openai for the same middle-tier set; tier-move (high→background) lowers the estimate; openai default unchanged from current values.
- `ingest-provider-profile.test.ts` (new): the profile map returns the expected provider+model per (task, profile); unknown task throws.
- Local `transcribeDocument`: unit test with a faked omlx client + a stub `renderToImages` → asserts page texts concatenated in order, `enable_thinking:false` sent, cost 0, `low_text`/`failed` thresholds honored.
- `v2-backfill` route test: `provider:'local'` stamps `ingest_provider='local'` on queued rows; default/absent → `'openai'`; invalid value → 400.
- `TriageStep` component tests: (a) toggling the checkbox changes the displayed estimate; (b) after Ingest, "Continue" is disabled while a row is `queued`/`indexing` and enabled once all terminal; (c) a `failed` row still allows Continue and shows the failed count.
- Full suite + `tsc` green; final review.

## 8. STATE.md updates required on commit

- **Schema:** new migration `0045` + `course_materials.ingest_provider`.
- **AI functions / providers:** local `transcribeDocument` now implemented; new ingest-provider-profile map; `v2-backfill` accepts `provider`.
- **What's live:** Triage step gains the use-local checkbox + completion gate.
- **Deferred/debt:** local text steps use campus `gptoss-120b` (validated 2026-06-23, comparable to OpenAI); campus `qwen3.6-*` avoided (empty output in thinking-mode). Local vision est. constant (12 s/slide) is a coarse bench midpoint, recalibrate from real `[ingest]` logs.

## 9. Deferred / follow-ups

- Validating/​retuning local text-step quality and the estimate constants against real `[ingest]` logs.
- Per-course remembered provider preference (this design is per-run only).
- Wiring the same toggle into the per-material `MaterialsPanel` "Index now" path (this design covers only the bulk Triage "Ingest & continue").
