# Cross-Course Evidence Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the already-embedded per-course material chunks into one shared, cross-course, semantic, citable retrieval surface the curriculum-chat agent can query, with a current-by-default currency contract and a `retired` material state.

**Architecture:** A reserved `program` Weaviate tenant holds the union of all courses' chunks (reusing the existing `MaterialChunk` class — only chunks, no sections, in Phase 1). A refresh job copies a course's *current* chunks (Postgres-derived: `ready ∧ ¬ignored ∧ retired_at IS NULL`) from its per-course tenant into `program`, stamping provenance; it fires incrementally on the snapshot hook and via an admin full-rebuild. A new `search_curriculum` agent tool queries `program` (global / drill-down / per-course-diversified). Spec: [`docs/superpowers/specs/2026-06-19-cross-course-evidence-spine-design.md`](../specs/2026-06-19-cross-course-evidence-spine-design.md).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Postgres 17, Weaviate v3 (`weaviate-client`), campus-Qwen embeddings (`embedBatch`/`embedText`), Vitest. Tool shape: `ToolDefinition` (`lib/ai/tool-use-types`).

**Phase-1 scope trims (deliberate, recorded in the spec):** the `program` tenant stores **chunks only** — no sections — so cross-course hits return `parentSectionText: null` (the chunk `text` + `contextBlurb` are the citable evidence). Parent-section enrichment cross-course is a later add. Concept cards, auto-retire triggering, snapshot→material linkage, and material-version retention are **out of scope** (deferred).

---

## File structure

**Create:**
- `lib/capture/program-index.ts` — `tenantForProgram()`, `refreshProgramIndex()`, `rebuildProgramIndex()`.
- `lib/capture/__tests__/program-index.test.ts`
- `lib/ai/wiki/curriculum-search-tool.ts` — `diversifyByCourse()` (pure) + `curriculumSearchTool` + `buildCurriculumSearchTools()`.
- `lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`
- `app/api/admin/program-index/rebuild/route.ts` — admin POST → full rebuild.
- `lib/capture/__tests__/cross-course-eval.test.ts` — cross-course recall eval fixture.

**Modify:**
- `lib/db/schema.ts` — add `retiredAt` to `courseMaterials` (+ generated migration `drizzle/0044_*.sql`).
- `lib/db/course-materials-queries.ts` — `mapMaterialRow` (+`retiredAt`), `setMaterialRetired()`, `listIndexableMaterialsForCourse()`.
- `lib/capture/vector-store.ts` — `SearchInput.courseCode`, `ChunkVectorRecord`/`SearchHit` provenance, `VectorStore.deleteByCourse`/`listChunksByCourse`, `tenantForProgram` re-export, in-memory impl.
- `lib/capture/vector-store-weaviate.ts` — `courseCode` filter, `deleteByCourse`, `listChunksByCourse`, provenance in upsert.
- `lib/capture/weaviate-schema.ts` — add `uploadedAt`, `snapshotId` text props to `chunkProps`.
- `lib/db/course-materials-queries.test.ts` (or existing test file) — retire query tests.
- `lib/capture/__tests__/vector-store.test.ts` (existing or new) — courseCode filter / deleteByCourse / listChunksByCourse.
- `lib/ai/wiki/chat.ts:69` + `lib/ai/wiki/mcp-server.ts:38` — register the search tool.
- `lib/ai/wiki/response-schema.ts` — material-chunk citation fields.
- `app/api/capture/[code]/snapshots/route.ts:150-167` — fire `refreshProgramIndex` in the background block.
- `app/api/courses/[code]/materials/[id]/route.ts` — PATCH accepts `retired` (confirm exact path in Task 11 Step 1).
- A materials-manager row — minimal Retire/Restore control (Task 11).
- `docs/architecture.html` — storage/retrieval + spine documentation (Task 13).
- `docs/STATE.md` — reconcile on finish (Task 14).

---

## Task 1: `retired_at` schema column + migration

**Files:**
- Modify: `lib/db/schema.ts` (the `courseMaterials` table, near `ignored` at line ~284)
- Create (generated): `drizzle/0044_*.sql`

- [ ] **Step 1: Add the column to the schema**

In `lib/db/schema.ts`, inside `courseMaterials = pgTable('course_materials', {...})`, immediately after the `ignored` column, add:

```typescript
  // Curriculum-currency state, distinct from `ignored` (which means "don't send
  // to AI": FERPA/policy/noise). `retired_at` = "the course no longer does this";
  // the cross-course spine excludes retired materials. Null = active.
  retiredAt: timestamp('retired_at', { withTimezone: true }),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0044_*.sql` containing `ALTER TABLE "course_materials" ADD COLUMN "retired_at" timestamp with time zone;` and an updated `drizzle/meta/_journal.json`.

- [ ] **Step 3: Apply the migration to the (shared) DB**

Run: `pnpm db:migrate`
Expected: applies cleanly. The column is nullable with no default — additive and safe for old running code (it ignores the unknown column).

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): add course_materials.retired_at (curriculum-currency state)"
```

---

## Task 2: Material-retire queries

**Files:**
- Modify: `lib/db/course-materials-queries.ts`
- Test: `lib/db/__tests__/course-materials-queries.test.ts` (create if absent; if a colocated test exists, add there)

- [ ] **Step 1: Add `retiredAt` to the row mapper**

In `lib/db/course-materials-queries.ts`, in `mapMaterialRow`, after the `rawCleared` line add:

```typescript
    retiredAt: row['retired_at'] as Date | null,
```

- [ ] **Step 2: Write the failing test for `setMaterialRetired` + `listIndexableMaterialsForCourse`**

Create `lib/db/__tests__/course-materials-queries.test.ts` (mock `@/lib/db/client` the way existing query tests do — check a sibling like `lib/db/__tests__/*.test.ts` for the established `db` mock shape; if none exists, this task runs against a test Postgres via the same harness other `lib/db` tests use). Minimal behavioral test:

```typescript
import { describe, it, expect } from 'vitest';
import { buildIndexableMaterialsWhere } from '@/lib/db/course-materials-queries';

describe('buildIndexableMaterialsWhere', () => {
  it('filters to ready, not-ignored, not-retired', () => {
    // The predicate is exposed as a pure SQL-condition builder so the
    // currency contract is unit-checkable without a live DB.
    const sql = buildIndexableMaterialsWhere('GC 3460').toString?.() ?? '';
    expect(String(sql)).toMatch(/indexing_status/);
    expect(String(sql)).toMatch(/ignored/);
    expect(String(sql)).toMatch(/retired_at/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run lib/db/__tests__/course-materials-queries.test.ts`
Expected: FAIL — `buildIndexableMaterialsWhere is not a function`.

- [ ] **Step 4: Implement the queries**

In `lib/db/course-materials-queries.ts`, add (the import line already has `eq, and, asc, isNull, sql`):

```typescript
/** The currency contract for the cross-course spine: a material contributes
 *  chunks only when it is fully indexed, not ignored, and not retired. */
export function buildIndexableMaterialsWhere(courseCode: string) {
  return and(
    eq(courseMaterials.courseCode, courseCode),
    eq(courseMaterials.indexingStatus, 'ready'),
    eq(courseMaterials.ignored, false),
    isNull(courseMaterials.retiredAt),
  );
}

/** Current, indexable materials for a course (spine currency set). */
export async function listIndexableMaterialsForCourse(
  courseCode: string,
): Promise<CourseMaterialRow[]> {
  return db.select().from(courseMaterials).where(buildIndexableMaterialsWhere(courseCode));
}

/** Set/clear a material's retired state. Returns true if a row was updated. */
export async function setMaterialRetired(id: string, retired: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ retiredAt: retired ? new Date() : null })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/course-materials-queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/course-materials-queries.ts lib/db/__tests__/course-materials-queries.test.ts
git commit -m "feat(db): material-retire queries + indexable-materials currency filter"
```

---

## Task 3: Vector-store types + in-memory backend (courseCode filter, deleteByCourse, listChunksByCourse, provenance, program tenant)

**Files:**
- Modify: `lib/capture/vector-store.ts`
- Test: `lib/capture/__tests__/vector-store.test.ts` (create)

- [ ] **Step 1: Extend the types**

In `lib/capture/vector-store.ts`:

Add provenance to `ChunkVectorRecord` (optional — only the program copy sets them):
```typescript
export interface ChunkVectorRecord {
  id: string;
  vector: number[];
  materialId: string;
  courseCode: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  parentSectionId: string;
  text: string;
  contextBlurb: string;
  /** Provenance (set by the cross-course spine copy; empty for per-course writes). */
  uploadedAt?: string | null;
  snapshotId?: string | null;
}
```

Add the filter to `SearchInput`:
```typescript
export interface SearchInput {
  queryVector: number[];
  queryText: string;
  k: number;
  materialId?: string;
  courseCode?: string;   // cross-course spine: drill-down to one course
}
```

Add provenance to `SearchHit`:
```typescript
export interface SearchHit {
  id: string;
  materialId: string;
  courseCode: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  text: string;
  parentSectionId: string;
  parentSectionText: string | null;
  contextBlurb: string;
  score: number;
  uploadedAt: string | null;
  snapshotId: string | null;
}
```

Add two methods to the `VectorStore` interface:
```typescript
  deleteByCourse(tenant: string, courseCode: string): Promise<void>;
  listChunksByCourse(tenant: string, courseCode: string): Promise<ChunkVectorRecord[]>;
```

Add the program-tenant helper next to `tenantForCourse`:
```typescript
/** The single reserved tenant holding the union of all courses' chunks for
 *  cross-course search. Namespaced like tenantForCourse so prefixes match. */
export function tenantForProgram(): string {
  return 'coursecapture-program';
}
```

- [ ] **Step 2: Write the failing test (in-memory backend)**

Create `lib/capture/__tests__/vector-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createInMemoryVectorStore, type ChunkVectorRecord } from '@/lib/capture/vector-store';

function chunk(over: Partial<ChunkVectorRecord>): ChunkVectorRecord {
  return {
    id: 'c1', vector: [1, 0, 0], materialId: 'm1', courseCode: 'GC 1000',
    fileName: 'f.pdf', sectionTitle: 'f.pdf', sectionIndex: 0, parentSectionId: 's1',
    text: 'ink mixing', contextBlurb: '', uploadedAt: null, snapshotId: null, ...over,
  };
}

describe('in-memory vector store — cross-course', () => {
  it('filters hybridSearch by courseCode', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert('program', [chunk({ id: 'a', courseCode: 'GC 1000' }), chunk({ id: 'b', courseCode: 'GC 2000', vector: [1, 0, 0] })]);
    const hits = await s.hybridSearch('program', { queryVector: [1, 0, 0], queryText: 'ink', k: 10, courseCode: 'GC 2000' });
    expect(hits.map(h => h.id)).toEqual(['b']);
    expect(hits[0]!.courseCode).toBe('GC 2000');
  });

  it('deleteByCourse removes only that course', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert('program', [chunk({ id: 'a', courseCode: 'GC 1000' }), chunk({ id: 'b', courseCode: 'GC 2000' })]);
    await s.deleteByCourse('program', 'GC 1000');
    const remaining = await s.listChunksByCourse('program', 'GC 2000');
    expect(remaining.map(c => c.id)).toEqual(['b']);
    expect(await s.listChunksByCourse('program', 'GC 1000')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run lib/capture/__tests__/vector-store.test.ts`
Expected: FAIL — `deleteByCourse`/`listChunksByCourse` not implemented; `courseCode` not on hits.

- [ ] **Step 4: Implement in the in-memory backend**

In `createInMemoryVectorStore`, update `hybridSearch` to honor `courseCode` and emit the new hit fields, and add the two methods:

```typescript
    async hybridSearch(tenant, input) {
      const state = tenants.get(tenant);
      if (!state) return [];
      const scored: SearchHit[] = [];
      for (const c of state.chunks.values()) {
        if (input.materialId && c.materialId !== input.materialId) continue;
        if (input.courseCode && c.courseCode !== input.courseCode) continue;
        const parent = state.sections.get(c.parentSectionId) ?? null;
        scored.push({
          id: c.id, materialId: c.materialId, courseCode: c.courseCode,
          fileName: c.fileName, sectionTitle: c.sectionTitle, sectionIndex: c.sectionIndex,
          text: c.text, parentSectionId: c.parentSectionId, parentSectionText: parent?.text ?? null,
          contextBlurb: c.contextBlurb, score: cosineSimilarity(input.queryVector, c.vector),
          uploadedAt: c.uploadedAt ?? null, snapshotId: c.snapshotId ?? null,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, input.k);
    },

    async deleteByCourse(tenant, courseCode) {
      const state = tenants.get(tenant);
      if (!state) return;
      for (const [id, c] of state.chunks) if (c.courseCode === courseCode) state.chunks.delete(id);
    },

    async listChunksByCourse(tenant, courseCode) {
      const state = tenants.get(tenant);
      if (!state) return [];
      return [...state.chunks.values()].filter(c => c.courseCode === courseCode);
    },
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run lib/capture/__tests__/vector-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (the new `SearchHit.courseCode` may surface consumers)**

Run: `pnpm exec tsc --noEmit`
Expected: errors only where `SearchHit` is consumed without the new fields. Fix each consumer to read the now-required `courseCode`/`uploadedAt`/`snapshotId` (search: `grep -rn "parentSectionText" app lib | grep -v node_modules`). If a consumer constructs `SearchHit` literals, add the new fields.

- [ ] **Step 7: Commit**

```bash
git add lib/capture/vector-store.ts lib/capture/__tests__/vector-store.test.ts
git commit -m "feat(vector-store): courseCode filter, deleteByCourse, listChunksByCourse, provenance fields"
```

---

## Task 4: Weaviate backend parity

**Files:**
- Modify: `lib/capture/vector-store-weaviate.ts`, `lib/capture/weaviate-schema.ts`

> No unit test (requires a live Weaviate). Verified by in-memory parity (Task 3) + a manual smoke in Task 5 Step 7 / Task 9. Implement as a mechanical mirror of the in-memory semantics.

- [ ] **Step 1: Add provenance properties to the chunk class**

In `lib/capture/weaviate-schema.ts`, append to `chunkProps`:
```typescript
  { name: 'uploadedAt', dataType: 'text' as const },
  { name: 'snapshotId', dataType: 'text' as const },
```
(Additive; existing tenants/objects keep working. New props are empty on per-course writes.)

- [ ] **Step 2: Write provenance in `upsert`**

In `vector-store-weaviate.ts` `upsert`, add to the mapped `properties`:
```typescript
          uploadedAt: r.uploadedAt ?? '',
          snapshotId: r.snapshotId ?? '',
```

- [ ] **Step 3: Apply the `courseCode` filter and emit new hit fields in `hybridSearch`**

In the `chunks.query.hybrid(...)` call, replace the `filters` line to combine `materialId` and `courseCode`, add the two return properties, and map them into the returned `SearchHit` (also add `courseCode` to the returned object):

```typescript
        filters: buildHybridFilter(chunks, input),
        returnMetadata: ['score'],
        returnProperties: [
          'materialId', 'courseCode', 'fileName', 'sectionTitle', 'sectionIndex',
          'parentSectionId', 'text', 'contextBlurb', 'uploadedAt', 'snapshotId',
        ],
```

Add a small helper above the factory (combines optional filters):
```typescript
function buildHybridFilter(chunks: ReturnType<typeof getChunksCollection>, input: SearchInput) {
  const fs = [];
  if (input.materialId) fs.push(chunks.filter.byProperty('materialId').equal(input.materialId));
  if (input.courseCode) fs.push(chunks.filter.byProperty('courseCode').equal(input.courseCode));
  if (fs.length === 0) return undefined;
  if (fs.length === 1) return fs[0];
  return weaviate.Filters.and(...fs);
}
```
(Import `weaviate` and define `getChunksCollection` inline, or inline the filter expression without the helper if the typing is awkward — the behavior is: AND the two optional equals.) In the `result.objects.map(...)` return, add:
```typescript
          courseCode: String(o.properties['courseCode'] ?? ''),
          uploadedAt: String(o.properties['uploadedAt'] ?? '') || null,
          snapshotId: String(o.properties['snapshotId'] ?? '') || null,
```

- [ ] **Step 4: Implement `deleteByCourse`**

Mirror `deleteByMaterial`, filtering the **chunk class only** (sections aren't in the program tenant) by `courseCode`:
```typescript
    async deleteByCourse(tenant, courseCode) {
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      try {
        await col.data.deleteMany(col.filter.byProperty('courseCode').equal(courseCode));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('tenant not found') || msg.includes('does not exist')) return;
        throw e;
      }
    },
```

- [ ] **Step 5: Implement `listChunksByCourse`**

```typescript
    async listChunksByCourse(tenant, courseCode) {
      await ensureSchemaOnce();
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      try {
        const res = await col.query.fetchObjects({
          filters: col.filter.byProperty('courseCode').equal(courseCode),
          includeVector: true,
          limit: 10000, // course chunk counts are well under this
        });
        return res.objects.map((o) => ({
          id: String(o.uuid),
          vector: (o.vectors?.default ?? []) as number[],
          materialId: String(o.properties['materialId']),
          courseCode: String(o.properties['courseCode']),
          fileName: String(o.properties['fileName']),
          sectionTitle: String(o.properties['sectionTitle']),
          sectionIndex: Number(o.properties['sectionIndex']),
          parentSectionId: String(o.properties['parentSectionId'] ?? ''),
          text: String(o.properties['text']),
          contextBlurb: String(o.properties['contextBlurb'] ?? ''),
          uploadedAt: (String(o.properties['uploadedAt'] ?? '') || null),
          snapshotId: (String(o.properties['snapshotId'] ?? '') || null),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('tenant not found') || msg.includes('does not exist')) return [];
        throw e;
      }
    },
```
(Confirm the v3 vector accessor: a single unnamed vector reads back as `o.vectors.default`. If the live smoke shows it under a different key, adjust this one line.)

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/capture/vector-store-weaviate.ts lib/capture/weaviate-schema.ts
git commit -m "feat(vector-store): Weaviate parity — courseCode filter, deleteByCourse, listChunksByCourse, provenance"
```

---

## Task 5: `program-index.ts` — refresh + rebuild

**Files:**
- Create: `lib/capture/program-index.ts`, `lib/capture/__tests__/program-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/capture/__tests__/program-index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInMemoryVectorStore, tenantForCourse, tenantForProgram, type ChunkVectorRecord } from '@/lib/capture/vector-store';

const listIndexable = vi.fn();
vi.mock('@/lib/db/course-materials-queries', () => ({
  listIndexableMaterialsForCourse: (...a: unknown[]) => listIndexable(...a),
}));

import { refreshProgramIndex } from '@/lib/capture/program-index';

function chunk(over: Partial<ChunkVectorRecord>): ChunkVectorRecord {
  return { id: 'c', vector: [1, 0], materialId: 'm1', courseCode: 'GC 3460', fileName: 'f.pdf',
    sectionTitle: 'f.pdf', sectionIndex: 0, parentSectionId: 's', text: 't', contextBlurb: '',
    uploadedAt: null, snapshotId: null, ...over };
}

describe('refreshProgramIndex', () => {
  beforeEach(() => listIndexable.mockReset());

  it('copies only current materials, stamps provenance, into the program tenant', async () => {
    const store = createInMemoryVectorStore();
    // per-course tenant has chunks for two materials; m_old is now retired/ignored
    await store.upsert(tenantForCourse('GC 3460'), [
      chunk({ id: 'a', materialId: 'm_keep' }),
      chunk({ id: 'b', materialId: 'm_old', text: 'ink mixing' }),
    ]);
    listIndexable.mockResolvedValue([{ id: 'm_keep', uploadedAt: new Date('2026-03-01T00:00:00Z') }]);

    await refreshProgramIndex('GC 3460', { store, snapshotId: 'snap-1' });

    const inProgram = await store.listChunksByCourse(tenantForProgram(), 'GC 3460');
    expect(inProgram.map(c => c.materialId)).toEqual(['m_keep']); // m_old dropped
    expect(inProgram[0]!.snapshotId).toBe('snap-1');
    expect(inProgram[0]!.uploadedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('is idempotent (delete-then-write leaves no stale slice)', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert(tenantForCourse('GC 3460'), [chunk({ id: 'a', materialId: 'm_keep' })]);
    listIndexable.mockResolvedValue([{ id: 'm_keep', uploadedAt: new Date('2026-03-01T00:00:00Z') }]);
    await refreshProgramIndex('GC 3460', { store, snapshotId: 's' });
    await refreshProgramIndex('GC 3460', { store, snapshotId: 's' });
    const inProgram = await store.listChunksByCourse(tenantForProgram(), 'GC 3460');
    expect(inProgram.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/capture/__tests__/program-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `program-index.ts`**

Create `lib/capture/program-index.ts`:

```typescript
/**
 * The cross-course evidence spine builder.
 *
 * Projects the current, indexable per-course chunks into a single reserved
 * `program` tenant for cross-course semantic search. Pure projection — no
 * re-embedding, no new content. Currency is derived from Postgres
 * (ready ∧ ¬ignored ∧ retired_at IS NULL) so retired/ignored/removed material
 * drops out on refresh.
 */
import {
  createVectorStore, tenantForCourse, tenantForProgram, type VectorStore, type ChunkVectorRecord,
} from '@/lib/capture/vector-store';
import { listIndexableMaterialsForCourse } from '@/lib/db/course-materials-queries';
import { listCourseCodes } from '@/lib/db/courses-queries';

export interface RefreshOptions {
  store?: VectorStore;
  snapshotId?: string | null;
}

/** Rebuild one course's slice of the program tenant from its current materials. */
export async function refreshProgramIndex(courseCode: string, opts: RefreshOptions = {}): Promise<void> {
  const store = opts.store ?? createVectorStore();
  const snapshotId = opts.snapshotId ?? null;

  const current = await listIndexableMaterialsForCourse(courseCode);
  const uploadedByMaterial = new Map(current.map(m => [m.id, m.uploadedAt]));
  const keepIds = new Set(current.map(m => m.id));

  // Source of vectors: the course's own per-course tenant (already embedded).
  const sourceChunks = await store.listChunksByCourse(tenantForCourse(courseCode), courseCode);
  const stamped: ChunkVectorRecord[] = sourceChunks
    .filter(c => keepIds.has(c.materialId))
    .map(c => ({
      ...c,
      uploadedAt: (uploadedByMaterial.get(c.materialId) ?? null)?.toISOString() ?? null,
      snapshotId,
    }));

  // delete-then-write: drops retired/ignored/removed material (incl. hard-deleted).
  await store.deleteByCourse(tenantForProgram(), courseCode);
  if (stamped.length > 0) await store.upsert(tenantForProgram(), stamped);
  console.log(`[program-index] ${courseCode}: ${stamped.length} chunks (from ${sourceChunks.length} source)`);
}

/** Full backfill / recovery: refresh every course. Batch-tolerable, run on demand. */
export async function rebuildProgramIndex(opts: RefreshOptions = {}): Promise<{ courses: number }> {
  const store = opts.store ?? createVectorStore();
  const codes = await listCourseCodes();
  for (const code of codes) await refreshProgramIndex(code, { store });
  return { courses: codes.length };
}
```

- [ ] **Step 4: Confirm `listCourseCodes` exists (or adjust)**

Run: `grep -n "export.*listCourseCodes\|export.*listCourses\|export.*getAllCourse" lib/db/courses-queries.ts`
If the exact name differs, use the existing "all course codes" query (e.g. map `listCourses()` → `.map(c => c.code)`). Adjust the import + call in `rebuildProgramIndex` accordingly.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run lib/capture/__tests__/program-index.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Manual Weaviate smoke (live instance is up at 127.0.0.1:8090)**

Run a one-off against a real course that has indexed materials:
```bash
VECTOR_STORE=weaviate pnpm exec tsx -e "import('./lib/capture/program-index').then(m=>m.refreshProgramIndex(process.argv[1])).then(()=>process.exit(0))" "GC 3460"
```
Expected: logs `[program-index] GC 3460: N chunks ...` with N>0, no throw. (Confirms the v3 vector accessor in Task 4 Step 5; fix that one line if N is 0 but the course has chunks.)

- [ ] **Step 8: Commit**

```bash
git add lib/capture/program-index.ts lib/capture/__tests__/program-index.test.ts
git commit -m "feat(spine): program-index refresh + full rebuild (Postgres-derived currency, provenance stamps)"
```

---

## Task 6: Fire refresh on the snapshot hook

**Files:**
- Modify: `app/api/capture/[code]/snapshots/route.ts` (the background IIFE at ~150-167)

- [ ] **Step 1: Add the refresh call inside the existing background block**

In the `(async () => { try { ... } catch ... })()` block that runs `updateWikiForSnapshot`, after the `writeAndPush(...)` line and still inside the `try`, add:

```typescript
      // Refresh this course's slice of the cross-course spine from its current
      // materials. Fire-and-log like the wiki update; the full rebuild recovers.
      await refreshProgramIndex(snapshot.courseCode, { snapshotId: snapshot.id }).catch(err =>
        console.error('[program-index] refresh failed for', snapshot.courseCode, err),
      );
```

Add the import at the top of the file:
```typescript
import { refreshProgramIndex } from '@/lib/capture/program-index';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the snapshots-route tests (regression — refresh must not break the flow)**

Run: `pnpm vitest run app/api/capture`
Expected: PASS. If a test asserts the background block's behavior and now sees a missing `refreshProgramIndex`, mock it: `vi.mock('@/lib/capture/program-index', () => ({ refreshProgramIndex: vi.fn() }))`.

- [ ] **Step 4: Commit**

```bash
git add app/api/capture/[code]/snapshots/route.ts
git commit -m "feat(spine): refresh program index on snapshot creation (background)"
```

---

## Task 7: Admin full-rebuild route

**Files:**
- Create: `app/api/admin/program-index/rebuild/route.ts`

- [ ] **Step 1: Find the admin-route auth pattern to mirror**

Run: `ls app/api/admin && grep -rln "POST" app/api/admin | head`
Open one existing admin POST route (e.g. the v2-backfill route referenced in STATE.md) and note how it authorizes (admin routes are gated by Basic Auth middleware; most just export `POST`). Mirror that shape exactly — do not invent new auth.

- [ ] **Step 2: Implement the route**

Create `app/api/admin/program-index/rebuild/route.ts` (matching the sibling admin route's style):

```typescript
import { NextResponse, after } from 'next/server';
import { rebuildProgramIndex } from '@/lib/capture/program-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Full cross-course spine rebuild + one-time backfill. Runs in the background
// (after()) so the request returns immediately; progress is in server logs.
export async function POST() {
  after(async () => {
    try {
      const { courses } = await rebuildProgramIndex();
      console.log(`[program-index] full rebuild complete: ${courses} courses`);
    } catch (err) {
      console.error('[program-index] full rebuild failed', err);
    }
  });
  return NextResponse.json({ status: 'rebuilding' });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/program-index/rebuild/route.ts
git commit -m "feat(spine): admin full-rebuild route for the program index"
```

---

## Task 8: `diversifyByCourse` pure function

**Files:**
- Create: `lib/ai/wiki/curriculum-search-tool.ts` (function only for now), `lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diversifyByCourse } from '@/lib/ai/wiki/curriculum-search-tool';

const hit = (id: string, courseCode: string, score: number) =>
  ({ id, courseCode, score } as any);

describe('diversifyByCourse', () => {
  it('caps hits per course and preserves score order within a course', () => {
    const hits = [
      hit('a', 'GC 1000', 0.9), hit('b', 'GC 1000', 0.8), hit('c', 'GC 1000', 0.7),
      hit('d', 'GC 2000', 0.6),
    ];
    const out = diversifyByCourse(hits, 2);
    expect(out.filter(h => h.courseCode === 'GC 1000').map(h => h.id)).toEqual(['a', 'b']);
    expect(out.some(h => h.courseCode === 'GC 2000')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the function**

Create `lib/ai/wiki/curriculum-search-tool.ts`:

```typescript
import type { SearchHit } from '@/lib/capture/vector-store';

/** Comparison mode: keep at most `perCourse` highest-scoring hits per course,
 *  preserving overall descending-score order. A verbose course can't crowd out
 *  the comparison. Assumes `hits` is already score-sorted (Weaviate returns it so). */
export function diversifyByCourse(hits: SearchHit[], perCourse: number): SearchHit[] {
  const seen = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const n = seen.get(h.courseCode) ?? 0;
    if (n >= perCourse) continue;
    seen.set(h.courseCode, n + 1);
    out.push(h);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/curriculum-search-tool.ts lib/ai/wiki/__tests__/curriculum-search-tool.test.ts
git commit -m "feat(spine): diversifyByCourse comparison-mode helper"
```

---

## Task 9: `search_curriculum` tool + registration

**Files:**
- Modify: `lib/ai/wiki/curriculum-search-tool.ts` (add the tool), `lib/ai/wiki/__tests__/curriculum-search-tool.test.ts` (add execute test), `lib/ai/wiki/chat.ts`, `lib/ai/wiki/mcp-server.ts`

- [ ] **Step 1: Write the failing execute test (inject a fake store + spy embed)**

Add to `lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`:

```typescript
import { vi } from 'vitest';
vi.mock('@/lib/ai/embeddings', () => ({ embedText: vi.fn(async () => [1, 0, 0]) }));
const fakeStore = {
  hybridSearch: vi.fn(async () => ([
    { id: 'a', materialId: 'm', courseCode: 'GC 1000', fileName: 'f.pdf', sectionTitle: 'f.pdf',
      sectionIndex: 0, text: 'ink', parentSectionId: '', parentSectionText: null, contextBlurb: '',
      score: 0.9, uploadedAt: null, snapshotId: null },
  ])),
} as any;
vi.mock('@/lib/capture/vector-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/vector-store')>()),
  createVectorStore: () => fakeStore,
}));

import { curriculumSearchTool } from '@/lib/ai/wiki/curriculum-search-tool';

describe('search_curriculum tool', () => {
  it('embeds the query, searches the program tenant, returns citable hits', async () => {
    const res: any = await curriculumSearchTool.execute({ query: 'ink mixing' });
    expect(fakeStore.hybridSearch).toHaveBeenCalledWith('coursecapture-program', expect.objectContaining({ queryText: 'ink mixing' }));
    expect(res.hits[0]).toMatchObject({ courseCode: 'GC 1000', fileName: 'f.pdf' });
  });

  it('passes courseCode through for drill-down', async () => {
    await curriculumSearchTool.execute({ query: 'x', courseCode: 'GC 2000' });
    expect(fakeStore.hybridSearch).toHaveBeenLastCalledWith('coursecapture-program', expect.objectContaining({ courseCode: 'GC 2000' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`
Expected: FAIL — `curriculumSearchTool` not exported.

- [ ] **Step 3: Implement the tool**

Add to `lib/ai/wiki/curriculum-search-tool.ts`:

```typescript
import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { createVectorStore, tenantForProgram } from '@/lib/capture/vector-store';
import { embedText } from '@/lib/ai/embeddings';

export const curriculumSearchTool: ToolDefinition = {
  name: 'search_curriculum',
  description:
    'Semantic search over the ACTUAL course materials (syllabi, assignments, rubrics, slide content) across ALL courses at once — the primary-source evidence, not the curated wiki prose and not the KUD scores. Use it to "show me / compare what courses actually do." Pass `courseCode` to drill into one course; pass `perCourse:true` to compare across courses (returns the top hits per course so a verbose course cannot dominate). Each hit cites its course + file. Prefer this over search_wiki when the user wants real material evidence or a cross-course comparison.',
  usagePolicy:
    'Free-text query. Returns primary-source excerpts grouped/diversified by course, each with courseCode + fileName for citation. Distinct from search_wiki (curated prose) and coverage_for_target (structured scores).',
  inputSchema: z.object({
    query: z.string().min(1),
    courseCode: z.string().optional(),
    perCourse: z.boolean().optional(),
    k: z.number().int().positive().max(50).optional(),
  }),
  async execute(args) {
    const { query, courseCode, perCourse, k } = args as
      { query: string; courseCode?: string; perCourse?: boolean; k?: number };
    const store = createVectorStore();
    const queryVector = await embedText(query);
    // In comparison mode fetch a wider candidate set, then diversify per course.
    const limit = perCourse ? Math.min((k ?? 8) * 6, 50) : (k ?? 8);
    const raw = await store.hybridSearch(tenantForProgram(), { queryVector, queryText: query, k: limit, courseCode });
    const hits = perCourse ? diversifyByCourse(raw, 3).slice(0, (k ?? 8) * 3) : raw;
    return {
      hits: hits.map(h => ({
        courseCode: h.courseCode, materialId: h.materialId, fileName: h.fileName,
        sectionTitle: h.sectionTitle, chunkId: h.id, text: h.text,
        contextBlurb: h.contextBlurb, uploadedAt: h.uploadedAt, score: h.score,
      })),
    };
  },
};

export function buildCurriculumSearchTools(): ToolDefinition[] {
  return [curriculumSearchTool];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/ai/wiki/__tests__/curriculum-search-tool.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Register the tool on the curriculum surfaces**

In `lib/ai/wiki/chat.ts`: add the import and append to the tools array at line ~69:
```typescript
import { buildCurriculumSearchTools } from './curriculum-search-tool';
// ...
  const tools = [...buildCurriculumChatTools(), ...buildCurriculumGraphTools(), ...buildCurriculumSearchTools()];
```

In `lib/ai/wiki/mcp-server.ts`: add the import and append to the default `tools` param at line ~38:
```typescript
import { buildCurriculumSearchTools } from '@/lib/ai/wiki/curriculum-search-tool';
// ...
  tools: ToolDefinition[] = [...buildCurriculumChatTools(), ...buildCurriculumGraphTools(), ...buildCurriculumSearchTools()],
```
(Leave the audit agent in `lib/ai/agent/audit-tools.ts` unchanged — it is single-course-scoped; cross-course search there is out of scope.)

- [ ] **Step 6: Typecheck + run wiki tests**

Run: `pnpm exec tsc --noEmit && pnpm vitest run lib/ai/wiki`
Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/wiki/curriculum-search-tool.ts lib/ai/wiki/__tests__/curriculum-search-tool.test.ts lib/ai/wiki/chat.ts lib/ai/wiki/mcp-server.ts
git commit -m "feat(spine): search_curriculum tool registered on /ask + MCP server"
```

---

## Task 10: Material-chunk citation variant

**Files:**
- Modify: `lib/ai/wiki/response-schema.ts`
- Test: `lib/ai/wiki/__tests__/response-schema.test.ts` (create)

> Strict-mode discipline (CLAUDE.md): every property in `properties` must be in `required`; optionals are nullable, not omitted. We extend the single citation object with nullable material fields rather than a union (unions are painful under OpenAI strict mode). `path` stays for wiki cites; the material fields are filled for spine cites.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/wiki/__tests__/response-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CurriculumChatResponseSchema, CurriculumChatResponseJsonSchema } from '@/lib/ai/wiki/response-schema';

describe('citation schema', () => {
  it('accepts a wiki-path citation', () => {
    const r = CurriculumChatResponseSchema.parse({ response: 'x', citations: [{ path: 'courses/gc-4800.md', excerpt: 'e', courseCode: null, materialId: null, fileName: null, chunkId: null }] });
    expect(r.citations[0]!.path).toBe('courses/gc-4800.md');
  });
  it('accepts a material-chunk citation', () => {
    const r = CurriculumChatResponseSchema.parse({ response: 'x', citations: [{ path: null, excerpt: 'e', courseCode: 'GC 1000', materialId: 'm', fileName: 'f.pdf', chunkId: 'c' }] });
    expect(r.citations[0]!.courseCode).toBe('GC 1000');
  });
  it('strict json schema lists every property in required', () => {
    const item: any = CurriculumChatResponseJsonSchema.properties.citations.items;
    expect(new Set(item.required)).toEqual(new Set(Object.keys(item.properties)));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/ai/wiki/__tests__/response-schema.test.ts`
Expected: FAIL — extra keys rejected / required mismatch.

- [ ] **Step 3: Extend the schema (zod + JSON schema in lockstep)**

In `lib/ai/wiki/response-schema.ts`, replace `WikiCitation` and the JSON-schema citation item:

```typescript
const WikiCitation = z.object({
  /** Wiki-page path (e.g. "courses/gc-4800.md") — null for material-chunk citations. */
  path: z.string().nullable(),
  /** Up-to-200-char verbatim excerpt. */
  excerpt: z.string().max(200),
  /** Material-chunk citation fields — null for wiki-page citations. */
  courseCode: z.string().nullable(),
  materialId: z.string().nullable(),
  fileName: z.string().nullable(),
  chunkId: z.string().nullable(),
});
```

And the JSON-schema `citations.items`:
```typescript
        type: 'object',
        properties: {
          path: { type: ['string', 'null'] },
          excerpt: { type: 'string', maxLength: 200 },
          courseCode: { type: ['string', 'null'] },
          materialId: { type: ['string', 'null'] },
          fileName: { type: ['string', 'null'] },
          chunkId: { type: ['string', 'null'] },
        },
        required: ['path', 'excerpt', 'courseCode', 'materialId', 'fileName', 'chunkId'],
        additionalProperties: false,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/ai/wiki/__tests__/response-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix consumers of `CurriculumChatCitation`**

Run: `pnpm exec tsc --noEmit`
The existing UI (`components/AskTab.tsx`) reads `citation.path`. It now must handle a null `path` (material cite): render `fileName`/`courseCode` when `path` is null, else the wiki link. Update the citation render to:
```tsx
{c.path ? <WikiLink path={c.path} /> : <span>{c.courseCode} · {c.fileName}</span>}
```
(Match the file's existing citation markup; the point is null-`path` → material label.) Re-run `tsc` until clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/wiki/response-schema.ts lib/ai/wiki/__tests__/response-schema.test.ts components/AskTab.tsx
git commit -m "feat(spine): material-chunk citation variant (strict-mode-safe nullable fields)"
```

---

## Task 11: Retire lever (PATCH + minimal UI)

**Files:**
- Modify: the per-material PATCH route + a materials-manager row control

- [ ] **Step 1: Locate the per-material PATCH route**

Run: `grep -rln "PATCH" app/api | grep -i material; grep -rn "tier" app/api/courses/[code]/materials/[id]/route.ts 2>/dev/null`
Open the route that already accepts `{ tier }` / `{ ignored }` on PATCH (the design references `PATCH /materials/[id]`). Confirm its exact path before editing.

- [ ] **Step 2: Write the failing test for the route accepting `retired`**

In that route's test file (mirror an existing PATCH test for `ignored`/`tier`), add a case: `PATCH { retired: true }` → calls `setMaterialRetired(id, true)` → 200. If no test file exists, add a focused one mocking `@/lib/db/course-materials-queries`.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run <that route's test path>`
Expected: FAIL — `retired` not handled.

- [ ] **Step 4: Handle `retired` in the PATCH route**

Mirror the existing `ignored` branch. Where the route parses the body and dispatches:
```typescript
import { setMaterialRetired } from '@/lib/db/course-materials-queries';
// ... within the handler, alongside the ignored/tier branches:
if (typeof body.retired === 'boolean') {
  const ok = await setMaterialRetired(id, body.retired);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```
(Keep it consistent with how the existing branches return.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run <that route's test path>`
Expected: PASS.

- [ ] **Step 6: Add the minimal UI control**

In the materials-manager row (`app/capture/[code]/MaterialsPanel.tsx` — the per-row action cluster), add a small Retire/Restore button mirroring the existing ignore action:
```tsx
<button type="button" onClick={() => patchMaterial(m.id, { retired: !m.retiredAt })}
  className="text-xs text-muted-foreground hover:text-foreground">
  {m.retiredAt ? 'Restore to course' : 'Retire (no longer taught)'}
</button>
```
Thread `retiredAt` onto the panel's material view type if absent (it's already on `CourseMaterialRow`; add `retiredAt: m.retiredAt?.toISOString() ?? null` to the `materialsView` map in `app/capture/[code]/page.tsx` and the `CaptureMaterial` type). Reuse the panel's existing PATCH helper (`patchMaterial`/`fetch`).

- [ ] **Step 7: Typecheck + targeted tests**

Run: `pnpm exec tsc --noEmit && pnpm vitest run app/capture`
Expected: clean + green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(spine): manual retire/restore lever (PATCH + materials-manager control)"
```

---

## Task 12: Cross-course recall eval set

**Files:**
- Create: `lib/capture/__tests__/cross-course-eval.test.ts`

> Measures retrieval recall separately from generation (the spec's eval discipline). Uses the in-memory store seeded with a tiny labeled corpus so it runs in CI without Weaviate; documents how to point it at the live `program` tenant for a real check.

- [ ] **Step 1: Write the eval test**

Create `lib/capture/__tests__/cross-course-eval.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createInMemoryVectorStore, tenantForProgram, type ChunkVectorRecord } from '@/lib/capture/vector-store';
import { diversifyByCourse } from '@/lib/ai/wiki/curriculum-search-tool';

// Tiny labeled corpus: each chunk is a 3-dim "concept" vector. The eval asserts a
// cross-course query retrieves the right courses (recall), and per-course
// diversification surfaces ≥2 distinct courses for a recurring concept.
const v = { color: [1, 0, 0], typography: [0, 1, 0], press: [0, 0, 1] };
function c(id: string, course: string, vec: number[]): ChunkVectorRecord {
  return { id, vector: vec, materialId: id, courseCode: course, fileName: `${id}.pdf`,
    sectionTitle: `${id}.pdf`, sectionIndex: 0, parentSectionId: '', text: id, contextBlurb: '',
    uploadedAt: null, snapshotId: null };
}

describe('cross-course recall eval', () => {
  it('a recurring concept surfaces from multiple courses', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert(tenantForProgram(), [
      c('color-a', 'GC 1000', v.color), c('color-b', 'GC 2000', v.color),
      c('color-c', 'GC 3000', v.color), c('typo-a', 'GC 1000', v.typography),
    ]);
    const raw = await s.hybridSearch(tenantForProgram(), { queryVector: v.color, queryText: 'color management', k: 20 });
    const diversified = diversifyByCourse(raw, 1);
    const courses = new Set(diversified.map(h => h.courseCode));
    expect(courses.size).toBeGreaterThanOrEqual(3);          // recall: all 3 color courses
    expect(diversified.every(h => h.text.startsWith('color'))).toBe(true); // precision: no typography
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run lib/capture/__tests__/cross-course-eval.test.ts`
Expected: PASS.

- [ ] **Step 3: Document the live-corpus check**

At the top of the file, add a comment block: *"For a real recall check, run the admin rebuild, then query the live `program` tenant with `VECTOR_STORE=weaviate` and a handful of known cross-course concepts (e.g. color management, prepress, typography), confirming the expected courses appear. This in-memory test guards the retrieval+diversification logic; the live check guards embedding/recall quality."*

- [ ] **Step 4: Commit**

```bash
git add lib/capture/__tests__/cross-course-eval.test.ts
git commit -m "test(spine): cross-course recall + diversification eval"
```

---

## Task 13: `docs/architecture.html` update (spec §7)

**Files:**
- Modify: `docs/architecture.html` (HTML-only, no `.md` twin)

- [ ] **Step 1: Deepen the storage/retrieval sections**

In the existing *Material storage* / *Vector store* / *Phase A — Material Ingestion* `<h3>` sections, add accurate detail (prose, matching the doc's voice and HTML structure):
- Postgres `course_materials` as source of truth + lifecycle flags (`indexing_status`, `tier`, `ignored`, `auto_set_aside`, **`retired_at`**); everything downstream is a derived projection.
- The ingestion pipeline: FERPA content gate → materials policy → digest → tiered routing (high = full chunk·contextualize·embed; middle = slide-vision / prose-section; background = single digest unit).
- The **chunking method**: 3-level hierarchical — heading-aligned sections + ~500-token detail chunks with 100-token overlap; deterministic UUID ids; contextual-retrieval blurbs prepended before embedding.
- Per-course retrieval: Weaviate `MaterialChunk`/`MaterialSection`, **one tenant per course**, `hybridSearch` (BM25 + vector), parent-section ("small-to-big") enrichment, citation via `fetchChunkById`.

- [ ] **Step 2: Add the curriculum-scale spine section**

Add a new `<h3>` (near the *Snapshots → …* group) titled e.g. "Curriculum-scale retrieval — the cross-course spine":
- The reserved `program` tenant (union of all courses' chunks, reusing the existing class; **chunks only** in v1, so cross-course hits carry no parent-section text).
- Currency contract (`ready ∧ ¬ignored ∧ retired_at IS NULL`, Postgres-derived), provenance stamps, refresh lifecycle (incremental on snapshot, full rebuild on demand).
- `search_curriculum` and its three modes (global / drill-down / per-course-diversified compare).
- The three retrieval layers the curriculum-chat agent composes — *structured* (graph tools over coverage + prereq edges), *synthesis* (wiki prose), *primary-source* (the spine) — and the source-of-truth framing (Postgres authoritative; wiki + spine are projections).
- A one-line forward note: the concept layer (Phase 2) would sit atop the spine; not yet built.

- [ ] **Step 3: Nav/index + sanity**

If the doc has a table of contents / nav list, add an entry for the new section. Open `docs/architecture.html` in a check: `grep -c "<h3" docs/architecture.html` increased by 1; verify no unclosed tags by running `pnpm exec tsc --noEmit` is N/A — instead eyeball the new blocks. (No `.md` twin is created.)

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.html
git commit -m "docs(architecture): document per-course → curriculum-scale storage/retrieval incl. the cross-course spine"
```

---

## Task 14: Full suite, STATE.md reconciliation, finish

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Full test suite + typecheck**

Run: `pnpm vitest run && pnpm exec tsc --noEmit`
Expected: all green, no type errors. Fix any regressions before proceeding.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors in touched files.

- [ ] **Step 3: Update STATE.md**

Move the spine from the Deferred/debt "PROPOSED" entry to reflect IMPLEMENTED status, and update the tracked surfaces:
- **What's live / routes / schema:** new `course_materials.retired_at` (migration 0044); `search_curriculum` tool on `/ask` + Explore Ask + MCP server; `program` Weaviate tenant; `POST /api/admin/program-index/rebuild`; refresh fires on snapshot creation.
- **Deferred / debt:** keep the five deferrals (concept cards; auto-retire + snapshot→material linkage; material-version retention; retire-from-scoring; reranker/router) and add the Phase-1 trim: *program tenant stores chunks only — cross-course hits have no parent-section enrichment yet.*
- Note: requires a **full rebuild** (`POST /api/admin/program-index/rebuild`) once after deploy to backfill the `program` tenant for already-captured courses.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): cross-course evidence spine implemented (Phase 1)"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge/PR. **Deploy note (from STATE.md):** prod runs `next start` on prebuilt `.next/` — the deploy ritual is `merge → cd deploy worktree → pnpm db:migrate (for 0044) → pnpm build → launchctl kickstart`, then run the one-time `POST /api/admin/program-index/rebuild` to backfill, then smoke `search_curriculum` via /ask.

---

## Self-review notes

- **Spec coverage:** storage (T3/T4), currency contract incl. `retired_at` (T1/T2/T5), provenance stamps (T3/T4/T5), incremental + full refresh (T5/T6/T7), `search_curriculum` w/ 3 modes (T8/T9), material-chunk citations (T10), retire lever (T11), eval set (T12), architecture.html (T13). All spec sections map to a task.
- **Deferred items** (concept cards, auto-retire/linkage, version retention, reranker/router) have **no tasks** — correct; they're out of scope.
- **Type consistency:** `tenantForProgram()` → `'coursecapture-program'` used identically in T3/T5/T9/T12; `SearchHit` gains `courseCode`/`uploadedAt`/`snapshotId` in T3 and every later consumer reads them; `ChunkVectorRecord` provenance optional-in / non-null-out is consistent; `refreshProgramIndex(courseCode, {store?, snapshotId?})` signature matches across T5/T6.
- **Known soft spot to verify during execution:** the Weaviate v3 read-back vector accessor (`o.vectors.default`) in T4 Step 5 — confirmed by the T5 Step 7 live smoke (fix the one line if the smoke shows 0 chunks for a course that has them).
