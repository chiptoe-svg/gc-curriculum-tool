import { describe, it, expect } from 'vitest';
import { depthScaffoldingStatus, type SnapshotCellInput } from '@/lib/program/scaffolding';

// Focused coverage of depthScaffoldingStatus — especially the new
// `no_introduction` status (was previously mislabeled `coverage_only`).

function cell(seq: number, k: number | null, u: number | null, d: number): SnapshotCellInput {
  return { snapshotId: `s${seq}`, courseCode: `GC ${1000 + seq}`, sequenceIndex: seq, kDepth: k, uDepth: u, dDepth: d, productiveFailureConditions: null };
}

describe('depthScaffoldingStatus', () => {
  it('not_addressed when nothing reaches K/U/D ≥ 1', () => {
    expect(depthScaffoldingStatus([cell(0, 0, 0, 0)]).status).toBe('not_addressed');
  });

  it('coverage_only for introduction-only', () => {
    // K=2 → introduction; nothing else.
    expect(depthScaffoldingStatus([cell(0, 2, 1, 0)]).status).toBe('coverage_only');
  });

  it('well_scaffolded for introduction + practice + integration', () => {
    const r = depthScaffoldingStatus([cell(0, 2, 1, 0), cell(1, 3, 2, 2), cell(2, 4, 4, 5)]);
    expect(r.status).toBe('well_scaffolded');
  });

  it('no_introduction when practiced but never introduced', () => {
    // Single cell at practice depth (K=3, D=2) with no introduction-level cell.
    const r = depthScaffoldingStatus([cell(0, 3, 3, 3)]);
    expect(r.phases).toMatchObject({ introduction: false, practice: true });
    expect(r.status).toBe('no_introduction');
  });

  it('no_introduction for practice + integration without introduction (was coverage_only)', () => {
    // practice cell then integration cell, neither at introduction depth.
    const r = depthScaffoldingStatus([cell(0, 3, 3, 3), cell(1, 4, 5, 5)]);
    expect(r.phases.introduction).toBe(false);
    expect(r.phases.integration).toBe(true);
    expect(r.status).toBe('no_introduction');
  });

  it('brittle_scaffold for integration with NO setup at all', () => {
    // single integration cell, no introduction/practice anywhere.
    expect(depthScaffoldingStatus([cell(0, null, 5, 5)]).status).toBe('brittle_scaffold');
  });
});
