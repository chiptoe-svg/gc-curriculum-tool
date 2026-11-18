/**
 * Runs only against the scratch database; skips itself anywhere else so it can never touch live data.
 * Rows it creates are deleted afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('cluster-queries (scratch database)', () => {
  const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const made: string[] = [];
  let q: typeof import('@/lib/db/cluster-queries');
  let dbm: typeof import('@/lib/db/client');
  let schema: typeof import('@/lib/db/schema');
  let orm: typeof import('drizzle-orm');
  let emptyState: import('@/lib/builder/cluster/state').ClusterState;

  const make = async (name: string) => {
    const row = await q.createCluster({ name: `${tag} ${name}`, state: emptyState, ownerGrantId: 'g', ownerKind: 'personal', createdBy: 'tester' });
    made.push(row.id);
    return row;
  };

  beforeAll(async () => {
    q = await import('@/lib/db/cluster-queries');
    dbm = await import('@/lib/db/client');
    schema = await import('@/lib/db/schema');
    orm = await import('drizzle-orm');
    emptyState = { cards: [], objectives: [], overrides: [], proposed: [], links: [], versions: {} } as unknown as typeof emptyState;
  });
  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.delete(schema.planSyllabusDrafts).where(orm.like(schema.planSyllabusDrafts.fileName, `${tag}%`));
    await dbm.db.delete(schema.curriculumClusters).where(orm.like(schema.curriculumClusters.name, `${tag}%`));
  });

  it('creates, lists and saves a cluster', async () => {
    const c = await make('a');
    expect(c.version).toBe(1);
    expect((await q.getCluster(c.id))?.name).toBe(`${tag} a`);
    expect((await q.listClusters()).some((s) => s.id === c.id)).toBe(true);
    const saved = await q.saveCluster(c.id, 1, { name: `${tag} a2`, state: emptyState, updatedBy: 'other' });
    expect(saved?.version).toBe(2);
    expect(saved?.name).toBe(`${tag} a2`);
    await q.deleteCluster(c.id);
    expect(await q.getCluster(c.id)).toBeNull();
  });

  it('save with a stale version returns null', async () => {
    const c = await make('b');
    expect(await q.saveCluster(c.id, 1, { name: `${tag} b1`, state: emptyState, updatedBy: 'x' })).not.toBeNull();
    expect(await q.saveCluster(c.id, 1, { name: `${tag} b2`, state: emptyState, updatedBy: 'y' })).toBeNull();
    expect((await q.getCluster(c.id))?.name).toBe(`${tag} b1`);
  });

  it('a syllabus draft row needs exactly one of plan or cluster', async () => {
    const c = await make('c');
    const plan = await dbm.db.insert(schema.curriculumPlans).values({
      name: `${tag} plan`, state: {} as never, ownerGrantId: 'g', ownerKind: 'personal', createdBy: 't', updatedBy: 't',
    }).returning();
    const planId = plan[0]!.id;
    try {
      const row = { courseRef: 'GC 1', fileName: `${tag}-f`, text: 't', model: 'm', draftedBy: 'x', draft: {} };
      await expect(dbm.db.insert(schema.planSyllabusDrafts).values({ ...row, planId, clusterId: c.id })).rejects.toThrow();
      await expect(dbm.db.insert(schema.planSyllabusDrafts).values({ ...row })).rejects.toThrow();
      await dbm.db.insert(schema.planSyllabusDrafts).values({ ...row, clusterId: c.id });
      await dbm.db.insert(schema.planSyllabusDrafts).values({ ...row, planId });
    } finally {
      await dbm.db.delete(schema.curriculumPlans).where(orm.eq(schema.curriculumPlans.id, planId));
    }
  });
});
