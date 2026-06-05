import { describe, it, expect } from 'vitest';
import {
  snapshotPfContribution,
  aggregateSubCompetency,
  type SnapshotCellInput,
  type ProductiveFailureConditions,
} from '@/lib/program/scaffolding';

const PF: ProductiveFailureConditions = {
  generate_then_consolidate: 'present',
  open_ended_problems: 'present',
  revision_cycles: 'present',
  structured_post_mortem: 'present',
  max_supporting_depth: 4,
  notes: [],
};

function cell(over: Partial<SnapshotCellInput> = {}): SnapshotCellInput {
  return {
    snapshotId: 's1', courseCode: 'GC 1000', sequenceIndex: 0,
    kDepth: 3, uDepth: 3, dDepth: 4, productiveFailureConditions: null,
    ...over,
  };
}

describe('no_data PF scoring', () => {
  it('snapshotPfContribution returns null for a not-assessed cell', () => {
    expect(snapshotPfContribution(cell({ productiveFailureConditions: null }))).toBeNull();
  });

  it('snapshotPfContribution returns a number for an assessed cell', () => {
    const v = snapshotPfContribution(cell({ productiveFailureConditions: PF }));
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
  });

  it('aggregate yields no_data when every contributing cell is not-assessed', () => {
    const agg = aggregateSubCompetency('sc1', 'Typography', [
      cell({ productiveFailureConditions: null }),
      cell({ snapshotId: 's2', sequenceIndex: 1, productiveFailureConditions: null }),
    ]);
    expect(agg.pfStatus).toBe('no_data');
    expect(agg.cumulativePfScore).toBe(0);
  });

  it('aggregate yields no_data for an empty cell list', () => {
    expect(aggregateSubCompetency('sc1', 'Typography', []).pfStatus).toBe('no_data');
  });

  it('aggregate computes over data-bearing cells only, ignoring not-assessed ones', () => {
    const agg = aggregateSubCompetency('sc1', 'Typography', [
      cell({ productiveFailureConditions: null }),
      cell({ snapshotId: 's2', sequenceIndex: 1, productiveFailureConditions: PF, dDepth: 4 }),
    ]);
    expect(agg.pfStatus).not.toBe('no_data');
    expect(agg.cumulativePfScore).toBeGreaterThan(0);
  });

  it('a not-assessed D≥4 cell cannot promote a sub-competency to well_developed', () => {
    // Three assessed D=3 cells push cumulative past the 1.5 threshold, but the
    // only D≥4 cell is NOT assessed — so hasUpper must stay false and the band
    // caps at `developing`, not `well_developed`. Pins the hasUpper exclusion.
    const assessedD3 = (id: string, i: number) =>
      cell({ snapshotId: id, sequenceIndex: i, productiveFailureConditions: PF, dDepth: 3 });
    const agg = aggregateSubCompetency('sc1', 'Typography', [
      assessedD3('s1', 0),
      assessedD3('s2', 1),
      assessedD3('s3', 2),
      cell({ snapshotId: 's4', sequenceIndex: 3, productiveFailureConditions: null, dDepth: 5 }),
    ]);
    expect(agg.cumulativePfScore).toBeGreaterThanOrEqual(1.5);
    expect(agg.pfStatus).toBe('developing');
  });
});
