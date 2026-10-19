// @vitest-environment node
// Task 5 — tests for scripts/catalog/insert-catalog-additions.ts. Pure parse
// tests always run; DB tests run only on the CA scratch (isCaScratchDb()), in
// a rolled-back transaction.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inArray, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap, careerTargetRequirements } from '@/lib/db/schema';
import {
  parseAdditions,
  parseArgs,
  applyAdditions,
  type Tx,
  type Additions,
} from '@/scripts/catalog/insert-catalog-additions';
import { isCaScratchDb } from './ca/scratch-guard';

const RUN = isCaScratchDb();
const FILE = path.resolve(__dirname, '../../docs/superpowers/specs/2026-10-19-catalog-additions.json');
const realJson = (): any => JSON.parse(readFileSync(FILE, 'utf8'));

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); })).rejects.toBeInstanceOf(Rollback);
}

function base(): any {
  return {
    _approval: 'ok',
    newCompetencies: [{
      id: 'x-one', name: 'X one', foundational: false, scoring: 'direct', stratum: 'technical',
      knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', rationale: 'r',
    }],
    descriptorRevisions: [],
  };
}

describe('parseArgs', () => {
  it('requires --file and --expect-db; apply defaults false', () => {
    expect(() => parseArgs(['--file', 'a'])).toThrow(/--expect-db/);
    expect(() => parseArgs(['--expect-db', 'x'])).toThrow(/--file/);
    expect(parseArgs(['--file', 'a', '--expect-db', 'x'])).toEqual({ file: 'a', expectDb: 'x', apply: false });
  });
});

describe('parseAdditions', () => {
  it('accepts the real file: 11 new, 2 revisions', () => {
    const a = parseAdditions(realJson());
    expect(a.newCompetencies).toHaveLength(11);
    expect(a.descriptorRevisions).toHaveLength(2);
  });
  it('refuses empty _approval', () => {
    const j = base(); j._approval = '  ';
    expect(() => parseAdditions(j)).toThrow(/_approval/);
  });
  it('refuses a foundational entry with non-null K or U', () => {
    const j = base(); j.newCompetencies[0].foundational = true;
    expect(() => parseAdditions(j)).toThrow(/foundational/);
    j.newCompetencies[0].knowDescriptor = null;
    expect(() => parseAdditions(j)).toThrow(/foundational/);
  });
  it('refuses a non-foundational entry with null K or U', () => {
    const j = base(); j.newCompetencies[0].knowDescriptor = null;
    expect(() => parseAdditions(j)).toThrow(/non-foundational/);
    const k = base(); k.newCompetencies[0].understandDescriptor = null;
    expect(() => parseAdditions(k)).toThrow(/non-foundational/);
  });
  it('refuses scoring outside direct/derived', () => {
    const j = base(); j.newCompetencies[0].scoring = 'magic';
    expect(() => parseAdditions(j)).toThrow(/scoring/);
  });
  it.each(['priorKnowDescriptor', 'priorUnderstandDescriptor', 'priorDoDescriptor'])('refuses a revision missing %s', (f) => {
    const j = realJson(); delete j.descriptorRevisions[0][f];
    expect(() => parseAdditions(j)).toThrow(new RegExp(f));
  });
  it('refuses a duplicate id', () => {
    const j = base(); j.newCompetencies.push({ ...j.newCompetencies[0] });
    expect(() => parseAdditions(j)).toThrow(/duplicate/);
  });
});

async function seedPriors(tx: Tx, a: Additions) {
  // Make sure revision targets exist with the file's prior text (the scratch may already differ after a real apply).
  for (const r of a.descriptorRevisions) {
    await tx.update(subCompetencies).set({
      knowDescriptor: r.priorKnowDescriptor, understandDescriptor: r.priorUnderstandDescriptor, doDescriptor: r.priorDoDescriptor,
    }).where(eq(subCompetencies.id, r.id));
  }
}
async function clearNew(tx: Tx, a: Additions) {
  const ids = a.newCompetencies.map(c => c.id);
  await tx.delete(subCompetencyMap).where(inArray(subCompetencyMap.oldSubCompetencyId, ids));
  await tx.delete(subCompetencies).where(inArray(subCompetencies.id, ids));
}

describe.skipIf(!RUN)('applyAdditions (CA scratch only)', () => {
  it('inserts all 11 with flags, identity map rows, no requirements; applies both revisions', async () => {
    const a = parseAdditions(realJson());
    await inRolledBackTx(async (tx) => {
      await clearNew(tx, a); await seedPriors(tx, a);
      const res = await applyAdditions(tx, a);
      expect(res.inserted).toHaveLength(11);
      expect(res.revised).toHaveLength(2);
      const ids = a.newCompetencies.map(c => c.id);
      const rows = await tx.select().from(subCompetencies).where(inArray(subCompetencies.id, ids));
      expect(rows).toHaveLength(11);
      for (const c of a.newCompetencies) {
        const r = rows.find(x => x.id === c.id)!;
        expect(r!.origin).toBe('gc_authored');
        expect(r!.foundational).toBe(c.foundational);
        expect(r!.scoring).toBe(c.scoring);
        expect(r!.knowDescriptor).toBe(c.knowDescriptor);
        expect(r!.understandDescriptor).toBe(c.understandDescriptor);
        expect(r!.doDescriptor).toBe(c.doDescriptor);
      }
      const maps = await tx.select().from(subCompetencyMap).where(inArray(subCompetencyMap.oldSubCompetencyId, ids));
      expect(maps).toHaveLength(11);
      for (const m of maps) { expect(m.competencyId).toBe(m.oldSubCompetencyId); expect(m.mergeNote).toBeNull(); }
      expect(await tx.select().from(careerTargetRequirements).where(inArray(careerTargetRequirements.competencyId, ids))).toHaveLength(0);
      for (const rev of a.descriptorRevisions) {
        const [r] = await tx.select().from(subCompetencies).where(eq(subCompetencies.id, rev.id));
        expect(r!.knowDescriptor).toBe(rev.knowDescriptor);
        expect(r!.understandDescriptor).toBe(rev.understandDescriptor);
        expect(r!.doDescriptor).toBe(rev.doDescriptor);
      }
    });
  });

  it('refuses when a new id already exists, writing nothing', async () => {
    const a = parseAdditions(realJson());
    await inRolledBackTx(async (tx) => {
      await clearNew(tx, a); await seedPriors(tx, a);
      await tx.insert(subCompetencies).values({ id: a.newCompetencies[3]!.id, name: 'pre', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', origin: 'migrated', updatedAt: new Date() });
      await expect(applyAdditions(tx, a)).rejects.toThrow(/already exist/);
      const others = a.newCompetencies.filter((_, i) => i !== 3).map(c => c.id);
      expect(await tx.select().from(subCompetencies).where(inArray(subCompetencies.id, others))).toHaveLength(0);
      const [rev] = await tx.select().from(subCompetencies).where(eq(subCompetencies.id, a.descriptorRevisions[0]!.id));
      expect(rev!.doDescriptor).toBe(a.descriptorRevisions[0]!.priorDoDescriptor);
    });
  });

  it('refuses when a revision prior text differs from the DB, printing both texts, writing nothing', async () => {
    const a = parseAdditions(realJson());
    await inRolledBackTx(async (tx) => {
      await clearNew(tx, a); await seedPriors(tx, a);
      await tx.update(subCompetencies).set({ doDescriptor: 'DRIFTED DB TEXT' }).where(eq(subCompetencies.id, a.descriptorRevisions[1]!.id));
      let msg = '';
      try { await applyAdditions(tx, a); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/DRIFTED DB TEXT/);
      expect(msg).toContain(a.descriptorRevisions[1]!.priorDoDescriptor);
      const ids = a.newCompetencies.map(c => c.id);
      expect(await tx.select().from(subCompetencies).where(inArray(subCompetencies.id, ids))).toHaveLength(0);
      const [first] = await tx.select().from(subCompetencies).where(eq(subCompetencies.id, a.descriptorRevisions[0]!.id));
      expect(first!.doDescriptor).toBe(a.descriptorRevisions[0]!.priorDoDescriptor);
    });
  });
});
