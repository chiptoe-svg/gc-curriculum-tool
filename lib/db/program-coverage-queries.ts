import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { snapshotTargetCoverage, courseCaptureSnapshots, careerTargets, subCompetencies } from '@/lib/db/schema';

export interface CoverageCellRow {
  snapshotId: string;
  careerTargetId: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  model: string;
  generatedAt: Date;
}

export interface UpsertCoverageCellInput {
  snapshotId: string;
  careerTargetId: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  model: string;
}

function rowToCell(row: typeof snapshotTargetCoverage.$inferSelect): CoverageCellRow {
  return {
    snapshotId: row.snapshotId,
    careerTargetId: row.careerTargetId,
    subCompetencyId: row.subCompetencyId,
    kDepth: row.kDepth,
    uDepth: row.uDepth,
    dDepth: row.dDepth,
    matchedCompetency: row.matchedCompetency,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence as 'high' | 'medium' | 'low',
    rationale: row.rationale,
    model: row.model,
    generatedAt: row.generatedAt,
  };
}

/**
 * Upsert one cell. Idempotent: the (snapshot, target, sub_competency) PK
 * means re-scoring overwrites instead of duplicating.
 */
export async function upsertCoverageCell(input: UpsertCoverageCellInput): Promise<void> {
  await db.insert(snapshotTargetCoverage).values({
    ...input,
    generatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [snapshotTargetCoverage.snapshotId, snapshotTargetCoverage.careerTargetId, snapshotTargetCoverage.subCompetencyId],
    set: {
      kDepth: input.kDepth,
      uDepth: input.uDepth,
      dDepth: input.dDepth,
      matchedCompetency: input.matchedCompetency,
      evidenceExcerpt: input.evidenceExcerpt,
      confidence: input.confidence,
      rationale: input.rationale,
      model: input.model,
      generatedAt: new Date(),
    },
  });
}

export async function getCellsForSnapshotTarget(snapshotId: string, careerTargetId: string): Promise<CoverageCellRow[]> {
  const rows = await db
    .select()
    .from(snapshotTargetCoverage)
    .where(and(
      eq(snapshotTargetCoverage.snapshotId, snapshotId),
      eq(snapshotTargetCoverage.careerTargetId, careerTargetId),
    ));
  return rows.map(rowToCell);
}

export async function getAllCells(): Promise<CoverageCellRow[]> {
  const rows = await db.select().from(snapshotTargetCoverage);
  return rows.map(rowToCell);
}

/**
 * Resolves which (snapshot, target) pairs need scoring: the cross-product of
 * (latest non-retired snapshot per course that has one) × (all non-retired
 * career targets). Returns pairs missing from snapshot_target_coverage.
 */
export interface PairToScore {
  snapshotId: string;
  courseCode: string;
  careerTargetId: string;
  careerTargetName: string;
}

export async function listStalePairs(): Promise<PairToScore[]> {
  // Pick the latest non-retired snapshot per course.
  const latestSnapshots = await db.execute(sql`
    SELECT DISTINCT ON (course_code)
      id, course_code, created_at
    FROM ${courseCaptureSnapshots}
    WHERE retired_at IS NULL
    ORDER BY course_code, created_at DESC
  `);
  const latestSnaps = (latestSnapshots.rows as Array<{ id: string; course_code: string }>);

  // Get the active targets.
  const targets = await db
    .select({ id: careerTargets.id, name: careerTargets.name })
    .from(careerTargets);

  // Get the (snapshot, target) pairs that already have at least one cell.
  // A pair is "scored" when any sub-competency row exists for it; we treat
  // partial scoring as not-yet-scored and re-run the whole pair.
  const existing = await db
    .select({
      snapshotId: snapshotTargetCoverage.snapshotId,
      careerTargetId: snapshotTargetCoverage.careerTargetId,
    })
    .from(snapshotTargetCoverage);
  const scored = new Set(existing.map(e => `${e.snapshotId}:${e.careerTargetId}`));

  const stale: PairToScore[] = [];
  for (const snap of latestSnaps) {
    for (const t of targets) {
      const key = `${snap.id}:${t.id}`;
      if (!scored.has(key)) {
        stale.push({
          snapshotId: snap.id,
          courseCode: snap.course_code,
          careerTargetId: t.id,
          careerTargetName: t.name,
        });
      }
    }
  }
  return stale;
}

export interface MatrixCourse {
  courseCode: string;
  courseTitle: string;
  level: number;
  snapshotId: string;
  snapshotCaption: string | null;
  snapshotCreatedAt: Date;
}

export interface MatrixSubCompetency {
  id: string;
  name: string;
  careerTargetId: string;
  careerTargetName: string;
  displayOrder: number;
}

export interface MatrixCoverageCell {
  snapshotId: string;
  careerTargetId: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface MatrixData {
  courses: MatrixCourse[];
  targets: Array<{ id: string; name: string; displayOrder: number }>;
  subCompetencies: MatrixSubCompetency[];
  cells: MatrixCoverageCell[];
}

/**
 * Read the full matrix payload in one shot: every course with a non-retired
 * snapshot, every active career target with its non-retired sub-competencies,
 * and every scored cell currently in the table.
 */
export async function getMatrixData(): Promise<MatrixData> {
  const latestSnapshotsRaw = await db.execute(sql`
    SELECT DISTINCT ON (s.course_code)
      s.id          AS snapshot_id,
      s.course_code AS course_code,
      s.caption     AS caption,
      s.created_at  AS created_at,
      c.title       AS title,
      c.level       AS level
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL
    ORDER BY s.course_code, s.created_at DESC
  `);
  const courses: MatrixCourse[] = (latestSnapshotsRaw.rows as Array<{
    snapshot_id: string;
    course_code: string;
    caption: string | null;
    created_at: Date;
    title: string;
    level: number;
  }>).map(r => ({
    courseCode: r.course_code,
    courseTitle: r.title,
    level: r.level,
    snapshotId: r.snapshot_id,
    snapshotCaption: r.caption,
    snapshotCreatedAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));

  const targets = await db
    .select({ id: careerTargets.id, name: careerTargets.name, displayOrder: careerTargets.displayOrder })
    .from(careerTargets);

  const subs = await db
    .select({
      id: subCompetencies.id,
      name: subCompetencies.name,
      careerTargetId: subCompetencies.careerTargetId,
      displayOrder: subCompetencies.displayOrder,
      retired: subCompetencies.retired,
    })
    .from(subCompetencies);

  const targetById = new Map(targets.map(t => [t.id, t]));
  const subCompetenciesOut: MatrixSubCompetency[] = subs
    .filter(s => !s.retired)
    .map(s => ({
      id: s.id,
      name: s.name,
      careerTargetId: s.careerTargetId,
      careerTargetName: targetById.get(s.careerTargetId)?.name ?? '',
      displayOrder: s.displayOrder,
    }));

  const cells = await getAllCells();

  return {
    courses: courses.sort((a, b) => a.courseCode.localeCompare(b.courseCode)),
    targets: targets.sort((a, b) => a.displayOrder - b.displayOrder),
    subCompetencies: subCompetenciesOut.sort((a, b) =>
      a.careerTargetId === b.careerTargetId
        ? a.displayOrder - b.displayOrder
        : a.careerTargetId.localeCompare(b.careerTargetId)
    ),
    cells: cells.map(c => ({
      snapshotId: c.snapshotId,
      careerTargetId: c.careerTargetId,
      subCompetencyId: c.subCompetencyId,
      kDepth: c.kDepth,
      uDepth: c.uDepth,
      dDepth: c.dDepth,
      matchedCompetency: c.matchedCompetency,
      evidenceExcerpt: c.evidenceExcerpt,
      confidence: c.confidence,
      rationale: c.rationale,
    })),
  };
}
