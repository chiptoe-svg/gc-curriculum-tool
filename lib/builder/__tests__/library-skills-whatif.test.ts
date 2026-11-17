// @vitest-environment node
// Skills-only what-ifs (saved from a cluster, migration 0070) in the builder library and the cluster's version lookup.
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, courseWhatIfs } from '@/lib/db/schema';
import { loadLibrary } from '../library';
import { clusterVersionOf, pageWhatIfs, WHAT_IF_PREFIX } from '../compute';
import { effectiveCourse } from '../edits';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { emptyClusterState, type ClusterState } from '../cluster/state';
import type { LibraryCourse, LibraryVersion } from '../types';
import type { WhatIfSkills } from '@/lib/what-if/types';

const hash = (s: string) => textHash(normalizeStatement(s));
const CODE = 'GC ZZ9';
const onScratch = (() => { try { return new URL(process.env.DATABASE_URL ?? '').pathname === '/gc_curriculum_builder_scratch'; } catch { return false; } })();

const SKILLS: WhatIfSkills = {
  objectives: ['Plan a press run'],
  developed: [{ statement: 'Mix ink to a spot color', k: 3, u: 2, d: 3 }],
  required: [{ statement: 'Read a job ticket', need: { k: 2, u: null, d: 1 } }],
  fromCluster: null,
};

describe.runIf(onScratch)('loadLibrary reads skills-only what-ifs (scratch DB)', () => {
  let snapId = '';
  const cleanup = async () => {
    await db.delete(courseWhatIfs).where(eq(courseWhatIfs.courseCode, CODE));
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  };
  afterAll(cleanup);

  it('loads a skills-only what-if', async () => {
    await cleanup();
    await db.insert(courses).values({ code: CODE, title: 'Test', level: 1, track: 'core', scope: 'gc', status: 'offered' } as never);
    const [snap] = await db.insert(courseCaptureSnapshots).values({
      courseCode: CODE, profile: {}, inputsMeta: {}, scaleVersion: 'v1', model: 'test', instructorName: 'T',
    } as never).returning({ id: courseCaptureSnapshots.id });
    snapId = snap!.id;
    const [row] = await db.insert(courseWhatIfs).values({
      courseCode: CODE, baseSnapshotId: snapId, ownerGrantId: 'g', ownerKind: 'personal', authorName: 'A',
      title: `${CODE} as edited on X`, skills: SKILLS,
    } as never).returning({ id: courseWhatIfs.id });
    const lib = await loadLibrary();
    const w = lib.courses.find(c => c.code === CODE)!.whatIfs.find(x => x.id === row!.id)!;
    expect(w).toBeTruthy();
    expect(w.skills).toEqual(SKILLS);
    expect(w.depths).toEqual([]);
    expect(w.notComputed).toEqual([]);
    expect(w.baseSnapshotId).toBe(snapId);
  });
});

const version = (id: string, skill: string, req: string): LibraryVersion => ({
  snapshotId: id, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
  projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
  skills: [{ skillRef: hash(skill), statement: skill, k: 1, u: 1, d: 1 }],
  required: [{ ref: hash(req), statement: req, need: { k: 1, u: 1, d: 1 } }],
});
const lc = (over: Partial<LibraryCourse> = {}): LibraryCourse => ({
  code: 'GC 2070', title: 'T', level: 2, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: ['Old objective'], sheetProjects: [], stated: [],
  versions: [version('s1', 'Old skill', 'Old need'), version('s2', 'Other skill', 'Other need')],
  whatIfs: [{ id: 'w1', title: 'x', author: 'A', depths: [], notComputed: [], skills: SKILLS, baseSnapshotId: 's2' }],
  ...over,
});
const stateWith = (v?: string): ClusterState => ({ ...emptyClusterState(), versions: v ? { 'GC 2070': v } : {} });

describe('clusterVersionOf', () => {
  it('swaps in the what-if skills', () => {
    const v = clusterVersionOf(lc(), stateWith(`${WHAT_IF_PREFIX}w1`))!;
    expect(v.snapshotId).toBe('s2'); // its base snapshot
    expect(v.skills).toEqual([{ skillRef: hash('Mix ink to a spot color'), statement: 'Mix ink to a spot color', k: 3, u: 2, d: 3 }]);
    expect(v.required).toEqual([{ ref: hash('Read a job ticket'), statement: 'Read a job ticket', need: { k: 2, u: null, d: 1 } }]);
    const eff = effectiveCourse(lc(), v, undefined);
    expect(eff.objectives.map(o => o.text)).toEqual(['Plan a press run']);
    expect(eff.developed.map(s => s.statement)).toEqual(['Mix ink to a spot color']);
  });

  it('falls back to the first version when the base snapshot is gone, and to a bare version when there is none', () => {
    const gone = lc({ whatIfs: [{ ...lc().whatIfs[0]!, baseSnapshotId: null }] });
    expect(clusterVersionOf(gone, stateWith(`${WHAT_IF_PREFIX}w1`))!.snapshotId).toBe('s1');
    const none = lc({ versions: [], whatIfs: [{ ...lc().whatIfs[0]!, baseSnapshotId: null }] });
    expect(clusterVersionOf(none, stateWith(`${WHAT_IF_PREFIX}w1`))!.skills.map(s => s.statement)).toEqual(['Mix ink to a spot color']);
  });

  it('otherwise reads as versionOf does, and ignores a what-if with no skills', () => {
    expect(clusterVersionOf(lc(), stateWith())!.snapshotId).toBe('s1');
    expect(clusterVersionOf(lc(), stateWith('s2'))!.snapshotId).toBe('s2');
    const paged = lc({ whatIfs: [{ ...lc().whatIfs[0]!, skills: null }] });
    expect(clusterVersionOf(paged, stateWith(`${WHAT_IF_PREFIX}w1`))!.snapshotId).toBe('s1');
  });
});

describe('the /build version picker', () => {
  it('build picker omits skills-only what-ifs', () => {
    const paged = { id: 'w2', title: 'p', author: 'B', depths: [], notComputed: [], skills: null, baseSnapshotId: 's1' };
    const course = lc({ whatIfs: [...lc().whatIfs, paged] });
    expect(pageWhatIfs(course).map(w => w.id)).toEqual(['w2']);
  });
});
