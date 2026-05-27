# CourseCapture v2 — Stage 2a Implementation Plan (pre-Weaviate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every part of CourseCapture v2 Stage 2 (Ingestion) that does NOT depend on Weaviate being available — schema migration, chunker, FERPA detector, materials policy, chunk contextualizer, generalized digest generator, vector-store abstraction with in-memory backend, and full pipeline wiring into `finalizeExtraction` behind a feature flag.

**Architecture:** Stage 2 of the spec at [`../specs/2026-05-26-coursecapture-agentic-retrieval-design.md`](../specs/2026-05-26-coursecapture-agentic-retrieval-design.md). This plan implements everything from "Phase A — Materials Ingestion" except the live Weaviate client and the Materials-panel UI (those land in Stage 2b once the local Weaviate instance is up). The vector-store abstraction is the seam: it accepts both the existing `InMemoryVectorStore` from `lib/ai/embeddings.ts` (used today by tests and by the dev-time pipeline) and a future `WeaviateVectorStore`. Switching backends is a one-line change at the call site.

**Tech Stack:** Drizzle migrations · TypeScript strict · Vitest · `lib/ai/embeddings.ts` (already shipped) for embeddings · campus `qwen3-embedding-4b` (2560-dim) for vectors · `getProviderForFunction` for the contextualizer + digest light-tier LLM calls. Existing `finalizeExtraction` pipeline gets extended; reference-compression's `summary` columns get renamed to `digest` in the same migration.

**Spec deviation note:** The spec specifies OpenAI `text-embedding-3-small` (1536-dim) for the embedder. Since the spec was written, the Clemson RCD campus endpoint shipped (`feat/campus-provider`, merged 2026-05-26) with `qwen3-embedding-4b` (2560-dim) hosted alongside the LLMs — free, FERPA-safe, OpenAI-compatible. We use it instead. Dimensionality is consistent across the index from day one; no migration cost.

**Out of scope (Stage 2b, separate plan):**
- `WeaviateVectorStore` implementation + tenant bootstrap.
- Materials panel UI (indexing-status dots, set-aside pills, override clicks, FERPA pills, audit-mode toggle).
- `ingestion-checkin` AI function + UI panel.
- Backfill existing materials with chunks/embeddings (waits on Weaviate).

---

## File structure

**Created in this plan:**
- `drizzle/0024_<adjective_noun>.sql` — schema migration (column renames + new columns).
- `lib/capture/chunker.ts` — pure-logic three-level chunker.
- `lib/capture/ferpa-detect.ts` — regex-based FERPA detector.
- `lib/capture/materials-policy.ts` — auto-set-aside rules (per-source-kind).
- `lib/capture/vector-store.ts` — abstract interface + re-export of `InMemoryVectorStore`.
- `lib/ai/analyze/chunk-contextualize.ts` — one light-tier LLM call per chunk → 1–2 sentence blurb.
- `lib/ai/analyze/material-digest.ts` — light-tier digest generator (generalizes `material-summary.ts`).
- `lib/ai/prompts/chunk-contextualize.md` — system prompt for the contextualizer.
- `lib/ai/prompts/material-digest.md` — system prompt for the digest generator (replaces `material-summary.md` once cut over).
- `tests/lib/capture/chunker.test.ts`
- `tests/lib/capture/ferpa-detect.test.ts`
- `tests/lib/capture/materials-policy.test.ts`
- `tests/lib/capture/vector-store.test.ts`
- `tests/ai/analyze/chunk-contextualize.test.ts`
- `tests/ai/analyze/material-digest.test.ts`
- `tests/lib/capture/finalize-extraction-v2.test.ts` — covers the new ingestion path.
- `scripts/_one-off/stage2a-smoke.ts` — end-to-end smoke against a fixture.

**Modified in this plan:**
- `lib/db/schema.ts` — rename `summary*` → `digest*`, add FERPA + policy + indexing columns.
- `lib/db/course-materials-queries.ts` — rename `updateMaterialSummary` → `updateMaterialDigest`, add `updateIndexingStatus`, `updateFerpaRisk`, `updateAutoSetAside`.
- `lib/capture/material-compression.ts` — rename `summary` field to `digest`, `useSummary` to `useDigest`, `summarizeMaterial` call to `generateMaterialDigest`.
- `lib/capture/finalize-extraction.ts` — extend to run the full ingestion pipeline when `COURSECAPTURE_V2_INGESTION=1`.
- `lib/ai/function-settings.ts` — add `chunk-contextualize` and `material-digest` function IDs (deprecate `material-summary` after Stage 2a cut-over).
- App and component files under `app/**` / `components/**` — any place that reads `summary` / `useSummary` / `summaryModel` / `summaryGeneratedAt` from `course_materials`. The Materials backfill route + Materials panel summary toggle UI.
- `.env.example` — document `COURSECAPTURE_V2_INGESTION` feature flag.
- `docs/STATE.md` — flip Stage 2 status from "blocked" to "Stage 2a shipped, Stage 2b pending Weaviate."

---

## Task list

### Task 1: Drizzle migration — rename + new columns

**Files:**
- Create: `drizzle/0024_<adjective_noun>.sql` (drizzle-kit will name it)
- Modify: `lib/db/schema.ts:170-203` (the `courseMaterials` table)
- Modify: `lib/db/course-materials-queries.ts` — rename method `updateMaterialSummary` → `updateMaterialDigest`; add new mutators.

**Spec section:** "Data model changes → Schema diff" (lines 419–451).

- [ ] **Step 1: Update `lib/db/schema.ts` `courseMaterials` table**

Replace the existing `summary`, `summaryModel`, `summaryGeneratedAt`, `useSummary` columns with `digest`, `digestModel`, `digestGeneratedAt`, `useDigest`, plus add the new columns: `ferpaRisk` (text, default `'low'`), `autoSetAside` (boolean, default false), `setAsideReason` (text, nullable), `indexingStatus` (text, default `'pending'`), `indexedAt` (timestamptz, nullable). Use the existing `pgTable` syntax from the surrounding rows.

- [ ] **Step 2: Generate migration**

Run: `pnpm drizzle-kit generate`
Expected: a new `drizzle/0024_<adjective>_<noun>.sql` file. Inspect it — it should contain `ALTER TABLE "course_materials" RENAME COLUMN "summary" TO "digest";` (x4 columns) and five `ADD COLUMN` lines.

- [ ] **Step 3: Apply migration locally**

Run: `pnpm db:push` (or whichever migrate command this project uses; check `package.json` scripts).
Expected: migration succeeds. Verify with `psql $DATABASE_URL -c "\d course_materials"` that `digest`, `digest_model`, `digest_generated_at`, `use_digest`, `ferpa_risk`, `auto_set_aside`, `set_aside_reason`, `indexing_status`, `indexed_at` are present and `summary*` are gone.

- [ ] **Step 4: Update `lib/db/course-materials-queries.ts`**

Find every reference to `summary`, `summaryModel`, `summaryGeneratedAt`, `useSummary` and rename to the `digest*` equivalents. Rename the exported function `updateMaterialSummary` → `updateMaterialDigest`. Add three new exported mutators: `updateIndexingStatus({ id, status, indexedAt? })`, `updateFerpaRisk({ id, risk })`, and `updateAutoSetAside({ id, autoSetAside, setAsideReason, ignored })`. The `ignored` parameter is required because the policy fires both flags together — when faculty overrides, `ignored` flips back but `auto_set_aside` stays true so the UI can render "system would exclude; you opted to include."

- [ ] **Step 5: Run typecheck — fix every call site that referenced the old names**

Run: `pnpm tsc --noEmit 2>&1 | grep -E "(summary\\b|useSummary|summaryModel|summaryGeneratedAt|updateMaterialSummary)" | head -50`
Expected initially: a list of errors. Fix each call site in `lib/`, `app/`, `components/`, `tests/`. Re-run until empty.

Likely call sites (verify and fix):
- `lib/capture/finalize-extraction.ts:53` — `updateMaterialSummary` call
- `lib/capture/material-compression.ts` — `CompressionMaterial` interface fields
- `lib/ai/analyze/material-summary.ts` — internal name fields (this file gets superseded in Task 10, but keep it compiling for now)
- `app/api/courses/[code]/materials/compress/route.ts`
- `app/api/courses/[code]/materials/[id]/use-summary/route.ts` (or wherever the use_summary PATCH endpoint lives)
- Materials panel React components — any badge / toggle reading `summary` field
- Any tests referencing the old column names

- [ ] **Step 6: Run the test suite — ensure nothing regressed**

Run: `pnpm vitest run 2>&1 | tail -20`
Expected: all tests pass. Some tests may need updates to use the digest field names — update them.

- [ ] **Step 7: Commit**

```
git add drizzle/0024_*.sql lib/db/schema.ts lib/db/course-materials-queries.ts lib/capture/material-compression.ts lib/capture/finalize-extraction.ts lib/ai/analyze/material-summary.ts app/ components/ tests/
git commit -m "feat(capture): rename summary→digest and add indexing columns"
```

---

### Task 2: Materials policy module (pure logic)

**Files:**
- Create: `lib/capture/materials-policy.ts`
- Create: `tests/lib/capture/materials-policy.test.ts`

**Spec section:** "Auto-set-aside policy" (lines 174–196).

- [ ] **Step 1: Write the failing tests first**

Create `tests/lib/capture/materials-policy.test.ts`. The test suite must cover:

1. Sets aside `Canvas: Syllabus` when `courseHasLearningObjectives: true`; included otherwise. Reason mentions "Sheets has LOs".
2. Sets aside empty/malformed Google Sheet imports (text matching `,,,` pattern); reason mentions "empty or malformed".
3. Keeps Google Sheets with substantive content (KUD-shaped text).
4. Sets aside `Canvas File: *.xlsx` and `*.xls`; reason mentions "spreadsheet".
5. Marks `Canvas: Discussions` as `ferpaRisk: 'high'` and `included: false`; reason mentions "student posts".
6. Default case: includes everything else with `ferpaRisk: 'low'`.
7. Every decision returns `overridable: true`.

Each test calls `evaluateMaterialsPolicy({ fileName, extractedText, courseHasLearningObjectives })` and asserts on `included`, `reason`, `ferpaRisk`, `overridable`.

- [ ] **Step 2: Run tests — verify all fail**

Run: `pnpm vitest run tests/lib/capture/materials-policy.test.ts`
Expected: FAIL with "Cannot find module '@/lib/capture/materials-policy'".

- [ ] **Step 3: Implement the module**

`lib/capture/materials-policy.ts` exports:

```ts
import { classifySource } from './material-compression';
export interface PolicyInput { fileName: string; extractedText: string | null; courseHasLearningObjectives: boolean; }
export interface PolicyDecision { included: boolean; reason: string; ferpaRisk: 'low' | 'medium' | 'high'; overridable: true; }
export function evaluateMaterialsPolicy(input: PolicyInput): PolicyDecision { /* rule cascade below */ }
export { classifySource };
```

Rule cascade order (first match wins):
1. `fileName === 'Canvas: Syllabus' && courseHasLearningObjectives` → set aside, reason "Sheets has LOs — Canvas syllabus duplicates them", risk low.
2. `fileName === 'Canvas: Discussions'` → set aside, reason "Contains student posts", risk high.
3. `/^Canvas File:.*\.(xlsx?|xlsm)$/i.test(fileName)` → set aside, reason "Spreadsheet — usually data, not audit material", risk low.
4. `looksLikeMalformedCsv(extractedText)` (helper: empty, comma-only, or stripped length < 20) → set aside, reason "Empty or malformed import", risk low.
5. Default → included, risk low.

All return `overridable: true`.

- [ ] **Step 4: Run tests — verify all pass**

Run: `pnpm vitest run tests/lib/capture/materials-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/capture/materials-policy.ts tests/lib/capture/materials-policy.test.ts
git commit -m "feat(capture): add materials auto-set-aside policy module"
```

---

### Task 3: FERPA detector (pure regex)

**Files:**
- Create: `lib/capture/ferpa-detect.ts`
- Create: `tests/lib/capture/ferpa-detect.test.ts`

**Spec section:** "FERPA detector" (lines 198–206). Conservative bias: false positives are fine (one-click override); false negatives are not.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/capture/ferpa-detect.test.ts`. Tests must cover:

1. Benign content → `level: 'low'`.
2. `"Submitted by Jane Doe..."` pattern → `'medium'`.
3. `"Posted by Alex Kim on 2026-03-12..."` pattern → `'medium'`.
4. Clemson CUID `C12345678` → `'high'`.
5. Gradebook table `"Name | Grade | ..."` → `'high'`.
6. Two medium signals stacked → escalates to `'high'`.
7. Empty input / null → `'low'`.

Each test asserts on `detectFerpaRisk(text).level` and (where useful) `matches.length > 0`.

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run tests/lib/capture/ferpa-detect.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement the module**

`lib/capture/ferpa-detect.ts` exports:

```ts
export interface FerpaResult { level: 'low' | 'medium' | 'high'; matches: Array<{ rule: string; sample: string }>; }
export function detectFerpaRisk(text: string | null | undefined): FerpaResult { /* regex cascade */ }
```

Regex set:
- `SUBMITTED_BY`: `/(?:^|\n)\s*Submitted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+/g` → rule `'submitted-by'`, medium signal
- `POSTED_BY`: `/(?:^|\n)\s*Posted by\s+[A-Z][a-z]+(?:\s+[A-Z][a-z\-']+)+\s+on\s+/g` → rule `'posted-by'`, medium signal
- `CUID`: `/\bC\d{8}\b/g` → rule `'cuid'`, high signal
- `GRADEBOOK`: `/(?:^|\n)\s*Name\s*\|\s*Grade\b/i` → rule `'gradebook'`, high signal

Level resolution: any high signal OR ≥2 medium signals → `'high'`; one medium signal → `'medium'`; else `'low'`.

- [ ] **Step 4: Run tests — verify all pass**

Run: `pnpm vitest run tests/lib/capture/ferpa-detect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/capture/ferpa-detect.ts tests/lib/capture/ferpa-detect.test.ts
git commit -m "feat(capture): add FERPA risk detector"
```

---

### Task 4: Hierarchical chunker

**Files:**
- Create: `lib/capture/chunker.ts`
- Create: `tests/lib/capture/chunker.test.ts`

**Spec section:** "Chunker" (lines 105–114). Three levels: digest (~1500 tokens — generated by Task 6), section (~2000 tokens, heading-aligned or paragraph-clustered), detail (~500 tokens with 100-token overlap, nested under each section). This task produces section + detail chunks.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/capture/chunker.test.ts`. Tests must cover:

1. `approxTokenCount` approximates ~4 chars/token; empty string → 0.
2. Empty input → `{ sections: [], details: [] }`.
3. Short heading-less text → single synthetic section with empty title; details all share its `parentSectionId`.
4. Markdown headings `#`, `##`, `###` create distinct sections; section titles match heading text.
5. Long section body splits into multiple detail chunks; each ≤ ~700 token equivalent.
6. Details under the same section share `parentSectionId`; details under different sections do not.
7. Detail chunks carry `sectionTitle` and `sectionIndex`.
8. Output is deterministic across runs given identical input.

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run tests/lib/capture/chunker.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement the chunker**

`lib/capture/chunker.ts` exports:

```ts
export function approxTokenCount(text: string): number { return text ? Math.ceil(text.length / 4) : 0; }
export interface ChunkInput { fileName: string; text: string; }
export interface SectionChunk { id: string; title: string; index: number; text: string; }
export interface DetailChunk { id: string; parentSectionId: string; sectionTitle: string; sectionIndex: number; index: number; text: string; }
export interface ChunkResult { sections: SectionChunk[]; details: DetailChunk[]; }
export function chunkMaterial(input: ChunkInput): ChunkResult { /* ... */ }
```

Constants: `DETAIL_TOKEN_TARGET = 500`, `DETAIL_OVERLAP_TOKENS = 100`, `SECTION_TOKEN_HARD_CAP = 2500`.

Implementation:
- `splitByHeadings(text)`: walk lines; lines matching `/^#{1,6}\s+(.+)$/` open a new section; non-heading lines accumulate into the current section's body. Trim each section's body.
- `splitIntoDetailChunks(body)`: if body fits in `DETAIL_TOKEN_TARGET * 4` chars, return `[body]`. Otherwise split by paragraph (`\n{2,}`), accumulate into buffers up to the target size; on overflow, push the buffer and start the next one with the trailing `DETAIL_OVERLAP_TOKENS * 4` chars of the previous buffer for context preservation.
- Section text gets capped at `SECTION_TOKEN_HARD_CAP * 4` chars (extremely long sections still produce one section row with a capped body).
- IDs are stable SHA-256-derived hex (first 16 chars) over `fileName | kind | position | sample`. Deterministic.

- [ ] **Step 4: Run tests — verify all pass**

Run: `pnpm vitest run tests/lib/capture/chunker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/capture/chunker.ts tests/lib/capture/chunker.test.ts
git commit -m "feat(capture): add three-level hierarchical chunker"
```

---

### Task 5: Vector-store abstraction

**Files:**
- Create: `lib/capture/vector-store.ts`
- Create: `tests/lib/capture/vector-store.test.ts`

**Spec section:** "Vector store — Weaviate" (lines 129–166). This task implements only the abstraction + the in-memory backend. The Weaviate adapter is Stage 2b.

- [ ] **Step 1: Write the failing tests**

Tests must cover:

1. Upsert + cosine search within one tenant returns top-k by similarity.
2. Tenant isolation: upserts in tenant A are not searchable in tenant B.
3. Re-upserting the same `id` overwrites the prior record (no duplicates).
4. `deleteByMaterial(tenant, materialId)` removes only that material's chunks + sections, leaves others.
5. `hybridSearch` returns parent section text (`parentSectionText`) when the parent section is present in the store via `upsertSections`.

All assertions use small hand-crafted vectors (e.g., `[1, 0, 0]`, `[0, 1, 0]`) so similarity rankings are obvious.

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run tests/lib/capture/vector-store.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement the abstraction**

`lib/capture/vector-store.ts` exports:

```ts
import { cosineSimilarity } from '@/lib/ai/embeddings';

export interface ChunkVectorRecord { id: string; vector: number[]; materialId: string; courseCode: string; fileName: string; sectionTitle: string; sectionIndex: number; parentSectionId: string; text: string; contextBlurb: string; }
export interface SectionRecord { id: string; materialId: string; title: string; index: number; text: string; }
export interface SearchInput { queryVector: number[]; queryText: string; k: number; materialId?: string; }
export interface SearchHit { id: string; materialId: string; fileName: string; sectionTitle: string; sectionIndex: number; text: string; parentSectionId: string; parentSectionText: string | null; contextBlurb: string; score: number; }
export interface VectorStore {
  upsert(tenant: string, records: ChunkVectorRecord[]): Promise<void>;
  upsertSections(tenant: string, sections: SectionRecord[]): Promise<void>;
  deleteByMaterial(tenant: string, materialId: string): Promise<void>;
  hybridSearch(tenant: string, input: SearchInput): Promise<SearchHit[]>;
}
export function createInMemoryVectorStore(): VectorStore { /* Map-of-Maps backed; see below */ }
export function tenantForCourse(courseCode: string): string { return `coursecapture-${courseCode.toLowerCase().replace(/\s+/g, '-')}`; }
```

Backend shape: per-tenant state is `{ chunks: Map<id, ChunkVectorRecord>, sections: Map<id, SectionRecord> }`. `hybridSearch` computes cosine for every chunk in the tenant (filtered by `materialId` when provided), joins each chunk to its parent section (text → `parentSectionText`), sorts desc, slices to `k`. The `queryText` field is ignored by this backend — it'll be used by the Weaviate adapter's BM25 side in Stage 2b.

`tenantForCourse('GC 4800')` → `'coursecapture-gc-4800'`.

- [ ] **Step 4: Run tests — verify all pass**

Run: `pnpm vitest run tests/lib/capture/vector-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add lib/capture/vector-store.ts tests/lib/capture/vector-store.test.ts
git commit -m "feat(capture): add vector-store abstraction + in-memory backend"
```

---

### Task 6: Material-digest generator (generalizes material-summary)

**Files:**
- Create: `lib/ai/analyze/material-digest.ts`
- Create: `lib/ai/prompts/material-digest.md`
- Modify: `lib/ai/function-settings.ts` — add `material-digest` function ID (keep `material-summary` until Task 10).
- Create: `tests/ai/analyze/material-digest.test.ts`

**Spec section:** "Per-material digest" (lines 168–172). Generalizes `material-summary`: applied to *every* material, not just long reference ones.

- [ ] **Step 1: Write the prompt**

Create `lib/ai/prompts/material-digest.md` with frontmatter `description:` + `manning_skills: [summarization, structured-output, instructional-design]`. The body instructs the model to produce a ~1500-token markdown digest with sections:
1. **What this material is** — one paragraph (kind, scope, authorship cue).
2. **Headings / structure** — nested bullets of section titles (or "No explicit structure" if heading-less).
3. **Key terms** — 10–20 load-bearing terms/concepts.
4. **Audit-supported competencies (KUD+)** — bullets in the form `**<competency>** — *<Know|Understand|Do>* — <one-sentence rationale>`. Only include genuine matches.
5. **Audit gaps** — bullets of audit-relevant questions the material cannot answer (so the auditor knows to ask the instructor).
6. **Caveats** — only if extraction looks malformed/partial; otherwise omit.

Output rule: markdown only, no preamble, no code fence wrapping the whole thing. Cap ~1500 tokens. Never pad short materials.

- [ ] **Step 2: Add function ID + tier**

Edit `lib/ai/function-settings.ts`:
- Add `'material-digest'` and `'chunk-contextualize'` to `AI_FUNCTION_IDS`.
- Set both to `'light'` in `DEFAULT_TIERS`.
- Add labels and descriptions: `material-digest` → "Material digest (every material, audit at-rest context)" / "Per-material structured digest, generated at extraction for every material. Loaded into the audit agent's at-rest context."; `chunk-contextualize` → "Chunk contextualizer (per-chunk position blurb)" / "One short positional blurb per detail chunk, prepended before embedding so the embedding encodes position + content."

- [ ] **Step 3: Write failing tests**

Create `tests/ai/analyze/material-digest.test.ts`. Mock `@/lib/ai/provider`'s `getProviderForFunction` to return a stub provider whose `complete()` resolves with `{ data: { digest: '## What this material is\n\nA textbook chapter.' }, costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 }`. Assert that `generateMaterialDigest({ fileName: 'Canvas File: Ch4.pdf', extractedText: 'Chapter 4. Color reproduction...' })` returns `{ digest, model }`, the digest contains the model's content, and the `systemPrompt` / `userMessage` passed to the provider mention the file name and content.

- [ ] **Step 4: Run tests — verify they fail**

Run: `pnpm vitest run tests/ai/analyze/material-digest.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 5: Implement the digest generator**

`lib/ai/analyze/material-digest.ts` exports:

```ts
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
export interface DigestInput { fileName: string; extractedText: string; }
export interface DigestResult { digest: string; model: string; }
export async function generateMaterialDigest(input: DigestInput): Promise<DigestResult> { /* ... */ }
```

Implementation: load the `material-digest` prompt, build a `userMessage` with the fileName and the extracted text wrapped in `--- ... ---` delimiters, and end with: `"Return JSON: { \"digest\": \"<the markdown digest>\" }"`. Call `provider.complete<{ digest: string }>` with a JSON schema requiring a single string field `digest`. Validate that `digest` is a non-empty string. Return `{ digest: data.digest, model: provider.model }`.

- [ ] **Step 6: Run tests — verify they pass**

Run: `pnpm vitest run tests/ai/analyze/material-digest.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add lib/ai/analyze/material-digest.ts lib/ai/prompts/material-digest.md lib/ai/function-settings.ts tests/ai/analyze/material-digest.test.ts
git commit -m "feat(ai): add material-digest generator (generalizes material-summary)"
```

---

### Task 7: Chunk contextualizer

**Files:**
- Create: `lib/ai/analyze/chunk-contextualize.ts`
- Create: `lib/ai/prompts/chunk-contextualize.md`
- Create: `tests/ai/analyze/chunk-contextualize.test.ts`

**Spec section:** "Contextual retrieval enrichment" (lines 116–124). One light-tier LLM call per detail chunk → 1–2 sentence blurb describing where the chunk sits.

- [ ] **Step 1: Write the prompt**

`lib/ai/prompts/chunk-contextualize.md` (frontmatter `manning_skills: [summarization, retrieval-augmented-generation]`). Body: receives a chunk of text plus a digest of the broader material; produces one or two sentences describing where this chunk sits and what it covers. Reference the material's title/kind explicitly. Name the topic in plain language. ≤ 60 words, no preamble, no JSON wrapping in body, just the blurb (the wrapper schema is enforced in the call).

Example output to include in the prompt:
> *"This is from Chapter 4 of the textbook chapter on color reproduction; it discusses the relationship between ΔE values and human-perceptible difference."*

- [ ] **Step 2: Write failing tests**

Tests must:
1. Verify the returned `blurb` contains a substring from the stubbed model response (e.g., "Chapter 4").
2. Verify the returned `model` matches the stub provider's model.
3. Verify the digest, section title, and chunk text are all included in the `userMessage` sent to the provider.

Mock `getProviderForFunction` as in Task 6, with `data: { blurb: 'From Chapter 4 of the textbook; covers ΔE perceptibility.' }`.

- [ ] **Step 3: Run tests — verify they fail**

Run: `pnpm vitest run tests/ai/analyze/chunk-contextualize.test.ts`

- [ ] **Step 4: Implement**

`lib/ai/analyze/chunk-contextualize.ts` exports `contextualizeChunk({ materialDigest, sectionTitle, chunkText }) → { blurb, model }`. Build a `userMessage` with the three inputs labeled, ending with `"Return JSON: { \"blurb\": \"<one to two sentences>\" }"`. Validate the response has a non-empty string `blurb`.

- [ ] **Step 5: Run tests — verify pass**

Run: `pnpm vitest run tests/ai/analyze/chunk-contextualize.test.ts`

- [ ] **Step 6: Commit**

```
git add lib/ai/analyze/chunk-contextualize.ts lib/ai/prompts/chunk-contextualize.md tests/ai/analyze/chunk-contextualize.test.ts
git commit -m "feat(ai): add chunk-contextualize for per-chunk position blurbs"
```

---

### Task 8: Ingestion pipeline integration in `finalizeExtraction`

**Files:**
- Modify: `lib/capture/finalize-extraction.ts`
- Modify: `.env.example` — document `COURSECAPTURE_V2_INGESTION` flag.
- Create: `tests/lib/capture/finalize-extraction-v2.test.ts`

**Spec section:** "Ingestion timing" (lines 215–224). When the flag is set, `finalizeExtraction` runs the full pipeline: policy → FERPA → digest → chunk → contextualize → embed → upsert. When the flag is off, the legacy reference-compression path still runs.

`finalizeExtraction` accepts an injected `vectorStore` so the function stays pure and testable. Stage 2a callers construct `createInMemoryVectorStore()`; Stage 2b replaces it with `WeaviateVectorStore`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/capture/finalize-extraction-v2.test.ts`. Mock these modules:
- `@/lib/db/course-materials-queries` — replace `updateExtractionResult`, `updateMaterialDigest`, `updateIndexingStatus`, `updateFerpaRisk`, `updateAutoSetAside` with `vi.fn()` spies.
- `@/lib/ai/analyze/material-digest` — `generateMaterialDigest` returns `{ digest: 'digest of <fileName>', model: 'test-model' }`.
- `@/lib/ai/analyze/chunk-contextualize` — `contextualizeChunk` returns `{ blurb: 'blurb for <text>', model: 'test-model' }`.
- `@/lib/ai/embeddings` — `embedBatch(texts)` returns `texts.map((_, i) => [i, 0, 0])`; re-export the real `cosineSimilarity`.

Test cases:

1. **Flag off → legacy path only.** With `COURSECAPTURE_V2_INGESTION` unset and a long extracted text (> compression threshold), call `finalizeExtraction({ id, courseCode, fileName: 'Canvas File: long.pdf', extractionStatus: 'ok', extractedText, vectorStore, courseHasLearningObjectives: false })`. Assert `updateIndexingStatus` and `updateFerpaRisk` were NOT called.

2. **Flag on → full v2 pipeline.** With `COURSECAPTURE_V2_INGESTION='1'` and a short markdown text with two `#` headings, assert `updateMaterialDigest` called once, `updateFerpaRisk` called once, `updateIndexingStatus` called with `{ status: 'ready' }`.

3. **Policy auto-set-aside fires.** Flag on, `fileName: 'Canvas: Discussions'`: assert `updateAutoSetAside` called with `{ autoSetAside: true, ignored: true }`.

4. **Embedding failure → indexing_status: failed.** Flag on; override the mocked `embedBatch` to reject on first call. Assert `updateIndexingStatus` called with `{ status: 'failed' }`.

- [ ] **Step 2: Run tests — they should fail (interface drift)**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction-v2.test.ts`
Expected: FAIL — `finalizeExtraction` doesn't yet accept `vectorStore` / `courseCode` / `courseHasLearningObjectives`.

- [ ] **Step 3: Implement the extended pipeline**

Extend `lib/capture/finalize-extraction.ts`. New `FinalizeExtractionInput` adds: `courseCode: string`, `vectorStore?: VectorStore`, `courseHasLearningObjectives?: boolean`. Add helper `V2_ENABLED = () => process.env.COURSECAPTURE_V2_INGESTION === '1'`.

The function:
1. Always calls `updateExtractionResult` (existing).
2. If `extractionStatus !== 'ok'` or no `extractedText`, returns.
3. If `V2_ENABLED()`, calls `runV2Pipeline(input)` and returns.
4. Otherwise, runs the legacy reference-compression path (existing behavior, now calling `generateMaterialDigest` + `updateMaterialDigest` instead of the old summarizer).

`runV2Pipeline(input)` order:
1. `detectFerpaRisk(extractedText)` → `updateFerpaRisk`.
2. `evaluateMaterialsPolicy({ fileName, extractedText, courseHasLearningObjectives })` → `updateAutoSetAside({ id, autoSetAside: !included, setAsideReason: included ? null : reason, ignored: !included })`. If `!included`, call `updateIndexingStatus({ id, status: 'skipped' })` and return.
3. `generateMaterialDigest({ fileName, extractedText })` → store digest text locally → `updateMaterialDigest({ id, digest, digestModel: model })`. On error: `updateIndexingStatus({ id, status: 'failed' })` and return.
4. If `!input.vectorStore`, call `updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() })` and return.
5. `updateIndexingStatus({ id, status: 'indexing' })`. Then: `chunkMaterial({ fileName, text: extractedText })`. If no details, set status `'ready'` and return.
6. `Promise.all(details.map(d => contextualizeChunk({ materialDigest: digestText, sectionTitle: d.sectionTitle, chunkText: d.text })))` → blurbs array.
7. Build `toEmbed = details.map((d, i) => \`${blurbs[i]!.blurb}\n\n${d.text}\`)`. Call `embedBatch(toEmbed)` → vectors.
8. Build `sectionRecords` (`{ id: s.id, materialId: id, title: s.title, index: s.index, text: s.text }` for each section).
9. Build `chunkRecords` (full `ChunkVectorRecord` per detail, with the matching vector and blurb).
10. `tenant = tenantForCourse(courseCode)`. Call `vectorStore.deleteByMaterial(tenant, id)` then `upsertSections(tenant, sectionRecords)` then `upsert(tenant, chunkRecords)`.
11. `updateIndexingStatus({ id, status: 'ready', indexedAt: new Date() })`. Catch any error from steps 5–11 → `updateIndexingStatus({ id, status: 'failed' })`, log to `console.error`.

- [ ] **Step 4: Run all tests — verify pass and nothing regressed**

Run: `pnpm vitest run tests/lib/capture/ tests/ai/analyze/ tests/lib/ai/`
Expected: all pass.

- [ ] **Step 5: Document the flag**

Edit `.env.example`, adding after the campus block:

```
# CourseCapture v2 ingestion pipeline. When set to "1", finalizeExtraction
# runs the new digest + chunk + embed + index path on every material; when
# unset, the legacy reference-compression-only path runs. Stage 2a uses
# an in-memory vector store; Stage 2b will swap in Weaviate.
COURSECAPTURE_V2_INGESTION=
```

- [ ] **Step 6: Commit**

```
git add lib/capture/finalize-extraction.ts lib/capture/vector-store.ts tests/lib/capture/finalize-extraction-v2.test.ts .env.example
git commit -m "feat(capture): wire v2 ingestion pipeline into finalizeExtraction"
```

---

### Task 9: End-to-end smoke script against fixture material

**Files:**
- Create: `scripts/_one-off/stage2a-smoke.ts`

A short tsx-runnable script that drives the full pipeline on a fixture material without DB writes — just to spot-check that digest + chunks + embeddings + search produce sensible output before merge.

- [ ] **Step 1: Write the smoke script**

`scripts/_one-off/stage2a-smoke.ts` imports the Stage 2a modules (`generateMaterialDigest`, `contextualizeChunk`, `embedBatch`, `embedText`, `chunkMaterial`, `detectFerpaRisk`, `evaluateMaterialsPolicy`, `createInMemoryVectorStore`, `tenantForCourse`). Defines a fixture string of two-or-three `#`-headed sections (e.g., a short Chapter 4 on color reproduction with ΔE thresholds and press calibration).

Flow:
1. Run policy + FERPA against the fixture, print results.
2. Generate the digest, print the first ~600 chars.
3. Chunk the fixture, print `{sections, details}` counts.
4. Contextualize each detail in parallel, print each blurb.
5. Build `toEmbed` (blurb + chunk text) and call `embedBatch`, print vector count and dim.
6. Construct an in-memory vector store; upsert sections and chunks under `tenantForCourse('GC 4800')`.
7. Embed a query string ("how do operators verify press calibration?") and call `hybridSearch` with k=3; print each hit with score, section title, and a text preview.
8. End with `=== done ===`. On any thrown error, log it and set `process.exitCode = 1`.

- [ ] **Step 2: Run the smoke script**

Run: `AI_PROVIDER=campus npx tsx --env-file=.env.local scripts/_one-off/stage2a-smoke.ts`
Expected output: Policy decides include, FERPA low, digest renders, 2–3 sections + 2–3 detail chunks, blurbs generated, embeddings 2560-dim, search returns the press-calibration chunk as the top hit.

- [ ] **Step 3: Commit**

```
git add scripts/_one-off/stage2a-smoke.ts
git commit -m "feat(capture): add Stage 2a smoke script"
```

---

### Task 10: Cleanup + STATE.md + final commit

**Files:**
- Delete: `lib/ai/analyze/material-summary.ts`
- Delete: `lib/ai/prompts/material-summary.md`
- Modify: `lib/ai/function-settings.ts` — remove `'material-summary'` from all four constants (`AI_FUNCTION_IDS`, `DEFAULT_TIERS`, `FUNCTION_LABELS`, `FUNCTION_DESCRIPTIONS`).
- Modify: `docs/STATE.md`.

- [ ] **Step 1: Verify no references to `material-summary` or `summarizeMaterial` remain**

Run: `grep -rn "material-summary\|summarizeMaterial\|materialSummary" lib/ app/ components/ tests/ 2>/dev/null`
Expected: empty (after the renames in Tasks 1, 6, and this task).

- [ ] **Step 2: Delete the superseded files**

```
git rm lib/ai/analyze/material-summary.ts lib/ai/prompts/material-summary.md
```

- [ ] **Step 3: Remove `'material-summary'` from function-settings**

Edit `lib/ai/function-settings.ts` and remove every entry keyed `'material-summary'`. Then run `pnpm tsc --noEmit` and `pnpm vitest run` to confirm clean.

- [ ] **Step 4: Update STATE.md**

In `docs/STATE.md`, flip the Stage 2 entry in "Next-up → Spec'd, not yet implemented" to reflect Stage 2a shipped:

```diff
- | **CourseCapture v2 — Agentic Retrieval** | [spec](./superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md) | Three-phase architecture: per-material ingestion (chunk + digest + Weaviate index), tool-using audit agent, synthesis with intrinsic provenance. Per-course Weaviate tenants on a shared local instance. `audit_mode` toggle per course (Full / Simple). Pending implementation plan. **Next move.** |
+ | **CourseCapture v2 — Agentic Retrieval** | [spec](./superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md) | Three-phase architecture: per-material ingestion (chunk + digest + Weaviate index), tool-using audit agent, synthesis with intrinsic provenance. **Stage 1 (foundation) + Stage 2a (pre-Weaviate ingestion: chunker, FERPA, policy, digest, contextualizer, vector-store abstraction with in-memory backend) shipped 2026-05-26.** Stage 2b (Weaviate adapter + Materials UI + check-in chat) pending local Weaviate instance. Stages 3–5 (agent loop, synthesis, migration) ahead. |
```

Add a sentence under "Architecture → AI provider + function tiers" mentioning the new function IDs (`material-digest`, `chunk-contextualize`) and that `material-summary` was removed in favor of `material-digest`.

- [ ] **Step 5: Final commit**

```
git add lib/ai/analyze/material-summary.ts lib/ai/prompts/material-summary.md lib/ai/function-settings.ts docs/STATE.md
git commit -m "chore(capture): remove material-summary; Stage 2a ships"
```

---

## Acceptance criteria

After all tasks complete:

1. `pnpm vitest run` is green (full suite, not just new tests).
2. `pnpm tsc --noEmit` is green for everything under `lib/`, `app/`, `components/`, `tests/` (preexisting `scripts/_one-off/*` errors remain).
3. `scripts/_one-off/stage2a-smoke.ts` runs to completion against the live campus endpoint and prints a top-hit search result that's contextually relevant to the fixture query.
4. With `COURSECAPTURE_V2_INGESTION=1`:
   - A freshly extracted material has `digest` populated, `indexing_status='ready'`, `ferpa_risk` set, `auto_set_aside` set per policy.
   - A `Canvas: Discussions` material is auto-set-aside (`ignored=true`, `auto_set_aside=true`).
5. With the flag off, the legacy reference-compression path still runs — long uploads still get a digest. (Backward compatibility during transition.)
6. STATE.md reflects Stage 2a as shipped.

## Out of scope (Stage 2b plan)

Explicitly deferred to the Stage 2b plan, written once the local Weaviate instance is up:

- `WeaviateVectorStore` class implementing the `VectorStore` interface.
- Weaviate schema bootstrap (idempotent `MaterialChunk` class with multi-tenancy).
- Tenant creation per course.
- Materials panel UI: indexing-status dots, auto-set-aside pills, override-button, FERPA pills, audit-mode toggle.
- `ingestion-checkin` AI function + UI panel above the audit chat.
- Backfill route: re-index existing materials into Weaviate.
- Live integration test against an ephemeral Weaviate tenant.

