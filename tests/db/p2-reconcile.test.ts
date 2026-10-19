// @vitest-environment node
// P2 Task 9 — reconcileBundle (spec §5, plan Ruling 8) and readAgreementInputs
// against the scratch clone. Every write runs inside a transaction that is
// rolled back, so the scratch clone's rows are never changed. Gated
// isP2ScratchDb(): needs 0059 applied for real. Seeds its own synthetic
// bundles (ids p2r-*).
import { describe, it, expect, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap, bundleMembers, bundleGoldenSamples, bundleGoldenPicks, bundleMappingRuns, bundleMappingOutcomes, type GoldenCandidate } from '@/lib/db/schema';
import { reconcileBundle, readAgreementInputs, confirmProposedMember, noteProposedDisagreement, type Executor } from '@/lib/db/bundle-queries';
import { main as reportMain } from '@/scripts/catalog/bundle-agreement-report';
import { itemKey, computeAgreement, sumAgreement } from '@/lib/catalog/agreement';
import { taskGroupKey } from '@/lib/catalog/shortlist';
import { isP2ScratchDb, SCRATCH_DB } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const REL = '31.0';
const B = 'p2r-1';
const B_UNSUBMITTED = 'p2r-2';
const B_NO_SAMPLE = 'p2r-3';
const MODEL = 'gpt-test-model';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback('rollback');
    });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err; // surface the real assertion failure, not a wrapper mismatch
  }
  throw new Error('transaction committed — expected rollback');
}

const G1_LABEL = 'Prepare synthetic reconcile proofs for the press.';
const G1_MEMBERS = [{ taskId: 'p2r-t1', onetSocCode: '99-0001.00' }, { taskId: 'p2r-t2', onetSocCode: '99-0002.00' }];
const CANDIDATES: GoldenCandidate[] = [
  { key: taskGroupKey('Some other synthetic task.'), label: 'Some other synthetic task.', rank: 1, score: 0.9, members: [{ taskId: 'p2r-t9', onetSocCode: '99-0009.00' }] },
  { key: taskGroupKey(G1_LABEL), label: G1_LABEL, rank: 3, score: 0.8, members: G1_MEMBERS },
];

async function seedBundles(tx: Executor): Promise<void> {
  const ids = [B, B_UNSUBMITTED, B_NO_SAMPLE];
  await tx.insert(subCompetencies).values(ids.map(id => ({
    id, name: `Reconcile ${id}`, knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D',
    retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
  })));
  await tx.insert(subCompetencyMap).values(ids.map(id => ({ oldSubCompetencyId: id, competencyId: id, mergeNote: null })));
}

function aiMember(bundleId: string, externalId: string, position: 'core' | 'related' | 'fringe') {
  return {
    bundleId, source: 'onet_element' as const, externalId, externalLabel: `Element ${externalId}`, onetSocCode: null, release: REL,
    position, aiPosition: position, status: 'proposed' as const, proposedBy: MODEL, rationale: 'because',
  };
}

function elementPick(bundleId: string, reviewer: string, externalId: string, position: 'core' | 'related' | 'fringe') {
  return { bundleId, reviewer, source: 'onet_element' as const, externalId, onetSocCode: null, release: REL, position, noCleanMatch: false };
}

async function seedSubmitted(tx: Executor): Promise<void> {
  await seedBundles(tx);
  await tx.insert(bundleGoldenSamples).values({ bundleId: B, stratum: 'technical', sampleSeed: 's', candidates: CANDIDATES, reviewer: 'R', submittedAt: new Date() });
  await tx.insert(bundleGoldenPicks).values([
    elementPick(B, 'R', 'e1', 'core'),
    elementPick(B, 'R', 'e2', 'related'),
    elementPick(B, 'R', 'e4', 'core'),
    ...G1_MEMBERS.map(m => ({ bundleId: B, reviewer: 'R', source: 'onet_task' as const, externalId: m.taskId, onetSocCode: m.onetSocCode, release: REL, position: 'related' as const, noCleanMatch: false })),
  ]);
  await tx.insert(bundleMembers).values([
    aiMember(B, 'e1', 'core'),
    aiMember(B, 'e2', 'fringe'),
    aiMember(B, 'e3', 'core'),
    { ...aiMember(B, 'e4', 'core'), status: 'rejected' as const, confirmedBy: 'Owner', confirmedAt: new Date('2026-10-01T00:00:00Z'), reviewNote: 'not this bundle' },
  ]);
}

// Includes the tuple's ctid: inside one transaction now() is constant, so a
// spurious UPDATE would leave updated_at unchanged — but it always moves the
// row to a new ctid. This is what makes "changes no row" observable here.
/** One ok mapping outcome (a fresh run) for `bundleId` — makes it count as mapped. */
async function seedOutcome(tx: Executor, bundleId: string, status: 'ok' | 'failed' = 'ok'): Promise<void> {
  const [run] = await tx.insert(bundleMappingRuns).values({ model: MODEL, promptVersion: 'v', taskShortlistK: 25, bundleCount: 1 }).returning({ id: bundleMappingRuns.id });
  await tx.insert(bundleMappingOutcomes).values({ runId: run!.id, bundleId, status, noCleanMatch: false, note: null });
}

async function snapshot(tx: Executor, bundleId: string) {
  return tx.select({ row: bundleMembers, ctid: sql<string>`${bundleMembers}.ctid::text` }).from(bundleMembers).where(eq(bundleMembers.bundleId, bundleId))
    .orderBy(asc(bundleMembers.source), asc(bundleMembers.externalId), asc(bundleMembers.onetSocCode));
}

describe.skipIf(!RUN)('P2 Task 9 — reconcileBundle (scratch DB only)', () => {
  it('confirms agreements, adds reviewer-only items, queues disagreements, leaves AI-only and human decisions alone', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      const before = new Map((await snapshot(tx, B)).map(r => [r.row.externalId, r]));

      const result = await reconcileBundle(tx, B);

      const snap = await snapshot(tx, B);
      const after = new Map(snap.map(r => [`${r.row.externalId}|${r.row.onetSocCode ?? ''}`, r.row]));
      const afterFull = new Map(snap.map(r => [r.row.externalId, r]));

      // Human decisions first: a rejected row stays rejected and untouched.
      expect(after.get('e4|')!.status).toBe('rejected');
      expect(afterFull.get('e4')).toEqual(before.get('e4'));
      expect(afterFull.get('e3')).toEqual(before.get('e3'));
      expect(result).toEqual({ skipped: false, confirmed: 1, added: 2, disagreements: 1 });
      const e1 = after.get('e1|')!;
      expect(e1.status).toBe('confirmed');
      expect(e1.confirmedBy).toBe('R');
      expect(e1.confirmedAt).not.toBeNull();
      expect(e1.reviewNote).toMatch(/blind pick/);

      const e2 = after.get('e2|')!;
      expect(e2.status).toBe('proposed');
      expect(e2.confirmedBy).toBeNull();
      expect(e2.position).toBe('fringe');
      expect(e2.reviewNote).toBe('blind pick: related');

      for (const m of G1_MEMBERS) {
        const g = after.get(`${m.taskId}|${m.onetSocCode}`)!;
        expect(g).toBeDefined();
        expect(g).toMatchObject({
          source: 'onet_task', status: 'confirmed', proposedBy: 'reviewer', aiPosition: null, position: 'related',
          confirmedBy: 'R', externalLabel: G1_LABEL, release: REL,
        });
      }

      expect(after.size).toBe(6);
    });
  });

  it('an AI fringe placement the reviewer did not mark stays proposed with NO note (decision 2026-10-19: fringe was not asked)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      await tx.insert(bundleMembers).values(aiMember(B, 'e5', 'fringe'));
      const before = (await snapshot(tx, B)).find(r => r.row.externalId === 'e5')!;
      await reconcileBundle(tx, B);
      const after = (await snapshot(tx, B)).find(r => r.row.externalId === 'e5')!;
      expect(after.row).toMatchObject({ status: 'proposed', position: 'fringe', reviewNote: null, confirmedBy: null });
      expect(after).toEqual(before);
    });
  });

  it('is idempotent: a second run confirms/adds nothing and changes no row (updated_at included)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      await reconcileBundle(tx, B);
      const before = await snapshot(tx, B);

      const second = await reconcileBundle(tx, B);
      expect(second).toEqual({ skipped: false, confirmed: 0, added: 0, disagreements: 1 });

      const after = await snapshot(tx, B);
      expect(after).toEqual(before);
    });
  });

  it('skips an unsubmitted sample and a bundle with no sample, changing nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: B_UNSUBMITTED, stratum: 'business', sampleSeed: 's', candidates: CANDIDATES });
      await tx.insert(bundleGoldenPicks).values([elementPick(B_UNSUBMITTED, 'R', 'e1', 'core'), elementPick(B_UNSUBMITTED, 'R', 'e5', 'core')]);
      await tx.insert(bundleMembers).values([aiMember(B_UNSUBMITTED, 'e1', 'core'), aiMember(B_NO_SAMPLE, 'e1', 'core')]);
      const beforeU = await snapshot(tx, B_UNSUBMITTED);
      const beforeN = await snapshot(tx, B_NO_SAMPLE);

      expect(await reconcileBundle(tx, B_UNSUBMITTED)).toMatchObject({ skipped: true });
      expect(await reconcileBundle(tx, B_NO_SAMPLE)).toMatchObject({ skipped: true });

      expect(await snapshot(tx, B_UNSUBMITTED)).toEqual(beforeU);
      expect(await snapshot(tx, B_NO_SAMPLE)).toEqual(beforeN);
    });
  });
});

describe.skipIf(!RUN)('P2 Task 9 fix 1 — guarded writes never override a decision made after reconcile read', () => {
  // Simulates the race: reconcile read e4 while it was 'proposed', then a
  // reviewer rejected it before reconcile's UPDATE. The UPDATE helpers are
  // called with that stale view (id + agreed position) against the now-
  // rejected row; the SQL predicate must make them match nothing.
  it('confirmProposedMember and noteProposedDisagreement leave a rejected row untouched', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      const before = (await snapshot(tx, B)).find(r => r.row.externalId === 'e4')!;
      expect(before.row.status).toBe('rejected');

      expect(await confirmProposedMember(tx, before.row.id, 'core', 'R')).toBe(0);
      expect(await noteProposedDisagreement(tx, before.row.id, 'blind pick: related')).toBe(0);

      const after = (await snapshot(tx, B)).find(r => r.row.externalId === 'e4')!;
      expect(after.row.status).toBe('rejected');
      expect(after).toEqual(before);
    });
  });

  it('confirmProposedMember does not confirm a proposed row whose position changed since the read', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      const e1 = (await snapshot(tx, B)).find(r => r.row.externalId === 'e1')!;
      // A reviewer moved e1 to 'related' after reconcile read it as 'core'.
      await tx.update(bundleMembers).set({ position: 'related' }).where(eq(bundleMembers.id, e1.row.id));
      expect(await confirmProposedMember(tx, e1.row.id, 'core', 'R')).toBe(0);
      const after = (await snapshot(tx, B)).find(r => r.row.externalId === 'e1')!;
      expect(after.row).toMatchObject({ status: 'proposed', position: 'related', confirmedBy: null });
    });
  });
});

describe.skipIf(!RUN)('P2 Task 9 — readAgreementInputs (scratch DB only)', () => {
  it('keys AI and blind items by element id / task group; a two-row task group counts once', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      // AI also placed g1 (expanded to two rows) — the AI side must count it once too.
      await tx.insert(bundleMembers).values(G1_MEMBERS.map(m => ({
        bundleId: B, source: 'onet_task' as const, externalId: m.taskId, externalLabel: G1_LABEL, onetSocCode: m.onetSocCode, release: REL,
        position: 'fringe' as const, aiPosition: 'fringe' as const, status: 'proposed' as const, proposedBy: MODEL, rationale: 'r',
      })));
      await seedOutcome(tx, B);
      // An unsubmitted sample must not be read.
      await tx.insert(bundleGoldenSamples).values({ bundleId: B_UNSUBMITTED, stratum: 'business', sampleSeed: 's', candidates: CANDIDATES });

      const { inputs } = await readAgreementInputs(tx);
      expect(inputs.find(i => i.bundleId === B_UNSUBMITTED)).toBeUndefined();
      const input = inputs.find(i => i.bundleId === B)!;
      expect(input).toBeDefined();

      const g1Key = itemKey('onet_task', G1_LABEL);
      expect([...input.ai.keys()].sort()).toEqual([itemKey('onet_element', 'e1'), itemKey('onet_element', 'e2'), itemKey('onet_element', 'e3'), itemKey('onet_element', 'e4'), g1Key].sort());
      expect(input.ai.get(itemKey('onet_element', 'e2'))).toBe('fringe');
      expect([...input.blind.keys()].sort()).toEqual([itemKey('onet_element', 'e1'), itemKey('onet_element', 'e2'), itemKey('onet_element', 'e4'), g1Key].sort());
      expect(input.blind.get(g1Key)).toBe('related');
    });
  });

  it('builds a second-reviewer pair over elements ∪ candidates, none where unpicked', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      await tx.insert(bundleGoldenPicks).values([
        elementPick(B, 'Q', 'e1', 'related'),
        { bundleId: B, reviewer: 'Q', source: 'onet_task' as const, externalId: 'p2r-t9', onetSocCode: '99-0009.00', release: REL, position: 'core' as const, noCleanMatch: false },
      ]);
      const { secondReviewerPairs } = await readAgreementInputs(tx);
      const pair = secondReviewerPairs.find(p => p.bundleId === B)!;
      expect(pair).toBeDefined();
      expect(pair.a.length).toBe(pair.b.length);
      // a = 'Q' (name order), b = 'R'. Count non-none labels.
      expect(pair.a.filter(x => x !== 'none').sort()).toEqual(['core', 'related']);
      expect(pair.b.filter(x => x !== 'none').sort()).toEqual(['core', 'core', 'related', 'related']);
      // Universe covers both candidates even where neither reviewer picked one.
      expect(pair.a.length).toBeGreaterThanOrEqual(CANDIDATES.length + 3);
    });
  });

  it('noMatch: latest ok outcome per active bundle; excludes sampled-unsubmitted bundles', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: B_UNSUBMITTED, stratum: 'business', sampleSeed: 's', candidates: CANDIDATES });
      const [r1] = await tx.insert(bundleMappingRuns).values({ model: MODEL, promptVersion: 'v', taskShortlistK: 25, bundleCount: 3 }).returning({ id: bundleMappingRuns.id });
      const [r2] = await tx.insert(bundleMappingRuns).values({ model: MODEL, promptVersion: 'v', taskShortlistK: 25, bundleCount: 1 }).returning({ id: bundleMappingRuns.id });
      const old = new Date('2026-10-01T00:00:00Z');
      const newer = new Date('2026-10-02T00:00:00Z');
      await tx.insert(bundleMappingOutcomes).values([
        // B: older no-match, latest ok outcome is a clean match → not listed.
        { runId: r1!.id, bundleId: B, status: 'ok', noCleanMatch: true, note: 'old', createdAt: old },
        { runId: r2!.id, bundleId: B, status: 'ok', noCleanMatch: false, note: null, createdAt: newer },
        // B_NO_SAMPLE: latest ok outcome is no-match → listed (a later failed run does not count).
        { runId: r1!.id, bundleId: B_NO_SAMPLE, status: 'ok', noCleanMatch: true, note: 'nothing fits', createdAt: old },
        { runId: r2!.id, bundleId: B_NO_SAMPLE, status: 'failed', noCleanMatch: false, note: null, createdAt: newer },
        // B_UNSUBMITTED: no-match, but its blind sample is unsubmitted → hidden.
        { runId: r1!.id, bundleId: B_UNSUBMITTED, status: 'ok', noCleanMatch: true, note: 'hidden', createdAt: old },
      ]);
      const { noMatch } = await readAgreementInputs(tx);
      const mine = noMatch.filter(n => n.bundleId.startsWith('p2r-'));
      expect(mine).toEqual([{ bundleId: B_NO_SAMPLE, note: 'nothing fits' }]);
    });
  });

  it('fix 2: a submitted sample with no ok outcome is left out of inputs/ALL and listed as not yet mapped', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSubmitted(tx);
      await seedOutcome(tx, B);
      // B_UNSUBMITTED is now SUBMITTED, but its only outcome failed — not mapped.
      await tx.insert(bundleGoldenSamples).values({ bundleId: B_UNSUBMITTED, stratum: 'business', sampleSeed: 's', candidates: CANDIDATES, reviewer: 'R', submittedAt: new Date() });
      await tx.insert(bundleGoldenPicks).values([elementPick(B_UNSUBMITTED, 'R', 'e7', 'core'), elementPick(B_UNSUBMITTED, 'R', 'e8', 'core')]);
      await seedOutcome(tx, B_UNSUBMITTED, 'failed');

      const { inputs, notYetMapped } = await readAgreementInputs(tx);
      expect(inputs.map(i => i.bundleId)).toContain(B);
      expect(inputs.map(i => i.bundleId)).not.toContain(B_UNSUBMITTED);
      expect(notYetMapped).toContain(B_UNSUBMITTED);
      expect(notYetMapped).not.toContain(B);

      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
      const code = await reportMain(['--expect-db', SCRATCH_DB], { executor: tx });
      spy.mockRestore();
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toMatch(/not yet mapped: .*p2r-2/);
      // ALL counts only mapped bundles (core + related, decision 2026-10-19): p2r-2's 2 picks are excluded.
      const all = sumAgreement(inputs.map(computeAgreement));
      expect(out).toContain(`ALL\n  AI placed ${all.aiCount} (core + related; fringe excluded), reviewer placed ${all.blindCount},`);
      expect(inputs.find(i => i.bundleId === B)!.blind.size).toBe(4);
    });
  });
});
