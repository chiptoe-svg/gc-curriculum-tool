/**
 * Phase 1B query layer. One round-trip per (career-target) load —
 * returns the snapshot × sub-competency cells with the productive-failure
 * conditions block joined in from each snapshot's profile JSON.
 *
 * Program-sequence ordering: courses are ordered by catalog `level` first
 * (1000 / 2000 / 3000 / 4000), then by course code. The catalog `level`
 * column already exists; the prerequisite-chain refinement is deferred to
 * Stage 2 if simple level-ordering proves coarse.
 */

import { asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  snapshotTargetCoverage,
  courseCaptureSnapshots,
  courses,
  careerTargets,
  subCompetencies,
} from '@/lib/db/schema';
import type { SnapshotCellInput, ProductiveFailureConditions } from '@/lib/program/scaffolding';

/**
 * Deploy moment of the problem-solving capture fix. Snapshots created BEFORE
 * this cannot be trusted for productive-failure data: the pre-fix v1 scores
 * path fabricated an all-`absent` block when Area 7 wasn't probed, so a stored
 * block may be fake-absent. Such snapshots are reclassified to no-data.
 *
 * SET THIS to the UTC timestamp at which this change merges/deploys
 * (`date -u +%Y-%m-%dT%H:%M:%SZ`). The default below is the fix's design date;
 * it is bumped to the actual deploy moment in the close-out task so snapshots
 * captured today under the OLD prompts are also reclassified.
 */
export const PF_CONTRACT_EPOCH = new Date('2026-06-05T02:50:48Z');

/** Presence-as-sentinel with the legacy cutoff: pre-epoch => null (no data). */
export function pfForSnapshot(
  createdAt: Date,
  block: ProductiveFailureConditions | null,
): ProductiveFailureConditions | null {
  if (createdAt < PF_CONTRACT_EPOCH) return null;
  return block;
}

export interface ScaffoldingCourse {
  snapshotId: string;
  courseCode: string;
  courseTitle: string;
  level: number;
  sequenceIndex: number;
  snapshotCreatedAt: Date;
  snapshotCaption: string | null;
}

export interface ScaffoldingSubCompetency {
  id: string;
  name: string;
  descriptorK: string | null;
  descriptorU: string | null;
  descriptorD: string | null;
}

export interface ScaffoldingTargetInput {
  targetId: string;
  targetName: string;
  courses: ScaffoldingCourse[];
  subCompetencies: ScaffoldingSubCompetency[];
  cellsBySubCompetency: Map<string, SnapshotCellInput[]>;
}

export async function loadScaffoldingTarget(targetId: string): Promise<ScaffoldingTargetInput | null> {
  const target = await db.select().from(careerTargets).where(eq(careerTargets.id, targetId)).limit(1);
  if (!target[0]) return null;

  // Schema uses displayOrder (not orderIndex) and singular descriptor field names:
  //   knowDescriptor / understandDescriptor / doDescriptor (not descriptorK/U/D)
  const subs = await db
    .select()
    .from(subCompetencies)
    .where(eq(subCompetencies.careerTargetId, targetId))
    .orderBy(asc(subCompetencies.displayOrder));

  // All latest (non-retired) snapshots, joined with their course for level
  // ordering. We use the cross-product of (snapshot × subCompetency) below.
  const snapshotRows = await db
    .select({
      snapshotId: courseCaptureSnapshots.id,
      courseCode: courseCaptureSnapshots.courseCode,
      profile: courseCaptureSnapshots.profile,
      caption: courseCaptureSnapshots.caption,
      createdAt: courseCaptureSnapshots.createdAt,
      level: courses.level,
      courseTitle: courses.title,
    })
    .from(courseCaptureSnapshots)
    .leftJoin(courses, eq(courses.code, courseCaptureSnapshots.courseCode))
    .where(isNull(courseCaptureSnapshots.retiredAt))
    .orderBy(asc(courses.level), asc(courseCaptureSnapshots.courseCode));

  // Pick the LATEST snapshot per course (keep first occurrence when ordering
  // by level then code; resolve by created_at within course).
  const byCourse = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) {
    const existing = byCourse.get(row.courseCode);
    if (!existing || row.createdAt > existing.createdAt) {
      byCourse.set(row.courseCode, row);
    }
  }
  const latest = Array.from(byCourse.values()).sort((a, b) => {
    const la = a.level ?? 9999, lb = b.level ?? 9999;
    if (la !== lb) return la - lb;
    return a.courseCode.localeCompare(b.courseCode);
  });

  const coursesOut: ScaffoldingCourse[] = latest.map((r, i) => ({
    snapshotId: r.snapshotId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle ?? r.courseCode,
    level: r.level ?? 0,
    sequenceIndex: i,
    snapshotCreatedAt: r.createdAt,
    snapshotCaption: r.caption,
  }));

  const snapshotIds = coursesOut.map(c => c.snapshotId);

  // Pull coverage cells for these snapshots × this target.
  // Filter by target and then filter in TS to the relevant snapshot IDs.
  const cells = await db
    .select()
    .from(snapshotTargetCoverage)
    .where(eq(snapshotTargetCoverage.careerTargetId, targetId));

  const cellMap = new Map<string, typeof cells[number]>();
  for (const c of cells) {
    if (snapshotIds.includes(c.snapshotId)) {
      cellMap.set(`${c.snapshotId}:${c.subCompetencyId}`, c);
    }
  }

  // Reconstruct productive-failure conditions per snapshot from its profile blob.
  const pfBySnapshot = new Map<string, ProductiveFailureConditions | null>();
  for (const r of latest) {
    const profile = r.profile as {
      audit_notes?: {
        productive_failure_conditions?: ProductiveFailureConditions | null;
      };
    } | null;
    pfBySnapshot.set(
      r.snapshotId,
      pfForSnapshot(r.createdAt, profile?.audit_notes?.productive_failure_conditions ?? null),
    );
  }

  const cellsBySub = new Map<string, SnapshotCellInput[]>();
  for (const sub of subs) {
    const list: SnapshotCellInput[] = [];
    for (const course of coursesOut) {
      const cell = cellMap.get(`${course.snapshotId}:${sub.id}`);
      if (!cell) continue;
      list.push({
        snapshotId: course.snapshotId,
        courseCode: course.courseCode,
        sequenceIndex: course.sequenceIndex,
        kDepth: cell.kDepth,
        uDepth: cell.uDepth,
        // dDepth is NOT NULL in schema but typed as number — safe cast
        dDepth: cell.dDepth,
        productiveFailureConditions: pfBySnapshot.get(course.snapshotId) ?? null,
      });
    }
    cellsBySub.set(sub.id, list);
  }

  return {
    targetId,
    targetName: target[0].name,
    courses: coursesOut,
    // Map schema's singular descriptor field names to the interface's descriptorK/U/D
    subCompetencies: subs.map(s => ({
      id: s.id,
      name: s.name,
      descriptorK: s.knowDescriptor ?? null,
      descriptorU: s.understandDescriptor ?? null,
      descriptorD: s.doDescriptor ?? null,
    })),
    cellsBySubCompetency: cellsBySub,
  };
}
