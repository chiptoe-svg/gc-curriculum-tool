import { db } from './client';
import { prototypeRuns } from './schema';
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

