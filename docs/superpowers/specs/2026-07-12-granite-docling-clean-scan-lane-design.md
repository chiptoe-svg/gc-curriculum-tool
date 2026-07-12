# Granite Docling clean-scan lane — Design

**Date:** 2026-07-12
**Status:** Design approved (brainstorm) — implementation plan not yet written.

## What this is

A new extraction lane for **image-based PDFs** during material ingest: try **Granite-Docling-258M** (local, via the docling-serve VLM pipeline) first, and fall back to the current OpenAI OCR path (`transcribeDocument`) when Granite's output looks degenerate (the small-model repetition trap). Gated by a flag, default off. Born-digital PDFs and non-PDF formats are untouched.

## Why

The July 2026 vision/OCR evaluation (`~/.local/share/gc-curriculum-tool/vision-bench/EVAL-2026-07-vision-ocr-granite.md`) established: Granite-Docling produces **fast, free, on-box (FERPA-safe), structure-preserving** markdown on **clean printed documents** (validated on real GC syllabi/rubrics/proposals — headings, tables, numbered sections, bullets all preserved), but hits the repetition trap on **handwritten/messy scans**. Today, every image-based PDF goes to OpenAI (`gpt-5.4`) for flat OCR — expensive, external, and non-structured. This lane captures Granite's win on the clean-scan majority while reserving OpenAI for the genuinely hard scans.

**Piece-#1 verified:** the running `docling-serve` (`:5001`) hosts Granite natively — `POST /v1/convert/file` with `pipeline=vlm` + `vlm_pipeline_model=granite_docling` returned correct structured markdown (HTTP 200, 4 s). No new service needed.

## The seam

`lib/courses/extract-text.ts`, the existing image-based branch (~line 100):

```
if (mimeType === 'application/pdf') {
  const isImageBased = charsPerPage < MIN_CHARS_PER_PAGE;
  if (isImageBased) {
    // TODAY: → provider.transcribeDocument() (OpenAI vision) → method: 'vision'
    // NEW:   → try Granite first, fall back to transcribeDocument on junk/empty/error
  }
}
```

Born-digital PDFs (charsPerPage ≥ threshold) and non-PDF formats never enter this branch, so they are structurally unaffected.

## Components

Three small, isolated units.

### 1. `DoclingExtractor.transcribeWithGranite(fileBytes, mimeType, fileName): Promise<{ text; pageCount }>`
`lib/courses/material-extractor.ts`. Mirrors `extractWhole`'s `/v1/convert/file` POST, but the form carries:
- `pipeline=vlm`
- `vlm_pipeline_model=granite_docling`
- `to_formats=md`

Reuses the existing `DoclingResponse` parsing (`doc.md_content ?? doc.text_content`) and the `--- ` page-count heuristic. It does **not** set `do_picture_description` (that's the separate chart-caption path). Same base URL (`DOCLING_URL`/`:5001`).

### 2. `repetitionRatio(markdown: string): number`
New pure helper (`lib/courses/repetition-ratio.ts`), unit-tested. Returns the fraction of non-empty lines that are **degenerate repeats** — a line identical to its immediate predecessor, or a line consisting solely of a junk token (`·`, `.`, a single bullet). Range 0..1. Empirically: clean docs ≈ 0.0, handwritten-scan trap ≈ 0.92. No I/O, no dependencies.

### 3. Routing in `extractText`
When `isImageBased` **and** `GRANITE_DOCLING_ENABLED` is truthy:
1. `try` Granite via `transcribeWithGranite`.
2. **Accept** if `text.length >= MIN_MEANINGFUL_CHARS` **and** `repetitionRatio(text) < GRANITE_REPETITION_THRESHOLD` (0.3) → return `{ method: 'granite', status: 'ok', text, pageCount, visionCostUsdCents: 0 }`.
3. **Decline** (junk / empty / any thrown error) → fall through to the existing `provider.transcribeDocument()` path, unchanged (`method: 'vision'`).

Flag off → the branch behaves exactly as today (straight to `transcribeDocument`).

## Flag

`GRANITE_DOCLING_ENABLED` (env), **default off**. Off = today's behavior byte-for-byte. On = Granite-first for image-based PDFs. `GRANITE_REPETITION_THRESHOLD` is a constant (0.3) in code, not env (tunable in a follow-up if needed).

## Data flow & observability

- The extraction result type gains `method: 'granite'` alongside `'text' | 'vision'` — lets us read adoption + fallback rate from the persisted `extractionMethod`.
- Granite cost is **0** (local); `visionCostUsdCents: 0`.
- Downstream (digest → chunk → index in `finalize-extraction.ts`) is **unchanged**: it consumes the returned `text` markdown exactly as today. Granite's markdown is richer (tables/headings preserved) but the same shape and contract.

## Error handling

Granite can only **decline**, never **fail** an extraction: any docling-serve error, timeout, empty output, or high repetition ratio routes to the OpenAI fallback. A Granite hiccup must never break ingestion — the existing `transcribeDocument` path (and its own `try/catch → status:'failed'`) remains the backstop.

## Testing

- **`repetitionRatio`** — unit tests: clean markdown → ~0; fully repetitive → ~1; empty → 0; mixed (some repeats) → mid; the real fixtures (proposals-like, lab-junk-like) land on the correct side of 0.3.
- **`transcribeWithGranite`** — mock `fetch`; assert the request body carries `pipeline=vlm` + `vlm_pipeline_model=granite_docling`; assert it parses `md_content` and the page count.
- **Routing** (`extractText`, mocking the Granite call + the vision provider): (a) Granite returns clean md → `method: 'granite'`; (b) Granite returns junk (high ratio) → falls back, `method: 'vision'`; (c) Granite throws → falls back; (d) flag off → straight to `transcribeDocument`, Granite never called; (e) born-digital PDF → neither path (unchanged).

## Rollout gate (not code)

The flag stays **off** until a validation pass over a batch of real image-based materials (syllabi/rubrics/scans) confirms Granite's quality and the 0.3 threshold. Then flip `GRANITE_DOCLING_ENABLED=1` in the deploy `.env.local`. Reversible instantly (unset the flag).

## Out of scope (YAGNI)

- **Born-digital PDFs** — stay on standard Docling text extraction (already fast, already renders tables as markdown).
- **The `DOCLING_VLM` picture-description path** — chart/image captioning is a separate concern, untouched.
- **Granite's targeted instructions** (chart→table, formula→LaTeX, section-header retrieval) — a future enhancement, not this lane.
- **Engine tuning** (mlx vs the plist's `DOCLING_DEVICE=cpu`) — a docling-serve config change, separate from this routing work.
