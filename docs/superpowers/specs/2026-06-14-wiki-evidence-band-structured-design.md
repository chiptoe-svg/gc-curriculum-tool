# Structured Wiki Evidence-Band Floor — Design

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Deferred/debt item "Wiki band floor operates on prose markers, not structured data." `search_wiki`'s `bandFloor` filter currently decides a page's evidence band by **string-scraping** the `·claimed`/`·materials`/`·artifact` tokens out of compiled prose (`detectBands`). That is fragile (format-brittle, recompiled-pages-only). The bands are already **derived deterministically** in `update.ts` (`deriveEvidenceBand` from each competency's `source` + `citations`) — the model only renders the prose marker, it doesn't judge the band. So we can persist the band as **structured frontmatter** and filter on that.

## Decisions made in the brainstorm (2026-06-14)

1. **Shape: a page-level deduped list.** `evidence_bands: [materials_supported, artifact_verified]` — the set of bands the page carries, in ladder order. This is exactly what the floor needs: `search_wiki` returns *pages*, and `pagePassesBandFloor(present, floor)` already takes a band **set**. A per-competency map was rejected (YAGNI — nothing filters competencies *within* a page).
2. **One-shot backfill now.** A pure, no-AI script stamps `evidence_bands` onto every existing page by reading its current prose markers (`detectBands`), so the floor works on **all** pages immediately rather than waiting for each page to be recompiled.
3. **Prose markers stay.** The `·claimed`/`·materials`/`·artifact` markers remain for human readers; the structured field is the machine-readable truth, stamped from the same derived band data. They never disagree because both come from `deriveEvidenceBand`.
4. **Deterministic stamping, not model-emitted.** The structured field is stamped post-generation in `update.ts` (exactly like `input_hash`), never populated by the LLM — the band is derived, not judged.

## Data shape

Page frontmatter gains one optional field on the page types that carry competency content (course + competency pages):

```yaml
evidence_bands: [claimed, materials_supported, artifact_verified]
```

- Values are `EvidenceBand` literals (`claimed` | `materials_supported` | `artifact_verified`), **deduped**, ordered by `BAND_ORDER` (lowest→highest).
- Empty list `evidence_bands: []` means "page carries no graded competency evidence" (distinct from the field being **absent**, which means "not yet stamped / legacy").
- Target pages don't carry a per-competency band today (their `coverageRollup` has none) — out of scope, unchanged.

## Components

### 1. `lib/ai/wiki/evidence-band-markers.ts` (pure — add a frontmatter reader)
Add:
```
readEvidenceBandsFrontmatter(markdown): EvidenceBand[] | null
```
Parses the `evidence_bands: [a, b]` line from the page's YAML frontmatter, lower-cases/trims, keeps only valid `BAND_ORDER` values, dedupes, returns them in ladder order. Returns `null` when the field is **absent** (so the caller can fall back), `[]` when present-but-empty.

Add:
```
resolvePageBands(markdown): EvidenceBand[]
```
Frontmatter-first, prose-fallback: `readEvidenceBandsFrontmatter(md) ?? detectBands(md)`. This is the single function read-time consumers call. `detectBands`, `pagePassesBandFloor`, `BAND_ORDER`, `BAND_MARKER`, `bandRank` are unchanged (still used by `resolvePageBands`'s fallback + the backfill).

### 2. `lib/ai/wiki/update.ts` (stamp the field deterministically)
Add a pure stamper mirroring `stampInputHash`:
```
stampEvidenceBands(content: string, bands: EvidenceBand[]): string
```
Writes `evidence_bands: [<comma-joined>]` into the frontmatter block (replace-if-present, append-into-block if absent, prepend a block if the page has none) — same `FRONTMATTER_RE` mechanics as `stampInputHash`.

At the point each page's `input_hash` is stamped, also compute the page-level band set and stamp it:
- **Course pages:** dedupe `deriveCompetencyBands(...).map(b => b.band)`.
- **Competency pages:** dedupe the per-cell `band` values from `loadCompetencySubstrate` (the `CompetencyContribution.band`, skipping `null`).
- Other page types (targets, concepts): no `evidence_bands` stamp.

The deduped, ladder-ordered set is computed by a small pure helper `dedupeBands(bands: (EvidenceBand|null)[]): EvidenceBand[]` (filters null, dedupes, sorts by `bandRank`).

### 3. `lib/ai/wiki/tools.ts` (`search_wiki` reads structured)
Replace the `const bands = detectBands(content);` call with `const bands = resolvePageBands(content);`. Everything downstream (`pagePassesBandFloor`, the `evidenceBands` annotation in the hit) is unchanged. Net effect: structured when stamped, graceful prose-scrape fallback when not.

### 4. `lib/ai/wiki/lint.ts` (assert the field)
New check `evidence-bands-missing` (severity `warning`): for **course** and **competency** pages, if the page **body** carries any band marker (`·claimed`/`·materials`/`·artifact` — i.e. it's a compiled, band-bearing page) but the frontmatter has **no** `evidence_bands` field (`readEvidenceBandsFrontmatter` returns `null`), emit a warning ("carries band markers but no structured `evidence_bands` frontmatter — run `pnpm wiki:backfill-bands` or recompile"). This catches drift between the prose markers and the structured field. (A page with markers + a present `evidence_bands` list is clean even if the exact sets differ slightly — the lint asserts *presence*, not set-equality, to avoid coupling to marker-rendering quirks.)

### 5. `scripts/wiki-backfill-bands.ts` + `pnpm wiki:backfill-bands` (one-shot, pure)
For every `.md` under the wiki repo's `courses/` and `competencies/`: read the file, `detectBands(content)` from the prose markers, `stampEvidenceBands(content, bands)`, write back only if changed. No AI, no DB. Prints a per-file summary and a total. Idempotent (re-running is a no-op once stamped). The operator runs it once + commits the wiki repo; thereafter `update.ts` stamps the field on every regen.

## Data flow

```
deriveEvidenceBand (source+citations)  ──┬─▶ prose marker  ·claimed/·materials/·artifact  (human)
   [already exists, deterministic]       └─▶ evidence_bands: [...] frontmatter            (machine)
                                                      │
search_wiki(bandFloor) ─▶ resolvePageBands(content) ─┤ frontmatter-first
                                                      └─▶ detectBands (prose) fallback (legacy/unstamped)
                                              ─▶ pagePassesBandFloor(present, floor)
```

## What is explicitly UNCHANGED
- `deriveEvidenceBand` / `EvidenceBand` semantics; the three-band ladder; `pagePassesBandFloor`'s "no bands → page passes (don't hide legacy)" rule.
- The prose markers + how `wiki-update.md` renders them.
- `read_wiki`'s band annotation (it can adopt `resolvePageBands` too, but that's a trivial follow-on, not required).
- Target pages (no per-competency band).

## Out of scope (deferred / non-goals)
- Per-competency band map (YAGNI — page-level set is all the floor consumes).
- Putting the band on target-page `coverageRollup` (lower priority, separate).
- Filtering competencies *within* a page by band, or a DB-side band column on `snapshot_target_coverage` (search_wiki searches page text, not the DB).
- Changing the wiki-update LLM prompt (the field is stamped deterministically; the prompt is untouched).

## Testing
- **Pure unit (`evidence-band-markers.ts`):** `readEvidenceBandsFrontmatter` — valid list, empty list (`[]` → `[]`), absent field (→ `null`), garbage/unknown values filtered, dedupe + ladder order; `resolvePageBands` — frontmatter wins when present, falls back to `detectBands` when absent.
- **Pure unit (`update.ts`):** `stampEvidenceBands` — replace existing, append into block, prepend new block, empty list; `dedupeBands` — null-filter + dedupe + ladder order.
- **Lint:** a page with body markers + no `evidence_bands` → one `evidence-bands-missing` warning; with the field → clean; a non-competency page (concept/target) → no warning.
- **Tool:** `search_wiki` with `bandFloor` filters a page whose **frontmatter** bands are all below the floor; keeps a legacy page (no field, no markers); keeps a page stamped at/above the floor.
- **Backfill (pure, fixture dir):** a page with `·materials` marker + no field → field stamped `[materials_supported]`; an already-stamped page → unchanged (idempotent); a marker-less page → `evidence_bands: []`.
