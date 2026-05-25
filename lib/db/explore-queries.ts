import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseExploreTargets, courseExploreAnalyses } from '@/lib/db/schema';
import type { TargetSpec, ExploreAnalysis } from '@/lib/ai/explore/schema';

export interface ExploreTargetRow {
  id: string;
  courseCode: string;
  kind: 'custom' | 'downstream';
  spec: TargetSpec;
  caption: string | null;
  proseInput: string | null;
  authoredAgainstSnapshotId: string | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToTarget(row: typeof courseExploreTargets.$inferSelect): ExploreTargetRow {
  return {
    id: row.id,
    courseCode: row.courseCode,
    kind: row.kind as 'custom' | 'downstream',
    spec: row.spec as TargetSpec,
    caption: row.caption,
    proseInput: row.proseInput,
    authoredAgainstSnapshotId: row.authoredAgainstSnapshotId,
    retiredAt: row.retiredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listTargetsByCourse(courseCode: string, includeRetired = false): Promise<ExploreTargetRow[]> {
  const whereClause = includeRetired
    ? eq(courseExploreTargets.courseCode, courseCode)
    : and(eq(courseExploreTargets.courseCode, courseCode), isNull(courseExploreTargets.retiredAt));
  const rows = await db
    .select()
    .from(courseExploreTargets)
    .where(whereClause)
    .orderBy(desc(courseExploreTargets.createdAt));
  return rows.map(rowToTarget);
}

export async function getTargetById(id: string): Promise<ExploreTargetRow | null> {
  const rows = await db
    .select()
    .from(courseExploreTargets)
    .where(eq(courseExploreTargets.id, id))
    .limit(1);
  return rows[0] ? rowToTarget(rows[0]) : null;
}

export interface CreateTargetInput {
  courseCode: string;
  kind: 'custom' | 'downstream';
  spec: TargetSpec;
  caption: string | null;
  proseInput: string | null;
  authoredAgainstSnapshotId: string | null;
}

export async function createTarget(input: CreateTargetInput): Promise<ExploreTargetRow> {
  const [row] = await db.insert(courseExploreTargets).values({
    courseCode: input.courseCode,
    kind: input.kind,
    spec: input.spec,
    caption: input.caption,
    proseInput: input.proseInput,
    authoredAgainstSnapshotId: input.authoredAgainstSnapshotId,
  }).returning();
  if (!row) throw new Error('createTarget: no row returned');
  return rowToTarget(row);
}

export interface UpdateTargetInput {
  id: string;
  spec?: TargetSpec;
  caption?: string | null;
  retired?: boolean;
}

export async function updateTarget(input: UpdateTargetInput): Promise<ExploreTargetRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.spec !== undefined) set.spec = input.spec;
  if (input.caption !== undefined) set.caption = input.caption;
  if (input.retired !== undefined) set.retiredAt = input.retired ? new Date() : null;
  const rows = await db
    .update(courseExploreTargets)
    .set(set)
    .where(eq(courseExploreTargets.id, input.id))
    .returning();
  return rows[0] ? rowToTarget(rows[0]) : null;
}

// ----- Analyses -----

export interface ExploreAnalysisRow {
  id: string;
  courseCode: string;
  snapshotId: string;
  targetId: string;
  analysis: ExploreAnalysis;
  model: string;
  createdAt: Date;
}

function rowToAnalysis(row: typeof courseExploreAnalyses.$inferSelect): ExploreAnalysisRow {
  return {
    id: row.id,
    courseCode: row.courseCode,
    snapshotId: row.snapshotId,
    targetId: row.targetId,
    analysis: row.analysis as ExploreAnalysis,
    model: row.model,
    createdAt: row.createdAt,
  };
}

export interface CreateAnalysisInput {
  courseCode: string;
  snapshotId: string;
  targetId: string;
  analysis: ExploreAnalysis;
  model: string;
}

export async function createAnalysis(input: CreateAnalysisInput): Promise<ExploreAnalysisRow> {
  const [row] = await db.insert(courseExploreAnalyses).values(input).returning();
  if (!row) throw new Error('createAnalysis: no row returned');
  return rowToAnalysis(row);
}

export async function listAnalysesByCourse(courseCode: string): Promise<ExploreAnalysisRow[]> {
  const rows = await db
    .select()
    .from(courseExploreAnalyses)
    .where(eq(courseExploreAnalyses.courseCode, courseCode))
    .orderBy(desc(courseExploreAnalyses.createdAt));
  return rows.map(rowToAnalysis);
}

export async function getAnalysisById(id: string): Promise<ExploreAnalysisRow | null> {
  const rows = await db
    .select()
    .from(courseExploreAnalyses)
    .where(eq(courseExploreAnalyses.id, id))
    .limit(1);
  return rows[0] ? rowToAnalysis(rows[0]) : null;
}
