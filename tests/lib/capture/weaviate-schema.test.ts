import { describe, it, expect, vi, beforeEach } from 'vitest';

const createCollection = vi.fn();
const listAll = vi.fn();
const tenantsGet = vi.fn();
const tenantsCreate = vi.fn();

vi.mock('@/lib/capture/weaviate-client', () => ({
  getWeaviateClient: vi.fn().mockResolvedValue({
    collections: {
      listAll: () => listAll(),
      create: (cfg: unknown) => createCollection(cfg),
      use: (_name: string) => ({
        tenants: {
          get: () => tenantsGet(),
          create: (arr: unknown) => tenantsCreate(arr),
        },
      }),
    },
  }),
}));

import { ensureSchema, ensureTenant, MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS } from '@/lib/capture/weaviate-schema';

beforeEach(() => {
  createCollection.mockReset();
  listAll.mockReset();
  tenantsGet.mockReset();
  tenantsCreate.mockReset();
});

describe('ensureSchema()', () => {
  it('creates both classes when neither exists', async () => {
    listAll.mockResolvedValue([]);

    await ensureSchema();

    expect(createCollection).toHaveBeenCalledTimes(2);
    const names = createCollection.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toContain(MATERIAL_CHUNK_CLASS);
    expect(names).toContain(MATERIAL_SECTION_CLASS);
  });

  it('is idempotent — calling twice creates each class only once', async () => {
    // First call: neither exists
    listAll.mockResolvedValueOnce([]);
    // Second call: both exist
    listAll.mockResolvedValueOnce([
      { name: MATERIAL_CHUNK_CLASS },
      { name: MATERIAL_SECTION_CLASS },
    ]);

    await ensureSchema();
    await ensureSchema();

    // Total creates should still be 2 (from the first call only)
    expect(createCollection).toHaveBeenCalledTimes(2);
  });

  it('creates only the missing class when one already exists', async () => {
    listAll.mockResolvedValue([{ name: MATERIAL_CHUNK_CLASS }]);

    await ensureSchema();

    expect(createCollection).toHaveBeenCalledTimes(1);
    expect(createCollection.mock.calls[0]?.[0]).toMatchObject({ name: MATERIAL_SECTION_CLASS });
  });
});

describe('ensureTenant()', () => {
  it('calls tenants.create once on each class when tenant is absent', async () => {
    tenantsGet.mockResolvedValue({});

    await ensureTenant('gc-3100');

    // One create call per class (2 classes)
    expect(tenantsCreate).toHaveBeenCalledTimes(2);
    expect(tenantsCreate).toHaveBeenCalledWith([{ name: 'gc-3100' }]);
  });

  it('is a no-op when tenant is already present', async () => {
    tenantsGet.mockResolvedValue({ 'gc-3100': { name: 'gc-3100', activityStatus: 'ACTIVE' } });

    await ensureTenant('gc-3100');

    expect(tenantsCreate).not.toHaveBeenCalled();
  });
});
