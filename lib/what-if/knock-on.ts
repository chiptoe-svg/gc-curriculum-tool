/**
 * Effects of a what-if on the neighboring courses and the career targets.
 * Deterministic: no AI call, no write. Every line comes from the what-if's
 * stored ratings and the program's stored coverage and prerequisite data.
 *
 * Replaces the retired Explore ripple and career-fit engines, because two things
 * differ here: each later course
 * is checked with ALL of its confirmed prerequisites, and career-target moves
 * are reported in both directions.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { competencyLevels, subCompetencies } from '@/lib/db/schema';
import { listConfirmedEdgePairs } from '@/lib/db/prerequisite-edge-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getMatrixData, type MatrixData } from '@/lib/db/program-coverage-queries';
import { depthBand } from '@/lib/program/depth-band';
import {
  computeGapsFromInputs, loadDelivered, loadPrereqGapInputs,
  type DeliveredAttainment, type GapStatus, type RelyEdge,
} from '@/lib/program/prereq-gaps';
import { buildBaselineDelivered, normalizeCompetencyKey } from '@/lib/what-if/neighbor-helpers';
import type { Kud, KnockOn, PredictedSubCompDepth, WhatIfProfile } from './types';

const maxN = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);

/**
 * The sub-competency depths the what-if's moved and new ratings stand for.
 * A moved rating resolves through the base snapshot's coverage rows (by
 * statement); a new linked rating through its own sub-competency id. Anything
 * that cannot be resolved is named in `notComputed` and never guessed.
 * Two statements on one sub-competency give one entry (per-dimension maximum).
 */
export async function resolveWhatIfDepths(
  baseSnapshotId: string,
  profile: WhatIfProfile,
): Promise<{ resolved: PredictedSubCompDepth[]; notComputed: string[] }> {
  const changed = profile.ratings.filter(r => r.status !== 'approved');
  if (changed.length === 0) return { resolved: [], notComputed: [] };

  // The base snapshot's coverage rows (one per sub-competency), by statement.
  // "Before" (buildBaselineDelivered) reads these same depths.
  type Cov = { id: string; k: number | null; u: number | null; d: number | null };
  const rows = await db
    .select({
      subCompetencyId: competencyLevels.competencyId,
      matchedCompetency: competencyLevels.matchedCompetency,
      kDepth: competencyLevels.kDepth,
      uDepth: competencyLevels.uDepth,
      dDepth: competencyLevels.dDepth,
    })
    .from(competencyLevels)
    .where(eq(competencyLevels.snapshotId, baseSnapshotId));
  const covByStatement = new Map<string, Cov[]>();
  for (const row of rows) {
    if (!row.matchedCompetency) continue;
    const key = normalizeCompetencyKey(row.matchedCompetency);
    const list = covByStatement.get(key) ?? [];
    list.push({ id: row.subCompetencyId, k: row.kDepth, u: row.uDepth, d: row.dDepth });
    covByStatement.set(key, list);
  }

  const bySub = new Map<string, PredictedSubCompDepth>();
  const fold = (id: string, v: Kud) => {
    const prev = bySub.get(id);
    bySub.set(id, {
      subCompetencyId: id,
      k: maxN(prev?.k ?? null, v.k),
      u: maxN(prev?.u ?? null, v.u),
      d: maxN(prev?.d ?? null, v.d),
    });
  };
  // On a dimension the what-if did not change, the coverage row's own value
  // stands; only a changed dimension takes the predicted value.
  const dim = (after: number | null, before: number | null, covered: number | null) =>
    after === before ? covered : after;

  const notComputed: string[] = [];
  for (const r of changed) {
    if (r.status === 'new') {
      if (r.linked && r.subCompetencyId) fold(r.subCompetencyId, r.kud);
      else notComputed.push(r.statement);
      continue;
    }
    const covs = covByStatement.get(normalizeCompetencyKey(r.statement)) ?? [];
    if (covs.length === 0) { notComputed.push(r.statement); continue; }
    const before = r.before ?? { k: null, u: null, d: null };
    for (const c of covs) {
      fold(c.id, { k: dim(r.kud.k, before.k, c.k), u: dim(r.kud.u, before.u, c.u), d: dim(r.kud.d, before.d, c.d) });
    }
  }

  // Every base coverage row that does not belong to a moved statement still
  // delivers its sub-competency, at its own depth: an unchanged statement's
  // row, and also a row whose matched text is empty or a paraphrase that
  // matches no statement ("before" counts all of them). Looked up by
  // sub-competency id; such rows join the maximum of an entry that exists,
  // but never create one of their own.
  const movedKeys = new Set(
    profile.ratings.filter(r => r.status === 'moved').map(r => normalizeCompetencyKey(r.statement)));
  for (const row of rows) {
    if (!bySub.has(row.subCompetencyId)) continue;
    if (row.matchedCompetency && movedKeys.has(normalizeCompetencyKey(row.matchedCompetency))) continue;
    fold(row.subCompetencyId, { k: row.kDepth, u: row.uDepth, d: row.dDepth });
  }
  return { resolved: [...bySub.values()], notComputed };
}

const statusOf = (edges: RelyEdge[], delivered: DeliveredAttainment[]): Map<string, GapStatus> =>
  new Map(computeGapsFromInputs(edges, delivered).map(g => [g.subCompetencyId, g.status]));

/**
 * Later courses that would gain or lose a prerequisite gap. "Before" is the
 * course's delivered rows with the focal course's rows taken from the base
 * snapshot; "after" replaces the focal rows for each predicted sub-competency
 * with one predicted ('intended') row. The course is checked with all of its
 * confirmed prerequisites, so a gap another prerequisite still covers is not
 * reported. Only gap -> met (closed) and met -> gap (opened) are reported.
 */
export function laterCourseLines(input: {
  focalCourseCode: string;
  focalBaseline: DeliveredAttainment[];
  predicted: PredictedSubCompDepth[];
  perCourse: Array<{ courseCode: string; edges: RelyEdge[]; delivered: DeliveredAttainment[] }>;
  label: (id: string) => string;
}): KnockOn['laterCourses'] {
  const { focalCourseCode, focalBaseline, predicted } = input;
  const predictedIds = new Set(predicted.map(p => p.subCompetencyId));
  const out: KnockOn['laterCourses'] = [];
  for (const c of input.perCourse) {
    const others = c.delivered.filter(d => d.prereqCourseCode !== focalCourseCode);
    const before = [...others, ...focalBaseline];
    const after = [
      ...others,
      ...focalBaseline.filter(d => !predictedIds.has(d.subCompetencyId)),
      ...predicted.map((p): DeliveredAttainment => ({
        prereqCourseCode: focalCourseCode, subCompetencyId: p.subCompetencyId,
        k: p.k, u: p.u, d: p.d, basis: 'intended',
      })),
    ];
    const was = statusOf(c.edges, before);
    const now = statusOf(c.edges, after);
    for (const [subCompetencyId, b] of was) {
      const a = now.get(subCompetencyId);
      const effect = b === 'gap' && a === 'met' ? 'closed' : b === 'met' && a === 'gap' ? 'opened' : null;
      if (effect) out.push({ courseCode: c.courseCode, subCompetencyId, label: input.label(subCompetencyId), effect });
    }
  }
  return out;
}

/**
 * New or raised walking-in expectations, checked against what the earlier
 * courses deliver. An expectation with no catalog link cannot be checked.
 */
export function earlierCourseLines(input: {
  incomingChanges: WhatIfProfile['incomingChanges'];
  prereqCodes: string[];
  delivered: DeliveredAttainment[];
  label: (id: string) => string;
}): KnockOn['earlierCourses'] {
  const out: KnockOn['earlierCourses'] = [];
  const edgeFor = (prereqCourseCode: string, subCompetencyId: string, e: { k: number | null; u: number | null; d: number | null }): RelyEdge =>
    ({ prereqCourseCode, subCompetencyId, expectedK: e.k, expectedU: e.u, expectedD: e.d });

  for (const c of input.incomingChanges) {
    if (c.kind === 'dropped') continue;
    if (!c.linked || !c.subCompetencyId) {
      out.push({ statement: c.statement, label: null, status: 'not_known', deliveredBy: [] });
      continue;
    }
    if (!c.expected) continue;
    const subId = c.subCompetencyId;
    const expected = c.expected;
    const all = statusOf(input.prereqCodes.map(p => edgeFor(p, subId, expected)), input.delivered).get(subId);
    const deliveredBy = input.prereqCodes.filter(p =>
      statusOf([edgeFor(p, subId, expected)], input.delivered).get(subId) === 'met');
    out.push({
      statement: c.statement, label: input.label(subId),
      status: all === 'met' ? 'met' : all === 'gap' ? 'not_met' : 'not_known',
      deliveredBy,
    });
  }
  return out;
}

const BAND_RANK: Record<string, number> = { none: 0, low: 1, working: 2, high: 3 };
const bandRankOf = (n: number | null): number => {
  const b = depthBand(n);
  return b ? BAND_RANK[b.key]! : -1; // no data ranks below every real band
};
const bandWord = (n: number | null): string => depthBand(n)?.word ?? 'no data';

/** Career targets where the focal course's Do band moves, in either direction. */
export function careerLines(input: {
  focalSnapshotId: string;
  predicted: PredictedSubCompDepth[];
  matrix: MatrixData;
}): KnockOn['careerTargets'] {
  const predBySub = new Map(input.predicted.map(p => [p.subCompetencyId, p]));
  const targetName = new Map(input.matrix.targets.map(t => [t.id, t.name]));
  const subName = new Map(input.matrix.subCompetencies.map(s => [s.id, s.name]));
  const out: KnockOn['careerTargets'] = [];
  for (const cell of input.matrix.cells) {
    if (cell.snapshotId !== input.focalSnapshotId) continue;
    const p = predBySub.get(cell.subCompetencyId);
    if (!p || p.d === null) continue;
    const was = bandRankOf(cell.dDepth);
    const now = bandRankOf(p.d);
    if (was === now) continue;
    out.push({
      targetName: targetName.get(cell.careerTargetId) ?? cell.careerTargetId,
      label: subName.get(cell.subCompetencyId) ?? cell.subCompetencyId,
      before: bandWord(cell.dDepth),
      after: bandWord(p.d),
      direction: now > was ? 'up' : 'down',
    });
  }
  return out;
}

/**
 * All effects of a what-if. Reads only. The caller checks that the what-if
 * still has a base snapshot before calling.
 */
export async function computeKnockOn(
  w: { courseCode: string; baseSnapshotId: string },
  profile: WhatIfProfile,
): Promise<KnockOn> {
  const snapshot = await getSnapshotById(w.baseSnapshotId);
  if (!snapshot) throw new Error(`computeKnockOn: base snapshot ${w.baseSnapshotId} not found`);

  const { resolved, notComputed } = await resolveWhatIfDepths(w.baseSnapshotId, profile);

  const pairs = await listConfirmedEdgePairs();
  const laterCodes = [...new Set(pairs.filter(p => p.prereq === w.courseCode).map(p => p.focal))];
  const earlierCodes = [...new Set(pairs.filter(p => p.focal === w.courseCode).map(p => p.prereq))];

  const names = new Map(
    (await db.select({ id: subCompetencies.id, name: subCompetencies.name }).from(subCompetencies))
      .map(s => [s.id, s.name]),
  );
  const label = (id: string) => names.get(id) ?? id;

  const focalBaseline = await buildBaselineDelivered(w.courseCode, w.baseSnapshotId);
  const perCourse = await Promise.all(laterCodes.map(async courseCode => ({
    courseCode, ...(await loadPrereqGapInputs(courseCode)),
  })));

  const linkedIncoming = profile.incomingChanges.filter(c => c.kind !== 'dropped' && c.linked && c.subCompetencyId);
  const earlierDelivered = await loadDelivered(
    earlierCodes.flatMap(prereqCourseCode =>
      linkedIncoming.map(c => ({ prereqCourseCode, subCompetencyId: c.subCompetencyId! }))),
  );

  const matrix = await getMatrixData();
  // No career cell for the base version: career effects cannot be computed.
  // Say so rather than report "no effect", and never read another version.
  const careerNotComputed = !matrix.cells.some(c => c.snapshotId === w.baseSnapshotId);

  return {
    laterCourses: laterCourseLines({ focalCourseCode: w.courseCode, focalBaseline, predicted: resolved, perCourse, label }),
    earlierCourses: earlierCourseLines({ incomingChanges: profile.incomingChanges, prereqCodes: earlierCodes, delivered: earlierDelivered, label }),
    careerTargets: careerLines({ focalSnapshotId: w.baseSnapshotId, predicted: resolved, matrix }),
    notComputed,
    careerNotComputed,
  };
}
