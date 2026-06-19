# Cross-Course Evidence Spine — Design

**Date:** 2026-06-19
**Status:** Proposed
**Surface:** A shared cross-course retrieval layer over already-ingested material chunks + one new tool on the curriculum-chat agent. Touches: `lib/capture/vector-store.ts` (+`-weaviate.ts`, `-schema`), `lib/ai/wiki/tools.ts` (or a sibling builder) + `lib/ai/wiki/chat.ts`, `lib/ai/wiki/response-schema.ts`, `lib/db/schema.ts` (+ a migration), `lib/db/course-materials-queries.ts`, the snapshot-creation hook that today fires the wiki recompile, and **`docs/architecture.html`** (published-doc update — see §7).
**Relation to prior work:** Builds on the v2 ingestion pipeline (`COURSECAPTURE_V2_INGESTION`, [`2026-06-16-background-ingest-design.md`](./2026-06-16-background-ingest-design.md), [`2026-06-18-tiered-ingestion-triage-design.md`](./2026-06-18-tiered-ingestion-triage-design.md)). It is **Phase 1** of a larger "graph search in RAG" exploration; **Phase 2 (concept cards / concept layer) is explicitly deferred** — see *Out of scope*.

---

## Problem

When a faculty member (or anyone) "converses with the GC wiki" (`/ask` and the Explore "Ask" tab, driven by `streamCurriculumChat`), the agent can reach two layers:

1. **Compiled narrative prose** — `read_wiki` / `list_wiki` / `search_wiki`. A curated LLM synthesis. `search_wiki` is **literal substring matching, explicitly not semantic**.
2. **Structured facts** — `coverage_for_target` / `prereq_chain`: KUD depth scores and prerequisite edges, queried straight from Postgres.

It **cannot** reach the **primary source** — the actual text of syllabi, assignment sheets, rubrics, and slide content. That content already exists and is already embedded: the v2 pipeline chunks each material and upserts vectors into Weaviate. But those vectors live in **per-course tenants** (`tenantForCourse(courseCode)`), reachable only inside a single course's capture context. So free-text cross-course questions — *"where does color management recur across the program, and how do the treatments differ?"* — can only be answered from curated summaries + scores, never from the real materials, and a literal keyword front door fragments on synonyms ("spot color" vs "ICC profiles" vs "color management").

The structural questions (multi-hop, prereq chains, coverage-by-target) are **already** well served by the typed-graph tools over authored structure. The gap is specifically: **semantic retrieval over the primary-source materials, across courses, reachable from chat and citable.**

## Goals

1. **Lift the already-embedded per-course chunks into one cross-course, semantic, citable retrieval surface** the curriculum-chat agent can query — without re-embedding the corpus or creating new content.
2. **No per-query tenant fan-out.** One query spans the whole program (the rare, batch-tolerable rebuild does the expensive work; chat-time stays cheap).
3. **Reflect current reality by default**, with retired/ignored/superseded material excluded — and provenance stamped so recency is visible.
4. **Support drill-down and comparison** — global search, single-course drill-down, and per-course-diversified "compare across courses" in one tool.

## Non-goals / Out of scope (deferred, recorded here and in STATE.md)

- **Concept cards & the concept layer (Phase 2).** Concept extraction, alias resolution, per-concept cross-course "how each course treats this" synthesis, concept-level program diagnostics, and any generation into the wiki's `concepts/` pages. The agent does cross-course synthesis **live** from `search_curriculum`; materializing it is a separate, later decision, judged on real chat quality. The hard/risky piece (concept resolution — the GraphRAG entity-resolution failure mode) lives entirely in Phase 2.
- **Auto-triggering of the retired state.** Phase 1 adds the `retired_at` column, the spine filter, and a minimal manual retire/un-retire control. The *automatic* mechanism — on new snapshot, diff against the prior snapshot; content present-then-absent flags a retire candidate — is deferred. **Dependency note:** that auto-trigger requires knowing which materials backed which snapshot's evidence, and today `snapshot_target_coverage.evidenceExcerpt` is free text with **no `materialId` link**. So the auto-trigger work must first build snapshot→material/evidence linkage — the *same* foundation a fully-automatic "index only latest-snapshot-endorsed material" approach would need. One future investment, not two.
- **Material-version retention / primary-source "what changed" diffing.** The spine is a **current-state projection** — it does not retain superseded material content, so it cannot by itself diff "the old syllabus said X, the new one says Y." Narrative/structured change is already recorded (per-snapshot coverage in Postgres; wiki git history) and is best surfaced later via a dedicated `course_history`/diff tool over that existing versioned data. Retaining versioned primary-source material is its own design.
- **Reranker / query router** on the chat retrieval path. Noted as a possible future improvement; not part of the spine.

## Source-of-truth framing

Postgres is the source of truth. The per-course Weaviate tenants, the wiki, and this spine are all **derived projections**. The spine adds no authoritative data: its currency contract is derived from Postgres (`course_materials`), and its vectors are copies of chunks that already exist. Nothing here becomes a new system of record.

---

## Design

### 1. Storage — a reserved `program` tenant, reusing the existing classes

No new Weaviate class. `MATERIAL_CHUNK_CLASS` / `MATERIAL_SECTION_CLASS` are already multi-tenant (one tenant per course), and **every `ChunkVectorRecord` already carries `courseCode`** as a property. So:

- Reserve a single tenant — `tenantForProgram()` returning a fixed name (e.g. `"program"`, namespaced with `WEAVIATE_TENANT_PREFIX` like `tenantForCourse`) — holding the **union** of all courses' chunks (a second copy; the per-course tenants stay untouched for capture/reset).
- All existing read code (`hybridSearch`, parent-section enrichment, `fetchChunkById`) works against that tenant **unchanged**. The only read-path change: extend `SearchInput` with an optional `courseCode` filter (today it filters only by `materialId`) and apply it in the Weaviate `hybrid` query via `byProperty('courseCode').equal(...)`.

**Trade-off accepted:** chunks are stored twice (per-course + program). Storage is cheap and the rebuild is batch-tolerable; this buys reuse of the entire read path and avoids a parallel class to maintain.

**Provenance stamps.** When writing into the `program` tenant, stamp each record with `snapshotId` (the latest snapshot for the course at build time, or null) and the material's `uploadedAt`. These are new properties on the program-tenant records — they let an answer say "this is from the March 2026 capture" and are the seam a future change-view hangs on. They do **not** retain history (still current-only).

### 2. Currency contract — what the spine indexes

The refresh derives a course's chunk set from **Postgres `course_materials` (source of truth)**, including a material's chunks only when:

```
indexing_status = 'ready'  AND  ignored = false  AND  retired_at IS NULL
```

Deriving from Postgres (rather than blindly copying the per-course tenant) guarantees currency even if the capture tenant is momentarily stale — e.g. a material ignored *after* it was indexed may leave vectors lingering in its per-course tenant; filtering by the authoritative Postgres set keeps those out of the spine. (That lingering-vector behavior in the capture index is pre-existing and out of scope to fix here.)

### 3. The `retired` material state (new)

A material can be **retired** — "the course no longer does this" — distinct from `ignored` ("don't send to AI": FERPA/policy/duplicate/noise) and from deletion. Kept separate because the meanings differ: retirement is a *curriculum-currency* signal, not an AI-context-exclusion signal.

- **Schema:** new nullable `retired_at timestamptz` on `course_materials` (mirrors the `indexed_at` / `digest_generated_at` pattern — gives both "is it retired" and "since when"). Drizzle migration required.
- **Spine filter:** `retired_at IS NULL` is part of the currency contract above. Retired materials drop from the `program` tenant on the next refresh.
- **Manual control (Phase 1):** a minimal retire / un-retire action (a per-material toggle in the materials manager + a query helper `setMaterialRetired(id, retired)` in `course-materials-queries.ts`), so the field is usable immediately. Auto-triggering is deferred (see *Out of scope*).
- **Capture/scoring behavior unchanged in Phase 1** beyond the spine: retired materials are not otherwise removed from per-course capture context here. (Whether retirement should also exclude from capture/scoring is a follow-up; flagged, not decided.)

### 4. Build / refresh — incremental on snapshot, full rebuild on demand

- **Refresh function** (`lib/capture/program-index.ts`, new): given a `courseCode`, delete that course's slice of the `program` tenant (`deleteByCourse` — a new store method filtering `byProperty('courseCode')`, parallel to `deleteByMaterial`) and re-add its current chunks (per the currency contract), copying records + sections from the per-course tenant and adding provenance stamps. Idempotent (delete-then-write).
- **Incremental trigger:** hook the per-course refresh onto the **same snapshot-creation event** that fires the wiki recompile. When course X gets a new snapshot, only X's slice rebuilds — cheap and incremental. (The per-course chunks already exist from ingestion; refresh re-projects, it does not re-embed.)
- **Full rebuild:** an admin action (`/admin/program-index/rebuild` or a script) iterating all courses — this is also the **one-time backfill** for already-ingested courses and the recovery path after a `/admin/v2-reset`.
- **Decoupled from ingestion** (no dual-write through `finalizeExtraction`): the spine is a projection refreshed on a trigger, so write logic stays in one place and the backfill is the same code as the steady-state refresh.

### 5. Read tool — `search_curriculum`

One new tool on the curriculum-chat agent. Registered alongside the existing wiki + graph tools (the chat builder in `lib/ai/wiki/`, and the MCP server surface that exposes the graph tools).

```
search_curriculum(query: string, {
  courseCode?: string,   // drill-down to one course
  perCourse?: boolean,   // comparison mode: top-n per distinct course
  k?: number,            // default cap
})
```

- Embeds the query (`embedBatch`), hybrid-searches the `program` tenant.
- `courseCode` → `SearchInput.courseCode` filter (drill-down).
- `perCourse: true` → fetch a larger candidate set, group hits by `courseCode`, cap top-n per course, so a verbose course can't crowd out the comparison. (This is what makes "how do treatments differ" usable.) Pure, unit-testable grouping logic separated from the store call.
- Returns citable excerpts in the existing `SearchHit` shape (`courseCode`, `fileName`, `sectionTitle`, `text`, `parentSectionText`, `contextBlurb`, chunk id, `score`), plus the provenance stamp.
- **Usage policy** in the tool description: this is the *primary-source / evidence* tool — use it for "show me / compare what courses actually do," distinct from `search_wiki` (curated prose) and `coverage_for_target` (structured scores).

### 6. Citations

Spine hits cite **material chunks** (course + file + section), not wiki pages. There is already a `CitationDrawer` / `ChunkPayload` and a `fetchChunkById` path for chunk citations.

- Add a **material-chunk citation variant** to `CurriculumChatResponseSchema` / `WikiCitation` (today citations are wiki-page-shaped: a `path`). The variant carries `{ courseCode, materialId, fileName, sectionTitle, chunkId }` so the drawer can resolve it via `fetchChunkById` against the `program` (or per-course) tenant.
- The Ask UI (`components/AskTab.tsx`) renders the new citation variant through the existing drawer.

### 7. Documentation — `docs/architecture.html` update

A first-class deliverable, not an afterthought: the spine changes the system's retrieval story, and the published architecture doc must reflect the **full storage-and-retrieval scope from single-course capture up to curriculum scale.** Authored **directly as HTML** (per the doc convention — single source of truth, no `.md` twin; edit the `.html`). The doc already has *Material storage*, *Vector store*, *Phase A — Material Ingestion*, and the *Snapshots → …* curriculum-scale sections; this update **deepens** the first three to full fidelity and **adds** a new cross-course retrieval section.

**(a) Deepen the underlying course-capture storage & retrieval sections** so the per-course path is documented end-to-end:
- **Source of truth:** Postgres `course_materials` — `extractedText`/`digest`, the lifecycle flags (`indexing_status`, `tier`, `ignored`, `auto_set_aside`, **`retired_at`**), and that everything downstream is a derived projection.
- **Ingestion pipeline:** the FERPA content gate → materials policy → digest → tiered routing (high = full chunk·contextualize·embed; middle = slide-vision / prose-section; background = single digest unit), with the **chunking method** spelled out (3-level hierarchical: heading-aligned sections + ~500-token detail chunks with 100-token overlap; deterministic UUID ids; contextual-retrieval blurbs).
- **Per-course retrieval:** Weaviate `MaterialChunk` / `MaterialSection`, one **tenant per course**, `hybridSearch` (BM25 + vector), parent-section ("small-to-big") enrichment, and citation resolution via `fetchChunkById` / the citation drawer.

**(b) Add a new "Curriculum-scale retrieval — the cross-course spine" section** covering:
- The **`program` tenant** (union of all courses' chunks, reusing the existing classes), the **currency contract** (`ready ∧ ¬ignored ∧ retired_at IS NULL`, derived from Postgres), provenance stamps, and the **refresh lifecycle** (incremental on snapshot, full rebuild on demand).
- **`search_curriculum`** and its three modes (global / drill-down / per-course-diversified compare).
- The **three retrieval layers the curriculum-chat agent composes** — *structured* (graph tools over the coverage matrix + prerequisite edges), *synthesis* (wiki prose), and *primary-source* (the spine) — and the source-of-truth framing (Postgres authoritative; the wiki and the spine are derived projections).
- A short forward-looking note that the **concept layer (Phase 2)** would sit atop the spine, marked as not-yet-built.

**(c) Wire-up:** if the new section warrants a nav/index entry, update `docs/index.html`; keep cross-links consistent with the existing doc. No `.md` twin is created.

The doc update lands in the **same change** as the implementation it describes (it is the last task in the plan, after the behavior is real), so the published architecture never describes vapor.

---

## Data flow

```
SNAPSHOT CREATED (course X)
   └─► [existing wiki recompile]   +   refreshProgramIndex(X):
                                          read current chunk set from Postgres
                                            (ready ∧ ¬ignored ∧ retired_at IS NULL)
                                          deleteByCourse('program', X)
                                          copy X's chunks+sections → 'program' tenant
                                            (+ snapshotId / uploadedAt stamps)

FREE CHAT (streamCurriculumChat)
   user: "where does color management recur, and how do treatments differ?"
   agent → search_curriculum(query, {perCourse:true})
            → embed query → hybridSearch('program', {queryVector, queryText, k})
            → group by courseCode, top-n each
            → cited excerpts back to the agent
   agent synthesizes the comparison live, cites material chunks
```

## Error handling

- **Missing `program` tenant** (before first backfill): `hybridSearch` returns `[]` (same graceful path as `deleteByMaterial` on a non-existent tenant); the tool returns an empty result with a note rather than erroring.
- **Course with no indexed materials:** contributes nothing; not an error.
- **Refresh failure for one course:** logged; does not block the snapshot/wiki flow (fire-and-log, like the existing post-snapshot work). The full rebuild can recover.
- **Stale program slice** (a refresh missed): bounded by the next snapshot refresh or a full rebuild; provenance stamps make staleness visible.

## Testing & eval

- **Unit:** refresh idempotency (delete-then-write leaves no duplicates); currency filter (retired / ignored / non-ready excluded; deriving from Postgres beats a stale tenant); `perCourse` diversification (pure grouping function); `courseCode` filter; `search_curriculum.execute` against a mock `VectorStore`; `setMaterialRetired` query.
- **Eval:** a small **cross-course recall eval set** — questions whose good answer requires evidence from ≥2 courses, with the expected courses/materials labeled — run to measure the spine's retrieval recall separately from the chat reply (per the "measure retrieval, not just generation" discipline). Establishes a baseline the later cards decision can be judged against.

## STATE.md updates (same commit as implementation)

- **What's live / routes / schema:** new `course_materials.retired_at` column + migration; new `search_curriculum` agent tool; `program` Weaviate tenant; admin rebuild surface. **Docs:** `docs/architecture.html` updated to document the full per-course → curriculum-scale storage/retrieval stack incl. the spine (§7).
- **Deferred / debt:** (1) Phase 2 concept cards / concept layer; (2) auto-retire triggering + the snapshot→material/evidence linkage it depends on; (3) material-version retention / primary-source "what changed" diffing; (4) whether `retired` should also exclude from capture/scoring; (5) reranker/router on chat retrieval.
