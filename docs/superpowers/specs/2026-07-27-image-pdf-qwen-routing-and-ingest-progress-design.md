# Image-PDF → qwen routing + ingest progress/ETA — Design

**Date:** 2026-07-27
**Status:** Design — pending operator review before the implementation plan.
**Scope:** a **curriculum stopgap**. The polished versions (per-page routing for mixed corpora, per-page real-time progress, the full legibility-contract render policy) belong to **rag-core**, onto which curriculum's ingestion migrates (Phase 1). This spec buys correctness + palatability *now*.

---

## 1. Problem

Two coupled problems, surfaced by issue #4 / GC 3620:

1. **Image-heavy PDFs crash extraction — silently.** GC 3620 is a design course whose materials are 20–42 MB image slide decks. Docling's **standard** pipeline (layout + EasyOCR) renders each page uncapped (`ApiVlmOptions.max_size: null` / `PdfPipelineOptions.images_scale`) to ~3840×2160 and feeds that to the fragile models. On the Spark's **GB10 (sm_121)** immature kernels, an op runs on the full-size raster *before* the models' internal resize and returns a hard `CUDA error: unknown error` (a mature GPU would degrade gracefully). Result: **14 of 18 GC 3620 materials `extraction_status=failed`**, the course's substance never entered the system, and the profile was synthesized from one material — with **no warning** (partly addressed by the extraction-health guard shipped `24d4087`; this spec fixes the extraction itself).
2. **The correct path (qwen) is slow, and the wait is opaque.** Routing image decks to qwen3.6-35B (~2–4 s/page) is the right call — granite-docling hallucinates on design content — but a multi-minute background ingest with no ETA or progress reads as "hung."

## 2. Goals / Non-Goals

**Goals**
- **Route image-heavy PDFs to the qwen per-page vision path** (render each page at a capped resolution → qwen), **skipping the crash-prone standard Docling** entirely for them. Any PDF that isn't clearly text ("confusion") → qwen.
- **Upfront ETA + a material-level progress bar** for ingest, so the wait is legible and self-correcting.

**Non-Goals (→ rag-core)**
- **Per-page routing** for mixed docs (cheap-text page + qwen image page in one doc). For a design corpus this saves ~nothing (every page is image), so it's not worth the complexity here.
- **Per-page real-time progress** (SSE / per-page job status).
- The **full legibility-contract render policy** (min-point-size → derived DPI + VLM budget, per corpus). The 10 pt / `max_size 2200` value is hardcoded here (already shipped `76d08ab`); rag-core parameterizes it.

## 3. Design

### 3.1 Detection (cheap, before the crashing path) — GEOMETRY-FIRST
Upfront `pdfinfo`/`pdftotext` probe for `application/pdf` (poppler, CPU, no GPU). Route to qwen when **`(page geometry is deck-shaped) OR (charsPerPage < MIN_CHARS_PER_PAGE)`**:
- **Geometry first** (the robust signal): `pdfinfo` page dimensions — decks are 16:9 / far larger than letter/A4. This catches the case text-density misses: a **text-bearing 4K slide** (live title/label text → `pdftotext` yields >100 chars) that is *still* a full-bleed image, which crashes render. The crash trigger is render size, not text scarcity, so geometry is the primary detector.
- **Text density second** (`charsPerPage < 100`, existing constant) — catches image PDFs that aren't deck-shaped (scanned letter/A4).

Runs *before* `DoclingExtractor.extract`, so the standard GPU pipeline is never invoked for image decks.

### 3.2 Routing — (b) APP-DIRECT per-page qwen (locked; docling not in the image path)
Image-heavy PDFs go to the **app's own per-page vision path** (`renderToImages` → `canonicalize` → offload to `VISION_OFFLOAD_MODEL` = **qwen3.6-35b-a3b**) — **docling is not involved in the image path at all.** Each page is rendered + resolution-capped and sent to qwen individually, so no whole-deck raster and **the GB10 crash is structurally impossible** for image decks (they never touch docling's standard pipeline). qwen params (validated Spark-side): `temperature 0.2–0.3`, `max_tokens ~700–800`, thinking-off (auto-injected); concurrency **5–7** (shared with prod → backfills off-peak). Architecture decision: **(b) over (a) docling-VLM** — self-contained, no docling-serve/bridge-IP dependency, uses the already-benchmarked path; the docling→qwen `ApiVlmOptions` recipe is retired to a documented fallback, not the prod image path.

**Defense-in-depth so routing isn't load-bearing:** also cap the **standard** pipeline's render (`PdfPipelineOptions.images_scale` in `buildForm`) so that a *misrouted* image deck (geometry+text both fooled) **degrades to weaker OCR instead of a hard CUDA crash**. (The `max_size 2200` cap shipped `76d08ab` covers only the VLM path; the standard pipeline is still uncapped today — this closes it.)

### 3.3 ETA (upfront, self-correcting)
Before ingest, `pdfinfo` gives per-material page counts (cheap). Estimate =
`qwen_pages × 1.25 s/page ÷ concurrency(~6)` (**1.25 s/page = the Spark-measured anchor**) + `digest(~1 light LLM/material)` + `chunk-contextualize(~1 LLM/chunk — the larger slice)` + `embed`. Surfaced as "**~N min**", and it **self-corrects** as real per-material completion times land — important because qwen is the shared prod model, so wall time drifts with prod load. **No hard promise** — always a live estimate.

### 3.4 Progress (material-level poll)
Materials already carry `indexing_status` (`pending → queued → indexing → ready/failed`). The capture client **polls** a status endpoint → "**X of Y materials done**" + a bar + the running ETA + a per-material failed count (ties to the extraction-health guard). No pipeline rework; reuses existing status. A poll-able `GET …/ingest-status` returns `{ total, done, failed, etaSeconds }`.

## 4. Testing
- Unit: the image-heavy **detection** (geometry-first + charsPerPage; confusion→qwen); the **ETA** computation (page counts × 1.25 s/page + overhead → seconds); the status aggregation (`X/Y/failed`); the `images_scale` cap on `buildForm`. All CPU, testable now.
- **qwen is already prod-served** (decision (b) needs no Spark deploy) → the extraction leg is **verifiable end-to-end immediately** against the live offload: re-run a staged GC 3620 deck → real per-slide text, no CUDA. **No external gate.**
- Regression: text-heavy PDFs still take the Docling text path unchanged; a *misrouted* deck degrades (weaker OCR) not crashes (the `images_scale` cap); full capture suite green.

## 5. Risks / Notes
- **Shared Spark GPU contention** during a bulk backfill (qwen is the prod model, 5–7 concurrency) — run backfills **off-peak**; the Spark side offered a load sanity-check.
- **ETA drift** — qwen wall time varies with prod load; the self-correcting estimate absorbs it (no hard promise).
- **Backfill:** re-extract GC 3620 (14) + GC 2400 (5) + GC 1040 (2) failed materials → re-score → the "under-evidenced" banners clear.

## 6. Phasing
1. Detection (geometry-first) + routing to app-direct qwen per-page + `images_scale` cap on the standard pipeline.
2. ETA (`pdfinfo` pre-count + 1.25 s/page model) + material-level progress poll + capture-UI bar.
3. End-to-end verify (staged deck → live qwen) → deploy → off-peak backfill → re-score.
