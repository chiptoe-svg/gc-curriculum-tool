import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureProfiles } from '@/lib/db/schema';
import type { CaptureProfile, CaptureReviewerStatus } from '@/lib/ai/capture/schema';

export interface CourseCaptureProfileRow {
  courseCode: string;
  profile: CaptureProfile;
  reviewerStatus: CaptureReviewerStatus;
  reviewerNote: string | null;
  scaleVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getCaptureProfileByCourse(
  courseCode: string,
): Promise<CourseCaptureProfileRow | null> {
  const rows = await db
    .select()
    .from(courseCaptureProfiles)
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    courseCode: row.courseCode,
    profile: row.profile,
    reviewerStatus: row.reviewerStatus,
    reviewerNote: row.reviewerNote,
    scaleVersion: row.scaleVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface UpsertCaptureProfileInput {
  courseCode: string;
  profile: CaptureProfile;
  reviewerStatus?: CaptureReviewerStatus;
  reviewerNote?: string | null;
}

/**
 * Insert or replace the current capture profile for a course. Uses a single
 * row per course (PK courseCode); writes overwrite the previous profile.
 *
 * Historical profiles are not retained automatically — if/when that matters
 * we add a sibling `course_capture_profile_runs` table mirroring the
 * `course_profile_runs` pattern. For alpha, single-row-per-course matches
 * the existing `course_profiles` convention and keeps the data model small.
 */
export async function upsertCaptureProfile({
  courseCode,
  profile,
  reviewerStatus = 'ai_drafted',
  reviewerNote = null,
}: UpsertCaptureProfileInput): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({ courseCode: courseCaptureProfiles.courseCode })
    .from(courseCaptureProfiles)
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(courseCaptureProfiles).values({
      courseCode,
      profile,
      reviewerStatus,
      reviewerNote,
      scaleVersion: profile.scale_version,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(courseCaptureProfiles)
      .set({
        profile,
        reviewerStatus,
        reviewerNote,
        scaleVersion: profile.scale_version,
        updatedAt: now,
      })
      .where(eq(courseCaptureProfiles.courseCode, courseCode));
  }
}

/**
 * Mark a capture profile as reviewer-confirmed (or edited) without changing
 * the profile blob. Returns true when a row was updated.
 */
export async function setCaptureProfileStatus(
  courseCode: string,
  status: CaptureReviewerStatus,
  reviewerNote?: string | null,
): Promise<boolean> {
  const rows = await db
    .update(courseCaptureProfiles)
    .set({
      reviewerStatus: status,
      reviewerNote: reviewerNote ?? null,
      updatedAt: new Date(),
    })
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .returning({ courseCode: courseCaptureProfiles.courseCode });
  return rows.length > 0;
}
