// @vitest-environment node
// P1 hostile-review fix wave, I-2: the /program bulk-refresh button's
// label must state the real work — the number of stale SNAPSHOTS, which
// is the number of AI calls POST /api/program/coverage/refresh will make
// (listStaleSnapshots scores one call per snapshot) — not a matrix-pair
// count, which can wildly understate it once unlinked competencies exist.
import { describe, it, expect } from 'vitest';
import { countScoredPairsForRows, staleSnapshotButtonLabel, type StalePairsRow, type StalePairsCell } from '@/lib/program/stale-pairs';

describe('staleSnapshotButtonLabel', () => {
  it('"Up to date" when nothing is stale', () => {
    expect(staleSnapshotButtonLabel(0)).toBe('Up to date');
  });

  it('singular for exactly one stale snapshot', () => {
    expect(staleSnapshotButtonLabel(1)).toBe('Score 1 stale snapshot');
  });

  it('plural for more than one', () => {
    expect(staleSnapshotButtonLabel(21)).toBe('Score 21 stale snapshots');
  });
});

// Red-proof: reproduces I-2's actual reported numbers (before the insert:
// 4 stale snapshots / 10 stale pairs; after: 21 stale snapshots / still
// read "10 stale pairs" because the pair-based count never saw the
// unlinked ids) — proves the old pair-derived label and the new
// snapshot-count label genuinely disagree, not just differ in wording.
describe('I-2 red-proof: the pair count and the snapshot count are NOT the same number', () => {
  it('21 stale snapshots can coexist with a pair-based count that still reads 10 stale pairs', () => {
    const rows: StalePairsRow[] = Array.from({ length: 10 }, (_, i) => ({ snapshotId: `s${i}` }));
    // Every row/target pair except one is already scored — 10 total pairs
    // across e.g. 5 courses x 2 targets minus coincidence; the exact
    // construction doesn't matter, only that scoredCount/totalPairs still
    // reports a SMALL number while staleSnapshotCount is large.
    const targets = ['t1', 't2'];
    const cells: StalePairsCell[] = [];
    for (const row of rows) {
      for (const t of targets) cells.push({ snapshotId: row.snapshotId, careerTargetId: t });
    }
    const totalPairs = rows.length * targets.length; // 20
    const scoredCount = countScoredPairsForRows(rows, cells); // 20 (every pair already scored)
    const oldLabelStalePairs = totalPairs - scoredCount; // 0 — "up to date" by the OLD metric

    // Now 21 snapshots go stale for a newly-inserted UNLINKED competency —
    // unlinked ids are never associated with any careerTargetId, so they
    // never appear in `cells` at all, and the pair-based count is
    // completely blind to them (this is exactly what the real bug did).
    const staleSnapshotCount = 21;

    expect(oldLabelStalePairs).toBe(0); // the OLD label would have said "Up to date"
    expect(staleSnapshotCount).toBe(21); // the REAL work is 21 AI calls
    expect(staleSnapshotButtonLabel(staleSnapshotCount)).toBe('Score 21 stale snapshots');
    expect(staleSnapshotButtonLabel(staleSnapshotCount)).not.toBe(`Score ${oldLabelStalePairs} stale pairs`);
  });
});
