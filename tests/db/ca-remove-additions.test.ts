// @vitest-environment node
// scripts/migrations/2026-10-19-ca-remove-additions.sql, run on the CA scratch
// inside a rolled-back transaction (BEGIN/COMMIT stripped so the outer
// transaction owns the rollback).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap, bundleMembers, bundleGoldenPicks, bundleGoldenSamples } from '@/lib/db/schema';
import { parseAdditions, applyAdditions, type Tx } from '@/scripts/catalog/insert-catalog-additions';
import { isCaScratchDb } from './ca/scratch-guard';

const RUN = isCaScratchDb();
const ROOT = path.resolve(__dirname, '../..');
const additions = () => parseAdditions(JSON.parse(readFileSync(path.join(ROOT, 'docs/superpowers/specs/2026-10-19-catalog-additions.json'), 'utf8')));
const REMOVE_SQL = () => readFileSync(path.join(ROOT, 'scripts/migrations/2026-10-19-ca-remove-additions.sql'), 'utf8')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); })).rejects.toBeInstanceOf(Rollback);
}
async function freshApplied(tx: Tx) {
  const a = additions();
  const ids = a.newCompetencies.map(c => c.id);
  await tx.delete(bundleGoldenSamples).where(inArray(bundleGoldenSamples.bundleId, ids));
  await tx.delete(bundleMembers).where(inArray(bundleMembers.bundleId, ids));
  await tx.execute(sql`DELETE FROM bundle_cards WHERE competency_id IN ${ids}`);
  await tx.delete(subCompetencyMap).where(inArray(subCompetencyMap.oldSubCompetencyId, ids));
  await tx.delete(subCompetencies).where(inArray(subCompetencies.id, ids));
  // revision targets must hold their prior text for applyAdditions to accept them
  for (const r of a.descriptorRevisions) {
    await tx.execute(sql`UPDATE sub_competencies SET know_descriptor = ${r.priorKnowDescriptor}, understand_descriptor = ${r.priorUnderstandDescriptor}, do_descriptor = ${r.priorDoDescriptor} WHERE id = ${r.id}`);
  }
  await applyAdditions(tx, a);
  return { a, ids };
}
const member = (bundleId: string, status: 'proposed' | 'confirmed' | 'rejected') => ({
  bundleId, source: 'onet_element' as const, release: 'r', externalId: 'x', externalLabel: 'x', position: 'core' as const,
  status, proposedBy: 'test',
  ...(status === 'proposed' ? {} : { confirmedBy: 'test', confirmedAt: new Date() }),
});

describe.skipIf(!RUN)('2026-10-19-ca-remove-additions.sql (CA scratch only)', () => {
  it('removes the 11 rows, their map rows and proposed members; leaves revised ids alone', async () => {
    await inRolledBackTx(async (tx) => {
      const { a, ids } = await freshApplied(tx);
      await tx.insert(bundleMembers).values(member(ids[0]!, 'proposed'));
      await tx.insert(bundleGoldenSamples).values({ bundleId: ids[3]!, stratum: 'technical', sampleSeed: 's', candidates: [] });
      await tx.execute(sql.raw(REMOVE_SQL()));
      expect(await tx.select().from(subCompetencies).where(inArray(subCompetencies.id, ids))).toHaveLength(0);
      expect(await tx.select().from(subCompetencyMap).where(inArray(subCompetencyMap.oldSubCompetencyId, ids))).toHaveLength(0);
      expect(await tx.select().from(bundleMembers).where(inArray(bundleMembers.bundleId, ids))).toHaveLength(0);
      const revIds = a.descriptorRevisions.map(r => r.id);
      expect(await tx.select().from(subCompetencies).where(inArray(subCompetencies.id, revIds))).toHaveLength(revIds.length);
    });
  });

  it('refuses when a reviewed (confirmed) bundle_members row exists', async () => {
    await inRolledBackTx(async (tx) => {
      const { ids } = await freshApplied(tx);
      await tx.insert(bundleMembers).values(member(ids[1]!, 'confirmed'));
      await expect(tx.execute(sql.raw(REMOVE_SQL()))).rejects.toThrow(/reviewed|refusing|Failed query/i);
    });
  });

  it('refuses when a bundle_golden_picks row exists', async () => {
    await inRolledBackTx(async (tx) => {
      const { ids } = await freshApplied(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: ids[2]!, stratum: 'technical', sampleSeed: 's', candidates: [] });
      await tx.insert(bundleGoldenPicks).values({ bundleId: ids[2]!, reviewer: 'test', source: 'onet_element', externalId: 'x', release: 'r', position: 'core' });
      await expect(tx.execute(sql.raw(REMOVE_SQL()))).rejects.toThrow(/golden|refusing|Failed query/i);
    });
  });
});
