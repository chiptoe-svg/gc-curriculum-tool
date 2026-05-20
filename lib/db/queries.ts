import { db } from './client';
import { prototypeRuns, prototypeFlags } from './schema';
import { eq, desc } from 'drizzle-orm';
import type { AnalysisResult, TargetChainAnalysisResult } from '@/lib/domain/types';

export interface InsertRunInput {
  ipHash: string;
  careerTargetId: string;
  courseLabel: string | null;
  courseSyllabus: string;
  priorCoursework: Array<{ courseLabel: string; syllabus: string }>;
  result: AnalysisResult | TargetChainAnalysisResult;
  aiProvider: string;
  aiModel: string;
  costUsdCents: number;
  durationMs: number;
  analysisKind: 'course_prereqs' | 'target_chain';
}

export async function insertRun(input: InsertRunInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeRuns).values({
    ipHash: input.ipHash,
    careerTargetId: input.careerTargetId,
    courseLabel: input.courseLabel,
    courseSyllabus: input.courseSyllabus,
    priorCoursework: input.priorCoursework,
    result: input.result,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    costUsdCents: input.costUsdCents,
    durationMs: input.durationMs,
    analysisKind: input.analysisKind,
  }).returning({ id: prototypeRuns.id });
  if (!row) throw new Error('insertRun: no row returned');
  return row;
}

export interface InsertFlagInput {
  runId: string;
  flagType: 'coverage' | 'prerequisite_gap' | 'kud_draft';
  target: string;
  note: string;
}

export async function insertFlag(input: InsertFlagInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeFlags).values(input).returning({ id: prototypeFlags.id });
  if (!row) throw new Error('insertFlag: no row returned');
  return row;
}

export async function listFlags(): Promise<Array<typeof prototypeFlags.$inferSelect>> {
  return db.select().from(prototypeFlags).orderBy(desc(prototypeFlags.createdAt)).limit(100);
}
