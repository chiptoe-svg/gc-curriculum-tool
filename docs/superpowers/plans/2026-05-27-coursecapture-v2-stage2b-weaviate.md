# CourseCapture v2 — Stage 2b Implementation Plan (Weaviate + Materials UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory `VectorStore` backend with a `WeaviateVectorStore` against the local Weaviate instance, ship the Materials-panel UI surfaces the Stage 2a schema already supports (indexing-status, auto-set-aside, FERPA risk, audit-mode toggle), and add the ingestion check-in AI function + inline panel above the audit chat. Stage 2b is the last Stage-2 task; after this, the audit agent in Stage 3 has real retrieval to call against.

**Architecture:** Stage 2a built the abstraction (`VectorStore` interface at `lib/capture/vector-store.ts` with an in-memory backend) and the data path (`finalizeExtraction` → policy → FERPA → digest → chunk → contextualize → embed → upsert). Stage 2b implements the Weaviate backend behind that interface and lights up the UI states already driven by the Stage 2a columns (`indexing_status`, `auto_set_aside`, `ferpa_risk`, `set_aside_reason`, `indexed_at`). The check-in chat is a thin AI layer on top — given the current materials state, emit either silence or one short panel above the audit chat.

**Tech Stack:** `weaviate-client@^3` (npm) · local Weaviate v1.37.5 on `127.0.0.1:8090` (HTTP) + `127.0.0.1:50051` (gRPC), launchd-managed at `~/Library/LaunchAgents/com.weaviate.plist`, anonymous access · embeddings continue to come from the campus `qwen3-embedding-4b` (2560-dim) — Weaviate's `DEFAULT_VECTORIZER_MODULE=none`, so we provide vectors at write time · TypeScript strict · Vitest · React with existing Materials panel styling.

**Spec adherence notes:**
- Spec specifies the `MaterialChunk` class schema (multi-tenancy enabled, BM25 inverted index, cosine distance). We also need a `MaterialSection` class for the parent-section join the in-memory backend already supports — the spec mentions `parentSectionId` but doesn't draw the section class explicitly. Adding it as an obvious extension of the schema.
- Spec ingestion-checkin module path is `lib/ai/analyze/ingestion-checkin.ts`. We add the function ID `ingestion-checkin` to `lib/ai/function-settings.ts` (light tier).
- Spec calls out the v2 backfill — re-index existing materials when their text changes. We add a one-off admin route `POST /api/admin/v2-backfill` that runs the v2 pipeline on every non-set-aside material for a given course.
- Spec calls out the audit-mode toggle per course (`courses.audit_mode`). The column shipped in Stage 1; Stage 2b lights up the UI control.

**Out of scope (Stage 3+):**
- Audit-chat-agent loop (system prompt is already drafted at `lib/ai/prompts/capture-chat-agent.md` from the nanoclaw negotiation work; wiring is Stage 3).
- Synthesis rewrite (`capture-scores.md` → `capture-synthesis.md` with mechanical source-flag derivation) — Stage 4.
- Migration of existing legacy `captureConversations` rows — Stage 5.

---

## File structure

**Created in this plan:**
- `lib/capture/weaviate-client.ts` — connection wrapper (lazy singleton, env resolution, anonymous-mode client).
- `lib/capture/weaviate-schema.ts` — `MaterialChunk` + `MaterialSection` class definitions, idempotent bootstrap, tenant-ensure helper.
- `lib/capture/vector-store-weaviate.ts` — `WeaviateVectorStore` implementing the existing `VectorStore` interface.
- `lib/ai/analyze/ingestion-checkin.ts` — light-tier AI helper that emits either `null` (silence) or a structured check-in message.
- `lib/ai/prompts/ingestion-checkin.md` — system prompt.
- `app/api/admin/v2-backfill/route.ts` — admin endpoint to re-index existing materials.
- `app/capture/[code]/IngestionCheckIn.tsx` — inline panel above the audit chat.
- `tests/lib/capture/weaviate-schema.test.ts`
- `tests/lib/capture/vector-store-weaviate.test.ts`
- `tests/ai/analyze/ingestion-checkin.test.ts`
- `scripts/_one-off/stage2b-smoke.ts` — end-to-end against the live Weaviate.

**Modified in this plan:**
- `package.json` — add `weaviate-client` dep.
- `lib/capture/vector-store.ts` — add `createVectorStore()` factory that picks backend by env; the existing `createInMemoryVectorStore` and types stay.
- `lib/capture/finalize-extraction.ts` — replace the explicit `createInMemoryVectorStore()` constructor in callers with `createVectorStore()` (or pass-through unchanged if callers already inject).
- `lib/ai/function-settings.ts` — add `'ingestion-checkin'` function ID (light tier).
- `lib/ai/prompts/load.ts` — add `'ingestion-checkin'` to `PromptName` union.
- `app/capture/[code]/MaterialsPanel.tsx` — indexing-status dots, auto-set-aside pills, override click, FERPA pills, audit-mode toggle.
- `app/api/courses/[code]/materials/[id]/route.ts` — accept `autoSetAside` + `ferpaRisk` field overrides (faculty override flow).
- `lib/db/course-materials-queries.ts` — read functions for the new columns when serving Materials panel data.
- `.env.example` — add `VECTOR_STORE=weaviate|in-memory` switch.
- `docs/STATE.md` — flip Stage 2b status to shipped.

---

## Task list

### Task 1: Weaviate client wrapper

**Files:**
- Create: `lib/capture/weaviate-client.ts`
- Modify: `package.json` (add `weaviate-client` dep)

**Spec section:** Phase A — Vector store.

- [ ] **Step 1: Install the npm client**

Run: `pnpm add weaviate-client`
Expected: package.json gets `weaviate-client@^3.x` (or whichever current major). Check `node_modules/weaviate-client/package.json` for the resolved version.

- [ ] **Step 2: Implement the connection module**

```ts
// lib/capture/weaviate-client.ts
import weaviate, { type WeaviateClient } from 'weaviate-client';

let client: WeaviateClient | null = null;

export async function getWeaviateClient(): Promise<WeaviateClient> {
  if (client) return client;
  const httpUrl = process.env.WEAVIATE_URL?.trim();
  if (!httpUrl) throw new Error('WEAVIATE_URL not set');
  const url = new URL(httpUrl);
  const grpcUrl = process.env.WEAVIATE_GRPC_URL?.trim() ?? '127.0.0.1:50051';
  const [grpcHost, grpcPortStr] = grpcUrl.split(':');
  const apiKey = process.env.WEAVIATE_API_KEY?.trim();

  client = await weaviate.connectToCustom({
    httpHost: url.hostname,
    httpPort: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    httpSecure: url.protocol === 'https:',
    grpcHost: grpcHost ?? '127.0.0.1',
    grpcPort: Number(grpcPortStr ?? '50051'),
    grpcSecure: false,
    ...(apiKey ? { authCredentials: new weaviate.ApiKey(apiKey) } : {}),
  });
  return client;
}

export async function closeWeaviateClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
```

- [ ] **Step 3: Smoke-test the connection**

Run: `npx tsx --env-file=.env.local -e "import { getWeaviateClient } from '@/lib/capture/weaviate-client'; (async () => { const c = await getWeaviateClient(); const meta = await c.getMeta(); console.log('OK:', meta.version); })().catch(e => { console.error(e); process.exit(1); });"`
Expected: prints `OK: 1.37.5`.

- [ ] **Step 4: Commit**

```
git add lib/capture/weaviate-client.ts package.json pnpm-lock.yaml
git commit -m "feat(capture): add Weaviate client wrapper for Stage 2b"
```

---

### Task 2: Schema bootstrap (MaterialChunk + MaterialSection classes)

**Files:**
- Create: `lib/capture/weaviate-schema.ts`
- Create: `tests/lib/capture/weaviate-schema.test.ts`

**Spec section:** Phase A — Vector store (the `MaterialChunkClass` snippet).

- [ ] **Step 1: Define the schema module**

```ts
// lib/capture/weaviate-schema.ts
import { getWeaviateClient } from './weaviate-client';

export const MATERIAL_CHUNK_CLASS = 'MaterialChunk';
export const MATERIAL_SECTION_CLASS = 'MaterialSection';

const chunkProps = [
  { name: 'materialId', dataType: 'text' as const },
  { name: 'courseCode', dataType: 'text' as const },
  { name: 'fileName', dataType: 'text' as const },
  { name: 'sectionTitle', dataType: 'text' as const },
  { name: 'sectionIndex', dataType: 'int' as const },
  { name: 'parentSectionId', dataType: 'text' as const },
  { name: 'text', dataType: 'text' as const, indexFilterable: true, indexSearchable: true },
  { name: 'contextBlurb', dataType: 'text' as const, indexSearchable: true },
];

const sectionProps = [
  { name: 'materialId', dataType: 'text' as const },
  { name: 'title', dataType: 'text' as const },
  { name: 'index', dataType: 'int' as const },
  { name: 'text', dataType: 'text' as const },
];

export async function ensureSchema(): Promise<void> {
  const client = await getWeaviateClient();
  const existing = await client.collections.listAll();
  const names = new Set(existing.map(c => c.name));

  if (!names.has(MATERIAL_CHUNK_CLASS)) {
    await client.collections.create({
      name: MATERIAL_CHUNK_CLASS,
      multiTenancy: { enabled: true, autoTenantCreation: true },
      vectorizers: weaviate.configure.vectorizer.none(),
      properties: chunkProps,
    });
  }
  if (!names.has(MATERIAL_SECTION_CLASS)) {
    await client.collections.create({
      name: MATERIAL_SECTION_CLASS,
      multiTenancy: { enabled: true, autoTenantCreation: true },
      vectorizers: weaviate.configure.vectorizer.none(),
      properties: sectionProps,
    });
  }
}

export async function ensureTenant(tenant: string): Promise<void> {
  // With autoTenantCreation enabled, this is a no-op when the tenant
  // doesn't yet exist — Weaviate creates it on first write. Kept as a
  // helper for explicit pre-warming.
  const client = await getWeaviateClient();
  for (const cls of [MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS]) {
    const col = client.collections.use(cls);
    const tenants = await col.tenants.get();
    if (!tenants[tenant]) {
      await col.tenants.create([{ name: tenant }]);
    }
  }
}
```

Note: import `weaviate` at the top to use `weaviate.configure.vectorizer.none()`.

- [ ] **Step 2: Write tests (mocking the client)**

`tests/lib/capture/weaviate-schema.test.ts` — mock `getWeaviateClient` to return a stub that records `collections.listAll`, `collections.create`, and `collections.use(...).tenants.create()` calls. Assertions:
1. `ensureSchema()` creates both classes when neither exists.
2. `ensureSchema()` is idempotent — second call creates neither.
3. `ensureSchema()` creates only the missing class when one already exists.
4. `ensureTenant(name)` calls `tenants.create` exactly once on each class when the tenant is absent.
5. `ensureTenant(name)` is a no-op when the tenant already exists.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/lib/capture/weaviate-schema.test.ts`

- [ ] **Step 4: Live bootstrap smoke**

Run from project root: `npx tsx --env-file=.env.local -e "import { ensureSchema } from '@/lib/capture/weaviate-schema'; ensureSchema().then(() => console.log('OK'));"`
Then verify: `curl -s http://127.0.0.1:8090/v1/schema | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['class'] for c in d['classes']])"` → should include `MaterialChunk` and `MaterialSection`.

- [ ] **Step 5: Commit**

```
git add lib/capture/weaviate-schema.ts tests/lib/capture/weaviate-schema.test.ts
git commit -m "feat(capture): Weaviate schema bootstrap (MaterialChunk + MaterialSection)"
```

---

### Task 3: WeaviateVectorStore

**Files:**
- Create: `lib/capture/vector-store-weaviate.ts`
- Create: `tests/lib/capture/vector-store-weaviate.test.ts`

**Spec section:** Phase A — Vector store (hybrid query is built into Weaviate; no fusion logic on our side).

- [ ] **Step 1: Implement the store**

```ts
// lib/capture/vector-store-weaviate.ts
import { getWeaviateClient } from './weaviate-client';
import { ensureSchema, ensureTenant, MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS } from './weaviate-schema';
import type { VectorStore, ChunkVectorRecord, SectionRecord, SearchInput, SearchHit } from './vector-store';

let schemaReady: Promise<void> | null = null;
const ensureSchemaOnce = () => (schemaReady ??= ensureSchema());

export function createWeaviateVectorStore(): VectorStore {
  return {
    async upsert(tenant, records) {
      await ensureSchemaOnce();
      await ensureTenant(tenant);
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      const batch = records.map(r => ({
        id: r.id,
        vector: r.vector,
        properties: {
          materialId: r.materialId,
          courseCode: r.courseCode,
          fileName: r.fileName,
          sectionTitle: r.sectionTitle,
          sectionIndex: r.sectionIndex,
          parentSectionId: r.parentSectionId,
          text: r.text,
          contextBlurb: r.contextBlurb,
        },
      }));
      await col.data.insertMany(batch);
    },

    async upsertSections(tenant, sections) {
      await ensureSchemaOnce();
      await ensureTenant(tenant);
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_SECTION_CLASS).withTenant(tenant);
      const batch = sections.map(s => ({
        id: s.id,
        properties: {
          materialId: s.materialId,
          title: s.title,
          index: s.index,
          text: s.text,
        },
      }));
      await col.data.insertMany(batch);
    },

    async deleteByMaterial(tenant, materialId) {
      const client = await getWeaviateClient();
      for (const cls of [MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS]) {
        const col = client.collections.use(cls).withTenant(tenant);
        await col.data.deleteMany(col.filter.byProperty('materialId').equal(materialId));
      }
    },

    async hybridSearch(tenant, input): Promise<SearchHit[]> {
      const client = await getWeaviateClient();
      const chunks = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      const filter = input.materialId
        ? chunks.filter.byProperty('materialId').equal(input.materialId)
        : undefined;
      const result = await chunks.query.hybrid(input.queryText, {
        vector: input.queryVector,
        limit: input.k,
        filters: filter,
        returnMetadata: ['score', 'distance'],
        returnProperties: ['materialId', 'courseCode', 'fileName', 'sectionTitle', 'sectionIndex', 'parentSectionId', 'text', 'contextBlurb'],
      });

      const sections = client.collections.use(MATERIAL_SECTION_CLASS).withTenant(tenant);
      const parentIds = Array.from(new Set(result.objects.map(o => String(o.properties.parentSectionId)).filter(Boolean)));
      const parentTextById = new Map<string, string>();
      if (parentIds.length) {
        const parents = await sections.query.fetchObjectsByIds(parentIds, {
          returnProperties: ['text'],
        });
        for (const p of parents.objects) parentTextById.set(p.uuid, String(p.properties.text));
      }

      return result.objects.map(o => ({
        id: o.uuid,
        materialId: String(o.properties.materialId),
        fileName: String(o.properties.fileName),
        sectionTitle: String(o.properties.sectionTitle),
        sectionIndex: Number(o.properties.sectionIndex),
        text: String(o.properties.text),
        parentSectionId: String(o.properties.parentSectionId),
        parentSectionText: parentTextById.get(String(o.properties.parentSectionId)) ?? null,
        contextBlurb: String(o.properties.contextBlurb),
        score: Number(o.metadata?.score ?? 0),
      }));
    },
  };
}
```

(Cast types as needed for the SDK; the SDK's `hybrid` signature has shifted between minor versions, so verify against the installed version's `.d.ts`.)

- [ ] **Step 2: Write tests**

`tests/lib/capture/vector-store-weaviate.test.ts` — mock `getWeaviateClient` with a stub that records `insertMany`, `deleteMany`, `query.hybrid`, `query.fetchObjectsByIds`. Assertions:
1. `upsert` calls `collections.use(MaterialChunk).withTenant(t).data.insertMany` with the records mapped to `{ id, vector, properties }` shape.
2. `upsert` calls `ensureSchema` and `ensureTenant` exactly once each on first call; not again on subsequent calls within the same process.
3. `upsertSections` writes to `MaterialSection` with the section properties.
4. `deleteByMaterial` calls `deleteMany` on both classes with the materialId filter.
5. `hybridSearch` calls `query.hybrid` with the right `vector`, `queryText`, `limit`, optional `materialId` filter.
6. `hybridSearch` joins parent-section text into the returned hits.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/lib/capture/vector-store-weaviate.test.ts`

- [ ] **Step 4: Commit**

```
git add lib/capture/vector-store-weaviate.ts tests/lib/capture/vector-store-weaviate.test.ts
git commit -m "feat(capture): add WeaviateVectorStore implementing the VectorStore interface"
```

---

### Task 4: Backend selector + wiring into finalizeExtraction

**Files:**
- Modify: `lib/capture/vector-store.ts` — add `createVectorStore()` factory
- Modify: `lib/capture/finalize-extraction.ts` — call sites that build the store
- Modify: `.env.example` — document `VECTOR_STORE`

- [ ] **Step 1: Add the factory**

Append to `lib/capture/vector-store.ts`:

```ts
import { createWeaviateVectorStore } from './vector-store-weaviate';

export function createVectorStore(): VectorStore {
  const which = process.env.VECTOR_STORE?.trim() || 'in-memory';
  if (which === 'weaviate') return createWeaviateVectorStore();
  if (which === 'in-memory') return createInMemoryVectorStore();
  throw new Error(`Unknown VECTOR_STORE: ${which}`);
}
```

- [ ] **Step 2: Update `finalizeExtraction` callers**

`finalizeExtraction` already takes an injected `vectorStore?: VectorStore`. The 4 route-handler callers in `app/api/courses/[code]/canvas-import/route.ts`, `canvas-reextract/route.ts`, `materials/route.ts`, `scan-linked-docs/route.ts` either don't pass it (use no store) or pass an in-memory one. Update each to call `createVectorStore()` when `process.env.COURSECAPTURE_V2_INGESTION === '1'` and pass that.

- [ ] **Step 3: Document the flag**

Edit `.env.example`, near the existing v2-ingestion block:

```
# Vector store backend for the v2 ingestion pipeline. 'in-memory' (default)
# uses the test/dev backend that does not persist across process restarts;
# 'weaviate' uses the local Weaviate instance (must be running — see
# ~/.dev-ports.yaml weaviate entry for setup).
VECTOR_STORE=
```

- [ ] **Step 4: Re-run all existing tests**

Run: `pnpm vitest run`
Expected: nothing regresses. Existing tests that mock the store still pass.

- [ ] **Step 5: Commit**

```
git add lib/capture/vector-store.ts lib/capture/finalize-extraction.ts app/api/courses/ .env.example
git commit -m "feat(capture): vector-store backend selector + Weaviate wiring"
```

---

### Task 5: Live integration smoke against Weaviate

**Files:**
- Create: `scripts/_one-off/stage2b-smoke.ts`

A tsx-runnable script that exercises the full v2 pipeline against the real Weaviate instance: ingest one fixture material into a test tenant, run a hybrid search, verify hits, delete the tenant. No DB writes. Mirrors Stage 2a's smoke but swaps in the Weaviate backend.

- [ ] **Step 1: Write the smoke script**

The script:
1. Loads the Stage 2a fixture (`# Chapter 4 — Color Reproduction` etc.) or a slightly larger variant.
2. Runs policy + FERPA + digest + chunk + contextualize + embed (Stage 2a modules, unchanged).
3. Constructs a `WeaviateVectorStore` and writes sections + chunks to a test tenant (`test-stage2b-smoke-<timestamp>`).
4. Embeds a query and calls `hybridSearch` with `k=3`; prints the hits with scores, section title, parent text presence.
5. Calls `deleteByMaterial` and re-runs the search to confirm the records are gone.
6. Cleans up the test tenant via the Weaviate REST API (`DELETE /v1/schema/MaterialChunk/tenants/<name>`).

- [ ] **Step 2: Run the smoke**

Run: `VECTOR_STORE=weaviate AI_PROVIDER=campus npx tsx --env-file=.env.local scripts/_one-off/stage2b-smoke.ts`
Expected: same pipeline output as the Stage 2a smoke + Weaviate write/search/delete round-trip; top hit is the press-calibration chunk; parent section text present in the result.

- [ ] **Step 3: Commit**

```
git add -f scripts/_one-off/stage2b-smoke.ts
# (scripts/_one-off is .gitignored; -f is intentional only if we choose to track this smoke. Prefer NOT tracking — same convention as Stage 2a.)
```

Actually: per the Stage 2a precedent, smoke scripts in `scripts/_one-off/` are NOT tracked. Do not run `git add -f`. Just confirm the script works locally and leave it untracked. No commit step for this task.

---

### Task 6: Materials panel UI — indexing status + FERPA + auto-set-aside + override

**Files:**
- Modify: `app/capture/[code]/MaterialsPanel.tsx`
- Modify: `app/api/courses/[code]/materials/[id]/route.ts` — accept faculty-override PATCH for `autoSetAside` (sets `ignored=false`) and possibly `ferpaRisk` reclassification.
- Modify: `lib/db/course-materials-queries.ts` — `listMaterialsForCourse` returns the new columns.

**Spec section:** Faculty UX — Materials panel.

- [ ] **Step 1: Extend the queries**

In `lib/db/course-materials-queries.ts`, ensure `listMaterialsForCourse` (or equivalent) selects `indexingStatus`, `indexedAt`, `ferpaRisk`, `autoSetAside`, `setAsideReason`. Update the returned `MaterialRow` type accordingly.

- [ ] **Step 2: UI states in `MaterialsPanel.tsx`**

For each material row, render:

- **Indexing status dot.** Small colored circle: pending = gray, indexing = amber (pulsing), ready = green, failed = red, skipped = soft-gray with strike-through. Tooltip on hover names the state plus `indexedAt` if set.
- **Auto-set-aside pill.** When `autoSetAside` is true: render a soft-pill below the row's filename ("Sheets has LOs — set aside" / "Empty or malformed import — set aside" / "Contains student posts — set aside FERPA") with an inline "Include anyway" link. Click POSTs `{ autoSetAside: true, ignored: false }` to `/api/courses/[code]/materials/[id]` (preserves the policy decision; flips the operational flag).
- **FERPA risk pill.** When `ferpaRisk !== 'low'`: amber pill ("Student names detected — FERPA review"). Click opens an inline confirm widget that lets faculty downgrade to `low` (false positive) or keep the flag.
- **Audit-mode toggle (course-level).** Header chip near the panel title: `Audit mode: Full ▾` with dropdown to `Simple`. PATCH `/api/courses/[code]` with `{ auditMode: 'simple' }`. One-sentence tooltip: "Simple mode skips chunk indexing for this course; the agent runs against digests inline. Switch to Full to enable retrieval."

Visual: keep all styling lightweight — these are silent defaults faculty can override; not modal.

- [ ] **Step 3: Override PATCH endpoint**

`PATCH /api/courses/[code]/materials/[id]` already exists for `useDigest` toggle. Extend it to accept optional `autoSetAside`, `ignored`, `ferpaRisk` fields. Validation: the policy module is the only thing that should set `autoSetAside=true`; faculty can only flip `ignored` and `ferpaRisk`. The PATCH handler enforces this.

- [ ] **Step 4: Manual UI smoke**

Set `COURSECAPTURE_V2_INGESTION=1` + `VECTOR_STORE=weaviate`. Re-extract one material on GC 4800 with `Canvas: Discussions` in the name. Verify the row gets FERPA-high + auto-set-aside pills. Click "Include anyway"; verify the row un-strikes and the audit prompt sees it again.

- [ ] **Step 5: Commit**

```
git add app/capture/[code]/MaterialsPanel.tsx app/api/courses/[code]/materials/ lib/db/course-materials-queries.ts
git commit -m "feat(capture): Materials panel — indexing-status / FERPA / auto-set-aside / audit-mode UI"
```

---

### Task 7: Ingestion check-in AI function

**Files:**
- Create: `lib/ai/prompts/ingestion-checkin.md`
- Create: `lib/ai/analyze/ingestion-checkin.ts`
- Modify: `lib/ai/function-settings.ts` — add `'ingestion-checkin'` (light tier)
- Modify: `lib/ai/prompts/load.ts` — add to `PromptName` union
- Create: `tests/ai/analyze/ingestion-checkin.test.ts`

**Spec section:** Phase A — Ingestion check-in chat.

- [ ] **Step 1: Write the prompt**

`lib/ai/prompts/ingestion-checkin.md`:
- Frontmatter `name: ingestion-checkin`, `manning_skills: [instructional-design, structured-output]`.
- Body: instructs the model that it receives `{ catalog, materials: [{ fileName, ferpaRisk, autoSetAside, setAsideReason, digestSnippet }] }` and emits either `null` (silence) or `{ message: '<short prose>', highlights: [{ kind: 'missing' | 'set-aside' | 'ferpa', text: '<≤120 char detail>' }] }`. Default behavior is silence. Only speak when:
  - A core source is missing (e.g., no syllabus, no rubrics for major assignments, no Canvas import attempt yet).
  - A material was auto-set-aside in a way the instructor should know about specifically (more than one in a row, or a high-FERPA-risk material).
  - Two-or-more digests look near-empty (extraction may have failed).
- Tone: short and matter-of-fact. ≤ 2 sentences in the visible message. ≤ 3 highlights.

- [ ] **Step 2: Implement the analyzer**

`lib/ai/analyze/ingestion-checkin.ts`:

```ts
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

export interface CheckInInput {
  catalog: { code: string; title: string; learningObjectives: string[]; majorProjects: string[] };
  materials: Array<{
    fileName: string;
    ferpaRisk: 'low' | 'medium' | 'high';
    autoSetAside: boolean;
    setAsideReason: string | null;
    digestSnippet: string;
  }>;
}

export interface CheckInResult {
  message: string | null;
  highlights: Array<{ kind: 'missing' | 'set-aside' | 'ferpa'; text: string }>;
  model: string;
}

export async function generateIngestionCheckIn(input: CheckInInput): Promise<CheckInResult> {
  const provider = await getProviderForFunction('ingestion-checkin');
  const systemPrompt = await loadPrompt('ingestion-checkin');

  const jsonSchema = {
    type: 'object',
    properties: {
      message: { type: ['string', 'null'] },
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { enum: ['missing', 'set-aside', 'ferpa'] },
            text: { type: 'string' },
          },
          required: ['kind', 'text'],
        },
      },
    },
    required: ['message', 'highlights'],
  };

  const userMessage = JSON.stringify(input);
  const { data } = await provider.complete<{ message: string | null; highlights: CheckInResult['highlights'] }>({
    systemPrompt,
    userMessage,
    schemaName: 'ingestion_checkin',
    jsonSchema,
    validate: (raw) => raw as { message: string | null; highlights: CheckInResult['highlights'] },
  });

  return { message: data.message, highlights: data.highlights ?? [], model: provider.model };
}
```

- [ ] **Step 3: Add to function-settings + load.ts**

Same shape as Stage 2a Tasks 6 and 7 — append `'ingestion-checkin'` to `AI_FUNCTION_IDS`, `DEFAULT_TIERS` (`'light'`), `FUNCTION_LABELS`, `FUNCTION_DESCRIPTIONS`, and the `PromptName` union.

- [ ] **Step 4: Test**

`tests/ai/analyze/ingestion-checkin.test.ts` — mock `getProviderForFunction`; assertions:
1. Returns `{ message: null, highlights: [], model }` when the stub returns null message.
2. Returns the model's structured output when populated.
3. Passes catalog + materials in the user message.

- [ ] **Step 5: Commit**

```
git add lib/ai/analyze/ingestion-checkin.ts lib/ai/prompts/ingestion-checkin.md lib/ai/function-settings.ts lib/ai/prompts/load.ts tests/ai/analyze/ingestion-checkin.test.ts
git commit -m "feat(ai): add ingestion-checkin AI function for v2 materials curation review"
```

---

### Task 8: Ingestion check-in panel above the audit chat

**Files:**
- Create: `app/capture/[code]/IngestionCheckIn.tsx`
- Modify: `app/capture/[code]/page.tsx` — render the panel above the audit chat
- Create or extend: `app/api/courses/[code]/checkin/route.ts` — GET fetches the check-in result; POST `{ action: 'dismiss' | 'proceed' }` records faculty acknowledgment.

**Spec section:** Phase A — Ingestion check-in chat (UI surface).

- [ ] **Step 1: Implement the panel component**

The component:
- Fetches `/api/courses/[code]/checkin` on mount; renders nothing while loading.
- Renders a single inline panel above the audit chat **only when** the GET response includes a non-null `message` AND the faculty hasn't dismissed it for this session.
- Shows the message + up to 3 highlights (icon per `kind`).
- Has two actions: "Drop a file" (opens the existing materials uploader scoped to this course) and "Proceed to audit" (dismisses the panel and scrolls to the audit chat).

- [ ] **Step 2: Route handler**

`GET /api/courses/[code]/checkin` runs `generateIngestionCheckIn` against the current course catalog + materials state, returns the result. Optionally caches per-session (Redis or just `course_capture_session_state` table if it exists; otherwise no cache, the call is light-tier and cheap).

`POST /api/courses/[code]/checkin` accepts `{ action: 'dismiss' }` — for now, just returns OK; persistence of dismissal is optional (the panel can dismiss client-side via React state).

- [ ] **Step 3: Wire into the capture page**

Render `<IngestionCheckIn courseCode={code} />` above `<CaptureChat ... />` in `app/capture/[code]/page.tsx`.

- [ ] **Step 4: Manual UI smoke**

Open `/capture/GC 4800` with v2 ingestion on. Verify either:
- The panel is silent (most cases), OR
- A short message + highlights appear when the AI flags something specific.

- [ ] **Step 5: Commit**

```
git add app/capture/[code]/IngestionCheckIn.tsx app/capture/[code]/page.tsx app/api/courses/[code]/checkin/
git commit -m "feat(capture): ingestion check-in inline panel above the audit chat"
```

---

### Task 9: Backfill route — re-index all materials for a course

**Files:**
- Create: `app/api/admin/v2-backfill/route.ts`
- Optional: small admin-UI button on `/admin` to trigger.

The backfill route accepts `POST { courseCode: string }` and re-runs the v2 ingestion path on every non-set-aside material for that course. Uses the same `finalizeExtraction({ vectorStore: createVectorStore(), ... })` call shape that materials uploads use. Idempotent — `vectorStore.deleteByMaterial` is called before re-upserting per material.

- [ ] **Step 1: Implement the route**

```ts
// app/api/admin/v2-backfill/route.ts
import { db } from '@/lib/db/client';
import { courseMaterials, courses } from '@/lib/db/schema';
import { eq, and, not } from 'drizzle-orm';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';

export async function POST(req: Request) {
  // Existing FACULTY_BASIC_AUTH gate already wraps /api/admin/* via middleware.
  const body = await req.json().catch(() => ({}));
  const courseCode = String(body.courseCode ?? '');
  if (!courseCode) return new Response('courseCode required', { status: 400 });

  const [course] = await db.select().from(courses).where(eq(courses.code, courseCode)).limit(1);
  if (!course) return new Response('course not found', { status: 404 });

  const materials = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), not(eq(courseMaterials.ignored, true))));

  const vectorStore = createVectorStore();
  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const m of materials) {
    if (m.extractionStatus !== 'ok' || !m.extractedText) {
      results.push({ id: m.id, status: 'skipped' });
      continue;
    }
    try {
      await finalizeExtraction({
        id: m.id,
        courseCode,
        fileName: m.fileName,
        extractionStatus: 'ok',
        extractedText: m.extractedText,
        vectorStore,
        courseHasLearningObjectives: (course.learningObjectives ?? []).length > 0,
      });
      results.push({ id: m.id, status: 'ok' });
    } catch (e) {
      results.push({ id: m.id, status: 'failed', error: String(e) });
    }
  }
  return Response.json({ courseCode, count: results.length, results });
}
```

(Make sure `COURSECAPTURE_V2_INGESTION` is set in env, or the legacy path runs instead.)

- [ ] **Step 2: Manual smoke**

```
curl -X POST -H "Content-Type: application/json" -d '{"courseCode":"GC 4800"}' http://127.0.0.1:3000/api/admin/v2-backfill
```
Expected: results array; each material's `indexing_status` flips to `'ready'` (or `'failed'` on errors) in the DB.

- [ ] **Step 3: Commit**

```
git add app/api/admin/v2-backfill/route.ts
git commit -m "feat(capture): admin v2-backfill route to re-index existing materials"
```

---

### Task 10: STATE.md + cleanup commit

- [ ] **Step 1: Update STATE.md**

Flip Stage 2b status to shipped:

```diff
- Stage 2b (Weaviate adapter + Materials UI + check-in chat) pending local Weaviate instance.
+ Stage 2b shipped 2026-05-27: WeaviateVectorStore against the local Weaviate v1.37.5 (per-course tenants, hybrid search, parent-section join), Materials panel UI (indexing-status dots, FERPA pills, auto-set-aside pills with override, audit-mode toggle), and the ingestion-checkin AI function + inline panel above the audit chat.
```

Add the new function IDs (`ingestion-checkin`) and the new `VECTOR_STORE` env var to the relevant lists.

- [ ] **Step 2: Final commit**

```
git add docs/STATE.md
git commit -m "chore(capture): STATE.md — Stage 2b shipped (Weaviate + Materials UI + check-in)"
```

---

## Acceptance criteria

After all tasks complete:

1. `pnpm vitest run` is green.
2. `pnpm tsc --noEmit` is green for everything under `lib/`, `app/`, `components/`, `tests/`.
3. `scripts/_one-off/stage2b-smoke.ts` runs to completion against the live Weaviate instance: ingests one fixture material, runs hybrid search with a top hit that's contextually relevant, deletes the tenant, prints success.
4. With `COURSECAPTURE_V2_INGESTION=1` + `VECTOR_STORE=weaviate`: a freshly extracted material gets indexed in Weaviate under the right tenant, the Materials panel renders its indexing status / FERPA risk / auto-set-aside pill correctly, and the audit chat can call `search_materials` against the indexed corpus.
5. The `/api/admin/v2-backfill` route, when posted with a course code, re-indexes every non-set-aside material and flips their `indexing_status` to `'ready'` (or `'failed'` with an error logged).
6. The ingestion check-in panel renders either silent or a short message above the audit chat when the AI flags something specific; faculty can dismiss it and proceed.
7. STATE.md reflects Stage 2b shipped.

## Out of scope (Stage 3+)

- Audit-chat-agent loop (wires the existing `lib/ai/prompts/capture-chat-agent.md` system prompt into a new function that calls `completeWithTools` against the Weaviate-backed retrieval).
- Synthesis rewrite (`capture-synthesis.md` with mechanical source-flag derivation).
- Migration of existing legacy `captureConversations` rows into `capture_messages` with synthesized session IDs.
- CareerCapture (industry partner side) — separate spec.
