/**
 * The live captures the builder and the required-skill judge both read, chosen one way so the two cannot disagree:
 * one non-retired snapshot per (course, instructor), the newest that has been scored against the competency catalog,
 * or, when none has, the newest. /program scores only on request, so a recent capture can sit unscored.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

export interface LiveCaptureRow {
  id: string;
  course_code: string;
  instructor_name: string | null;
  created_at: Date | string;
  profile: CaptureProfile;
}

export async function liveCaptures(): Promise<LiveCaptureRow[]> {
  return (await db.execute(sql`
    SELECT DISTINCT ON (s.course_code, s.instructor_name)
      s.id, s.course_code, s.instructor_name, s.created_at, s.profile
    FROM course_capture_snapshots s
    WHERE s.retired_at IS NULL
    ORDER BY s.course_code, s.instructor_name,
      EXISTS (SELECT 1 FROM snapshot_competency_coverage c WHERE c.snapshot_id = s.id) DESC, s.created_at DESC
  `)).rows as unknown as LiveCaptureRow[];
}

/** Whether a course has any live (non-retired) capture: the library then lists it as captured. */
export async function hasLiveCapture(courseCode: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 FROM course_capture_snapshots WHERE course_code = ${courseCode} AND retired_at IS NULL LIMIT 1
  `)).rows;
  return rows.length > 0;
}

