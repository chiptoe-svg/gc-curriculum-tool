import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const dbDeleteWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    delete: () => ({ where: () => ({ returning: dbDeleteWhere }) }),
    select: vi.fn(() => ({ from: () => ({ where: () => [] }) })),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  snapshotCompetencyCoverage: {
    snapshotId: 'snapshot_id',
    competencyId: 'competency_id',
  },
  targetCoverage: {
    snapshotId: 'snapshot_id',
    careerTargetId: 'career_target_id',
    subCompetencyId: 'sub_competency_id',
  },
  courseCaptureSnapshots: {},
  careerTargets: { id: 'id', name: 'name', displayOrder: 'display_order' },
  subCompetencies: {
    id: 'id',
    name: 'name',
    careerTargetId: 'career_target_id',
    displayOrder: 'display_order',
    retired: 'retired',
  },
  targetSubCompetencies: {
    id: 'id',
    name: 'name',
    careerTargetId: 'career_target_id',
    displayOrder: 'display_order',
    retired: 'retired',
  },
  courseCodes: { courseCode: 'course_code' },
}));

import { invalidateCoverageForSubCompetency } from '@/lib/db/program-coverage-queries';

beforeEach(() => vi.clearAllMocks());

describe('invalidateCoverageForSubCompetency', () => {
  it('deletes rows for the given (careerTargetId, subCompetencyId) and returns count', async () => {
    dbDeleteWhere.mockResolvedValue([{ snapshotId: 'snap-1' }, { snapshotId: 'snap-2' }]);
    const count = await invalidateCoverageForSubCompetency('target-abc', 'sc-xyz');
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(count).toBe(2);
  });

  it('returns 0 when no cells exist for the pair', async () => {
    dbDeleteWhere.mockResolvedValue([]);
    const count = await invalidateCoverageForSubCompetency('target-abc', 'sc-xyz');
    expect(count).toBe(0);
  });
});

describe('career-coverage queries gate on builds_to_career', () => {
  it('getMatrixData filters its snapshot query on builds_to_career (career-rollup scope, A2)', async () => {
    const executed: unknown[] = [];
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn((q: unknown) => {
      executed.push(q);
      return Promise.resolve({ rows: [] });
    });
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: () => [] }));

    const { getMatrixData } = await import('@/lib/db/program-coverage-queries');
    await getMatrixData();

    const dialect = new PgDialect();
    const texts = executed.map((q) => dialect.sqlToQuery(q as never).sql);
    expect(texts.some((t) => t.includes('builds_to_career'))).toBe(true);
  });

  // P0b Amendment 1 (A2): scoring scope is every program-visible course,
  // regardless of builds_to_career — listStaleSnapshots must NOT restrict on
  // it any more (inverted from the pre-amendment assertion this replaces).
  it('listStaleSnapshots does NOT filter its latest-snapshot query on builds_to_career (scoring scope, A2)', async () => {
    const executed: unknown[] = [];
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn((q: unknown) => {
      executed.push(q);
      return Promise.resolve({ rows: [] });
    });
    // Two different select shapes: subCompetencies (chained .where()) and
    // snapshotCompetencyCoverage (awaited directly, no .where()). The chain
    // below supports both.
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({
      from: () => {
        const c: Record<string, unknown> = {};
        c.where = () => Promise.resolve([]);
        c.then = (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res);
        return c;
      },
    }));

    const { listStaleSnapshots } = await import('@/lib/db/program-coverage-queries');
    await listStaleSnapshots();

    const dialect = new PgDialect();
    const texts = executed.map((q) => dialect.sqlToQuery(q as never).sql);
    expect(texts.some((t) => t.includes('builds_to_career'))).toBe(false);
    // Still program-visible scoped.
    expect(texts.some((t) => t.includes("scope") && t.includes("status"))).toBe(true);
  });
});

describe('getMatrixData — retired sub-competencies (2026-10-06 target batch)', () => {
  it('drops cells scored against retired sub-competencies, so no consumer reads them as current', async () => {
    const schema = await import('@/lib/db/schema');
    const mod = await import('@/lib/db/client');
    // One course row matching snapshot 's1', so the cells' career-rollup
    // scope filter (snapshot must belong to a builds_to_career course in
    // the matrix's own course list — Task 8b) doesn't strip them out before
    // the retired-competency filter under test gets to run.
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => Promise.resolve({
      rows: [{ snapshot_id: 's1', course_code: 'ZZ 9999', caption: null, created_at: new Date(0), instructor_name: null, title: 'ZZ', level: 9000 }],
    }));
    const cell = (subCompetencyId: string) => ({
      snapshotId: 's1', careerTargetId: 't5', subCompetencyId, kDepth: 1, uDepth: 1, dDepth: 1,
      matchedCompetency: null, evidenceExcerpt: null, confidence: 'high', rationale: '', model: 'm', generatedAt: new Date(0),
    });
    const byTable = new Map<unknown, unknown[]>([
      [schema.careerTargets, [{ id: 't5', name: 'T5', displayOrder: 4 }]],
      [schema.targetSubCompetencies, [
        { id: 'kept', name: 'Kept', careerTargetId: 't5', displayOrder: 0, retired: false },
        { id: 'old', name: 'Old', careerTargetId: 't5', displayOrder: 1, retired: true },
      ]],
      [schema.targetCoverage, [cell('kept'), cell('old')]],
    ]);
    // Chainable + awaitable: careerTargets/targetSubCompetencies/targetCoverage
    // are awaited directly (no .where()); listPairedCodesForCourses (now hit,
    // since uniqueCodes is non-empty with the course row above) calls
    // .from(courseCodes).where(...), which needs a .where() that resolves to
    // the same (empty, unmapped) rows.
    const chain = (rows: unknown[]) => {
      const c: Record<string, unknown> = { where: () => c };
      c.then = (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
      return c;
    };
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: (t: unknown) => chain(byTable.get(t) ?? []) }));

    const { getMatrixData } = await import('@/lib/db/program-coverage-queries');
    const data = await getMatrixData();
    expect(data.subCompetencies.map(s => s.id)).toEqual(['kept']);
    expect(data.cells.map(c => c.subCompetencyId)).toEqual(['kept']);
  });
});
