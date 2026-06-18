# Tiered Ingestion — Increment 3a: Tier-Aware Worker Routing + Background Path

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Make the ingest worker **honor `tier`**: `background` materials get the cheap digest-only path (digest → embed the digest as a single retrieval unit, skip per-chunk work); `high` (and `null`, and — *for now* — `middle`) keep the existing full pipeline. This is the routing skeleton + the cheapest tier. The `middle` depth paths (slide-vision, prose-section) are Increments **3b**/**3c**; until they land, `middle` falls through to the full pipeline (documented), so nothing breaks. Part of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md).

**Architecture:** `processMaterial` passes `row.tier` into `finalizeExtraction`; `finalizeExtraction` branches after the digest step. Background = one section + one chunk record built from the digest text, embedded via `embedBatch`, upserted via the existing `vectorStore` API (same records shape as the full path, just one). No new infra, no schema change (`tier` column exists from 2a).

**Tech Stack:** Vitest; reuses `generateMaterialDigest`, `embedBatch`, `vectorStore.upsert*`, `tenantForCourse`.

---

## File Structure
- Modify: `lib/capture/finalize-extraction.ts` — accept `tier`, branch to a background path.
- Modify: `lib/capture/ingest-queue.ts` (`processMaterial`) — pass `row.tier` to `finalizeExtraction`.
- Consolidate: the `Tier` type — export from `lib/capture/material-tier.ts` and import it in `finalize-extraction.ts` + `TriageStep.tsx` (it's currently duplicated). 
- Test: `tests/lib/capture/finalize-extraction-tier.test.ts` (or extend an existing finalize-extraction test if present).

---

### Task 1: Thread `tier` into finalizeExtraction + processMaterial

**Files:** `lib/capture/finalize-extraction.ts`, `lib/capture/ingest-queue.ts`.

- [ ] **Step 1:** Add `tier?: 'high' | 'middle' | 'background' | null` to `FinalizeExtractionInput`. Import the `Tier` type from `@/lib/capture/material-tier` (and remove the duplicate `type Tier` in `TriageStep.tsx`, importing it from there instead — verify tsc).
- [ ] **Step 2:** In `processMaterial` (`ingest-queue.ts`), pass `tier: row.tier as Tier | null` in the `finalizeExtraction({...})` call.
- [ ] **Step 3:** `pnpm exec tsc --noEmit` clean (no behavior change yet — `tier` is unused so far).
- [ ] **Step 4: Commit** — `git commit -m "feat(triage): thread tier into finalizeExtraction; consolidate Tier type"`

---

### Task 2: Background-tier path (digest → embed single unit)

**Files:** `lib/capture/finalize-extraction.ts`; Test: `tests/lib/capture/finalize-extraction-tier.test.ts`.

After the digest is generated (existing step 3) and the `if (!input.vectorStore) return` guard (step 4), add a branch **before** the existing chunk path: when `input.tier === 'background'`, build a single section + single chunk from the digest and upsert, then mark ready — skipping `chunkMaterial`/`contextualizeChunk`.

- [ ] **Step 1: Write the failing test.** Use the in-memory vector store (the dev/test backend) or a fake `vectorStore` capturing `upsert` calls. Two cases:
  - `tier:'background'` material → exactly **one** chunk record upserted, its `text` is the digest, `contextBlurb` empty; `chunkMaterial` NOT used (assert one upserted chunk, not N). Status → `ready`.
  - `tier:'high'` (or null) material with multi-section text → the existing multi-chunk path runs (≥1 chunk via `chunkMaterial`), unchanged.
  (Mirror an existing finalize-extraction test's setup for the digest mock + vectorStore fake; mock `generateMaterialDigest`, `embedBatch`, and the `vectorStore`.)

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** the background branch:

```typescript
// After digest (digestText set) and the !input.vectorStore early-return:
if (input.tier === 'background') {
  await updateIndexingStatus({ id, status: 'indexing' });
  try {
    const [vector] = await embedBatch([digestText]);
    const tenant = tenantForCourse(courseCode);
    const sectionId = `${id}-digest`;
    await input.vectorStore.deleteByMaterial(tenant, id);
    await input.vectorStore.upsertSections(tenant, [{ id: sectionId, materialId: id, title: fileName, index: 0, text: digestText }]);
    await input.vectorStore.upsert(tenant, [{
      id: `${id}-digest-0`, vector: vector!, materialId: id, courseCode, fileName,
      sectionTitle: fileName, sectionIndex: 0, parentSectionId: sectionId,
      text: digestText, contextBlurb: '',
    }]);
    console.log(`[ingest] ${courseCode} "${fileName}": background tier — 1 digest unit`);
    await updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() });
  } catch (err) {
    console.error(`finalizeExtraction (background): failed for ${id}`, err);
    await updateIndexingStatus({ id, status: 'failed' });
  }
  return;
}
// ...existing chunk+contextualize+embed path continues for high/middle/null...
```

- [ ] **Step 4:** Run → PASS. `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): background-tier ingest (digest embedded as a single unit)"`

---

### Task 3: Typecheck + suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run tests/lib/capture tests/api` green.
- [ ] **Step 2:** STATE.md: Increment 3a done — worker now honors `tier`; background = digest-as-single-unit; `high`/`null`/`middle` still full pipeline (middle's per-unit depth = 3b/3c). Note the `Tier`-type consolidation.
- [ ] **Step 3: Commit** — `git commit -m "docs(state): tiered-ingestion 3a (tier routing + background path)"`

---

## Self-Review notes (controller)
- **Spec coverage:** the tier-routing skeleton + background depth. `middle` deliberately falls through to full pipeline until 3b (slide-vision) / 3c (prose-section). `high` unchanged.
- **Working software:** `high`/`null` behavior byte-for-byte unchanged (the branch only fires for `background`). Flag-on background materials now ingest cheaply. Flag-off: the worker still sets `tier` to null on legacy rows → full pipeline, unchanged.
- **Per-unit API reuse:** the background single-chunk records use the exact `ChunkVectorRecord`/`SectionRecord` shapes the full path uses — 3b/3c's per-unit summaries will reuse the same shapes (sectionTitle = doc name for doc-level citation).
- **Tier-type consolidation:** removes the duplicate `Tier` in `TriageStep.tsx`.
