// @vitest-environment node
// P2 Task 11 — review-queue query semantics (applyMemberAction, bulkConfirm,
// submitBlindPicks, resetBlind, isBlindLocked) and controller rulings B–E,
// against the scratch clone. Every write runs inside a transaction that is
// rolled back, so the clone's rows never change. Gated isP2ScratchDb().
// Seeds synthetic bundles p2ra-*; uses real 31.0 element/task rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  subCompetencies, subCompetencyMap, bundleMembers, bundleGoldenSamples, bundleGoldenPicks, bundleMappingRuns, bundleMappingOutcomes,
  onetElementDefinitions, onetTaskStatements, type GoldenCandidate,
} from '@/lib/db/schema';
import {
  applyMemberAction, bulkConfirm, submitBlindPicks, resetBlind, isBlindLocked, reconcileBundle, BLIND_NOT_MAPPED, type Executor,
} from '@/lib/db/bundle-queries';
import { taskGroupKey } from '@/lib/catalog/shortlist';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const REL = '31.0';
const S = 'p2ra-sampled';
const Q = 'p2ra-queue';
const OTHER = 'p2ra-other';
const MODEL = 'gpt-test';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error('transaction committed — expected rollback');
}

let E: Array<{ id: string; name: string }> = [];
let T: Array<{ taskId: string; onetSocCode: string; task: string }> = [];
let G1: GoldenCandidate; // two members (two real task rows sharing one label for the test's purposes)
let G2: GoldenCandidate;

beforeAll(async () => {
  if (!RUN) return;
  E = (await db.select({ id: onetElementDefinitions.elementId, name: onetElementDefinitions.elementName }).from(onetElementDefinitions)
    .where(eq(onetElementDefinitions.release, REL)).orderBy(asc(onetElementDefinitions.elementId)).limit(6));
  T = await db.select({ taskId: onetTaskStatements.taskId, onetSocCode: onetTaskStatements.onetSocCode, task: onetTaskStatements.task })
    .from(onetTaskStatements).where(eq(onetTaskStatements.release, REL)).orderBy(asc(onetTaskStatements.onetSocCode), asc(onetTaskStatements.taskId)).limit(4);
  G1 = { key: taskGroupKey(T[0]!.task), label: T[0]!.task, rank: 1, score: 0.9, members: [T[0]!, T[1]!].map(t => ({ taskId: t.taskId, onetSocCode: t.onetSocCode })) };
  G2 = { key: taskGroupKey(T[2]!.task), label: T[2]!.task, rank: 2, score: 0.8, members: [{ taskId: T[2]!.taskId, onetSocCode: T[2]!.onetSocCode }] };
});

async function seedBundles(tx: Executor): Promise<void> {
  const ids = [S, Q, OTHER];
  await tx.insert(subCompetencies).values(ids.map(id => ({
    id, name: `Review ${id}`, knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D',
    retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
  })));
  await tx.insert(subCompetencyMap).values(ids.map(id => ({ oldSubCompetencyId: id, competencyId: id, mergeNote: null })));
}

/** An ok mapping outcome for the bundle: the blind pick needs one (adversarial I-2). */
async function markMapped(tx: Executor, bundleId: string, status: 'ok' | 'failed' = 'ok'): Promise<void> {
  const [run] = await tx.insert(bundleMappingRuns).values({ model: MODEL, promptVersion: 'p', taskShortlistK: 25, bundleCount: 1, dryRun: false }).returning({ id: bundleMappingRuns.id });
  await tx.insert(bundleMappingOutcomes).values({ runId: run!.id, bundleId, status, noCleanMatch: false, note: null });
}

function ai(bundleId: string, i: number, position: 'core' | 'related' | 'fringe', extra: Partial<typeof bundleMembers.$inferInsert> = {}) {
  return {
    bundleId, source: 'onet_element' as const, externalId: E[i]!.id, externalLabel: E[i]!.name, onetSocCode: null, release: REL,
    position, aiPosition: position, status: 'proposed' as const, proposedBy: MODEL, rationale: 'r', ...extra,
  };
}

async function members(tx: Executor, bundleId: string) {
  const rows = await tx.select().from(bundleMembers).where(eq(bundleMembers.bundleId, bundleId));
  return new Map(rows.map(r => [`${r.externalId}|${r.onetSocCode ?? ''}`, r]));
}

async function sampleRow(tx: Executor, bundleId: string) {
  const [s] = await tx.select().from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId));
  return s!;
}

async function picks(tx: Executor, bundleId: string) {
  return tx.select().from(bundleGoldenPicks).where(eq(bundleGoldenPicks.bundleId, bundleId))
    .orderBy(asc(bundleGoldenPicks.source), asc(bundleGoldenPicks.externalId), asc(bundleGoldenPicks.onetSocCode));
}

describe.skipIf(!RUN)('P2 Task 11 — review actions (scratch DB only)', () => {
  it('confirm / reject touch only proposed rows of THIS bundle', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      const [p1, p2, decided, other] = await tx.insert(bundleMembers).values([
        ai(Q, 0, 'core'), ai(Q, 1, 'related'),
        ai(Q, 2, 'core', { status: 'rejected', confirmedBy: 'Earlier', confirmedAt: new Date('2026-10-01T00:00:00Z') }),
        ai(OTHER, 0, 'core'),
      ]).returning({ id: bundleMembers.id });

      const r = await applyMemberAction(tx, Q, 'Pat', { action: 'confirm', memberIds: [p1!.id, decided!.id, other!.id] }, REL);
      expect(r).toEqual({ ok: true, changed: 1 });
      const rj = await applyMemberAction(tx, Q, 'Pat', { action: 'reject', memberIds: [p2!.id, decided!.id] }, REL);
      expect(rj).toEqual({ ok: true, changed: 1 });

      const m = await members(tx, Q);
      expect(m.get(`${E[0]!.id}|`)).toMatchObject({ status: 'confirmed', confirmedBy: 'Pat' });
      expect(m.get(`${E[0]!.id}|`)!.confirmedAt).not.toBeNull();
      expect(m.get(`${E[1]!.id}|`)).toMatchObject({ status: 'rejected', confirmedBy: 'Pat' });
      expect(m.get(`${E[2]!.id}|`)).toMatchObject({ status: 'rejected', confirmedBy: 'Earlier' });
      expect((await members(tx, OTHER)).get(`${E[0]!.id}|`)).toMatchObject({ status: 'proposed', confirmedBy: null });
    });
  });

  it('set_position confirms the row and keeps ai_position (ruling E)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      const [p] = await tx.insert(bundleMembers).values([ai(Q, 0, 'core')]).returning({ id: bundleMembers.id });
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'set_position', memberIds: [p!.id], position: 'fringe' }, REL)).toEqual({ ok: true, changed: 1 });
      const row = (await members(tx, Q)).get(`${E[0]!.id}|`)!;
      expect(row).toMatchObject({ status: 'confirmed', position: 'fringe', aiPosition: 'core', confirmedBy: 'Pat', reviewNote: 'position changed from core' });
      expect(row.confirmedAt).not.toBeNull();
      // Decided: a second set_position (or confirm) changes nothing.
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'set_position', memberIds: [p!.id], position: 'related' }, REL)).toEqual({ ok: true, changed: 0 });
    });
  });

  it('add: inserts a confirmed reviewer row with the O*NET label; 409 for an existing item; 404 for an unknown one', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      await tx.insert(bundleMembers).values([ai(Q, 0, 'core')]);
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'add', item: { kind: 'element', elementId: E[0]!.id }, position: 'core' }, REL))
        .toEqual({ ok: false, status: 409, error: 'already a member; use confirm or set_position' });
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'add', item: { kind: 'element', elementId: '9.Z.9.z' }, position: 'core' }, REL))
        .toMatchObject({ ok: false, status: 404 });
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'add', item: { kind: 'task', taskId: 'nope', onetSocCode: T[0]!.onetSocCode }, position: 'core' }, REL))
        .toMatchObject({ ok: false, status: 404 });

      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'add', item: { kind: 'element', elementId: E[1]!.id }, position: 'related' }, REL)).toEqual({ ok: true, changed: 1 });
      expect(await applyMemberAction(tx, Q, 'Pat', { action: 'add', item: { kind: 'task', taskId: T[0]!.taskId, onetSocCode: T[0]!.onetSocCode }, position: 'fringe' }, REL)).toEqual({ ok: true, changed: 1 });
      const m = await members(tx, Q);
      expect(m.get(`${E[1]!.id}|`)).toMatchObject({ source: 'onet_element', externalLabel: E[1]!.name, status: 'confirmed', proposedBy: 'reviewer', aiPosition: null, position: 'related', confirmedBy: 'Pat', reviewNote: null });
      expect(m.get(`${T[0]!.taskId}|${T[0]!.onetSocCode}`)).toMatchObject({ source: 'onet_task', externalLabel: T[0]!.task, release: REL, status: 'confirmed', proposedBy: 'reviewer' });
    });
  });

  it('bulkConfirm confirms every proposed row with bulk_confirmed, leaving decided rows alone', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      await tx.insert(bundleMembers).values([
        ai(Q, 0, 'core'), ai(Q, 1, 'fringe'),
        ai(Q, 2, 'core', { status: 'rejected', confirmedBy: 'Earlier', confirmedAt: new Date() }),
        ai(OTHER, 0, 'core'),
      ]);
      expect(await bulkConfirm(tx, Q, 'Pat')).toEqual({ ok: true, changed: 2 });
      const m = await members(tx, Q);
      for (const i of [0, 1]) expect(m.get(`${E[i]!.id}|`)).toMatchObject({ status: 'confirmed', bulkConfirmed: true, confirmedBy: 'Pat' });
      expect(m.get(`${E[2]!.id}|`)).toMatchObject({ status: 'rejected', bulkConfirmed: false });
      expect((await members(tx, OTHER)).get(`${E[0]!.id}|`)!.status).toBe('proposed');
      expect(await bulkConfirm(tx, 'p2ra-missing', 'Pat')).toMatchObject({ ok: false, status: 404 });
    });
  });

  it('queue writes are refused (409) while blind-locked; isBlindLocked tracks submit', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: S, stratum: 'technical', sampleSeed: 's', candidates: [G1, G2] });
      const [p] = await tx.insert(bundleMembers).values([ai(S, 0, 'core')]).returning({ id: bundleMembers.id });
      await markMapped(tx, S);
      expect(await isBlindLocked(S, tx)).toBe(true);
      expect(await isBlindLocked(Q, tx)).toBe(false);
      expect(await applyMemberAction(tx, S, 'Pat', { action: 'confirm', memberIds: [p!.id] }, REL)).toEqual({ ok: false, status: 409, error: 'blind sample not submitted' });
      expect(await applyMemberAction(tx, S, 'Pat', { action: 'add', item: { kind: 'element', elementId: E[3]!.id }, position: 'core' }, REL)).toMatchObject({ ok: false, status: 409 });
      expect(await bulkConfirm(tx, S, 'Pat')).toMatchObject({ ok: false, status: 409 });
      expect(await resetBlind(tx, S, 'Pat', 'n')).toMatchObject({ ok: false, status: 409 });
      expect(await submitBlindPicks(tx, S, 'Pat', [{ kind: 'element', elementId: E[0]!.id, position: 'core' }], false, REL)).toMatchObject({ ok: true });
      expect(await isBlindLocked(S, tx)).toBe(false);
    });
  });

  describe('submitBlindPicks', () => {
    async function seedSample(tx: Executor) {
      await seedBundles(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: S, stratum: 'technical', sampleSeed: 's', candidates: [G1, G2] });
      await markMapped(tx, S);
    }

    it('409 "not mapped yet" until the bundle has an ok mapping outcome (a failed one does not count); nothing written (adversarial I-2)', async () => {
      await inRolledBackTx(async (tx) => {
        await seedBundles(tx);
        await tx.insert(bundleGoldenSamples).values({ bundleId: S, stratum: 'technical', sampleSeed: 's', candidates: [G1, G2] });
        const pick = { kind: 'element' as const, elementId: E[0]!.id, position: 'core' as const };
        expect(BLIND_NOT_MAPPED).toBe("This bundle hasn't been mapped yet — run the mapping before its blind pick");
        expect(await submitBlindPicks(tx, S, 'Pat', [pick], false, REL)).toEqual({ ok: false, status: 409, error: BLIND_NOT_MAPPED });
        expect(await submitBlindPicks(tx, S, 'Pat', [], true, REL)).toEqual({ ok: false, status: 409, error: BLIND_NOT_MAPPED });
        await markMapped(tx, S, 'failed');
        expect(await submitBlindPicks(tx, S, 'Pat', [pick], false, REL)).toEqual({ ok: false, status: 409, error: BLIND_NOT_MAPPED });
        expect(await picks(tx, S)).toHaveLength(0);
        expect((await sampleRow(tx, S)).submittedAt).toBeNull();
        expect(await isBlindLocked(S, tx)).toBe(true);
        expect(await members(tx, S)).toEqual(new Map());

        await markMapped(tx, S);
        expect(await submitBlindPicks(tx, S, 'Pat', [pick], false, REL)).toMatchObject({ ok: true });
      });
    });

    it('404 when not sampled; 400 for no-clean-match plus picks, an outside task group, an unknown element, a duplicate, or nothing', async () => {
      await inRolledBackTx(async (tx) => {
        await seedSample(tx);
        const pick = { kind: 'element' as const, elementId: E[0]!.id, position: 'core' as const };
        expect(await submitBlindPicks(tx, Q, 'Pat', [pick], false, REL)).toMatchObject({ ok: false, status: 404 });
        expect(await submitBlindPicks(tx, S, 'Pat', [pick], true, REL)).toMatchObject({ ok: false, status: 400 });
        expect(await submitBlindPicks(tx, S, 'Pat', [{ kind: 'task', groupKey: 'ffffffffffffffff', position: 'core' }], false, REL)).toMatchObject({ ok: false, status: 400 });
        expect(await submitBlindPicks(tx, S, 'Pat', [{ kind: 'element', elementId: '9.Z.9.z', position: 'core' }], false, REL)).toMatchObject({ ok: false, status: 400 });
        expect(await submitBlindPicks(tx, S, 'Pat', [pick, { ...pick, position: 'fringe' }], false, REL)).toMatchObject({ ok: false, status: 400 });
        expect(await submitBlindPicks(tx, S, 'Pat', [], false, REL)).toMatchObject({ ok: false, status: 400 });
        expect(await picks(tx, S)).toHaveLength(0);
        expect((await sampleRow(tx, S)).submittedAt).toBeNull();
      });
    });

    it('expands a task group to one pick per member, submits, reconciles in the same transaction (ruling B); a second submit is 409', async () => {
      await inRolledBackTx(async (tx) => {
        await seedSample(tx);
        await tx.insert(bundleMembers).values([ai(S, 0, 'core')]);
        const r = await submitBlindPicks(tx, S, 'Pat', [
          { kind: 'element', elementId: E[0]!.id, position: 'core' },
          { kind: 'task', groupKey: G1.key, position: 'related' },
        ], false, REL);
        expect(r).toEqual({ ok: true, reconcile: { skipped: false, confirmed: 1, added: 2, disagreements: 0 } });
        const ps = await picks(tx, S);
        expect(ps.filter(p => p.source === 'onet_task').map(p => `${p.externalId}|${p.onetSocCode}|${p.position}`).sort())
          .toEqual(G1.members.map(m => `${m.taskId}|${m.onetSocCode}|related`).sort());
        expect(ps).toHaveLength(3);
        const s = await sampleRow(tx, S);
        expect(s.reviewer).toBe('Pat');
        expect(s.submittedAt).not.toBeNull();
        expect((await members(tx, S)).get(`${E[0]!.id}|`)).toMatchObject({ status: 'confirmed', confirmedBy: 'Pat' });
        expect(await submitBlindPicks(tx, S, 'Pat', [{ kind: 'element', elementId: E[1]!.id, position: 'core' }], false, REL))
          .toMatchObject({ ok: false, status: 409 });
      });
    });

    it('no clean match stores one no_clean_match row', async () => {
      await inRolledBackTx(async (tx) => {
        await seedSample(tx);
        expect(await submitBlindPicks(tx, S, 'Pat', [], true, REL)).toMatchObject({ ok: true });
        const ps = await picks(tx, S);
        expect(ps).toHaveLength(1);
        expect(ps[0]).toMatchObject({ noCleanMatch: true, source: null, externalId: null, position: null });
      });
    });
  });

  describe('resetBlind (ruling C)', () => {
    /**
     * A submitted sample where reconcile has: confirmed an agreed AI row (E0),
     * noted a disagreement on a proposed row (E1), added a reviewer-only row
     * (E2). Then the queue decided rows: confirmed E3, rejected E4,
     * set_position on E5, and added a task — all of which must survive a reset.
     */
    async function seedReconciled(tx: Executor) {
      await seedBundles(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: S, stratum: 'technical', sampleSeed: 's', candidates: [G1, G2] });
      await markMapped(tx, S);
      const ids = await tx.insert(bundleMembers).values([
        ai(S, 0, 'core'), ai(S, 1, 'fringe'), ai(S, 3, 'core'), ai(S, 4, 'core'), ai(S, 5, 'related'),
      ]).returning({ id: bundleMembers.id, externalId: bundleMembers.externalId });
      const id = (i: number) => ids.find(r => r.externalId === E[i]!.id)!.id;
      const sub = await submitBlindPicks(tx, S, 'Pat', [
        { kind: 'element', elementId: E[0]!.id, position: 'core' },
        { kind: 'element', elementId: E[1]!.id, position: 'related' },
        { kind: 'element', elementId: E[2]!.id, position: 'core' },
      ], false, REL);
      expect(sub).toEqual({ ok: true, reconcile: { skipped: false, confirmed: 1, added: 1, disagreements: 1 } });
      expect((await applyMemberAction(tx, S, 'Queue', { action: 'confirm', memberIds: [id(3)] }, REL)).ok).toBe(true);
      expect((await applyMemberAction(tx, S, 'Queue', { action: 'reject', memberIds: [id(4)] }, REL)).ok).toBe(true);
      expect((await applyMemberAction(tx, S, 'Queue', { action: 'set_position', memberIds: [id(5)], position: 'core' }, REL)).ok).toBe(true);
      expect((await applyMemberAction(tx, S, 'Queue', { action: 'add', item: { kind: 'task', taskId: T[3]!.taskId, onetSocCode: T[3]!.onetSocCode }, position: 'core' }, REL)).ok).toBe(true);
    }

    it('400 without a note; 404 when not sampled', async () => {
      await inRolledBackTx(async (tx) => {
        await seedReconciled(tx);
        expect(await resetBlind(tx, S, 'Admin', '   ')).toMatchObject({ ok: false, status: 400 });
        expect(await resetBlind(tx, S, 'Admin', 'x'.repeat(501))).toMatchObject({ ok: false, status: 400 });
        expect(await resetBlind(tx, Q, 'Admin', 'n')).toMatchObject({ ok: false, status: 404 });
        expect((await sampleRow(tx, S)).submittedAt).not.toBeNull();
      });
    });

    it('undoes reconcile, deletes the picks, re-locks, appends reset_note — and never touches queue decisions', async () => {
      await inRolledBackTx(async (tx) => {
        await seedReconciled(tx);
        const before = await members(tx, S);
        const queueKeys = [`${E[3]!.id}|`, `${E[4]!.id}|`, `${E[5]!.id}|`, `${T[3]!.taskId}|${T[3]!.onetSocCode}`];

        expect(await resetBlind(tx, S, 'Admin', '  wrong reviewer  ')).toEqual({ ok: true });

        const after = await members(tx, S);
        // reconcile's confirmation reverted
        expect(after.get(`${E[0]!.id}|`)).toMatchObject({ status: 'proposed', confirmedBy: null, confirmedAt: null, reviewNote: null, position: 'core', aiPosition: 'core' });
        // reconcile's disagreement note cleared
        expect(after.get(`${E[1]!.id}|`)).toMatchObject({ status: 'proposed', reviewNote: null });
        // reconcile's reviewer-only insert deleted
        expect(after.has(`${E[2]!.id}|`)).toBe(false);
        // queue decisions untouched, field for field
        for (const k of queueKeys) expect(after.get(k)).toEqual(before.get(k));
        expect(after.get(`${E[5]!.id}|`)).toMatchObject({ status: 'confirmed', position: 'core', aiPosition: 'related' });

        expect(await picks(tx, S)).toHaveLength(0);
        const s = await sampleRow(tx, S);
        expect(s.submittedAt).toBeNull();
        expect(s.resetNote).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z Admin: wrong reviewer$/);
        expect(await isBlindLocked(S, tx)).toBe(true);
      });
    });

    it('a resubmission after a reset starts clean and replaces the previous picks; reset_note accumulates', async () => {
      await inRolledBackTx(async (tx) => {
        await seedReconciled(tx);
        expect(await resetBlind(tx, S, 'Admin', 'first')).toEqual({ ok: true });
        const r = await submitBlindPicks(tx, S, 'Pat', [{ kind: 'element', elementId: E[1]!.id, position: 'fringe' }], false, REL);
        expect(r).toEqual({ ok: true, reconcile: { skipped: false, confirmed: 1, added: 0, disagreements: 0 } });
        const ps = await picks(tx, S);
        expect(ps.map(p => `${p.externalId}|${p.position}`)).toEqual([`${E[1]!.id}|fringe`]);
        const m = await members(tx, S);
        expect(m.get(`${E[0]!.id}|`)).toMatchObject({ status: 'proposed', reviewNote: null }); // no stale reconcile state
        expect(m.get(`${E[1]!.id}|`)).toMatchObject({ status: 'confirmed', confirmedBy: 'Pat' });
        expect(await resetBlind(tx, S, 'Admin', 'second')).toEqual({ ok: true });
        expect((await sampleRow(tx, S)).resetNote).toMatch(/Admin: first\n.* Admin: second$/);
      });
    });
  });

  it('reconcile never clobbers a reviewer\'s own note on a proposed row (ruling D)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx);
      await tx.insert(bundleGoldenSamples).values({ bundleId: S, stratum: 'technical', sampleSeed: 's', candidates: [G1], reviewer: 'Pat', submittedAt: new Date() });
      await tx.insert(bundleMembers).values([ai(S, 0, 'fringe', { reviewNote: 'my own note' }), ai(S, 1, 'fringe'), ai(S, 2, 'fringe', { reviewNote: 'blind pick: related' })]);
      await tx.insert(bundleGoldenPicks).values([0, 1, 2].map(i => ({
        bundleId: S, reviewer: 'Pat', source: 'onet_element' as const, externalId: E[i]!.id, onetSocCode: null, release: REL, position: 'core' as const, noCleanMatch: false,
      })));
      const r = await reconcileBundle(tx, S);
      expect(r).toEqual({ skipped: false, confirmed: 0, added: 0, disagreements: 3 });
      const m = await members(tx, S);
      expect(m.get(`${E[0]!.id}|`)!.reviewNote).toBe('my own note');
      expect(m.get(`${E[1]!.id}|`)!.reviewNote).toBe('blind pick: core');
      expect(m.get(`${E[2]!.id}|`)!.reviewNote).toBe('blind pick: core'); // an earlier reconcile note is refreshed
      const [own] = await tx.select().from(bundleMembers).where(and(eq(bundleMembers.bundleId, S), eq(bundleMembers.externalId, E[0]!.id)));
      expect(own!.status).toBe('proposed');
    });
  });
});
