# Tiered Ingestion — Increment 3c: Middle-Tier Prose-Section Path

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Implement the **middle-tier depth for prose documents** (text docs that aren't slide decks): split the extracted text into sections, summarize each section, embed each summary as its own retrieval unit, cite at the **document level**. This completes increment 3's middle tier (slides = 3b; prose = here). Builds on 3a (tier routing) and 3b (the middle branch + `handledBySlide` fall-through). Part of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md).

**Architecture:** Reuse, don't reinvent. The existing `chunkMaterial({fileName, text})` already returns `{ sections, details }` where `sections` are heading-based structural sections `{id, title, index, text}`. For a middle prose material (one where the 3b slide path fell through — `renderToImages` produced no pages), summarize each section above a min length via the existing `generateMaterialDigest` (treating the section as a mini-material), keep the summaries, embed each as one `ChunkVectorRecord` with `sectionTitle = fileName` (**doc-level citation** — the section ordinal lives only in the record `id`), plus a doc-rollup section (reuse `digestText`). Bounded concurrency (reuse the `mapWithConcurrency` helper added in 3b). No new AI function, no new infra.

**Tech Stack:** Vitest; reuses `chunkMaterial`, `generateMaterialDigest`, `embedBatch`, `vectorStore`, `mapWithConcurrency`.

---

## File Structure
- Modify: `lib/capture/finalize-extraction.ts` — add the prose-section path in the middle branch's fall-through (when not slide-handled).
- Test: extend `tests/lib/capture/finalize-extraction-tier.test.ts`.

(No new files; no new AI function — section summaries reuse `generateMaterialDigest`.)

---

### Task 1: Middle-prose path in finalizeExtraction

**Files:** Modify `lib/capture/finalize-extraction.ts`; Test: extend `tests/lib/capture/finalize-extraction-tier.test.ts`.

**Where it goes:** in the middle branch, AFTER the 3b slide path determines it did NOT handle the material (`handledBySlide` false — i.e. `renderToImages` returned `[]` / all-low / error) but BEFORE the existing full chunk pipeline. So the order for `tier==='middle'` becomes: try slides → else try prose-section → else fall through to full pipeline.

**Logic (a `handledByProse` flag, mirroring `handledBySlide`):**
1. Only when `input.tier === 'middle'` and not slide-handled and `extractedText` present.
2. `const { sections } = chunkMaterial({ fileName, text: extractedText });`
3. Keep sections with `text.trim().length >= MIN_SECTION_CHARS` (e.g. `200` — skips heading-only/boilerplate sections, the prose analogue of low-content slides). If **fewer than 2** qualifying sections → fall through to the full pipeline (a short/flat doc isn't worth per-section treatment; let the normal chunker handle it).
4. `await updateIndexingStatus({ id, status: 'indexing' });`
5. Summarize each qualifying section with bounded concurrency (cap 4), reusing `mapWithConcurrency`:
   `const summaries = await mapWithConcurrency(qualifying, 4, (s) => generateMaterialDigest({ fileName: `${fileName} — ${s.title}`, extractedText: s.text }));`
   (each returns `{ digest, model }`; use `.digest` as the section summary.)
6. `embedBatch` the summary texts. Build: one rollup `SectionRecord` `{ id: ${id}-doc, materialId: id, title: fileName, index: 0, text: digestText || fileName }`; one `ChunkVectorRecord` per summarized section: `{ id: ${id}-section-${i}, vector, materialId: id, courseCode, fileName, sectionTitle: fileName, sectionIndex: 0, parentSectionId: ${id}-doc, text: summaries[i].digest, contextBlurb: '' }`.
   - **CRITICAL (doc-level citation):** `sectionTitle` MUST be `fileName`, NOT the section title. The section ordinal/title may live ONLY in the internal record `id`. No surfaced field (`sectionTitle`/`text`/`contextBlurb`) carries a section index. (The summary `text` is model output of the section content — acceptable, same trust model as slides.)
7. `deleteByMaterial` → `upsertSections([rollup])` → `upsert(chunkRecords)`; set `handledByProse = true` only after all upserts succeed; status `ready`.
8. Wrap in try/catch; on error fall through to the full pipeline (no stuck row). After the block: `if (handledByProse) return;` else control reaches the existing full chunk pipeline.

- [ ] **Step 1: Failing test.** Mock `chunkMaterial` → `{ sections: [3 sections each with >200-char text], details: [...] }`, `generateMaterialDigest` → distinct summaries, `embedBatch` → vectors, fake `vectorStore`. Case A: `tier:'middle'`, slide path falls through (`renderToImages` → `[]`), prose path → **3** chunks upserted, every `sectionTitle === fileName`, assert NO surfaced field matches `/section\s*\d/i` and none equals a section's own title; status `ready`. Case B: `tier:'middle'` with only 1 qualifying section (others < 200 chars) → falls through to the full chunk pipeline (`contextualizeChunk` called). Case C: `tier:'high'` unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): middle-tier prose-section ingest (per-section summaries, doc-level citation)`

---

### Task 2: Suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run tests/lib/capture tests/api` green.
- [ ] **Step 2:** STATE.md: 3c done — middle prose docs now ingest via per-section summaries (reusing `chunkMaterial` sections + `generateMaterialDigest`, doc-level citation); **Increment 3 complete** (all three tiers honored; middle = slides-via-vision OR prose-via-section). Note Increment 4 (estimates) remains.
- [ ] **Step 3: Commit** — `docs(state): tiered-ingestion 3c (prose-section) done — increment 3 complete`

---

## Self-Review notes (controller)
- **Spec coverage:** middle-tier prose depth — the last slice. With 3a+3b+3c, the worker fully honors all three tiers and both middle unit types (slide / section).
- **Reuse:** no new AI function (section summaries = `generateMaterialDigest` per section), no new infra; reuses `chunkMaterial.sections` + `mapWithConcurrency` (3b).
- **Doc-level citation:** assert no surfaced field carries a section index/title (same discipline as slides).
- **Fall-through:** <2 qualifying sections OR error → full pipeline (short/flat docs handled normally; never a stuck row). Branch order for middle: slides → prose → full.
- **Cost:** one `generateMaterialDigest` per qualifying section, concurrency-capped at 4.
