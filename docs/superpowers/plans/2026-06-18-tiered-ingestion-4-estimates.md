# Tiered Ingestion — Increment 4: Time Estimates on the Ingest Screen

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Show a **per-material time estimate** on each ingest-screen row and a **concurrency-adjusted total** next to the Ingest button — decision support so faculty can judge what to include and plan their session. Presented as **coarse rounded buckets/ranges, never a stopwatch**. Completes the tiered-ingestion feature. Part of the [spec](../specs/2026-06-18-tiered-ingestion-triage-design.md).

**Architecture:** A pure estimate module (`lib/capture/ingest-estimate.ts`) maps each material's `tier` + a cheap size signal (pageCount / extracted-text length / bytes — whatever `CaptureMaterial` carries) to rough seconds, calibrated from the `[ingest]` stage timings + the measured ~1 s/slide vision. The total = Σ(per-material) ÷ the worker's `MAX_CONCURRENCY` (2), shown as a range. `TriageStep` renders a per-row chip + the total. **Time only** ($0 — local/campus). No backend, no new infra.

**Tech Stack:** Vitest; React (TriageStep).

---

## File Structure
- Create: `lib/capture/ingest-estimate.ts` — `estimateSeconds(m)`, `formatDuration(s)`, `estimateTotal(materials)`.
- Modify: `app/capture/[code]/TriageStep.tsx` — per-row chip + total by the Ingest button.
- Tests: `tests/lib/capture/ingest-estimate.test.ts`; extend `tests/app/.../TriageStep.test.tsx`.

---

### Task 1: Estimate module (pure)

**Files:** Create `lib/capture/ingest-estimate.ts`; Test: `tests/lib/capture/ingest-estimate.test.ts`.

Input shape (subset of `CaptureMaterial`): `{ tier: 'high'|'middle'|'background'|null; pageCount?: number|null; extractedText?: string|null; sizeBytes?: number|null; ignored?: boolean }`.

**Rough cost model (constants at the top, commented as tunable / calibrated from `[ingest]` logs + ~1 s/slide vision; the numbers matter less than the shape):**
```typescript
const DIGEST_S = 2;            // one generateMaterialDigest call
const DOCLING_S_PER_PAGE = 3;  // file extraction (Docling), only for file-backed
const CTX_S_PER_CHUNK = 0.5;   // chunk-contextualize
const VISION_S_PER_SLIDE = 1;  // gemma-4-E4B per slide
const SLIDE_CONCURRENCY = 4;   // within-deck vision concurrency (3b)
const SECTION_SUMMARY_S = 1;   // generateMaterialDigest per prose section
```
- A `units(m)` helper: `pageCount ?? (extractedText ? ceil(len/2000) : (sizeBytes ? ceil(bytes/50000) : 8))` (rough page/section/slide proxy; 8 = a sane default when nothing's known).
- `estimateSeconds(m)`:
  - `ignored` → 0 (not ingested).
  - `background` → `DIGEST_S`.
  - `middle` → `DIGEST_S + 3 (render) + ceil(units/SLIDE_CONCURRENCY) * VISION_S_PER_SLIDE` (slides) — prose is similar magnitude (sections * SECTION_SUMMARY_S); one formula is fine at this coarseness.
  - `high` / `null` → `DIGEST_S + units*DOCLING_S_PER_PAGE_if_file + (chunks = units*3) * CTX_S_PER_CHUNK`. (Treat `null` as high — matches the worker.)
- `formatDuration(s)` → rounded bucket string: `<10s`→`"~5s"`; `<60s`→`"~Ns"` rounded to 5s; `<3600`→`"~N min"` rounded to a sensible step; ≥1h→`"~N hr"`.
- `estimateTotal(materials)` → `{ seconds: number; label: string }` where `seconds = ceil(Σ estimateSeconds(non-ignored) / CONCURRENCY)` (CONCURRENCY=2, matching the ingest queue's `MAX_CONCURRENCY`), and `label` is a **range** around it (e.g. `~${formatDuration(seconds*0.7)}–${formatDuration(seconds*1.4)}`), never a single precise number.

- [ ] **Step 1: Failing test.** Assert: monotonic in size (more pages → ≥ seconds, same tier); for the same size, `background < middle <= high` per-material seconds; `ignored` → 0; `formatDuration` buckets (e.g. 3→"~5s", 45→"~45s", 130→"~2 min"); `estimateTotal` divides by 2 and returns a range label; total excludes ignored.
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): ingest time-estimate model (per-material + concurrency-adjusted total)`

---

### Task 2: Wire estimates into TriageStep

**Files:** Modify `app/capture/[code]/TriageStep.tsx`; extend its test.

- Per row: render a small muted estimate chip (e.g. `formatDuration(estimateSeconds(row))`) next to the size descriptor. Ignored rows show no estimate (or a struck-through dash).
- Near the **Ingest & continue** button: render `Estimated: {estimateTotal(keptRows).label} (2 at a time)` computed from the **non-ignored** rows in their **current tiers** (so it updates live as faculty move/ignore — the component already keeps local row state). Add a one-line caveat: "rough estimate."
- The total recomputes whenever rows change tier or ignore state (derive it from the live row state each render — no extra state needed).

- [ ] **Step 1:** Extend the TriageStep test: with a known set of materials, the total label renders near the Ingest button; moving a row to `high` (heavier) increases the estimate vs `background`; ignoring a row reduces it. (Assert on the rendered text / that the number changes, not exact seconds.)
- [ ] **Step 2–4:** FAIL → implement → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(triage): show per-row + total ingest estimates on the triage screen`

---

### Task 3: Suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run tests/lib/capture app/capture tests/api` green.
- [ ] **Step 2:** STATE.md: Increment 4 done — per-row + concurrency-adjusted total estimates on the ingest screen (coarse ranges, time-only). **Tiered-ingestion feature COMPLETE** behind `COURSECAPTURE_TRIAGE`; ready to flip the flag (note: flipping is an operator decision; the deploy is prod-mode so it needs a build+restart, and the two deferred to-dos — Add-slides wiring, EXT_TO_MIME dedup — remain).
- [ ] **Step 3: Commit** — `docs(state): tiered-ingestion 4 (estimates) done — feature complete`

---

## Self-Review notes (controller)
- **Spec coverage:** the time-estimate decision-support. Coarse by design (the spec's "ranges not stopwatch").
- **Honesty:** estimates are rough — present as ranges with a "rough estimate" caveat; constants are calibrated-but-approximate and documented as tunable. Size signals are limited (pageCount/text-len/bytes; no persisted slideCount), so middle/deck estimates are especially approximate — acceptable for decision support.
- **Live recompute:** total derives from current non-ignored rows each render, so upgrade/downgrade/ignore update it immediately (the whole point — visible cost before committing).
- **No backend/infra:** pure util + render. Completes the feature; flipping `COURSECAPTURE_TRIAGE` is a separate operator step (prod build+restart).
