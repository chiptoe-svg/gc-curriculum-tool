/**
 * Career-fit ripple: does a predicted delta improve the DEPTH BAND of the focal
 * course's contribution to a career-target sub-competency? No stored "required
 * depth" exists — program coverage is banded (depth-band.ts) — so "better career
 * fit" = the focal course's cell for a (target, sub-comp) moving up a band
 * (e.g. working → high). Do-centric in v1; K/U career-fit is a deferred refinement.
 * Pure; reads the matrix, mutates nothing.
 */
import { depthBand } from '@/lib/program/depth-band';
import type { MatrixData } from '@/lib/db/program-coverage-queries';
import type { RippleLine } from './scenario';
import type { PredictedSubCompDepth } from './ripple';

const BAND_RANK: Record<string, number> = { none: 0, low: 1, working: 2, high: 3 };
const bandRankOf = (n: number | null): number => {
  const b = depthBand(n);
  return b ? BAND_RANK[b.key]! : -1; // null / no-data ranks below every real band
};
const bandWord = (n: number | null): string => depthBand(n)?.word ?? 'no data';

export function computeCareerFit(input: {
  focalSnapshotId: string;
  predictedSubCompDepths: PredictedSubCompDepth[];
  matrix: MatrixData;
}): RippleLine[] {
  const predBySub = new Map(input.predictedSubCompDepths.map(p => [p.subCompetencyId, p]));
  const targetName = new Map(input.matrix.targets.map(t => [t.id, t.name]));
  const subName = new Map(input.matrix.subCompetencies.map(s => [s.id, s.name]));
  const out: RippleLine[] = [];
  for (const cell of input.matrix.cells) {
    if (cell.snapshotId !== input.focalSnapshotId) continue;
    const p = predBySub.get(cell.subCompetencyId);
    if (!p) continue;
    if (bandRankOf(p.d) > bandRankOf(cell.dDepth)) {
      out.push({
        kind: 'career_fit',
        courseCode: null,
        subCompetencyId: cell.subCompetencyId,
        label: `${targetName.get(cell.careerTargetId) ?? cell.careerTargetId} · ${subName.get(cell.subCompetencyId) ?? cell.subCompetencyId}`,
        before: bandWord(cell.dDepth),
        after: bandWord(p.d),
      });
    }
  }
  return out;
}
