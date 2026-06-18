# Tiered Ingestion — Increment 3b: Middle-Tier Slide-Vision Path

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Implement the **middle-tier depth for slide decks**: render each slide to an image, run a per-slide vision pass on omlx gemma-4-E4B, embed each slide's note as its own retrieval unit, and cite at the **document level** (slide index never surfaced). Wires into `finalizeExtraction`'s middle branch for slide-type materials. Non-slide middle materials fall through to the existing full pipeline until Increment 3c (prose-section). Part of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md); builds on 3a (tier routing).

**Architecture:** `pdftoppm` (poppler, already installed at `/opt/homebrew/bin/pdftoppm`) renders PDF→PNG; PPTX/legacy decks go `soffice --headless --convert-to pdf` (LibreOffice, already installed) → PDF → `pdftoppm`. Each PNG → a data-URI → omlx gemma-4-E4B vision call (`LOCAL_BASE_URL`/`LOCAL_API_KEY`, OpenAI-compatible `image_url`) → a structured note. Low-content slides are skipped. Each kept note embeds as one `ChunkVectorRecord` with `sectionTitle = <document name>` (NOT "slide N"). A deck rollup note is added. All inside the `tier === 'middle'` branch in `finalizeExtraction`, behind `COURSECAPTURE_TRIAGE`. **No new system deps.**

**Tech Stack:** Node `child_process` (pdftoppm/soffice shell-out), `tmp`/`fs` temp dirs, the omlx vision endpoint, existing `embedBatch` + `vectorStore`, Vitest.

---

## File Structure
- Create: `lib/capture/render-pages.ts` — `renderToImages(bytes, mimeType, fileName): Promise<Buffer[]>` (PDF→PNG via pdftoppm; PPTX/legacy→PDF→PNG; returns `[]` on failure, never throws).
- Create: `lib/capture/slide-vision.ts` — `describeSlide(png: Buffer): Promise<SlideNote>` (omlx gemma-4-E4B vision; bias-safe defaults).
- Modify: `lib/capture/finalize-extraction.ts` — `tier === 'middle'` + slide-like → the slide-vision path.
- Tests: `tests/lib/capture/render-pages.test.ts`, `tests/lib/capture/slide-vision.test.ts`, extend `finalize-extraction-tier.test.ts`.

---

### Task 1: Page-render utility (pdftoppm / soffice)

**Files:** Create `lib/capture/render-pages.ts`; Test: `tests/lib/capture/render-pages.test.ts`.

- Detect: `application/pdf` → render directly; PPTX/PPT/Keynote/legacy-office → `soffice --headless --convert-to pdf --outdir <tmp> <in>` first, then render the PDF. Others → return `[]`.
- Render: write bytes to a temp dir, `pdftoppm -png -r 150 <pdf> <tmp>/page`, read `page-*.png` in numeric order into Buffers, clean up the temp dir (always, even on error).
- A per-deck slide cap (e.g. `MAX_SLIDES = 60`) — render at most that many, log if truncated (no silent cap).
- Never throw — on any failure return `[]` (caller falls back).

- [ ] **Step 1:** Write the failing test. Pure-shell rendering is hard to unit-test hermetically; test the **orchestration**: (a) an unsupported mime → `[]` with no shell-out (mock `child_process`); (b) the pdftoppm/soffice commands are invoked with the expected args for pdf vs pptx (assert on the mocked spawn/exec calls); (c) temp dir is cleaned up. Use a real tiny generated PDF for one end-to-end render IF cheap (the test machine has pdftoppm) — otherwise keep it mock-based and add a `// smoke-tested manually` note.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): page-render util (pdftoppm/soffice → PNG buffers)`

---

### Task 2: Per-slide vision note (omlx gemma-4-E4B)

**Files:** Create `lib/capture/slide-vision.ts`; Test: `tests/lib/capture/slide-vision.test.ts`.

`SlideNote = { topic: string; teaches: string; keyVisual: string; contentLevel: 'substantive' | 'low' }`.

`describeSlide(png)` → base64 data-URI → POST `${LOCAL_BASE_URL}/chat/completions` with model `gemma-4-E4B-it-MLX-8bit` (override via `SLIDE_VISION_MODEL`), `Authorization: Bearer ${LOCAL_API_KEY}`, a `user` message with a `text` part (the instruction + strict-JSON ask) and an `image_url` part (`{url: "data:image/png;base64,…"}`), `response_format: {type:'json_object'}`. Parse + validate to `SlideNote`; on any error or unparseable output return `{ topic:'', teaches:'', keyVisual:'', contentLevel:'low' }` (so a bad slide is skipped, never crashes the deck).

- [ ] **Step 1:** Failing test — mock `fetch`: a well-formed JSON response → parsed `SlideNote`; a non-JSON / error response → the safe `contentLevel:'low'` default; assert the request carries an `image_url` data-URI part and the bearer key.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): per-slide vision note via omlx gemma-4-E4B`

---

### Task 3: Slide-vision middle path in finalizeExtraction

**Files:** Modify `lib/capture/finalize-extraction.ts`; extend `tests/lib/capture/finalize-extraction-tier.test.ts`.

In the worker, the slide path needs the original **bytes** (to render), which `finalizeExtraction` doesn't currently receive (it works from `extractedText`). So: pass the file **bytes + mimeType** through. In `processMaterial` (`ingest-queue.ts`), it already reads `bytes` for extraction — thread them (and `mimeType`) into `finalizeExtraction` (add optional `fileBytes?: Buffer; mimeType?: string`).

Add to `finalizeExtraction`, inside/just before the existing logic, a branch: when `input.tier === 'middle'` AND the material is **slide-like** (mime is PPTX/Keynote, or `renderToImages` yields ≥1 page for a PDF):
1. `const images = await renderToImages(fileBytes, mimeType, fileName)`. If `images.length === 0` → **fall through** to the existing full pipeline (not slide-renderable; 3c will handle prose).
2. `const notes = await Promise.all(images.map(describeSlide))` (bounded concurrency if needed).
3. Keep only `contentLevel === 'substantive'` notes. If none → fall through to full pipeline.
4. Build one `ChunkVectorRecord` per kept note: `text = "{topic}\n{teaches}\n{keyVisual}"`, `sectionTitle = fileName` (**doc-level — no slide index in any surfaced field**; the slide ordinal may live in the record `id` only, e.g. `${id}-slide-${i}`, which is internal). `embedBatch` the note texts; upsert one section (`title: fileName`) + the per-slide chunks.
5. Deck rollup: also write the digest (already generated) as the section text / or stitch a short rollup — reuse `digestText` as the doc-level summary section.
6. Mark `ready`. Wrap in try/catch → on failure fall through to full pipeline (never leave stuck).

- [ ] **Step 1:** Failing test — a `tier:'middle'` PPTX-ish material (mock `renderToImages` → 3 buffers, `describeSlide` → 2 substantive + 1 low) → exactly **2** chunks upserted, each `sectionTitle === fileName` (assert **no** chunk field contains "slide N"), status `ready`. A middle material where `renderToImages` → `[]` → falls through to the full chunk path (contextualize called).
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): middle-tier slide-vision ingest (per-slide notes, doc-level citation)`

---

### Task 4: Live smoke + suite + STATE.md

- [ ] **Step 1: Live smoke (controller/manual):** render a small real deck → vision → confirm notes come back from omlx (the gemma-4-E4B path we verified earlier). Document the result; don't gate CI on omlx availability.
- [ ] **Step 2:** `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run tests/lib/capture tests/api` green.
- [ ] **Step 3:** STATE.md: 3b done — middle slide decks now ingest via render→vision→per-slide-embed (doc-level citation); new env `SLIDE_VISION_MODEL` (default gemma-4-E4B); uses pre-installed pdftoppm + soffice; non-slide middle still full pipeline until 3c.
- [ ] **Step 4: Commit.**

---

## Self-Review notes (controller)
- **Spec coverage:** middle-tier *slide* depth (the vision path). Prose-section middle = 3c. High/background unchanged (3a). Estimates = 4.
- **Doc-level citation (load-bearing):** assert in tests that no surfaced field carries a slide number — the whole point of the earlier "no citing slide 4" decision.
- **Graceful fallback:** any render/vision failure → fall through to the full pipeline; a single bad slide → skipped (low-content default). The renderer is never a single point of failure.
- **Bytes threading:** `finalizeExtraction` gains `fileBytes`/`mimeType`; `processMaterial` already has the bytes in hand.
- **No new system deps:** pdftoppm + soffice already installed; vision reuses omlx.
- **Concurrency/cost:** per-slide vision is ~1s on E4B, $0 (local). Cap decks (MAX_SLIDES); log truncation (no silent cap).
