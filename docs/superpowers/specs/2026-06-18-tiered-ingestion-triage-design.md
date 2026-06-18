# Tiered Ingestion with a Triage Step — Design

**Date:** 2026-06-18
**Status:** Proposed
**Surface:** Canvas import + the capture material pipeline — `app/api/courses/[code]/canvas-import/route.ts`, `lib/canvas/*`, `lib/capture/ingest-queue.ts`, `lib/ai/analyze/material-digest.ts`, a new triage page under `app/capture/[code]/`, a new per-slide vision path.
**Supersedes (in part):** [`2026-06-17-capture-step1-guided-sources-design.md`](./2026-06-17-capture-step1-guided-sources-design.md) — that spec assumed Canvas "Import" = ingest. Here, "Import" = *list for triage*, and ingestion moves to a separate downstream step. The source-gathering boxes (Canvas/Syllabus/Other) can remain; the ingest-on-import behavior is replaced.

---

## Problem

Canvas import currently does discovery, extraction, *and* the expensive per-file Docling extraction synchronously, before faculty can ignore anything — so effort is spent on material that gets discarded, and faculty have no chance to prune or to right-size effort per item. (Trace: the import route fetches the course, assembles text, then serially downloads + Docling-extracts up to 20 linked files in the foreground, then enqueues everything for full chunk → contextualize → embed indexing.) Two consequences: imports feel slow (the time concern that prompted this), and every material gets the same maximal treatment regardless of its evidentiary value.

## Goals

1. **Prune before processing.** Discover and *list* everything to be ingested with no extraction, so ignoring is free.
2. **Match ingestion effort to evidentiary value** via three tiers, auto-classified and faculty-adjustable.
3. **Treat lecture slides as the visual instructional artifacts they are** — a per-slide vision pass, not text-only Docling.
4. **Make time visible** so faculty can decide what to include and plan their session.

## The two-phase model

### Phase 1 — Discover & list (cheap, no extraction)
Pull the inventory from the source (Canvas API fetch + assemble; uploads; Drive/IMSCC) and produce a **manifest row per candidate material** — type, name, and a cheap size signal (bytes; PDF page count; PPTX slide count; HTML text length) obtained *without* extraction. The Phase-1 classifier may use **metadata + a light peek only** (filename, mime, size, optional first-page peek) — never full extraction. Faculty can **ignore** any row here. Nothing is downloaded-for-extraction, chunked, summarized, or embedded yet. (This is today's import route minus the file-download/extract loop and minus enqueue.)

### Phase 2 — Triage & tiered ingest
A triage screen presents the manifest in **three tiers** (below), auto-classified, with a per-row **time estimate** and a **total** by the Ingest button. Faculty **move rows up or down between tiers (upgrade and downgrade are equally first-class), or ignore**, then click **Ingest**. The time estimate re-computes live as rows change tier or ignore state, so the cost of an upgrade is visible before committing. Only then does extraction/indexing happen, at each row's confirmed tier depth.

**Tiers are depth levels with a type-aware mechanism.** Because upgrade/downgrade must work for *any* material, a tier names a depth, and the mechanism adapts to the material type — see the table's Depth column, and the per-type note under the Middle tier.

### Ignore vs delete (two distinct actions)
Both are available in Phase 1 and on the triage screen:

- **Ignore — reversible, carries forward.** A flag, not a removal. Every discovered row — including ones ignored in Phase 1 — flows through to the Phase-2 triage screen. Phase-1-ignored rows appear there **pre-checked as ignored** (excluded from the ingest run and the time total by default) but remain **visible and one uncheck away** from inclusion. Nothing leaves the manifest; the time estimate updates when toggled. Use when "probably not, but maybe."
- **Delete — eliminates it.** A hard removal: the row drops from the manifest and does **not** carry to Phase 2. For a newly-discovered row (not yet persisted) it's simply dropped. For a row backed by an existing material (re-import), delete removes the `course_materials` row + its file + indexed chunks (the existing per-row delete). Use when "this should not be here at all." *Caveat:* delete affects this run; a later fresh re-import from the same source can re-discover the item (delete is not a persistent source-level suppression — that's out of scope).

## The three tiers (evidence-strength ladder)

| Tier | Material kinds | Depth | Reuses |
|---|---|---|---|
| **High value** | assignments, quizzes, rubrics, syllabus | full pipeline: extract → chunk → **contextualize** → embed → upsert | existing pipeline |
| **Middle (instructional)** | lecture slides/decks; instructional prose "directly explained to students" | per-**unit** summary, embedded per unit, cited at doc level. Unit = **slide** (vision) for decks, **section** (text summary) for prose — both in v1 (below). | new vision path + section-summary path |
| **Background** | readings, references, supplementary | one whole-material **digest**, embedded as a *single* unit (coarse retrieval), no per-page work | existing `generateMaterialDigest` |

**Type-aware depth (so upgrade/downgrade work for any material).** A tier is a *depth level*; the mechanism adapts to type. Middle = "per-unit summary," and **both unit types ship in v1**: the unit is a **slide** for decks (vision pass) and a **section/heading** for prose (text summary) — same summarize-then-embed-per-unit shape, different unit boundary and summarizer. So a prose reading can be upgraded into middle and get per-section treatment, just as a deck gets per-slide.

### Classifier (Phase-1, cheap)
- **Structure-first, no LLM:** Canvas already types items — assignments/quizzes/rubrics → high; syllabus → high; pages/discussions → middle. These are authoritative.
- **LLM only for the ambiguous *file* bucket:** classify each file on cheap signals (filename, mime, size, optional first-page peek) into deck→middle / reading→background. **Bias toward the cheaper tier when unsure** (under-ingest is one click to fix; over-ingest wastes the budget we're saving).
- **Faculty override everything** on the triage screen (move up/down between tiers, ignore, or delete). Auto-classification exists to make defaults good enough that faculty mostly confirm, not sort from scratch.

## Middle tier in detail (the design focus)

**The unifying shape:** middle = *split the material into its natural units, summarize each unit, embed each summary, cite at the document level.* The unit is type-specific — a **slide** for decks, a **section** for prose — and **both are in v1**. Middle sits between background (one whole-doc digest) and high (extract → chunk → contextualize → embed everything): one summary per natural unit, much lighter than full chunk-contextualization, but with retrieval granularity background lacks.

### Slide path (decks: PDF/PPTX)
A lecture slide is a designed visual artifact — its teaching content is in diagrams, annotated images, and layout, which text-only Docling extraction misses. So:

1. **Render each slide to an image.** PDF → PNG (pymupdf/pdftoppm); PPTX → PDF (LibreOffice, already in the stack for legacy office) → PNG. ~150 DPI for text legibility.
2. **One vision pass per slide** on a local omlx VLM (default `gemma-4-E4B-it-MLX-8bit` — confirmed working, ~1 s/slide, $0 marginal), returning a structured note:
   `{ topic, teaches, key_visual, content_level: "substantive" | "low" }`.
   This single call replaces *both* extraction and chunk-contextualization — the note is already the clean, self-contained unit, and the slide is the natural retrieval unit.
3. **Skip low-content slides.** `content_level: "low"` (title/agenda/divider/thank-you) → kept as a one-line note, **not embedded**. Bounds the big-deck cost; the skip signal is free (same call).

### Prose path (text documents: readings, articles, notes)
For a text document there's nothing visual to render, so the unit is the **section**:

1. **Extract once** via Docling (the high-tier extractor) → structured markdown.
2. **Split into sections** on heading structure (`#`/`##`). If the doc is flat (no headings), fall back to fixed-size windows grouped to a target length (so a heading-less PDF still sections sensibly).
3. **One summary call per section** (text LLM — campus `gpt-oss-120b` with the OpenAI fallback, same as `chunk-contextualize`), returning the same note shape `{ topic, teaches, key_point, content_level }`.
4. **Skip low-content sections** (references, boilerplate appendices) the same way — one-line note, not embedded.

### Common to both (output + retrieval + citation)
- **Per-unit embed** for retrieval quality — marginal cost is just embedding calls (campus Qwen, $0) on top of notes we generate anyway.
- **Two-level output:** per-unit notes (embedded individually) + a short **doc rollup** stitched from the notes ("what this material covers").
- **Cite at the document level.** The unit *index* (slide number / section ordinal) is internal metadata only and is **never surfaced**. The agent/synthesis attributes to "the Lecture 9 deck" / "the Smith 2020 reading"; the citation drawer shows the retrieved note headed by the document name — never "slide 4" or "section 3." (The number is what felt invasive, not the content.) This is a labeling + prompt decision, independent of the embedding granularity.
- **Vision-primary for slides.** Text-dense/code/data-table slides are the one weak spot for VLM OCR; **default vision-only**, with a *noted future refinement* to supplement flagged dense slides with Docling text. Not in v1 unless walkthrough shows it's needed.

## Time estimate (in v1 — decision support)

Per-row estimate = **tier × cheap size signal × measured per-unit cost**:
- Size signals available at triage without extraction: file bytes, PDF page count, PPTX slide count, HTML text length.
- Per-unit costs calibrated from the existing `[ingest]` stage-timing logs (extract/digest/contextualize/embed/upsert) + the measured vision cost (~1 s/slide on E4B).
- Rough math: background ≈ one digest (~1 s); middle-slides ≈ render + (content-slides × ~1 s vision); middle-prose ≈ Docling extract (~s/page) + (sections × ~0.5 s summary); high-value file ≈ Docling (~s/page) + (chunks × ~0.5 s contextualize) + embed. (Prose section count isn't known pre-extraction, so the Phase-1 estimate proxies it from page count.)

**Total ≠ sum.** The worker runs `MAX_CONCURRENCY = 2`, so the total by the Ingest button is **sum ÷ concurrency** (honest wall-clock), not the naive sum.

Presentation discipline:
- Shown as **ranges/buckets** (`~30s`, `~3–5 min`, or light/medium/heavy chips), **not** false-precise seconds — omlx load, Docling CPU, and model-latency variance are real (measured spread 0.8 s–13 s across models; a 15 s mini outlier on record).
- **Time, not dollars.** Local omlx + campus inference is $0 marginal; surface time. Show a token/$ figure *only* when the OpenAI `gpt-5.4-mini` fallback is in the loop (campus down).

## What's reused vs new

- **Reused:** the ingest queue + worker (`processMaterial`), `generateMaterialDigest` (background tier), the full chunk→contextualize→embed pipeline (high tier), ignore/FERPA set-aside, Canvas fetch/assemble, LibreOffice rendering, the omlx vision path (just enabled).
- **New:** (a) Phase-1 list mode (import without extraction/enqueue) + cheap size-probe; (b) the triage page + classifier; (c) a per-material **`tier`/depth** column the worker branches on; (d) the middle-tier **per-unit summary** paths — slide-vision (render → VLM note) and prose-section (extract → section split → text summary) → per-unit embed + doc rollup; (e) the estimate model.

## What this does NOT include
- No change to the interview (Step 2) or synthesis logic beyond the document-level citation labeling.
- No Docling text/vision supplement for text-dense slides in v1 (noted refinement).
- No per-row dollar accounting unless OpenAI fallback is active.
- No change to the source-gathering boxes' layout beyond "Import" producing a list instead of ingesting.
- No persistent source-level suppression — delete affects the current run, not future re-imports.

## Testing
- **Phase-1 list:** import yields a manifest with size signals and *no* extraction/enqueue side effects; ignored rows carry forward pre-checked, deleted rows do not.
- **Classifier:** structural items map to the right tiers deterministically; the file-bucket classifier returns a tier + biases cheap on low confidence (unit-test the decision function on filename/mime fixtures).
- **Middle tier — slides:** render produces N images; vision note schema validates; `content_level: low` slides are skipped from embedding; per-slide notes embed.
- **Middle tier — prose:** sectioning splits on headings (and falls back to windows on a flat doc); one summary per section; low-content sections skipped; per-section notes embed.
- **Citation surface (both):** contains the document name and **never** a unit index (assert the slide number / section ordinal is absent from any user-facing field).
- **Worker tiering:** `processMaterial` honors the `tier` column and routes by material type within middle (slide-vision vs prose-section vs full vs digest).
- **Estimate:** total = Σ(per-row) ÷ concurrency; per-row monotonic in size signal.

## Risks
- **Classification reintroducing cost** — mitigated: Phase-1 classifies on metadata + light peek only, never full extraction.
- **Big-deck vision cost** — mitigated: low-content skip + small fast VLM + (future) slide cap.
- **VLM accuracy on text-dense slides** — accepted for v1; faculty downgrade + the noted Docling-supplement refinement are the outs.
- **Prose sectioning quality** — heading-less documents have no natural unit boundary; the fixed-window fallback handles them, but sections may split awkwardly. Acceptable for v1 (the summaries are still per-region); faculty downgrade-to-background is the out if a doc sections poorly.
- **Estimate precision** — managed by presenting ranges/buckets and never promising a stopwatch number.
- **Extra step / clicks** — the triage screen must have strong defaults and bulk actions so faculty confirm rather than sort.
