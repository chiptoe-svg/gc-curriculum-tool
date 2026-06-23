# Ingestion: provider choice, accurate estimates, and completion gating — Design (Spec B)

**Date:** 2026-06-23
**Status:** Proposed (brainstorming-approved 2026-06-23; reconciled 2026-06-23 to the two-vision-path reality)
**Surface:** CourseCapture triage/ingest step (`app/capture/[code]/TriageStep.tsx`), the in-process ingest worker (`lib/capture/ingest-queue.ts`), the estimate model (`lib/capture/ingest-estimate.ts`), the AI provider layer (`lib/ai/*`, `lib/courses/extract-text.ts`), and `POST /api/admin/v2-backfill`.
**Relationship:** Spec B of a two-spec split. **Spec A** (`2026-06-23-slide-note-vision-benchmark-design.md`) benchmarks and picks the local *slide-note* model + schema for `describeSlide`. Spec B uses whatever `describeSlide` is in place now (current default `gemma-4-E4B`) and does **not** wait on Spec A; Spec A's verdict later swaps the slide recipe in, transparently to Spec B. The one local model Spec B *does* fix is for image-PDF **transcription** (`Qwen3.6-35B-A3B`), which is already settled and not a Spec A question.

---

## 1. Motivation

Three operator-reported gaps on the Step-2 "Triage materials → Ingest" screen:

1. **Time estimates don't clearly track choices.** The estimate should recompute when materials move between High/Middle/Background tiers.
2. **No way to keep a whole ingest run off the paid cloud.** Today's ingest is already *mostly* on-prem — there are **two distinct vision paths**, and only one touches OpenAI:
   - **Middle-tier slide decks** → `describeSlide()` (`lib/capture/slide-vision.ts`) → **local omlx** (`SLIDE_VISION_MODEL`, default `gemma-4-E4B`), regardless of `AI_PROVIDER`. **Already on-prem.** (Its model/quality is Spec A's domain.)
   - **High/null-tier image-based PDFs** (scanned docs / all-image PDFs that yield no text) → the `extract-text.ts` vision fallback → `getProvider().transcribeDocument` → **OpenAI `gpt-5.4`**. **This is the one vision step that leaves the box.**

   Text (digest + contextualize) already defaults to Clemson campus `gptoss-120b` (`reasoning_effort:low`) via `chunkLlmComplete`, with an automatic OpenAI `gpt-5.4-mini` fallback on any error; embeddings are always campus Qwen. So the current default is a *hybrid*: free-where-possible, paid-where-needed (image-PDF vision always; text on campus failure). A 2026-06-23 bench (`vision-bench/README.md`) established **omlx `Qwen3.6-35B-A3B` (thinking off) does image transcription cleanly (~9–23 s/slide), comparable to OpenAI**, so a fully on-prem path is viable; a text bench re-confirmed campus `gptoss-120b` matches OpenAI for digest/contextualize, free. We want an opt-in toggle that closes the two remaining OpenAI leaks: image-PDF transcription → omlx, and the text OpenAI fallback → suppressed. Zero OpenAI, nothing off-device.
3. **Ingestion completion is invisible.** "Ingest & continue" fires the background queue and *immediately* advances to the interview (`onIngested()` → `landingStep='interview'`), so the user proceeds while extraction/indexing is still running, with no signal that it isn't done.

All three are built together as one increment.

## 2. Goals / non-goals

**Goals**
- Estimate recomputes on tier move (already works; this spec keeps it correct, not mode-aware — see 3.A for why).
- An opt-in **"use local/free models"** checkbox beside the Ingest button that switches the run into **local-only mode**: image-PDF transcription → omlx `Qwen3.6-35B-A3B` (thinking off); digest/contextualize → campus `gptoss-120b` with the OpenAI fallback **suppressed**; embeddings → campus; slide-deck vision unchanged (already local). Unchecked keeps today's **hybrid** behavior.
- A **hard completion gate**: the user cannot advance to the interview until every material reaches a terminal indexing state.

**Non-goals**
- Changing the default behavior (stays hybrid; local-only is opt-in per run).
- The slide-note (`describeSlide`) model/schema — that's Spec A. Spec B uses whatever is in place; if Spec A swaps the model, both modes get it equally (slide vision is local in both modes).
- Embeddings provider choice (always campus Qwen, unchanged).
- Per-task provider selection within a mode. The two modes are fixed bundles, not a matrix.
- Mode-aware *estimates* (see 3.A — deliberately not built; the predictable cost is mode-independent and the completion gate shows real progress).

## 3. Design

### 3.A — Estimate stays tier-driven, NOT mode-aware (`lib/capture/ingest-estimate.ts`)

The estimate already recomputes on tier move (verified working) because `TriageStep` re-renders `estimateTotal(rows)` on every `rows` mutation. This spec **does not** add a `mode` parameter, for a deliberate reason:

- **Slide-deck vision** (middle tier, the dominant slide path) runs on local omlx in *both* modes → no per-mode delta.
- **Text** (digest/contextualize) runs on campus `gptoss-120b` in *both* modes → no per-mode delta.
- The **only** mode-variable cost is local transcription of *image-based* PDFs (high/null tier). But image-based-ness is **not knowable at triage time** — a pending upload has no extracted text or page count yet, so the estimate can't tell a 30-page text PDF (won't hit vision) from a 30-page scanned PDF (will). A blanket local-mode surcharge would massively over-estimate the common text-PDF case; modeling nothing under-estimates the rare scanned case. Either is false precision.

So instead: the checkbox carries a **static caveat** ("Local mode may run longer for scanned/image PDFs"), and the **completion gate (3.C) shows real per-material progress** — which supersedes estimate precision once the run starts. The existing constants stay as-is. If real `[ingest]` logs later show a calibratable, detectable delta, revisit.

### 3.B — "Use local/free" checkbox = local-only mode

**UI.** A checkbox in the Triage footer, beside "Ingest & continue":
> ☐ Use local/free models — no API cost, nothing leaves campus (may run longer for scanned PDFs)

Default **unchecked** (hybrid). Its boolean lives in `TriageStep` state and is sent in the ingest request body.

**The two modes are fixed bundles:**

| step | hybrid (unchecked, current default) | local-only (checked) |
|---|---|---|
| slide-deck vision (`describeSlide`, middle tier) | local omlx (current `SLIDE_VISION_MODEL`) | **same** — already local |
| image-PDF transcription (`transcribeDocument`, high/null tier) | OpenAI `gpt-5.4` | **omlx** `Qwen3.6-35B-A3B-UD-MLX-4bit` (`enable_thinking:false`) |
| material digest | campus `gptoss-120b`, OpenAI fallback on error | campus `gptoss-120b`, **fallback suppressed** |
| chunk contextualize | campus `gptoss-120b`, OpenAI fallback on error | campus `gptoss-120b`, **fallback suppressed** |
| embeddings | campus (unchanged) | campus (unchanged) |

So checking the box changes exactly two things: (1) image-PDF transcription goes to omlx instead of OpenAI, and (2) the digest/contextualize OpenAI fallback is turned off so a campus failure surfaces as a failed material rather than silent OpenAI spend. Slide vision and text-on-campus are already local in both modes — which is why the change is small and the estimate doesn't move.

**Local `transcribeDocument` (currently stubbed/throws in `lib/ai/local.ts`).** Implement it:
1. Render the PDF bytes to PNG page images via `renderToImages(bytes, mimeType, fileName)` (`lib/capture/render-pages.ts`, `pdftoppm`), capped at `MAX_SLIDES`.
2. For each page (bounded concurrency), POST to the omlx chat endpoint (`LOCAL_BASE_URL`/`LOCAL_API_KEY`) with the vision model, an `image_url` data-URI part, `chat_template_kwargs:{enable_thinking:false}`, and a transcription prompt; concatenate page texts in reading order.
3. Return `{ text, costUsdCents: 0, truncated }` per `TranscribeDocumentResult`.

**Building a local provider while `AI_PROVIDER=openai`.** `buildProvider(modelOverride)` is locked to the global `AI_PROVIDER`, so it can't return a `LocalProvider` in prod. Add an explicit `buildLocalProvider(model?)` to `lib/ai/provider.ts` that constructs a `LocalProvider` regardless of `AI_PROVIDER`, reading `LOCAL_BASE_URL`/`LOCAL_API_KEY` and a new `LOCAL_VISION_MODEL` env (default `Qwen3.6-35B-A3B-UD-MLX-4bit`). `extract-text.ts` gains an optional injected vision provider:
- `extractText(args, { visionProvider }?)` — when present, the image-PDF fallback uses it instead of `getProvider()`.
- The worker passes `buildLocalProvider()` when the row is a local run, nothing otherwise.

**Suppressing the text OpenAI fallback.** `chunkLlmComplete` (`lib/ai/analyze/chunk-llm-provider.ts`) gains an option `{ noOpenAIFallback?: boolean }`: when set, a campus error rethrows instead of falling to OpenAI. `generateMaterialDigest` and `contextualizeChunk` thread it; `finalizeExtraction` passes it from the run's mode.

**Per-run mode plumbing (restart-safe).** Add a nullable `ingest_provider` (text) column to `course_materials` (Drizzle migration `0045`) holding the *mode*: `'local'` for a local-only run, `null` for hybrid (default). Flow:
- `POST /api/admin/v2-backfill` accepts `{ mode?: 'hybrid' | 'local' }` (validated; default `'hybrid'`).
- For each enqueued material it stamps `ingest_provider = 'local'` for a local run, leaving `null` for hybrid.
- `processMaterial` reads `row.ingestProvider`. When `'local'`: pass `buildLocalProvider()` into `extractText` and `noOpenAIFallback:true` into `finalizeExtraction`. When `null`: today's hybrid path unchanged.
- `null` → hybrid, so boot-recovery re-queues default to the always-available hybrid path; a `'local'` run stays local across restarts.

This is the restart-safe choice over an in-memory `materialId→mode` map.

### 3.C — Completion hard-gate (`TriageStep.tsx`)

Replace the immediate `onIngested()` with an in-step ingest lifecycle:
- On "Ingest & continue": POST `v2-backfill` (with `mode`), then enter an **`ingesting`** state on the step (don't call `onIngested`).
- Poll material statuses every 3 s (reuse `fetchCourseMaterials`, the mechanism `MaterialsPanel` uses) until **every non-ignored material is terminal** (`ready` | `failed` | `skipped`).
- Render a progress bar: *"Ingesting 4 of 8…"* with done / failed / skipped counts.
- **"Continue to interview" is disabled until all terminal**, then enabled with a ✓ "Ingestion complete (N ready, M skipped, K failed)" state; clicking calls `onIngested()`.
- The "← Back to materials" button (added 2026-06-22) stays enabled throughout.
- Failures don't block the gate (terminal = ready **or** failed **or** skipped), so one bad material can't trap the user; the failed count is surfaced.

## 4. Data flow

```
TriageStep (checkbox: useLocal)
  └─ estimateTotal(rows)                                        [3.A — no mode param]
  └─ POST /api/admin/v2-backfill { courseCode, slug, mode }     [3.B]   mode = useLocal ? 'local' : 'hybrid'
       └─ for each material w/ ingestAction()=='queue':
            updateIndexingStatus(status:'queued', ingestProvider: mode==='local' ? 'local' : null)
            enqueue(id) → worker
  └─ poll fetchCourseMaterials() every 3s → progress bar        [3.C]
       └─ all terminal? enable Continue → onIngested()

worker.processMaterial(row)             // local = (row.ingestProvider === 'local')
  └─ extractText(args, local ? { visionProvider: buildLocalProvider() } : undefined)   [image-PDF fallback only]
  └─ finalizeExtraction(..., { noOpenAIFallback: local })       [digest/contextualize: campus, fallback off when local]
       └─ describeSlide (middle tier): local omlx — unchanged, both modes
  └─ embeddings: campus (unchanged)
```

## 5. Schema change

Migration `0045` (Drizzle-generated): `ALTER TABLE course_materials ADD COLUMN ingest_provider text;` — nullable, no backfill. Semantics: **`null` = hybrid (default)**, **`'local'` = local-only run**. Drizzle schema (`lib/db/schema.ts`) `courseMaterials` gains `ingestProvider: text('ingest_provider')`. `updateIndexingStatus` gains an optional `ingestProvider` arg; `CourseMaterialRow` (and `mapMaterialRow` in `course-materials-queries.ts`) gains the field.

## 6. Error handling

- **omlx down / model won't load (507)** during a local run: `transcribeDocument` throws → `extract-text` catches → material `failed` (existing path). Gate treats `failed` as terminal; no auto-fallback to paid OpenAI (would defeat the intent silently — user re-runs unchecked).
- **Campus slow/unavailable** for digest/contextualize: in **local** mode the suppressed-fallback rethrows → material `failed`. In **hybrid** mode the OpenAI fallback still fires (unchanged).
- **Worker restart mid-run:** boot recovery re-queues stuck rows; `ingest_provider` persists (`null` resumes hybrid, `'local'` resumes local).
- **Estimate is advisory:** no correctness dependency; the gate shows truth.

## 7. Testing

- `ingest-estimate.test.ts`: confirm tier-move (high→background) lowers the estimate; no mode param (assert current values unchanged).
- Local `transcribeDocument`: unit test with a faked omlx client + stub `renderToImages` → page texts concatenated in order, `enable_thinking:false` sent, cost 0, `truncated` honored at `MAX_SLIDES`.
- `buildLocalProvider`: returns a `LocalProvider` even when `AI_PROVIDER=openai`; uses `LOCAL_VISION_MODEL` default.
- `extractText` injection: with `{ visionProvider }`, an image-based PDF routes to the injected provider, not `getProvider()`.
- `chunkLlmComplete` no-fallback: campus forced to error + `{ noOpenAIFallback:true }` → rethrows, never calls OpenAI; without the flag → still falls back (current behavior preserved).
- `v2-backfill` route: `mode:'local'` stamps `ingest_provider='local'`; default/absent → `null`; invalid → 400.
- `TriageStep` component: (a) after Ingest, "Continue" disabled while a row is `queued`/`indexing`, enabled once all terminal; (b) a `failed` row still allows Continue and shows the failed count; (c) the local checkbox sends `mode:'local'`.
- Full suite + `tsc` green; final review.

## 8. STATE.md updates required on commit

- **Schema:** new migration `0045` + `course_materials.ingest_provider` (`null`=hybrid, `'local'`=local-only).
- **AI functions / providers:** local `transcribeDocument` implemented (omlx Qwen-VL, `LOCAL_VISION_MODEL`); `buildLocalProvider` added; `chunkLlmComplete` gains `noOpenAIFallback`; `v2-backfill` accepts `mode`. **Clarify in STATE that middle-tier slide vision was already local** (a pre-existing fact this work surfaced, not a change).
- **Env vars:** `LOCAL_VISION_MODEL` (default `Qwen3.6-35B-A3B-UD-MLX-4bit`).
- **What's live:** Triage gains the use-local checkbox (local-only mode) + completion gate.
- **Deferred/debt:** estimate is deliberately not mode-aware (image-PDF vision cost undetectable pre-ingest); the slide-note model/schema is Spec A's call (Spec B uses the current `describeSlide`).

## 9. Deferred / follow-ups

- Mode-aware or post-hoc-calibrated estimates if `[ingest]` logs reveal a detectable, modelable delta.
- Per-course remembered mode preference (this design is per-run only).
- Wiring the same toggle into the per-material `MaterialsPanel` "Index now" path (this covers only bulk Triage "Ingest & continue").
- Spec A's chosen slide recipe lands independently and is picked up here with no Spec B change.
