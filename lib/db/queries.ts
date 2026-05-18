import { db } from './client';
import { prototypeRuns, prototypeFlags } from './schema';
import { eq, desc } from 'drizzle-orm';
import type { AnalysisResult } from '@/lib/domain/types';

export interface InsertRunInput {
  ipHash: string;
  careerTargetId: string;
  upstreamCourseLabel: string | null;
  downstreamCourseLabel: string | null;
  upstreamSyllabus: string;
  downstreamSyllabus: string;
  result: AnalysisResult;
  aiProvider: string;
  aiModel: string;
  costUsdCents: number;
  durationMs: number;
}

export async function insertRun(input: InsertRunInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeRuns).values({
    ipHash: input.ipHash,
    careerTargetId: input.careerTargetId,
    upstreamCourseLabel: input.upstreamCourseLabel,
    downstreamCourseLabel: input.downstreamCourseLabel,
    upstreamSyllabus: input.upstreamSyllabus,
    downstreamSyllabus: input.downstreamSyllabus,
    result: input.result,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    costUsdCents: input.costUsdCents,
    durationMs: input.durationMs,
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
