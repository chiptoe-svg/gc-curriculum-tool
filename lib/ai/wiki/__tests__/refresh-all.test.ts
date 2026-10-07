/**
 * Tests for lib/ai/wiki/refresh-all.ts — the one-pass wiki refresh planner and
 * runner. Pure planning + a runner driven by fake generators and a fake writer,
 * so no DB, model, or wiki repo is touched.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: { select: vi.fn() } }));

import {
  latestSnapshotPerCourse,
  planRefresh,
  parseRefreshArgs,
  runRefresh,
  oldPathCallCount,
  type RefreshInputs,
  type RefreshDeps,
} from '../refresh-all';

const d = (s: string) => new Date(`${s}T12:00:00Z`);

const inputs: RefreshInputs = {
  snapshots: [
    { id: 'a-old', courseCode: 'GC 1010', createdAt: d('2026-01-01') },
    { id: 'a-new', courseCode: 'GC 1010', createdAt: d('2026-03-01') },
    { id: 'b-1', courseCode: 'GC 4800', createdAt: d('2026-02-01') },
    { id: 'c-new', courseCode: 'GC 3460', createdAt: d('2026-05-01') },
    { id: 'c-old', courseCode: 'GC 3460', createdAt: d('2026-04-01') },
  ],
  competencySlugs: ['comp-1', 'comp-2', 'comp-3', 'comp-4', 'comp-5', 'comp-6', 'comp-7'],
  targetSlugs: ['t-1', 't-2'],
  hasProductiveFailure: true,
};

describe('latestSnapshotPerCourse', () => {
  it('keeps exactly the newest snapshot per course, sorted by course code', () => {
    const out = latestSnapshotPerCourse(inputs.snapshots);
    expect(out.map(s => [s.courseCode, s.id])).toEqual([
      ['GC 1010', 'a-new'],
      ['GC 3460', 'c-new'],
      ['GC 4800', 'b-1'],
    ]);
  });
});

describe('planRefresh', () => {
  it('plans each course page once, from that course\'s latest snapshot', () => {
    const plan = planRefresh(inputs, {});
    expect(plan.courses.map(c => [c.courseCode, c.snapshotId, c.page.path])).toEqual([
      ['GC 1010', 'a-new', 'courses/gc-1010.md'],
      ['GC 3460', 'c-new', 'courses/gc-3460.md'],
      ['GC 4800', 'b-1', 'courses/gc-4800.md'],
    ]);
  });

  it('plans every program page exactly once, with the index last', () => {
    const plan = planRefresh(inputs, {});
    const paths = plan.programPages.map(p => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      ...inputs.competencySlugs.map(s => `competencies/${s}.md`),
      't-1', 't-2',
    ].map(p => (p.startsWith('t-') ? `targets/${p}.md` : p)).concat([
      'concepts/productive-failure.md',
      'concepts/three-act-structure.md',
      'index.md',
    ]));
    // No course page rides the program pass.
    expect(plan.programPages.some(p => p.type === 'course')).toBe(false);
  });

  it('omits productive-failure when no snapshot carries its conditions', () => {
    const plan = planRefresh({ ...inputs, hasProductiveFailure: false }, {});
    expect(plan.programPages.map(p => p.slug)).not.toContain('productive-failure');
    expect(plan.programPages.map(p => p.slug)).toContain('three-act-structure');
  });

  it('dedupes repeated slugs from the inputs', () => {
    const plan = planRefresh({ ...inputs, competencySlugs: ['x', 'x', 'y'], targetSlugs: ['t', 't'] }, {});
    expect(plan.programPages.map(p => p.path).filter(p => p.startsWith('competencies/'))).toEqual([
      'competencies/x.md', 'competencies/y.md',
    ]);
    expect(plan.programPages.filter(p => p.type === 'target')).toHaveLength(1);
  });

  it('batches program pages at WIKI_PAGES_PER_CALL with the index in the final batch', () => {
    const plan = planRefresh(inputs, {});
    // 7 comps + 2 targets + 2 concepts + index = 12 pages → 2 batches of 6.
    expect(plan.programBatches.map(b => b.length)).toEqual([6, 6]);
    expect(plan.programBatches.flat()).toEqual(plan.programPages);
    const last = plan.programBatches[plan.programBatches.length - 1]!;
    expect(last[last.length - 1]!.type).toBe('index');
  });

  it('manifest lists every course and program page except the index', () => {
    const plan = planRefresh(inputs, { only: 'program' });
    const manifestPaths = plan.manifest.map(p => p.path);
    expect(manifestPaths).toContain('courses/gc-1010.md');
    expect(manifestPaths).toContain('competencies/comp-1.md');
    expect(manifestPaths).not.toContain('index.md');
  });

  it('--only courses drops the program pass', () => {
    const plan = planRefresh(inputs, { only: 'courses' });
    expect(plan.courses).toHaveLength(3);
    expect(plan.programPages).toEqual([]);
    expect(plan.programBatches).toEqual([]);
  });

  it('--only program drops the course pass', () => {
    const plan = planRefresh(inputs, { only: 'program' });
    expect(plan.courses).toEqual([]);
    expect(plan.programPages.length).toBe(12);
  });

  it('--course restricts to that one course page (case/space-insensitive) and skips program pages', () => {
    const plan = planRefresh(inputs, { course: 'gc-3460' });
    expect(plan.courses.map(c => [c.courseCode, c.snapshotId])).toEqual([['GC 3460', 'c-new']]);
    expect(plan.programPages).toEqual([]);
  });

  it('--course with an unknown course throws', () => {
    expect(() => planRefresh(inputs, { course: 'GC 9999' })).toThrow(/GC 9999/);
  });
});

describe('parseRefreshArgs', () => {
  it('parses --dry-run, --only and --course', () => {
    expect(parseRefreshArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseRefreshArgs(['--only', 'program'])).toEqual({ dryRun: false, only: 'program' });
    expect(parseRefreshArgs(['--only=courses'])).toEqual({ dryRun: false, only: 'courses' });
    expect(parseRefreshArgs(['--course', 'GC 4800'])).toEqual({ dryRun: false, course: 'GC 4800' });
  });

  it('rejects a bad --only value, an unknown flag, and --course with --only program', () => {
    expect(() => parseRefreshArgs(['--only', 'all'])).toThrow();
    expect(() => parseRefreshArgs(['--bogus'])).toThrow();
    expect(() => parseRefreshArgs(['--course', 'GC 4800', '--only', 'program'])).toThrow();
  });
});

describe('oldPathCallCount', () => {
  it('sums ceil(pages / WIKI_PAGES_PER_CALL) per snapshot', () => {
    expect(oldPathCallCount([43, 2, 6, 7])).toBe(8 + 1 + 1 + 2);
  });
});

// ---------------------------------------------------------------------------
// Runner — fake generators (stand-ins for the model) + fake writer
// ---------------------------------------------------------------------------

function fakeDeps() {
  const generateCourse = vi.fn(async (snapshotId: string) => ({
    pages: [{ path: `courses/${snapshotId}.md`, content: 'x' }],
    logEntry: `course ${snapshotId}`,
  }));
  const generateProgramBatch = vi.fn(async (batch: Array<{ path: string }>, _manifest: unknown) => ({
    pages: batch.map(p => ({ path: p.path, content: 'x' })),
    logEntry: 'program',
  }));
  const write = vi.fn(async () => ({ sha: 'abc1234' }));
  const lines: string[] = [];
  const deps: RefreshDeps = {
    generateCourse,
    generateProgramBatch,
    write,
    log: (l: string) => { lines.push(l); },
  };
  return { deps, generateCourse, generateProgramBatch, write, lines };
}

describe('runRefresh', () => {
  it('dry-run lists pages and batches and makes no model calls and no writes', async () => {
    const { deps, generateCourse, generateProgramBatch, write, lines } = fakeDeps();
    const plan = planRefresh(inputs, {});
    const res = await runRefresh(plan, deps, { dryRun: true });
    expect(generateCourse).not.toHaveBeenCalled();
    expect(generateProgramBatch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    const out = lines.join('\n');
    expect(out).toContain('courses/gc-1010.md');
    expect(out).toContain('competencies/comp-7.md');
    expect(out).toMatch(/batch 2\/2/);
    expect(res).toMatchObject({ coursePages: 3, programPages: 12, programBatches: 2, estimatedCalls: 5 });
  });

  it('generates each course once and each program batch once, one write per unit', async () => {
    const { deps, generateCourse, generateProgramBatch, write } = fakeDeps();
    const plan = planRefresh(inputs, {});
    const res = await runRefresh(plan, deps, { dryRun: false });
    expect(generateCourse.mock.calls.map(c => c[0])).toEqual(['a-new', 'c-new', 'b-1']);
    expect(generateProgramBatch).toHaveBeenCalledTimes(2);
    const programPaths = generateProgramBatch.mock.calls.flatMap(c => c[0].map((p: { path: string }) => p.path));
    expect(programPaths).toEqual(plan.programPages.map(p => p.path));
    // Every batch is handed the full manifest (index navigation completeness).
    for (const call of generateProgramBatch.mock.calls) expect(call[1]).toBe(plan.manifest);
    expect(write).toHaveBeenCalledTimes(3 + 2);
    expect(res).toMatchObject({ succeeded: 5, failed: 0 });
  });

  it('a failing unit is logged and the run continues', async () => {
    const { deps, generateCourse, write } = fakeDeps();
    generateCourse.mockRejectedValueOnce(new Error('model down'));
    const res = await runRefresh(planRefresh(inputs, { only: 'courses' }), deps, { dryRun: false });
    expect(write).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ succeeded: 2, failed: 1 });
  });

  it('writes are strictly sequential (one writeAndPush in flight at a time)', async () => {
    const { deps } = fakeDeps();
    let inFlight = 0;
    let maxInFlight = 0;
    deps.write = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return { sha: 'x' };
    });
    await runRefresh(planRefresh(inputs, {}), deps, { dryRun: false });
    expect(maxInFlight).toBe(1);
  });
});
