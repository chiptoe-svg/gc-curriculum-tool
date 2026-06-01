import { isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureProfiles, courseCaptureSnapshots, captureMessages } from '@/lib/db/schema';

export type CaptureStatus = 'not-started' | 'in-audit' | 'ai-drafted' | 'reviewed' | 'captured';

export interface CourseStatusRow {
  code: string;
  title: string;
  level: number | null;
  status: CaptureStatus;
  lastCapturedAt: Date | null;   // most-recent non-retired snapshot createdAt
  lastEditedAt: Date | null;     // capture_profiles.updatedAt
  hasActiveSession: boolean;     // any capture_messages within last 24h
}

/**
 * Compute capture status for every course in the catalog. 4 parallel queries
 * (no per-course loops). Used by the /courses landing page.
 *
 * Status ladder (highest wins):
 *   captured   — at least one non-retired snapshot exists
 *   reviewed   — profile exists with reviewerStatus 'edited' | 'confirmed'
 *   ai-drafted — profile exists with reviewerStatus 'ai_drafted'
 *   in-audit   — any capture_message in the last 24h (active audit session)
 *   not-started — none of the above
 */
export async function listCoursesWithStatus(): Promise<CourseStatusRow[]> {
  const [courseRows, profileRows, snapshotRows, recentMessages] = await Promise.all([
    db.select().from(courses),
    db.select().from(courseCaptureProfiles),
    db
      .select()
      .from(courseCaptureSnapshots)
      .where(isNull(courseCaptureSnapshots.retiredAt))
      .orderBy(desc(courseCaptureSnapshots.createdAt)),
    db
      .select({ courseCode: captureMessages.courseCode, createdAt: captureMessages.createdAt })
      .from(captureMessages)
      .orderBy(desc(captureMessages.createdAt))
      .limit(500), // cap; we only need most-recent per course for 24h check
  ]);

  const profileByCode = new Map(profileRows.map(p => [p.courseCode, p]));

  // Keep only the latest snapshot per course (rows already DESC by createdAt).
  const latestSnapshotByCode = new Map<string, typeof snapshotRows[number]>();
  for (const s of snapshotRows) {
    if (!latestSnapshotByCode.has(s.courseCode)) latestSnapshotByCode.set(s.courseCode, s);
  }

  // Track which courses had a capture_message in the last 24h.
  const recentSessionByCode = new Map<string, Date>();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const m of recentMessages) {
    if (m.createdAt > oneDayAgo && !recentSessionByCode.has(m.courseCode)) {
      recentSessionByCode.set(m.courseCode, m.createdAt);
    }
  }

  return courseRows.map(c => {
    const profile = profileByCode.get(c.code);
    const snapshot = latestSnapshotByCode.get(c.code);
    const hasActiveSession = recentSessionByCode.has(c.code);

    let status: CaptureStatus;
    if (snapshot) {
      status = 'captured';
    } else if (profile?.reviewerStatus === 'edited' || profile?.reviewerStatus === 'confirmed') {
      status = 'reviewed';
    } else if (profile?.reviewerStatus === 'ai_drafted') {
      status = 'ai-drafted';
    } else if (hasActiveSession) {
      status = 'in-audit';
    } else {
      status = 'not-started';
    }

    return {
      code: c.code,
      title: c.title,
      level: c.level ?? null,
      status,
      lastCapturedAt: snapshot?.createdAt ?? null,
      lastEditedAt: profile?.updatedAt ?? null,
      hasActiveSession,
    };
  });
}
