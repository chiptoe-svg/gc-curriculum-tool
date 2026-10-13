// @vitest-environment node
// P2 Task 10 — the mapping writer (writeBundleProposals, recordFailedOutcome)
// and the map-bundles-onet CLI, against the scratch clone. Every write runs
// inside a transaction that is rolled back, so the scratch clone's rows are
// never changed. Gated isP2ScratchDb(): needs 0059 applied for real. Seeds
// its own synthetic bundles (ids p2p-*).
//
// Invariant under test (destruction-capable path): at every instant,
// including across a failure mid-bundle, a bundle's rows are either the
// complete old set or the complete new set, and confirmed/rejected rows are
// never deleted or modified by a mapping run.
import { describe, it, expect, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  subCompetencies, subCompetencyMap, bundleMembers, bundleMappingRuns, bundleMappingOutcomes,
  bundleGoldenSamples, bundleGoldenPicks,
} from '@/lib/db/schema';
import {
  createRun, finishRun, writeBundleProposals, recordFailedOutcome, bundlesWithOkOutcome, type Executor,
} from '@/lib/db/bundle-queries';
import type { MemberRow, PlacementInput, PlacementResult } from '@/lib/ai/catalog/map-bundle-onet';
import type { BundleSummary, CardFields } from '@/lib/catalog/bundles';
import type { TaskRow } from '@/lib/catalog/shortlist';
import { main, type CliDeps } from '@/scripts/catalog/map-bundles-onet';
import { isP2ScratchDb, SCRATCH_DB } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const REL = '31.0';
const B = 'p2p-1';
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
    throw err;
  }
  throw new Error('transaction committed — expected rollback');
}

async function seedBundles(tx: Executor, ids: string[]): Promise<void> {
  await tx.insert(subCompetencies).values(ids.map(id => ({
    id, name: `Proposals ${id}`, knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D',
    retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
  })));
  await tx.insert(subCompetencyMap).values(ids.map(id => ({ oldSubCompetencyId: id, competencyId: id, mergeNote: null })));
}

async function seedRun(tx: Executor): Promise<string> {
  return createRun(tx, { model: MODEL, promptVersion: 'bundle-map-onet@1', taskShortlistK: 25, bundleCount: 1 });
}

function el(externalId: string, position: MemberRow['position']): MemberRow {
  return { source: 'onet_element', externalId, externalLabel: `Element ${externalId}`, onetSocCode: null, release: REL, position, rationale: `why ${externalId}` };
}
function task(externalId: string, soc: string | null, position: MemberRow['position']): MemberRow {
  return { source: 'onet_task', externalId, externalLabel: `Task ${externalId}`, onetSocCode: soc, release: REL, position, rationale: `why ${externalId}` };
}

// ctid included: inside one transaction now() is constant, so a spurious
// UPDATE would leave updated_at unchanged — but it always moves the tuple.
async function snapshot(tx: Executor, bundleId: string) {
  return tx.select({ row: bundleMembers, ctid: sql<string>`${bundleMembers}.ctid::text` }).from(bundleMembers)
    .where(eq(bundleMembers.bundleId, bundleId))
    .orderBy(asc(bundleMembers.source), asc(bundleMembers.externalId), asc(bundleMembers.onetSocCode));
}
async function outcomes(tx: Executor, bundleId: string) {
  return tx.select().from(bundleMappingOutcomes).where(eq(bundleMappingOutcomes.bundleId, bundleId));
}

/** Case B seed: confirmed X, rejected Y (elements), proposed Z from an earlier run. */
async function seedDecided(tx: Executor): Promise<void> {
  const earlierRun = await seedRun(tx);
  const base = { bundleId: B, source: 'onet_element' as const, onetSocCode: null, release: REL, proposedBy: MODEL, rationale: 'earlier' };
  await tx.insert(bundleMembers).values([
    { ...base, externalId: 'X', externalLabel: 'Element X', position: 'core', aiPosition: 'core', status: 'confirmed', confirmedBy: 'Owner', confirmedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), runId: earlierRun },
    { ...base, externalId: 'Y', externalLabel: 'Element Y', position: 'related', aiPosition: 'related', status: 'rejected', confirmedBy: 'Owner', confirmedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), reviewNote: 'not this bundle', runId: earlierRun },
    { ...base, externalId: 'Z', externalLabel: 'Element Z', position: 'fringe', aiPosition: 'fringe', status: 'proposed', runId: earlierRun },
  ]);
}

describe.skipIf(!RUN)('P2 Task 10 — writeBundleProposals / recordFailedOutcome (scratch DB only)', () => {
  it('Case A: first write inserts proposed rows (ai_position = position, proposed_by, run_id) and one ok outcome', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      const runId = await seedRun(tx);
      const res = await writeBundleProposals(tx, {
        runId, bundleId: B, model: MODEL, noCleanMatch: false, note: 'n', costUsdCents: 123,
        rows: [el('e1', 'core'), el('e2', 'fringe'), task('t1', '99-0001.00', 'related')],
      });
      expect(res).toMatchObject({ deleted: 0, inserted: 3, keptDecided: 0 });
      expect(res.reconcile.skipped).toBe(true);
      const rows = (await snapshot(tx, B)).map(r => r.row);
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.status).toBe('proposed');
        expect(r.aiPosition).toBe(r.position);
        expect(r.proposedBy).toBe(MODEL);
        expect(r.runId).toBe(runId);
        expect(r.confirmedBy).toBeNull();
      }
      expect(rows.find(r => r.externalId === 't1')).toMatchObject({ source: 'onet_task', onetSocCode: '99-0001.00', position: 'related' });
      const out = await outcomes(tx, B);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ runId, status: 'ok', noCleanMatch: false, note: 'n', costUsdCents: 123 });
    });
  });

  it('Case B: rerun deletes only proposed rows; confirmed/rejected rows are untouched (rerun safety)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      await seedDecided(tx);
      const before = new Map((await snapshot(tx, B)).map(r => [r.row.externalId, r]));
      const runId = await seedRun(tx);

      const res = await writeBundleProposals(tx, {
        runId, bundleId: B, model: MODEL, noCleanMatch: false, note: null, costUsdCents: 0,
        rows: [el('X', 'fringe'), el('Y', 'related'), el('W', 'core')],
      });

      const after = new Map((await snapshot(tx, B)).map(r => [r.row.externalId, r]));
      // X: confirmed, untouched (same tuple, same position/confirmed_by/updated_at).
      expect(after.get('X')).toEqual(before.get('X'));
      expect(after.get('X')!.row).toMatchObject({ status: 'confirmed', position: 'core', confirmedBy: 'Owner' });
      // Y: rejected, untouched.
      expect(after.get('Y')).toEqual(before.get('Y'));
      // Z: the earlier run's proposal, deleted.
      expect(after.has('Z')).toBe(false);
      // W: new proposal.
      expect(after.get('W')!.row).toMatchObject({ status: 'proposed', position: 'core', aiPosition: 'core', runId });
      expect(after.size).toBe(3);
      expect(res).toMatchObject({ deleted: 1, inserted: 1, keptDecided: 2 });
    });
  });

  it('Case C: a row violating a CHECK throws and leaves no partial rows and no outcome (inner transaction)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      await seedDecided(tx);
      const beforeMembers = await snapshot(tx, B);
      const beforeOutcomes = await outcomes(tx, B);
      const runId = await seedRun(tx);

      await expect(tx.transaction(inner => writeBundleProposals(inner, {
        runId, bundleId: B, model: MODEL, noCleanMatch: false, note: null, costUsdCents: 0,
        rows: [el('W', 'core'), task('t-bad', null, 'core')],
      }))).rejects.toThrow();

      expect(await snapshot(tx, B)).toEqual(beforeMembers);
      expect((await snapshot(tx, B)).some(r => r.row.externalId === 'Z')).toBe(true);
      expect(await outcomes(tx, B)).toEqual(beforeOutcomes);
    });
  });

  it('Case C2: the same failure with NO caller wrapper still leaves no partial rows (the writer owns its savepoint)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      await seedDecided(tx);
      const beforeMembers = await snapshot(tx, B);
      const runId = await seedRun(tx);

      await expect(writeBundleProposals(tx, {
        runId, bundleId: B, model: MODEL, noCleanMatch: false, note: null, costUsdCents: 0,
        rows: [el('W', 'core'), task('t-bad', null, 'core')],
      })).rejects.toThrow();

      // The caller's transaction is still usable, and nothing changed.
      expect(await snapshot(tx, B)).toEqual(beforeMembers);
      expect(await outcomes(tx, B)).toEqual([]);
    });
  });

  it('Case D: with a submitted sample whose pick agrees with a new proposed row, reconcile confirms it in the same write', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      await tx.insert(bundleGoldenSamples).values({ bundleId: B, stratum: 'technical', sampleSeed: 's', candidates: [], reviewer: 'R', submittedAt: new Date() });
      await tx.insert(bundleGoldenPicks).values({ bundleId: B, reviewer: 'R', source: 'onet_element', externalId: 'e1', onetSocCode: null, release: REL, position: 'core', noCleanMatch: false });
      const runId = await seedRun(tx);

      const res = await writeBundleProposals(tx, {
        runId, bundleId: B, model: MODEL, noCleanMatch: false, note: null, costUsdCents: 0,
        rows: [el('e1', 'core'), el('e2', 'related')],
      });
      expect(res.reconcile).toEqual({ skipped: false, confirmed: 1, added: 0, disagreements: 0 });
      const rows = new Map((await snapshot(tx, B)).map(r => [r.row.externalId, r.row]));
      expect(rows.get('e1')).toMatchObject({ status: 'confirmed', confirmedBy: 'R', aiPosition: 'core' });
      expect(rows.get('e2')).toMatchObject({ status: 'proposed' });
    });
  });

  it('Case E: recordFailedOutcome writes failed/no_clean_match=false, touches no members, a retry overwrites its own failure but never an ok', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, [B]);
      await seedDecided(tx);
      const beforeMembers = await snapshot(tx, B);
      const runId = await seedRun(tx);

      await recordFailedOutcome(tx, { runId, bundleId: B, note: 'boom', costUsdCents: 0 });
      expect(await snapshot(tx, B)).toEqual(beforeMembers);
      let out = await outcomes(tx, B);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ runId, status: 'failed', noCleanMatch: false, note: 'boom', costUsdCents: 0 });

      await recordFailedOutcome(tx, { runId, bundleId: B, note: 'boom again', costUsdCents: 5 });
      out = await outcomes(tx, B);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ status: 'failed', note: 'boom again', costUsdCents: 5 });
      expect(await bundlesWithOkOutcome(tx)).not.toContain(B);

      // An ok outcome in another run is never downgraded by a stray failure record.
      const run2 = await seedRun(tx);
      await writeBundleProposals(tx, { runId: run2, bundleId: B, model: MODEL, noCleanMatch: true, note: null, costUsdCents: 0, rows: [] });
      await recordFailedOutcome(tx, { runId: run2, bundleId: B, note: 'late', costUsdCents: 0 });
      const [ok] = await tx.select().from(bundleMappingOutcomes).where(eq(bundleMappingOutcomes.runId, run2));
      expect(ok).toMatchObject({ status: 'ok', noCleanMatch: true, note: null });
      expect(await bundlesWithOkOutcome(tx)).toContain(B);
    });
  });

  it('createRun / finishRun record the run row (dry_run false; finished_at and cost set on finish)', async () => {
    await inRolledBackTx(async (tx) => {
      const runId = await createRun(tx, { model: MODEL, promptVersion: 'pv', taskShortlistK: 25, bundleCount: 3 });
      let [r] = await tx.select().from(bundleMappingRuns).where(eq(bundleMappingRuns.id, runId));
      expect(r).toMatchObject({ model: MODEL, promptVersion: 'pv', taskShortlistK: 25, bundleCount: 3, dryRun: false, costUsdCents: 0, finishedAt: null });
      await finishRun(tx, runId, 456);
      [r] = await tx.select().from(bundleMappingRuns).where(eq(bundleMappingRuns.id, runId));
      expect(r!.costUsdCents).toBe(456);
      expect(r!.finishedAt).not.toBeNull();
    });
  });
});

// ─── CLI ────────────────────────────────────────────────────────────────────

const CLI_IDS = ['p2p-c1', 'p2p-c2', 'p2p-c3'];
const SUMMARIES: BundleSummary[] = CLI_IDS.map(id => ({ id, name: `CLI ${id}`, knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D', origin: 'gc_authored' }));
const CARD: CardFields = { stratum: 'technical', includes: 'i', excludes: 'x', distinctions: 'd', positiveExamples: ['p'], negativeExamples: ['n'] };
const TASKS: TaskRow[] = [
  { taskId: 'p2p-t1', onetSocCode: '99-0001.00', task: 'Synthetic proofing task.' },
  { taskId: 'p2p-t2', onetSocCode: '99-0002.00', task: 'Synthetic budgeting task.' },
];

function fakePlacement(input: PlacementInput): PlacementResult {
  return {
    rows: [el(`${input.bundle.id}-e1`, 'core')], noCleanMatch: false, note: null, droppedIds: [], model: MODEL, costUsdCents: 100,
  };
}

function cliDeps(tx: Executor, placeBundle: CliDeps['placeBundle']): CliDeps & { recordSpend: ReturnType<typeof vi.fn> } {
  return {
    executor: tx,
    placeBundle,
    listActiveBundles: async () => SUMMARIES,
    readConfirmedCards: async () => new Map(CLI_IDS.map(id => [id, CARD])),
    readElementDefinitions: async () => [{ elementId: '2.C.1.a', elementName: 'Admin', domain: 'knowledge', description: 'd' }],
    readTaskStatements: async () => TASKS,
    readVectors: async (_ex, _kind, wanted) => new Map(wanted.map((w, i) => [w.ref, [1, i + 1, 0]])),
    checkDailyCap: async () => ({ ok: true, spentCents: 0, overCap: false }),
    recordSpend: vi.fn(async () => {}),
    estimate: () => 100,
    resolveModel: async () => MODEL,
  };
}

async function cliOutcomes(tx: Executor) {
  const rows = await tx.select().from(bundleMappingOutcomes);
  return rows.filter(r => CLI_IDS.includes(r.bundleId));
}

describe.skipIf(!RUN)('P2 Task 10 — map-bundles-onet CLI (scratch DB only)', () => {
  it('--apply without --max-cost exits 2 and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      const runsBefore = (await tx.select().from(bundleMappingRuns)).length;
      expect(await main(['--expect-db', SCRATCH_DB, '--apply'], cliDeps(tx, place))).toBe(2);
      expect(place).not.toHaveBeenCalled();
      expect((await tx.select().from(bundleMappingRuns)).length).toBe(runsBefore);
      expect(await cliOutcomes(tx)).toEqual([]);
    });
  });

  it('dry run makes no placeBundle calls and no writes', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      const runsBefore = (await tx.select().from(bundleMappingRuns)).length;
      const deps = cliDeps(tx, place);
      expect(await main(['--expect-db', SCRATCH_DB], deps)).toBe(0);
      expect(place).not.toHaveBeenCalled();
      expect(deps.recordSpend).not.toHaveBeenCalled();
      expect((await tx.select().from(bundleMappingRuns)).length).toBe(runsBefore);
      expect(await cliOutcomes(tx)).toEqual([]);
      const members = await tx.select().from(bundleMembers);
      expect(members.filter(m => CLI_IDS.includes(m.bundleId))).toEqual([]);
    });
  });

  it('wrong --expect-db exits 1 before any write', async () => {
    await inRolledBackTx(async (tx) => {
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      expect(await main(['--expect-db', 'gc_curriculum', '--apply', '--max-cost', '1'], cliDeps(tx, place))).toBe(1);
      expect(place).not.toHaveBeenCalled();
    });
  });

  it('--bundles with an unknown id exits 2', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      expect(await main(['--expect-db', SCRATCH_DB, '--bundles', 'p2p-c1,nope'], cliDeps(tx, place))).toBe(2);
      expect(place).not.toHaveBeenCalled();
    });
  });

  it('--max-cost 0.025 (250 units) with 3 bundles at 100 each places 2, stops with exit 4, writes outcomes for exactly 2', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      const deps = cliDeps(tx, place);
      expect(await main(['--expect-db', SCRATCH_DB, '--apply', '--max-cost', '0.025'], deps)).toBe(4);
      expect(place).toHaveBeenCalledTimes(2);
      expect(deps.recordSpend).toHaveBeenCalledTimes(2);
      expect(deps.recordSpend).toHaveBeenCalledWith(100);
      const out = await cliOutcomes(tx);
      expect(out.map(o => o.bundleId).sort()).toEqual(['p2p-c1', 'p2p-c2']);
      expect(out.every(o => o.status === 'ok')).toBe(true);
      const [run] = await tx.select().from(bundleMappingRuns).where(eq(bundleMappingRuns.id, out[0]!.runId));
      expect(run).toMatchObject({ costUsdCents: 200, bundleCount: 3 });
      expect(run!.finishedAt).not.toBeNull();
    });
  });

  it('a daily-cap refusal stops the run with exit 4 before any paid call', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      const deps = { ...cliDeps(tx, place), checkDailyCap: async () => ({ ok: false, spentCents: 999, overCap: true }) };
      expect(await main(['--expect-db', SCRATCH_DB, '--apply', '--max-cost', '10'], deps)).toBe(4);
      expect(place).not.toHaveBeenCalled();
    });
  });

  it('a throw on bundle 2 records failed for it, places 1 and 3, exits 1; --missing then selects only bundle 2', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => {
        if (i.bundle.id === 'p2p-c2') throw new Error('model said no');
        return fakePlacement(i);
      });
      expect(await main(['--expect-db', SCRATCH_DB, '--apply', '--max-cost', '10'], cliDeps(tx, place))).toBe(1);
      expect(place).toHaveBeenCalledTimes(3);
      const out = new Map((await cliOutcomes(tx)).map(o => [o.bundleId, o]));
      expect(out.get('p2p-c1')!.status).toBe('ok');
      expect(out.get('p2p-c2')).toMatchObject({ status: 'failed', noCleanMatch: false });
      expect(out.get('p2p-c2')!.note).toMatch(/model said no/);
      expect(out.get('p2p-c3')!.status).toBe('ok');
      const c2Members = await tx.select().from(bundleMembers).where(eq(bundleMembers.bundleId, 'p2p-c2'));
      expect(c2Members).toEqual([]);

      const place2 = vi.fn(async (i: PlacementInput) => fakePlacement(i));
      expect(await main(['--expect-db', SCRATCH_DB, '--apply', '--max-cost', '10', '--missing'], cliDeps(tx, place2))).toBe(0);
      expect(place2).toHaveBeenCalledTimes(1);
      expect(place2.mock.calls[0]![0].bundle.id).toBe('p2p-c2');
    });
  });

  it('a write failure (DB error) records failed for that bundle and the run continues', async () => {
    await inRolledBackTx(async (tx) => {
      await seedBundles(tx, CLI_IDS);
      const place = vi.fn(async (i: PlacementInput) => {
        const r = fakePlacement(i);
        if (i.bundle.id === 'p2p-c1') r.rows.push(task('t-bad', null, 'core')); // violates bundle_members_soc_check
        return r;
      });
      expect(await main(['--expect-db', SCRATCH_DB, '--apply', '--max-cost', '10'], cliDeps(tx, place))).toBe(1);
      const out = new Map((await cliOutcomes(tx)).map(o => [o.bundleId, o]));
      expect(out.get('p2p-c1')!.status).toBe('failed');
      expect(out.get('p2p-c2')!.status).toBe('ok');
      expect(out.get('p2p-c3')!.status).toBe('ok');
      expect(await tx.select().from(bundleMembers).where(eq(bundleMembers.bundleId, 'p2p-c1'))).toEqual([]);
    });
  });
});
