import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { synthesisRuns } from '@/lib/db/schema';
import { countSubmittedForTarget } from './queries';

export type StalenessReason = 'no_run' | 'new_submissions' | 'age';

export interface StalenessResult {
  stale: boolean;
  reason?: StalenessReason;
  cachedSubmissionCount?: number;
  currentSubmissionCount: number;
  threshold: number;
}

const AGE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

function thresholdFromEnv(): number {
  const raw = process.env.SYNTHESIS_STALENESS_THRESHOLD?.trim();
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function stalenessCheck(targetId: string): Promise<StalenessResult> {
  const threshold = thresholdFromEnv();
  const currentSubmissionCount = await countSubmittedForTarget(targetId);

  const rows = await db.select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.careerTargetId, targetId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(1);
  const latest = rows[0];

  if (!latest) {
    return { stale: true, reason: 'no_run', currentSubmissionCount, threshold };
  }

  const age = Date.now() - latest.createdAt.getTime();
  if (age > AGE_LIMIT_MS) {
    return { stale: true, reason: 'age', cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
  }

  const delta = currentSubmissionCount - latest.submissionCount;
  if (delta >= threshold) {
    return { stale: true, reason: 'new_submissions', cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
  }

  return { stale: false, cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
}
