import { describe, it, expect, vi } from 'vitest';

// Chainable, awaitable query mock: every builder method returns the chain and
// awaiting it yields the rows registered for the table passed to from().
const rowsByTable = new Map<unknown, unknown[]>();
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ['where', 'orderBy', 'limit', 'leftJoin', 'innerJoin']) c[m] = () => c;
  c.then = (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}
vi.mock('@/lib/db/client', () => ({
  db: { select: () => ({ from: (t: unknown) => chain(rowsByTable.get(t) ?? []) }) },
}));

import { careerTargets, subCompetencies, courseCaptureSnapshots, snapshotTargetCoverage } from '@/lib/db/schema';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';

describe('loadScaffoldingTarget — retired sub-competencies (2026-10-06 target batch)', () => {
  it('does not hand retired sub-competencies to the scaffolding analysis', async () => {
    const sub = (id: string, retired: boolean, displayOrder: number) => ({
      id, name: id, careerTargetId: 't5', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', displayOrder, retired,
    });
    rowsByTable.set(careerTargets, [{ id: 't5', name: 'T5' }]);
    rowsByTable.set(subCompetencies, [sub('kept', false, 0), sub('old', true, 1)]);
    rowsByTable.set(courseCaptureSnapshots, []);
    rowsByTable.set(snapshotTargetCoverage, []);

    const out = await loadScaffoldingTarget('t5');
    expect(out!.subCompetencies.map(s => s.id)).toEqual(['kept']);
    expect([...out!.cellsBySubCompetency.keys()]).toEqual(['kept']);
  });
});
