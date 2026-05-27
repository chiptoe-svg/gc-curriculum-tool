import weaviate from 'weaviate-client';
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
  { name: 'text', dataType: 'text' as const },
  { name: 'contextBlurb', dataType: 'text' as const },
];

const sectionProps = [
  { name: 'materialId', dataType: 'text' as const },
  { name: 'title', dataType: 'text' as const },
  { name: 'index', dataType: 'int' as const },
  { name: 'text', dataType: 'text' as const },
];

/** Idempotent: creates MaterialChunk + MaterialSection classes if they don't
 *  exist; no-op otherwise. Both have multi-tenancy enabled and use no built-in
 *  vectorizer (we provide vectors at write time). BM25 is on by default for
 *  text properties. */
export async function ensureSchema(): Promise<void> {
  const client = await getWeaviateClient();
  const existing = await client.collections.listAll();
  const names = new Set(existing.map((c: { name: string }) => c.name));

  if (!names.has(MATERIAL_CHUNK_CLASS)) {
    await client.collections.create({
      name: MATERIAL_CHUNK_CLASS,
      multiTenancy: weaviate.configure.multiTenancy({ enabled: true, autoTenantCreation: true }),
      vectorizers: weaviate.configure.vectorizer.none(),
      properties: chunkProps,
    });
  }
  if (!names.has(MATERIAL_SECTION_CLASS)) {
    await client.collections.create({
      name: MATERIAL_SECTION_CLASS,
      multiTenancy: weaviate.configure.multiTenancy({ enabled: true, autoTenantCreation: true }),
      vectorizers: weaviate.configure.vectorizer.none(),
      properties: sectionProps,
    });
  }
}

/** With autoTenantCreation enabled, tenants are created on first write.
 *  This helper is for explicit pre-warming when callers want to confirm
 *  the tenant exists before issuing writes. */
export async function ensureTenant(tenant: string): Promise<void> {
  const client = await getWeaviateClient();
  for (const cls of [MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS]) {
    const col = client.collections.use(cls);
    const tenants = await col.tenants.get();
    // tenants.get() returns a Record<tenantName, TenantConfig> in v3
    if (!(tenant in tenants)) {
      await col.tenants.create([{ name: tenant }]);
    }
  }
}
