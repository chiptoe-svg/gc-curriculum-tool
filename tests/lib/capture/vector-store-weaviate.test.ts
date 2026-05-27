/**
 * Unit tests for WeaviateVectorStore.
 *
 * All Weaviate I/O is mocked — no live server required.
 * The mock client tracks calls to insertMany, deleteMany, query.hybrid,
 * and query.fetchObjectById so tests can assert call shape + args.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChunkVectorRecord, SectionRecord } from '@/lib/capture/vector-store';

// ---------------------------------------------------------------------------
// Mock weaviate-schema
// ---------------------------------------------------------------------------
const mockEnsureSchema = vi.fn().mockResolvedValue(undefined);
const mockEnsureTenant = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/capture/weaviate-schema', () => ({
  ensureSchema: () => mockEnsureSchema(),
  ensureTenant: (t: string) => mockEnsureTenant(t),
  MATERIAL_CHUNK_CLASS: 'MaterialChunk',
  MATERIAL_SECTION_CLASS: 'MaterialSection',
}));

// ---------------------------------------------------------------------------
// Mock weaviate-client
// ---------------------------------------------------------------------------

// We track calls per collection×tenant so we can inspect them.
const mockInsertMany = vi.fn().mockResolvedValue({ errors: {} });
const mockDeleteMany = vi.fn().mockResolvedValue({ successful: 0, failed: 0, matches: 0 });
const mockHybridQuery = vi.fn();
const mockFetchObjectById = vi.fn();

/** Builds a minimal filter value — shape mirrors what the real SDK produces */
const makeFilter = (property: string, value: unknown) => ({
  operator: 'Equal' as const,
  target: { property },
  value,
});

/**
 * The mock collection returned by .use(cls).withTenant(tenant).
 * `filter.byProperty` is synchronous and returns a FilterByProperty-like object.
 */
function makeMockCol(cls: string, tenant: string) {
  return {
    _cls: cls,
    _tenant: tenant,
    data: {
      insertMany: mockInsertMany,
      deleteMany: mockDeleteMany,
    },
    query: {
      hybrid: mockHybridQuery,
      fetchObjectById: mockFetchObjectById,
    },
    filter: {
      byProperty: (name: string) => ({
        equal: (value: unknown) => makeFilter(name, value),
      }),
    },
  };
}

// Collections tracking which (cls, tenant) pair was accessed last — lets us
// verify withTenant was called with the right argument.
const lastAccess: { cls?: string; tenant?: string } = {};

vi.mock('@/lib/capture/weaviate-client', () => ({
  getWeaviateClient: vi.fn().mockResolvedValue({
    collections: {
      use: (cls: string) => ({
        withTenant: (tenant: string) => {
          lastAccess.cls = cls;
          lastAccess.tenant = tenant;
          return makeMockCol(cls, tenant);
        },
      }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Import SUT *after* mocks are established
// ---------------------------------------------------------------------------
import { createWeaviateVectorStore } from '@/lib/capture/vector-store-weaviate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(id: string, overrides: Partial<ChunkVectorRecord> = {}): ChunkVectorRecord {
  return {
    id,
    vector: [0.1, 0.2, 0.3],
    materialId: 'mat-1',
    courseCode: 'GC 4800',
    fileName: 'slides.pdf',
    sectionTitle: 'Intro',
    sectionIndex: 0,
    parentSectionId: 'sec-1',
    text: 'hello world',
    contextBlurb: 'context blurb',
    ...overrides,
  };
}

function makeSection(id: string, overrides: Partial<SectionRecord> = {}): SectionRecord {
  return {
    id,
    materialId: 'mat-1',
    title: 'Intro',
    index: 0,
    text: 'section text',
    ...overrides,
  };
}

/** Build a fake WeaviateObject as hybrid query returns */
function makeHybridHit(
  uuid: string,
  properties: Record<string, unknown>,
  score = 0.75,
) {
  return {
    uuid,
    properties,
    metadata: { score },
    references: undefined,
    vectors: {},
  };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

// We also need to reset the module-level lazy singletons so each test
// starts fresh. Because vi.mock hoists, we reset by importing the module
// fresh — but that's complex. Instead we rely on the fact that vitest
// isolates modules per file by default.  For the lazy singletons (schemaReady,
// seenTenants) we use vi.resetModules() + dynamic import in each test group
// that cares about call-once semantics.

beforeEach(() => {
  vi.clearAllMocks();
  // Default hybrid result: empty
  mockHybridQuery.mockResolvedValue({ objects: [] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WeaviateVectorStore', () => {
  describe('upsert', () => {
    it('calls insertMany on MaterialChunk with the right tenant and mapped records', async () => {
      const store = createWeaviateVectorStore();
      const chunk = makeChunk('c1');
      await store.upsert('tenant-a', [chunk]);

      expect(mockInsertMany).toHaveBeenCalledOnce();
      const [items] = mockInsertMany.mock.calls[0] as [unknown[]];
      expect(items).toHaveLength(1);
      const item = items[0] as Record<string, unknown>;
      expect(item['id']).toBe('c1');
      // v3 uses `vectors` (plural), not `vector`
      expect(item['vectors']).toEqual([0.1, 0.2, 0.3]);
      expect((item['properties'] as Record<string, unknown>)['materialId']).toBe('mat-1');
      expect((item['properties'] as Record<string, unknown>)['sectionIndex']).toBe(0);
    });

    it('no-ops when records array is empty — no client call', async () => {
      const store = createWeaviateVectorStore();
      await store.upsert('tenant-a', []);
      expect(mockInsertMany).not.toHaveBeenCalled();
    });

    it('passes the right tenant to withTenant', async () => {
      const store = createWeaviateVectorStore();
      await store.upsert('my-tenant', [makeChunk('x')]);
      expect(lastAccess.tenant).toBe('my-tenant');
      expect(lastAccess.cls).toBe('MaterialChunk');
    });
  });

  describe('upsertSections', () => {
    it('calls insertMany on MaterialSection with section properties (no vectors field)', async () => {
      const store = createWeaviateVectorStore();
      const section = makeSection('s1');
      await store.upsertSections('tenant-a', [section]);

      expect(mockInsertMany).toHaveBeenCalledOnce();
      const [items] = mockInsertMany.mock.calls[0] as [unknown[]];
      expect(items).toHaveLength(1);
      const item = items[0] as Record<string, unknown>;
      expect(item['id']).toBe('s1');
      // Sections have no vector field
      expect(item).not.toHaveProperty('vectors');
      expect((item['properties'] as Record<string, unknown>)['title']).toBe('Intro');
      expect((item['properties'] as Record<string, unknown>)['text']).toBe('section text');
    });

    it('no-ops when sections array is empty', async () => {
      const store = createWeaviateVectorStore();
      await store.upsertSections('tenant-a', []);
      expect(mockInsertMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteByMaterial', () => {
    it('calls deleteMany on both MaterialChunk and MaterialSection with a materialId filter', async () => {
      const store = createWeaviateVectorStore();
      await store.deleteByMaterial('tenant-a', 'mat-99');

      // Should be called twice: once per class
      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
      // Both calls should carry a filter for materialId = 'mat-99'
      for (const call of mockDeleteMany.mock.calls) {
        const filter = call[0] as ReturnType<typeof makeFilter>;
        expect(filter.operator).toBe('Equal');
        expect(filter.value).toBe('mat-99');
      }
    });
  });

  describe('hybridSearch', () => {
    it('calls query.hybrid with queryText, vector, limit, and no filter when materialId is absent', async () => {
      const store = createWeaviateVectorStore();
      await store.hybridSearch('tenant-a', {
        queryText: 'hello',
        queryVector: [1, 0, 0],
        k: 5,
      });

      expect(mockHybridQuery).toHaveBeenCalledOnce();
      const [queryText, opts] = mockHybridQuery.mock.calls[0] as [string, Record<string, unknown>];
      expect(queryText).toBe('hello');
      expect(opts['vector']).toEqual([1, 0, 0]);
      expect(opts['limit']).toBe(5);
      expect(opts['filters']).toBeUndefined();
    });

    it('passes a materialId filter when materialId is provided', async () => {
      const store = createWeaviateVectorStore();
      await store.hybridSearch('tenant-a', {
        queryText: 'hello',
        queryVector: [1, 0, 0],
        k: 3,
        materialId: 'mat-1',
      });

      const [, opts] = mockHybridQuery.mock.calls[0] as [string, Record<string, unknown>];
      const filter = opts['filters'] as ReturnType<typeof makeFilter>;
      expect(filter).toBeDefined();
      expect(filter.operator).toBe('Equal');
      expect(filter.value).toBe('mat-1');
    });

    it('maps score from o.metadata.score', async () => {
      mockHybridQuery.mockResolvedValue({
        objects: [
          makeHybridHit('uuid-1', {
            materialId: 'mat-1',
            courseCode: 'GC 4800',
            fileName: 'f.pdf',
            sectionTitle: 'S',
            sectionIndex: 0,
            parentSectionId: '',
            text: 'body',
            contextBlurb: 'blurb',
          }, 0.88),
        ],
      });

      const store = createWeaviateVectorStore();
      const hits = await store.hybridSearch('t', { queryText: 'x', queryVector: [], k: 1 });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.score).toBe(0.88);
      expect(hits[0]!.id).toBe('uuid-1');
    });

    it('returns parentSectionText from joined section when parentSectionId is set', async () => {
      mockHybridQuery.mockResolvedValue({
        objects: [
          makeHybridHit('uuid-chunk-1', {
            materialId: 'mat-1',
            courseCode: 'GC 4800',
            fileName: 'f.pdf',
            sectionTitle: 'S',
            sectionIndex: 0,
            parentSectionId: 'parent-uuid-1',
            text: 'chunk body',
            contextBlurb: '',
          }, 0.9),
        ],
      });

      mockFetchObjectById.mockResolvedValue({
        uuid: 'parent-uuid-1',
        properties: { text: 'parent section text' },
        metadata: undefined,
        references: undefined,
        vectors: {},
      });

      const store = createWeaviateVectorStore();
      const hits = await store.hybridSearch('t', { queryText: 'x', queryVector: [], k: 1 });

      expect(hits[0]!.parentSectionId).toBe('parent-uuid-1');
      expect(hits[0]!.parentSectionText).toBe('parent section text');
      expect(mockFetchObjectById).toHaveBeenCalledOnce();
      const [fetchedId] = mockFetchObjectById.mock.calls[0] as [string, unknown];
      expect(fetchedId).toBe('parent-uuid-1');
    });

    it('returns parentSectionText as null when parentSectionId is empty', async () => {
      mockHybridQuery.mockResolvedValue({
        objects: [
          makeHybridHit('uuid-chunk-2', {
            materialId: 'mat-1',
            courseCode: 'GC 4800',
            fileName: 'f.pdf',
            sectionTitle: 'S',
            sectionIndex: 0,
            parentSectionId: '',
            text: 'chunk body',
            contextBlurb: '',
          }, 0.5),
        ],
      });

      const store = createWeaviateVectorStore();
      const hits = await store.hybridSearch('t', { queryText: 'x', queryVector: [], k: 1 });

      expect(hits[0]!.parentSectionText).toBeNull();
      // No parent fetch should happen
      expect(mockFetchObjectById).not.toHaveBeenCalled();
    });

    it('returns parentSectionText as null when parentSectionId is missing from properties', async () => {
      mockHybridQuery.mockResolvedValue({
        objects: [
          makeHybridHit('uuid-chunk-3', {
            materialId: 'mat-1',
            courseCode: 'GC 4800',
            fileName: 'f.pdf',
            sectionTitle: 'S',
            sectionIndex: 1,
            // parentSectionId intentionally absent
            text: 'chunk body',
            contextBlurb: '',
          }, 0.4),
        ],
      });

      const store = createWeaviateVectorStore();
      const hits = await store.hybridSearch('t', { queryText: 'x', queryVector: [], k: 1 });

      expect(hits[0]!.parentSectionText).toBeNull();
      expect(mockFetchObjectById).not.toHaveBeenCalled();
    });

    it('deduplicates parentSectionId calls when multiple chunks share the same parent', async () => {
      mockHybridQuery.mockResolvedValue({
        objects: [
          makeHybridHit('uuid-c1', {
            materialId: 'mat-1', courseCode: 'GC 4800', fileName: 'f.pdf',
            sectionTitle: 'S', sectionIndex: 0, parentSectionId: 'parent-shared',
            text: 'chunk 1', contextBlurb: '',
          }, 0.9),
          makeHybridHit('uuid-c2', {
            materialId: 'mat-1', courseCode: 'GC 4800', fileName: 'f.pdf',
            sectionTitle: 'S', sectionIndex: 1, parentSectionId: 'parent-shared',
            text: 'chunk 2', contextBlurb: '',
          }, 0.8),
        ],
      });

      mockFetchObjectById.mockResolvedValue({
        uuid: 'parent-shared',
        properties: { text: 'shared parent text' },
        metadata: undefined,
        references: undefined,
        vectors: {},
      });

      const store = createWeaviateVectorStore();
      const hits = await store.hybridSearch('t', { queryText: 'x', queryVector: [], k: 2 });

      // fetchObjectById should be called only once despite two chunks sharing the same parent
      expect(mockFetchObjectById).toHaveBeenCalledOnce();
      expect(hits[0]!.parentSectionText).toBe('shared parent text');
      expect(hits[1]!.parentSectionText).toBe('shared parent text');
    });
  });

  describe('lazy singleton — ensureSchema + ensureTenant', () => {
    it('ensureSchema is called once even across multiple upsert calls', async () => {
      // Use a fresh store instance; reset the module-level schemaReady by
      // re-importing. We do this by resetting modules for this specific test.
      vi.resetModules();

      // Re-mock after reset
      const freshEnsureSchema = vi.fn().mockResolvedValue(undefined);
      const freshEnsureTenant = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@/lib/capture/weaviate-schema', () => ({
        ensureSchema: () => freshEnsureSchema(),
        ensureTenant: (t: string) => freshEnsureTenant(t),
        MATERIAL_CHUNK_CLASS: 'MaterialChunk',
        MATERIAL_SECTION_CLASS: 'MaterialSection',
      }));
      vi.doMock('@/lib/capture/weaviate-client', () => ({
        getWeaviateClient: vi.fn().mockResolvedValue({
          collections: {
            use: (_cls: string) => ({
              withTenant: (_t: string) => ({
                data: {
                  insertMany: vi.fn().mockResolvedValue({ errors: {} }),
                },
                filter: { byProperty: (_n: string) => ({ equal: (_v: unknown) => ({}) }) },
                query: {},
              }),
            }),
          },
        }),
      }));

      const { createWeaviateVectorStore: freshCreate } = await import(
        '@/lib/capture/vector-store-weaviate'
      );

      const store = freshCreate();
      await store.upsert('t1', [makeChunk('a')]);
      await store.upsert('t1', [makeChunk('b')]);
      await store.upsert('t2', [makeChunk('c')]);

      expect(freshEnsureSchema).toHaveBeenCalledOnce();
    });

    it('ensureTenant is called once per tenant but not for repeated calls on the same tenant', async () => {
      vi.resetModules();

      const freshEnsureSchema2 = vi.fn().mockResolvedValue(undefined);
      const freshEnsureTenant2 = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@/lib/capture/weaviate-schema', () => ({
        ensureSchema: () => freshEnsureSchema2(),
        ensureTenant: (t: string) => freshEnsureTenant2(t),
        MATERIAL_CHUNK_CLASS: 'MaterialChunk',
        MATERIAL_SECTION_CLASS: 'MaterialSection',
      }));
      vi.doMock('@/lib/capture/weaviate-client', () => ({
        getWeaviateClient: vi.fn().mockResolvedValue({
          collections: {
            use: (_cls: string) => ({
              withTenant: (_t: string) => ({
                data: {
                  insertMany: vi.fn().mockResolvedValue({ errors: {} }),
                },
                filter: { byProperty: (_n: string) => ({ equal: (_v: unknown) => ({}) }) },
                query: {},
              }),
            }),
          },
        }),
      }));

      const { createWeaviateVectorStore: freshCreate2 } = await import(
        '@/lib/capture/vector-store-weaviate'
      );

      const store = freshCreate2();
      // Two calls on the same tenant — ensureTenant should fire only once
      await store.upsert('tenant-x', [makeChunk('a')]);
      await store.upsert('tenant-x', [makeChunk('b')]);
      // A different tenant — ensureTenant should fire once more
      await store.upsert('tenant-y', [makeChunk('c')]);

      expect(freshEnsureTenant2).toHaveBeenCalledTimes(2);
      expect(freshEnsureTenant2).toHaveBeenCalledWith('tenant-x');
      expect(freshEnsureTenant2).toHaveBeenCalledWith('tenant-y');
    });
  });
});
