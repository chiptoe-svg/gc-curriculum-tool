/**
 * Weaviate-backed VectorStore implementation for CourseCapture v2 ingestion.
 *
 * Satisfies the same VectorStore interface as InMemoryVectorStore from
 * vector-store.ts. Switch backends by replacing createInMemoryVectorStore()
 * with createWeaviateVectorStore() at the call site.
 *
 * Schema and tenant bootstrapping are lazy:
 * - ensureSchema is called once per process (schemaReady singleton).
 * - ensureTenant is called at most once per tenant name per process
 *   (seenTenants Set). With autoTenantCreation enabled on both classes,
 *   this is just a safety pre-warm; the write itself would succeed without it.
 */

import { getWeaviateClient } from './weaviate-client';
import {
  ensureSchema,
  ensureTenant,
  MATERIAL_CHUNK_CLASS,
  MATERIAL_SECTION_CLASS,
} from './weaviate-schema';
import type {
  VectorStore,
  ChunkVectorRecord,
  SectionRecord,
  SearchInput,
  SearchHit,
} from './vector-store';

// ---------------------------------------------------------------------------
// Module-level lazy-init state (per-process, fine for Next.js dev server)
// ---------------------------------------------------------------------------

let schemaReady: Promise<void> | null = null;
const ensureSchemaOnce = (): Promise<void> =>
  (schemaReady ??= ensureSchema());

const seenTenants = new Set<string>();
async function ensureTenantOnce(tenant: string): Promise<void> {
  if (seenTenants.has(tenant)) return;
  await ensureTenant(tenant);
  seenTenants.add(tenant);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWeaviateVectorStore(): VectorStore {
  return {
    // -----------------------------------------------------------------------
    // upsert — store chunk vectors in MaterialChunk
    // -----------------------------------------------------------------------
    async upsert(tenant, records) {
      if (records.length === 0) return;
      await ensureSchemaOnce();
      await ensureTenantOnce(tenant);
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      await col.data.insertMany(
        records.map((r) => ({
          id: r.id,
          // v3 DataObject uses `vectors` (plural). For a single un-named vector
          // pass the array directly; Weaviate stores it as the "default" vector.
          vectors: r.vector,
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
        })),
      );
    },

    // -----------------------------------------------------------------------
    // upsertSections — store section text in MaterialSection (no vector)
    // -----------------------------------------------------------------------
    async upsertSections(tenant, sections) {
      if (sections.length === 0) return;
      await ensureSchemaOnce();
      await ensureTenantOnce(tenant);
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_SECTION_CLASS).withTenant(tenant);
      await col.data.insertMany(
        sections.map((s) => ({
          id: s.id,
          properties: {
            materialId: s.materialId,
            title: s.title,
            index: s.index,
            text: s.text,
          },
        })),
      );
    },

    // -----------------------------------------------------------------------
    // deleteByMaterial — remove all objects with the given materialId
    // -----------------------------------------------------------------------
    async deleteByMaterial(tenant, materialId) {
      const client = await getWeaviateClient();
      for (const cls of [MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS]) {
        const col = client.collections.use(cls).withTenant(tenant);
        await col.data.deleteMany(
          col.filter.byProperty('materialId').equal(materialId),
        );
      }
    },

    // -----------------------------------------------------------------------
    // hybridSearch — BM25 + vector blend, then join parent-section text
    // -----------------------------------------------------------------------
    async hybridSearch(tenant, input: SearchInput): Promise<SearchHit[]> {
      const client = await getWeaviateClient();
      const chunks = client.collections
        .use(MATERIAL_CHUNK_CLASS)
        .withTenant(tenant);

      const result = await chunks.query.hybrid(input.queryText, {
        vector: input.queryVector,
        limit: input.k,
        filters: input.materialId
          ? chunks.filter.byProperty('materialId').equal(input.materialId)
          : undefined,
        returnMetadata: ['score'],
        returnProperties: [
          'materialId',
          'courseCode',
          'fileName',
          'sectionTitle',
          'sectionIndex',
          'parentSectionId',
          'text',
          'contextBlurb',
        ],
      });

      // Collect unique parentSectionIds from the chunk hits
      const parentIds = Array.from(
        new Set(
          result.objects
            .map((o) => String(o.properties['parentSectionId'] ?? ''))
            .filter(Boolean),
        ),
      );

      // Fetch parent sections one-by-one (fetchObjectById — v3 does not
      // expose a batch-by-ids method on query). Parent count ≤ k, typically 3-5.
      const parentTextById = new Map<string, string>();
      if (parentIds.length > 0) {
        const sections = client.collections
          .use(MATERIAL_SECTION_CLASS)
          .withTenant(tenant);
        for (const pid of parentIds) {
          try {
            const obj = await sections.query.fetchObjectById(pid, {
              returnProperties: ['text'],
            });
            if (obj) {
              parentTextById.set(String(obj.uuid), String(obj.properties['text']));
            }
          } catch {
            // Skip missing/deleted parent sections gracefully
          }
        }
      }

      return result.objects.map((o) => {
        const parentSectionId = String(o.properties['parentSectionId'] ?? '');
        return {
          id: String(o.uuid),
          materialId: String(o.properties['materialId']),
          fileName: String(o.properties['fileName']),
          sectionTitle: String(o.properties['sectionTitle']),
          sectionIndex: Number(o.properties['sectionIndex']),
          text: String(o.properties['text']),
          parentSectionId,
          parentSectionText: parentTextById.get(parentSectionId) ?? null,
          contextBlurb: String(o.properties['contextBlurb']),
          score: Number(o.metadata?.score ?? 0),
        };
      });
    },
  };
}
