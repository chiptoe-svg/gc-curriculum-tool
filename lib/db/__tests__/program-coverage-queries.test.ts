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
  snapshotTargetCoverage: {
    careerTargetId: 'career_target_id',
    subCompetencyId: 'sub_competency_id',
    snapshotId: 'snapshot_id',
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
  it('getMatrixData filters its snapshot query on builds_to_career', async () => {
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

  it('listStalePairs filters its latest-snapshot query on builds_to_career', async () => {
    const executed: unknown[] = [];
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn((q: unknown) => {
      executed.push(q);
      return Promise.resolve({ rows: [] });
    });
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: () => [] }));

    const { listStalePairs } = await import('@/lib/db/program-coverage-queries');
    await listStalePairs();

    const dialect = new PgDialect();
    const texts = executed.map((q) => dialect.sqlToQuery(q as never).sql);
    expect(texts.some((t) => t.includes('builds_to_career'))).toBe(true);
  });
});

describe('getMatrixData — retired sub-competencies (2026-10-06 target batch)', () => {
  it('drops cells scored against retired sub-competencies, so no consumer reads them as current', async () => {
    const schema = await import('@/lib/db/schema');
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => Promise.resolve({ rows: [] }));
    const cell = (subCompetencyId: string) => ({
      snapshotId: 's1', careerTargetId: 't5', subCompetencyId, kDepth: 1, uDepth: 1, dDepth: 1,
      matchedCompetency: null, evidenceExcerpt: null, confidence: 'high', rationale: '', model: 'm', generatedAt: new Date(0),
    });
    const byTable = new Map<unknown, unknown[]>([
      [schema.careerTargets, [{ id: 't5', name: 'T5', displayOrder: 4 }]],
      [schema.subCompetencies, [
        { id: 'kept', name: 'Kept', careerTargetId: 't5', displayOrder: 0, retired: false },
        { id: 'old', name: 'Old', careerTargetId: 't5', displayOrder: 1, retired: true },
      ]],
      [schema.snapshotTargetCoverage, [cell('kept'), cell('old')]],
    ]);
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: (t: unknown) => byTable.get(t) ?? [] }));

    const { getMatrixData } = await import('@/lib/db/program-coverage-queries');
    const data = await getMatrixData();
    expect(data.subCompetencies.map(s => s.id)).toEqual(['kept']);
    expect(data.cells.map(c => c.subCompetencyId)).toEqual(['kept']);
  });
});
