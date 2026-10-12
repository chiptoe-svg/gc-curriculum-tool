/**
 * Matrix "stale pairs" count — how many (course-row, target) pairs the
 * `/program` matrix still needs scored, for the "Score N stale pairs"
 * button in ProgramCoverageClient.tsx.
 *
 * Owner decision (2026-10-12, P0b Task 8b fix round 1): career-rollup
 * readers (getMatrixData included) now count every program-visible course,
 * not just `builds_to_career = true` ones — so `MatrixData.cells` can carry
 * cells for snapshots that never get a matrix ROW (`MatrixData.courses`
 * stays `builds_to_career = true`, a display choice). Counting
 * `new Set(cells.map(...)).size` directly against `courses.length *
 * targets.length` could then exceed that bound, making "stale pairs" go
 * negative (e.g. "Score -50 stale pairs"). `countScoredPairsForRows`
 * restricts the count to pairs whose snapshot IS one of the matrix's own
 * rows, so it can never exceed `rows.length * <number of distinct
 * careerTargetIds among the cells>` — in practice, never exceed totalPairs.
 */

export interface StalePairsRow {
  snapshotId: string;
}

export interface StalePairsCell {
  snapshotId: string;
  careerTargetId: string;
}

/** Count distinct (snapshotId, careerTargetId) pairs among `cells` whose snapshot is one of `rows`. */
export function countScoredPairsForRows(rows: readonly StalePairsRow[], cells: readonly StalePairsCell[]): number {
  const rowSnapshotIds = new Set(rows.map(r => r.snapshotId));
  const scoredPairs = new Set(
    cells
      .filter(c => rowSnapshotIds.has(c.snapshotId))
      .map(c => `${c.snapshotId}:${c.careerTargetId}`),
  );
  return scoredPairs.size;
}
