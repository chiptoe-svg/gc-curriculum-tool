# Ingestion: provider choice, accurate estimates, and completion gating — Design

**Date:** 2026-06-23
**Status:** Proposed (brainstorming-approved 2026-06-23; supersedes nothing)
**Surface:** CourseCapture triage/ingest step (`app/capture/[code]/TriageStep.tsx`), the in-process ingest worker (`lib/capture/ingest-queue.ts`), the estimate model (`lib/capture/ingest-estimate.ts`), the AI provider layer (`lib/ai/*`), and `POST /api/admin/v2-backfill`.

---

## 1. Motivation

Three operator-reported gaps on the Step-2 "Triage materials → Ingest" screen:

1. **Time estimates don't clearly track choices.** The estimate should recompute when materials move between High/Middle/Background tiers (and, new, when the ingest mode changes).
2. **No way to keep a whole ingest run off the paid cloud.** Today's ingest is already partly on-prem: digest + contextualize default to Clemson campus `gptoss-120b` (`reasoning_effort:low`) via `chunkLlmComplete`, with an automatic OpenAI `gpt-5.4-mini` fallback on any error; embeddings are always campus Qwen. **The one step that always hits paid OpenAI is vision transcription** (`gpt-5.4`), and the text steps can still silently fall back to OpenAI. So the current default is a *hybrid*: free-where-possible, paid-where-needed. A 2026-06-23 bench (`~/.local/share/gc-curriculum-tool/vision-bench/README.md`) established that **omlx `Qwen3.6-35B-A3B` (thinking off) does image/slide transcription cleanly and completely (~9–23 s/slide), comparable to OpenAI** — so a fully on-prem vision path is now viable. A follow-up 2026-06-23 text bench re-confirmed the existing campus choice: **`gptoss-120b` matches OpenAI `gpt-5.4-mini` quality and is faster (digest 5.8s vs 6.6s; contextualize 0.6s vs 1.3s), free.** (The campus `qwen3.6-*` models were rejected for text — they default to thinking-mode and returned empty content for these JSON tasks without `enable_thinking:false`.) We want an opt-in toggle that puts the *entire* run on-prem: vision → omlx, text → campus with the OpenAI fallback suppressed, embeddings → campus. Zero OpenAI, nothing off-device.
3. **Ingestion completion is invisible.** "Ingest & continue" fires the background queue and *immediately* advances to the interview (`onIngested()` → `landingStep='interview'`), so the user proceeds while extraction/indexing is still running, with no signal that it isn't done.

All three are being built together as one increment.

## 2. Goals / non-goals

**Goals**
- Estimate recomputes on tier move **and** on mode toggle, using mode-calibrated constants.
- An opt-in **"use local/free models"** checkbox beside the Ingest button that switches the run into **local-only mode** (vision → omlx, text → campus with OpenAI fallback off, embeddings → campus) and re-estimates. Unchecked keeps today's **hybrid** behavior (vision → OpenAI, text → campus-first-with-OpenAI-fallback, embeddings → campus).
- A **hard completion gate**: the user cannot advance to the interview until every material reaches a terminal indexing state.

**Non-goals**
- Changing the default behavior (stays hybrid; local-only is opt-in per run).
- Embeddings provider choice (always campus Qwen, unchanged).
- A general per-function provider-routing UI (out of scope; this is one ingest-run toggle with two modes).
- Per-task provider selection within a mode. The two modes are fixed bundles, not a matrix — there is no "OpenAI vision + local text" combination.
- Further tuning of local text quality beyond the 2026-06-23 validation (campus `gptoss-120b` confirmed comparable to OpenAI for both text steps).

## 3. Design

### 3.A — Mode-aware estimates (`lib/capture/ingest-estimate.ts`)

`estimateSeconds` / `estimateTotal` gain a `mode: 'hybrid' | 'local'` parameter (default `'hybrid'` to preserve current numbers). The **only** timing difference between the modes is vision transcription — text (digest/contextualize) runs on campus `gptoss-120b` in *both* modes, and Docling extraction is provider-independent — so just the vision constants switch:

| constant | hybrid | local | notes |
|---|---|---|---|
| `VISION_S_PER_SLIDE` | 1 | 12 | hybrid = OpenAI `gpt-5.4`; local = omlx Qwen-VL bench midpoint (~9–23 s, text-density dependent) |
| `SLIDE_CONCURRENCY` | 4 | 2 | local vision is memory-bound; less intra-material parallelism |
| `DOCLING_S_PER_PAGE` | 3 | 3 | extraction is Docling either way (mode-independent) |
| `DIGEST_S` | 2 | 2 | campus `gptoss-120b` in both modes |
| `CTX_S_PER_CHUNK` | 0.5 | 0.5 | campus `gptoss-120b` in both modes |

These are coarse decision-support numbers (the UI already shows a ±range and "rough estimate"), recalibratable from `[ingest]` stage logs. `TriageStep` passes the live checkbox state into `estimateTotal(rows, mode)` and into each row's `estimateSeconds(row, mode)`; React already recomputes on every render, so both tier moves (which mutate `rows`) and the checkbox toggle trigger a fresh estimate. **Tier-move recalc is verified as already working; this change only makes the numbers mode-correct.**

### 3.B — "Use local/free" checkbox = local-only mode

**UI.** A checkbox in the Triage footer, beside "Ingest & continue":
> ☐ Use local/free models — slower, no API cost, nothing leaves campus

Default **unchecked** (hybrid, the fast current path). Its boolean lives in `TriageStep` state, feeds the estimate (3.A), and is sent in the ingest request body.

**The two modes are fixed bundles, not a per-task matrix:**

| step | hybrid (unchecked, current default) | local-only (checked) |
|---|---|---|
| vision transcription | OpenAI `gpt-5.4` | **omlx** `Qwen3.6-35B-A3B-UD-MLX-4bit` (`enable_thinking:false`) |
| material digest | campus `gptoss-120b`, OpenAI `gpt-5.4-mini` fallback on error | campus `gptoss-120b`, **fallback suppressed** (fail instead) |
| chunk contextualize | campus `gptoss-120b`, OpenAI `gpt-5.4-mini` fallback on error | campus `gptoss-120b`, **fallback suppressed** (fail instead) |
| embeddings | campus (unchanged) | campus (unchanged) |

So the only behavioral deltas of checking the box are: (1) vision goes to omlx instead of OpenAI, and (2) the digest/contextualize OpenAI fallback is turned off so a campus failure surfaces as a failed material rather than silently spending on OpenAI. Text already runs free on campus in both modes; this is why the change is small.

**Local `transcribeDocument` (currently stubbed/throws).** Implement it for the local provider:
1. Render the PDF/slide bytes to PNG page images via the existing `renderToImages(bytes, mimeType, fileName)` in `lib/capture/render-pages.ts` (the `pdftoppm` path), capped at the existing `MAX_SLIDES`.
2. For each page image (bounded concurrency), call the omlx OpenAI-compatible chat endpoint (`LOCAL_BASE_URL`, `LOCAL_API_KEY`) with the configured vision model, `chat_template_kwargs:{enable_thinking:false}`, and the standard transcription prompt; concatenate page texts in reading order.
3. Return `{ text, method:'vision', status, costUsdCents: 0 }`. Reuse the existing `low_text`/`failed` thresholds in `extract-text.ts`.

**Suppressing the text OpenAI fallback.** `chunkLlmComplete` (`lib/ai/analyze/chunk-llm-provider.ts`) gains an option `{ noOpenAIFallback?: boolean }`. When set, a campus error rethrows instead of falling through to OpenAI. The digest (`material-digest.ts`) and contextualize (`chunk-contextualize.ts`) call sites thread this option from the ingest mode. (Vision in local mode never touches OpenAI either, because `transcribeDocument` is dispatched to the local provider directly — see plumbing below.)

**Per-run mode plumbing (restart-safe).** Add a nullable `ingest_provider` (text) column to `course_materials` (new Drizzle migration `0045`) holding the *mode*: `'local'` for a local-only run, `null` for hybrid (the default). Flow:
- `POST /api/admin/v2-backfill` accepts `{ mode?: 'hybrid' | 'local' }` (validated; default `'hybrid'`).
- For each material it enqueues, it stamps `ingest_provider = 'local'` for a local run, leaving it `null` for hybrid (a new field on the queued-status update).
- The worker (`processMaterial`) reads `row.ingestProvider`. When `'local'`: `extractText` uses `buildProvider('local')` for `transcribeDocument` (omlx Qwen-VL), and digest/contextualize pass `noOpenAIFallback:true`. When `null`: today's hybrid path unchanged (`getProvider()` vision = OpenAI, campus-with-fallback text).
- `null` → hybrid, so a worker restart that re-queues stuck rows (boot recovery) defaults to the safe, always-available hybrid path; a `'local'` run stays local across restarts.

This is the restart-safe choice over an in-memory `materialId→mode` map (which would revert on restart).

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
  └─ estimateTotal(rows, useLocal ? 'local' : 'hybrid')         [3.A]
  └─ POST /api/admin/v2-backfill { courseCode, slug, mode }     [3.B]   mode = useLocal ? 'local' : 'hybrid'
       └─ for each material w/ ingestAction()=='queue':
            updateIndexingStatus(status:'queued', ingestProvider: mode==='local' ? 'local' : null)
            enqueue(id) → worker
  └─ poll fetchCourseMaterials() every 3s → progress bar        [3.C]
       └─ all terminal? enable Continue → onIngested()

worker.processMaterial(row)             // local = (row.ingestProvider === 'local')
  └─ extractText(...) → vision provider = local ? buildProvider('local') : getProvider()   [local impl: render-pages + omlx]
  └─ digest/contextualize → chunkLlmComplete(..., { noOpenAIFallback: local })   [campus gptoss-120b; fallback off when local]
  └─ embeddings: campus (unchanged)
```

## 5. Schema change

Migration `0045` (Drizzle-generated): `ALTER TABLE course_materials ADD COLUMN ingest_provider text;` — nullable, no backfill. Semantics: **`null` = hybrid (default)**, **`'local'` = local-only run**. Drizzle schema (`lib/db/schema.ts`) `courseMaterials` gains `ingestProvider: text('ingest_provider')`. The queue-status query helpers (`updateIndexingStatus`) gain an optional `ingestProvider` arg; `CourseMaterialRow` gains the field.

## 6. Error handling

- **omlx down / model won't load (507/connection error)** during a local-only run: `transcribeDocument` throws → `extract-text` catches → material marked `failed` (existing path). The hard gate treats `failed` as terminal, so the user isn't trapped; the failed count is shown. (We do **not** auto-fall-back to paid OpenAI — that would defeat the "no cost / nothing off-device" intent silently; the user re-runs with the box unchecked if they want.)
- **Campus endpoint slow/unavailable** for digest/contextualize: in **local-only** mode the suppressed-fallback path rethrows → material `failed` (same terminal behavior). In **hybrid** mode the existing OpenAI fallback still fires, so a campus blip is invisible — unchanged from today.
- **Worker restart mid-run:** boot recovery re-queues stuck `indexing` rows; `ingest_provider` persists, so the mode survives (`null` rows resume hybrid, `'local'` rows resume local-only).
- **Estimate is advisory:** no correctness dependency; mislabeled time never blocks anything.

## 7. Testing

- `ingest-estimate.test.ts`: extend with `mode` param — assert local mode produces a larger total than hybrid for the same middle-tier set (vision is the only delta); tier-move (high→background) lowers the estimate; hybrid default unchanged from current values.
- Local `transcribeDocument`: unit test with a faked omlx client + a stub `renderToImages` → asserts page texts concatenated in order, `enable_thinking:false` sent, cost 0, `low_text`/`failed` thresholds honored.
- `chunkLlmComplete` no-fallback: with a campus client forced to error and `{ noOpenAIFallback:true }`, asserts it rethrows and never calls the OpenAI client; without the flag, asserts it still falls back (current behavior preserved).
- `v2-backfill` route test: `mode:'local'` stamps `ingest_provider='local'` on queued rows; default/absent → `null`; invalid value → 400.
- `TriageStep` component tests: (a) toggling the checkbox changes the displayed estimate; (b) after Ingest, "Continue" is disabled while a row is `queued`/`indexing` and enabled once all terminal; (c) a `failed` row still allows Continue and shows the failed count.
- Full suite + `tsc` green; final review.

## 8. STATE.md updates required on commit

- **Schema:** new migration `0045` + `course_materials.ingest_provider` (`null`=hybrid, `'local'`=local-only).
- **AI functions / providers:** local `transcribeDocument` now implemented (omlx Qwen-VL); `chunkLlmComplete` gains `noOpenAIFallback`; `v2-backfill` accepts `mode`.
- **What's live:** Triage step gains the use-local checkbox (local-only mode) + completion gate.
- **Deferred/debt:** local text steps use campus `gptoss-120b` (validated 2026-06-23, comparable to OpenAI); campus `qwen3.6-*` avoided for text (empty output in thinking-mode). Local vision est. constant (12 s/slide) is a coarse bench midpoint, recalibrate from real `[ingest]` logs.

## 9. Deferred / follow-ups

- Validating/​retuning local text-step quality and the estimate constants against real `[ingest]` logs.
- Per-course remembered provider preference (this design is per-run only).
- Wiring the same toggle into the per-material `MaterialsPanel` "Index now" path (this design covers only the bulk Triage "Ingest & continue").
