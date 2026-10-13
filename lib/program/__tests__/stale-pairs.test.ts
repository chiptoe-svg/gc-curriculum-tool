import { describe, it, expect } from 'vitest';
import { countScoredPairsForRows } from '@/lib/program/stale-pairs';

describe('countScoredPairsForRows', () => {
  it('counts a cell whose snapshot is one of the matrix rows', () => {
    const rows = [{ snapshotId: 's1' }];
    const cells = [{ snapshotId: 's1', careerTargetId: 't1' }];
    expect(countScoredPairsForRows(rows, cells)).toBe(1);
  });

  it('does not count a cell whose snapshot is NOT one of the matrix rows (fix round 1, owner decision)', () => {
    // Career rollups now count every program-visible course, so `cells` can
    // carry a cell for a snapshot that never got a matrix row (an off-path
    // course, builds_to_career=false). Without the row restriction this
    // would inflate the count past totalPairs and the UI's "stale pairs"
    // button could show a negative number.
    const rows = [{ snapshotId: 's1' }];
    const cells = [
      { snapshotId: 's1', careerTargetId: 't1' },
      { snapshotId: 'off-path-snapshot', careerTargetId: 't1' },
    ];
    expect(countScoredPairsForRows(rows, cells)).toBe(1);
  });

  it('never exceeds rows.length * distinct target count, even with many off-path cells', () => {
    const rows = [{ snapshotId: 's1' }, { snapshotId: 's2' }];
    const cells = [
      { snapshotId: 's1', careerTargetId: 't1' },
      { snapshotId: 's2', careerTargetId: 't1' },
      // 10 off-path cells across several targets — none should count.
      ...Array.from({ length: 10 }, (_, i) => ({ snapshotId: `off-path-${i}`, careerTargetId: `t${i}` })),
    ];
    const totalPairs = rows.length * 1; // one distinct target among the on-row cells
    expect(countScoredPairsForRows(rows, cells)).toBeLessThanOrEqual(totalPairs);
    expect(countScoredPairsForRows(rows, cells)).toBe(2);
  });

  it('dedupes repeated (snapshot, target) pairs', () => {
    const rows = [{ snapshotId: 's1' }];
    const cells = [
      { snapshotId: 's1', careerTargetId: 't1' },
      { snapshotId: 's1', careerTargetId: 't1' }, // same pair, different sub-competency row in practice
    ];
    expect(countScoredPairsForRows(rows, cells)).toBe(1);
  });

  it('returns 0 for no rows or no cells', () => {
    expect(countScoredPairsForRows([], [{ snapshotId: 's1', careerTargetId: 't1' }])).toBe(0);
    expect(countScoredPairsForRows([{ snapshotId: 's1' }], [])).toBe(0);
  });
});
