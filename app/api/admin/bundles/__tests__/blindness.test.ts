// @vitest-environment node
// P2 Task 11 — server-side blindness (spec §5; controller ruling G). While a
// sampled bundle's blind pick is unsubmitted, NO route may let the AI's
// placements (members, rationale, outcome note) leave the server, and every
// queue write is refused. Gated isP2ScratchDb(): never runs against live.
//
// Isolation: the route handlers use the module `db`, so `@/lib/db/client` is
// mocked with a proxy that points `db` at ONE transaction held open for the
// whole file and rolled back in afterAll (a route's own db.transaction
// becomes a savepoint). Nothing is ever committed, so parallel test files
// that count golden samples (p2-draw, p2-reconcile) never see these rows.
// (A committed seed + cleanup, as first written, made p2-draw fail in a
// parallel run.)
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  subCompetencies, subCompetencyMap, bundleCards, bundleMembers, bundleGoldenSamples,
  bundleMappingRuns, bundleMappingOutcomes, onetTaskStatements, type GoldenCandidate,
} from '@/lib/db/schema';
import { taskGroupKey } from '@/lib/catalog/shortlist';
import { isP2ScratchDb } from '@/tests/db/p2/scratch-guard';

const held = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock('@/lib/db/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/client')>('@/lib/db/client');
  const db = new Proxy({}, {
    get(_t, k) {
      const target = (held.tx ?? actual.db) as Record<PropertyKey, unknown>;
      const v = target[k];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { ...actual, db };
});
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: () => true }));

import { db } from '@/lib/db/client';
import { GET as listGET } from '../route';
import { GET as detailGET } from '../[id]/route';
import { GET as agreementGET } from '../agreement/route';
import { GET as searchGET } from '../search/route';
import { POST as membersPOST } from '../[id]/members/route';
import { POST as bulkPOST } from '../[id]/bulk-confirm/route';
import { POST as resetPOST } from '../[id]/reset-blind/route';
import { POST as blindPOST } from '../[id]/blind/route';

const RUN = isP2ScratchDb();
const B = 'p2blind-a';
const REL = '31.0';
const RATIONALE = 'SECRET-RATIONALE-xyz';
const NOTE = 'SECRET-NOTE-xyz';
let memberId = '';
let searchWord = '';

class Rollback extends Error {}
let release: () => void = () => {};
let finished: Promise<void> = Promise.resolve();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (path: string, body: Record<string, unknown>) =>
  new Request(`http://h${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe.skipIf(!RUN)('P2 Task 11 — blindness enforced in the API (scratch DB only)', () => {
  beforeAll(async () => {
    await new Promise<void>((ready, fail) => {
      finished = db.transaction(async (tx) => {
        held.tx = tx;
        ready();
        await new Promise<void>(r => { release = r; });
        throw new Rollback('rollback');
      }).catch((err: unknown) => { if (!(err instanceof Rollback)) fail(err); });
    });
    const [task] = await db.select().from(onetTaskStatements).where(eq(onetTaskStatements.release, REL)).limit(1);
    if (!task) throw new Error('scratch clone has no 31.0 task statements');
    searchWord = task.task.split(/\s+/).find(w => /^[A-Za-z]{6,}$/.test(w)) ?? task.task.split(/\s+/)[0]!;
    const candidates: GoldenCandidate[] = [
      { key: taskGroupKey(task.task), label: task.task, rank: 1, score: 0.9, members: [{ taskId: task.taskId, onetSocCode: task.onetSocCode }] },
    ];
    await db.insert(subCompetencies).values({
      id: B, name: 'Blindness bundle', knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D',
      retired: false, mergedInto: null, origin: 'gc_authored', updatedAt: new Date(),
    });
    await db.insert(subCompetencyMap).values({ oldSubCompetencyId: B, competencyId: B, mergeNote: null });
    await db.insert(bundleCards).values({
      competencyId: B, stratum: 'technical', includes: 'i', excludes: 'e', distinctions: 'd',
      positiveExamples: ['p'], negativeExamples: ['n'], status: 'confirmed', confirmedBy: 'Owner', confirmedAt: new Date(),
    });
    await db.insert(bundleGoldenSamples).values({ bundleId: B, stratum: 'technical', sampleSeed: 's', candidates });
    const [run] = await db.insert(bundleMappingRuns).values({ model: 'gpt-test', promptVersion: 'v', taskShortlistK: 25, bundleCount: 1 }).returning({ id: bundleMappingRuns.id });
    const [m] = await db.insert(bundleMembers).values([
      { bundleId: B, source: 'onet_element', externalId: '2.B.5.a', externalLabel: 'Time Management', onetSocCode: null, release: REL, position: 'core', aiPosition: 'core', status: 'proposed', proposedBy: 'gpt-test', rationale: RATIONALE, runId: run!.id },
      { bundleId: B, source: 'onet_task', externalId: task.taskId, externalLabel: task.task, onetSocCode: task.onetSocCode, release: REL, position: 'related', aiPosition: 'related', status: 'proposed', proposedBy: 'gpt-test', rationale: RATIONALE, runId: run!.id },
    ]).returning({ id: bundleMembers.id });
    memberId = m!.id;
    // noCleanMatch true so the agreement route's no-match list would carry the note if unfiltered.
    await db.insert(bundleMappingOutcomes).values({ runId: run!.id, bundleId: B, status: 'ok', noCleanMatch: true, note: NOTE });
  });

  afterAll(async () => {
    release();
    await finished;
    held.tx = null;
  });

  it('GET list: no AI placement data for the locked bundle', async () => {
    const res = await listGET(new Request('http://h/api/admin/bundles'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(RATIONALE);
    expect(text).not.toContain(NOTE);
    const item = (JSON.parse(text) as { bundles: Array<{ id: string; counts: unknown; noCleanMatch: unknown; sampled: boolean; submitted: boolean }> }).bundles.find(b => b.id === B)!;
    expect(item).toMatchObject({ sampled: true, submitted: false, counts: null, noCleanMatch: null });
  });

  it('GET detail: members and latestOutcome are null', async () => {
    const res = await detailGET(new Request(`http://h/api/admin/bundles/${B}`), params(B));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(RATIONALE);
    expect(text).not.toContain(NOTE);
    const json = JSON.parse(text) as { members: unknown; latestOutcome: unknown; sample: { submitted: boolean; candidates: unknown[] } };
    expect(json.members).toBeNull();
    expect(json.latestOutcome).toBeNull();
    expect(json.sample.submitted).toBe(false);
    expect(json.sample.candidates).toHaveLength(1);
  });

  it('GET detail: the new blind list is present and carries no AI data (decision 2026-10-19)', async () => {
    const res = await detailGET(new Request(`http://h/api/admin/bundles/${B}`), params(B));
    const text = await res.text();
    expect(text).not.toContain(RATIONALE);
    const json = JSON.parse(text) as { blind: { elements: Array<Record<string, unknown>>; elementNotice: string | null; taskRows: Array<Record<string, unknown>> } };
    expect(json.blind.taskRows).toHaveLength(1);
    // Exact key sets: nothing from bundle_members (position, rationale, status, ...) can ride along.
    for (const r of json.blind.taskRows) expect(Object.keys(r).sort()).toEqual(['key', 'label', 'members', 'rank', 'similar']);
    for (const e of json.blind.elements) expect(Object.keys(e).sort()).toEqual(['description', 'domain', 'elementId', 'elementName']);
    expect(Object.keys(json.blind).sort()).toEqual(['elementNotice', 'elements', 'taskRows']);
  });

  it('GET agreement: the unsubmitted sample is absent', async () => {
    const res = await agreementGET(new Request('http://h/api/admin/bundles/agreement'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(RATIONALE);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain(B);
  });

  it('GET search: returns O*NET items with no membership data', async () => {
    const res = await searchGET(new Request(`http://h/api/admin/bundles/search?q=${encodeURIComponent(searchWord)}`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(RATIONALE);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain(B);
    expect((JSON.parse(text) as { tasks: unknown[] }).tasks.length).toBeGreaterThan(0);
  });

  it('refuses every queue write while locked (409)', async () => {
    const r1 = await membersPOST(post(`/api/admin/bundles/${B}/members`, { reviewer: 'R', action: 'confirm', memberIds: [memberId] }), params(B));
    expect(r1.status).toBe(409);
    const r2 = await bulkPOST(post(`/api/admin/bundles/${B}/bulk-confirm`, { reviewer: 'R' }), params(B));
    expect(r2.status).toBe(409);
    const r3 = await resetPOST(post(`/api/admin/bundles/${B}/reset-blind`, { reviewer: 'R', note: 'oops' }), params(B));
    expect(r3.status).toBe(409);
    const [row] = await db.select().from(bundleMembers).where(eq(bundleMembers.id, memberId));
    expect(row!.status).toBe('proposed');
  });

  it('after the blind submit, the detail reveals the AI placements', async () => {
    const res = await blindPOST(post(`/api/admin/bundles/${B}/blind`, {
      reviewer: 'R', noCleanMatch: false, picks: [{ kind: 'element', elementId: '2.B.5.a', position: 'core' }],
    }), params(B));
    expect(res.status).toBe(200);
    const detail = await detailGET(new Request(`http://h/api/admin/bundles/${B}`), params(B));
    const text = await detail.text();
    expect(text).toContain(RATIONALE);
    const json = JSON.parse(text) as { members: Array<{ externalId: string; status: string }> };
    // Reconcile ran in the submit transaction (Ruling 8): the agreed element is confirmed.
    expect(json.members.find(m => m.externalId === '2.B.5.a')!.status).toBe('confirmed');
  });
});
