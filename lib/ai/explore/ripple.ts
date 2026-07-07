import { computeGapsFromInputs, type DeliveredAttainment, type RelyEdge, type SubCompetencyGap } from '@/lib/program/prereq-gaps';
import type { RippleLine, IncomingDemand } from './scenario';

export interface PredictedSubCompDepth { subCompetencyId: string; k: number | null; u: number | null; d: number | null; }

export interface ComputeRippleInput {
  focalCourseCode: string;
  /** Edges where a DOWNSTREAM course relies on the focal course (prereqCourseCode === focalCourseCode). */
  downstreamEdges: RelyEdge[];
  /** Baseline delivered attainment for the focal course (from snapshotTargetCoverage). */
  baselineDelivered: DeliveredAttainment[];
  /** The change's predicted new depths, keyed to sub-competency. */
  predictedSubCompDepths: PredictedSubCompDepth[];
  /** New incoming demands the change introduces (upstream). */
  assumesIncoming: IncomingDemand[];
  /** Resolve a sub-competency id to a human label. */
  subCompLabel: (subCompetencyId: string) => string;
}

const statusOf = (gaps: SubCompetencyGap[], subId: string): string =>
  gaps.find(g => g.subCompetencyId === subId)?.status ?? 'no_data';

export function computeRipple(input: ComputeRippleInput): RippleLine[] {
  const out: RippleLine[] = [];

  // --- Downstream: re-run the gap engine on baseline vs. predicted-overridden delivered ---
  const predBySub = new Map(input.predictedSubCompDepths.map(p => [p.subCompetencyId, p]));
  // Predicted depths are hypotheses → tag 'intended' (not 'measured') so nothing downstream
  // mistakes a prediction for measured evidence.
  const scenarioDelivered: DeliveredAttainment[] = input.baselineDelivered.map(d => {
    const p = d.prereqCourseCode === input.focalCourseCode ? predBySub.get(d.subCompetencyId) : undefined;
    return p ? { ...d, k: p.k, u: p.u, d: p.d, basis: 'intended' } : d;
  });
  // Ensure predicted sub-comps with no baseline row still get a scenario row for the focal course.
  for (const p of input.predictedSubCompDepths) {
    if (!scenarioDelivered.some(d => d.prereqCourseCode === input.focalCourseCode && d.subCompetencyId === p.subCompetencyId)) {
      scenarioDelivered.push({ prereqCourseCode: input.focalCourseCode, subCompetencyId: p.subCompetencyId, k: p.k, u: p.u, d: p.d, basis: 'intended' });
    }
  }

  const baseGaps = computeGapsFromInputs(input.downstreamEdges, input.baselineDelivered);
  const scenGaps = computeGapsFromInputs(input.downstreamEdges, scenarioDelivered);

  const subs = new Set(input.downstreamEdges.map(e => e.subCompetencyId));
  for (const subId of subs) {
    const before = statusOf(baseGaps, subId);
    const after = statusOf(scenGaps, subId);
    // Only surface genuine gap → met flips; no_data → met is intentionally suppressed
    // because no gap was ever confirmed, so claiming "gap closed" would be misleading.
    if (before === 'gap' && after === 'met') {
      out.push({ kind: 'downstream_gap', subCompetencyId: subId, label: input.subCompLabel(subId), before, after });
    }
  }

  // --- Upstream: each new incoming demand is a new prereq requirement on this course ---
  for (const a of input.assumesIncoming) {
    const dims = [a.k != null ? `K${a.k}` : null, a.u != null ? `U${a.u}` : null, a.d != null ? `D${a.d}` : null].filter(Boolean).join(' ');
    out.push({ kind: 'upstream_gap', subCompetencyId: a.subCompetencyId ?? null, label: a.label, before: 'no demand', after: `new demand ${dims}` });
  }

  return out;
}
