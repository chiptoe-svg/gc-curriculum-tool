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

### 3.1 Detection (cheap, before the crashing path)
Add an **upfront text-layer probe** for `application/pdf`, using `pdftotext`/`pdfinfo` (poppler, on PATH — CPU, no GPU): compute `charsPerPage` from the *text layer* (born-digital text). `charsPerPage < MIN_CHARS_PER_PAGE` (100, existing constant) ⇒ **image-heavy** ⇒ route to qwen. This runs *before* `DoclingExtractor.extract`, so the standard GPU pipeline is never invoked for image decks (no crash). Text-heavy PDFs keep today's Docling text path.

### 3.2 Routing (image-heavy → qwen per-page, capped)
Image-heavy PDFs go to the **existing per-page vision path** (`renderToImages` → `canonicalize` → offload to `VISION_OFFLOAD_MODEL` = **qwen3.6-35b-a3b**, already wired). Each page is rendered + **capped at `max_size 2200`** (10 pt-derived, `76d08ab`) and sent to qwen individually — so no whole-deck raster, no GB10 blowup. Coordinates with the operator's server-side `docling-serve → qwen` `ApiVlmOptions.max_size` wiring; the app-side per-request cap is belt-and-suspenders.

### 3.3 ETA (upfront, self-correcting)
Before ingest, `pdfinfo` gives per-material page counts (cheap). Estimate =
`qwen_pages × ~3 s ÷ concurrency(~6)` + `digest(~1 light LLM/material)` + `chunk-contextualize(~1 LLM/chunk — the larger slice)` + `embed`. Surfaced as "**~N min**", refined as real per-material completion times land.

### 3.4 Progress (material-level poll)
Materials already carry `indexing_status` (`pending → queued → indexing → ready/failed`). The capture client **polls** a status endpoint → "**X of Y materials done**" + a bar + the running ETA + a per-material failed count (ties to the extraction-health guard). No pipeline rework; reuses existing status. A poll-able `GET …/ingest-status` returns `{ total, done, failed, etaSeconds }`.

## 4. Testing
- Unit: the image-heavy **detection** (charsPerPage threshold, confusion→qwen); the **ETA** computation (page counts × rates → seconds); the status aggregation (`X/Y/failed`). All CPU, testable now.
- The **qwen extraction leg** is verified **end-to-end once the operator's `docling-serve → qwen` wiring is live** (re-run a staged GC 3620 deck → real text, no CUDA). Deploy gated on that.
- Regression: text-heavy PDFs still take the Docling text path unchanged; full capture suite green.

## 5. Risks / Notes
- **Shared Spark GPU contention** during a bulk backfill (qwen is the prod model) — bounded by the ≤8-slot concurrency gate; run backfills off-peak.
- **qwen not yet wired** — the routing + ETA + progress ship testable now; the qwen leg's end-to-end proof + deploy wait on the Spark side.
- **Backfill:** once live, re-extract GC 3620 (14) + GC 2400 (5) + GC 1040 (2) failed materials → re-score → the "under-evidenced" banners clear.

## 6. Phasing
1. Detection + routing (image-heavy → qwen per-page, skip standard Docling).
2. ETA (pdfinfo pre-count + rate model) + material-level progress poll + capture-UI bar.
3. (After qwen live) end-to-end verify + deploy + backfill.
