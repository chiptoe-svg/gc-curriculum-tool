/**
 * Runs only against the scratch database; skips itself anywhere else so it can never touch live data.
 * Rows it inserts carry a unique marker in required_hash and are deleted afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Node's own .env parser (no hand parsing); an explicit DATABASE_URL in the environment wins.
try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('match-queries (scratch database)', () => {
  const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req = `${tag}-req`;
  const sup = `${tag}-sup`;
  let q: typeof import('@/lib/db/match-queries');
  let dbm: typeof import('@/lib/db/client');
  let schema: typeof import('@/lib/db/schema');
  let orm: typeof import('drizzle-orm');

  const base = (over: Partial<import('@/lib/db/match-queries').NewDecision> = {}): import('@/lib/db/match-queries').NewDecision => ({
    requiredHash: req, suppliedHash: sup, requiredText: 'r', suppliedText: 's',
    requiredCourse: 'GC 1', suppliedCourse: 'GC 0', label: 'fully', source: 'map', decidedBy: 'tester', ...over,
  });

  beforeAll(async () => {
    q = await import('@/lib/db/match-queries');
    dbm = await import('@/lib/db/client');
    schema = await import('@/lib/db/schema');
    orm = await import('drizzle-orm');
  });
  afterAll(async () => {
    if (!dbm) return;
    await dbm.db.delete(schema.skillMatchDecisions).where(orm.like(schema.skillMatchDecisions.requiredHash, `${tag}%`));
    await dbm.db.delete(schema.skillMatchJudgments).where(orm.like(schema.skillMatchJudgments.requiredHash, `${tag}%`));
  });

  it('latestDecisions returns the newest decision per pair and keeps history', async () => {
    await q.insertDecision(base({ label: 'fully', decidedAt: new Date('2026-01-01T00:00:00Z') }));
    await q.insertDecision(base({ label: 'not', decidedAt: new Date('2026-01-02T00:00:00Z') }));
    const latest = await q.latestDecisions();
    expect(latest.get(`${req}|${sup}`)?.label).toBe('not');
    const all = (await q.exportDecisions({ latestOnly: false })).filter((d) => d.requiredHash === req);
    expect(all).toHaveLength(2);
    const onlyLatest = (await q.exportDecisions({ latestOnly: true })).filter((d) => d.requiredHash === req);
    expect(onlyLatest.map((d) => d.label)).toEqual(['not']);
  });

  it('a draft decision is visible only on its plan', async () => {
    const r2 = `${tag}-req2`;
    const planId = '00000000-0000-4000-8000-000000000001';
    await q.insertDecision(base({ requiredHash: r2, draft: true, planId, label: 'partly' }));
    expect((await q.latestDecisions()).has(`${r2}|${sup}`)).toBe(false);
    expect((await q.latestDecisions({ planId: '00000000-0000-4000-8000-000000000002' })).has(`${r2}|${sup}`)).toBe(false);
    expect((await q.latestDecisions({ planId })).get(`${r2}|${sup}`)?.label).toBe('partly');
  });

  it('judgments upsert and read back by model and prompt version', async () => {
    const r3 = `${tag}-req3`;
    await q.writeJudgments([{ requiredHash: r3, suppliedHash: sup, model: 'm', promptVersion: 'v1', pFully: 0.2, pPartly: 0.5 }]);
    await q.writeJudgments([{ requiredHash: r3, suppliedHash: sup, model: 'm', promptVersion: 'v1', pFully: 0.9, pPartly: 0.05 }]);
    const got = await q.readJudgments([{ requiredHash: r3, suppliedHash: sup }], 'm', 'v1');
    expect(got.get(`${r3}|${sup}`)?.pFully).toBeCloseTo(0.9);
    expect((await q.readJudgments([{ requiredHash: r3, suppliedHash: sup }], 'm', 'v2')).size).toBe(0);
  });
});
