import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, courseCaptureProfiles } from '@/lib/db/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InputsMeta {
  catalog: {
    description: string;
    prerequisites: string;
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  };
  builderProfilePresent: boolean;
  materials: Array<{
    id: string;
    fileName: string;
    extractionStatus: string;
    sizeBytes: number;
    ignored: boolean;
  }>;
  prereqSnapshotsUsed: Array<{
    courseCode: string;
    snapshotId: string;
    caption: string | null;
  }>;
  scanPasses: {
    canvasImportedAt: string | null;
    googleDocsScannedAt: string | null;
  };
}

export interface SnapshotRow {
  id: string;
  courseCode: string;
  profile: CaptureProfile;
  inputsMeta: InputsMeta;
  transcript: ChatMessage[];
  caption: string | null;
  captionNote: string | null;
  reviewerNote: string | null;
  /** Populated for v2 captures; null for v1 legacy snapshots. */
  transcriptSessionId: string | null;
  scaleVersion: string;
  model: string;
  /** Auditor identity at capture time. 'Department canonical' for backfilled rows. */
  instructorName: string | null;
  retiredAt: Date | null;
  createdAt: Date;
}

export interface CreateSnapshotInput {
  courseCode: string;
  profile: CaptureProfile;
  inputsMeta: InputsMeta;
  transcript: ChatMessage[];
  caption: string | null;
  captionNote: string | null;
  reviewerNote: string | null;
  model: string;
  /** Inherited from the producing session's capture_messages.instructor_name. */
  instructorName?: string | null;
  /** The v2 capture session that produced this snapshot. Links the immutable
   *  audit transcript (capture_messages) to the snapshot so the wiki raw layer
   *  can render it. Null for genuine v1 captures (no session). */
  transcriptSessionId?: string | null;
}

export async function createSnapshot(input: CreateSnapshotInput): Promise<SnapshotRow> {
  const [row] = await db.insert(courseCaptureSnapshots).values({
    courseCode: input.courseCode,
    profile: input.profile,
    inputsMeta: input.inputsMeta,
    transcript: input.transcript,
    caption: input.caption,
    captionNote: input.captionNote,
    reviewerNote: input.reviewerNote,
    scaleVersion: input.profile.scale_version,
    model: input.model,
    instructorName: input.instructorName ?? null,
    transcriptSessionId: input.transcriptSessionId ?? null,
  }).returning();
  if (!row) throw new Error('createSnapshot: no row returned');
  return rowToSnapshot(row);
}

export interface ListSnapshotsOptions {
  includeRetired?: boolean;
}

export async function listSnapshotsByCourse(
  courseCode: string,
  opts: ListSnapshotsOptions = {},
): Promise<SnapshotRow[]> {
  const whereClause = opts.includeRetired
    ? eq(courseCaptureSnapshots.courseCode, courseCode)
    : and(eq(courseCaptureSnapshots.courseCode, courseCode), isNull(courseCaptureSnapshots.retiredAt));

  const rows = await db
    .select()
    .from(courseCaptureSnapshots)
    .where(whereClause)
    .orderBy(desc(courseCaptureSnapshots.createdAt));
  return rows.map(rowToSnapshot);
}

export async function getSnapshotById(id: string): Promise<SnapshotRow | null> {
  const rows = await db
    .select()
    .from(courseCaptureSnapshots)
    .where(eq(courseCaptureSnapshots.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToSnapshot(row) : null;
}

/**
 * Returns the most recent non-retired snapshot for the given course,
 * or null if none exists. Used by downstream consumers (prereq loader,
 * Explore module) that want a stable point-in-time profile.
 */
export async function getLatestSnapshotByCourse(courseCode: string): Promise<SnapshotRow | null> {
  const rows = await db
    .select()
    .from(courseCaptureSnapshots)
    .where(and(
      eq(courseCaptureSnapshots.courseCode, courseCode),
      isNull(courseCaptureSnapshots.retiredAt),
    ))
    .orderBy(desc(courseCaptureSnapshots.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? rowToSnapshot(row) : null;
}

export async function setSnapshotRetired(id: string, retired: boolean): Promise<boolean> {
  const rows = await db
    .update(courseCaptureSnapshots)
    .set({ retiredAt: retired ? new Date() : null })
    .where(eq(courseCaptureSnapshots.id, id))
    .returning({ id: courseCaptureSnapshots.id });
  return rows.length > 0;
}

/**
 * Copy a snapshot's profile back into the working draft for its course.
 * The transcript is NOT loaded — the chat starts fresh from this draft.
 * Conversation persistence (capture_conversations) is not touched here;
 * callers should clear it separately if they want a clean chat.
 */
export async function loadSnapshotAsDraft(snapshotId: string): Promise<boolean> {
  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) return false;

  const now = new Date();
  // Atomic upsert on the courseCode PK (closes the TOCTOU select-then-write
  // window). reviewerStatus 'edited' = forking from a snapshot is a draft edit.
  const fields = {
    profile: snapshot.profile,
    reviewerStatus: 'edited' as const,
    reviewerNote: `Loaded from snapshot ${snapshotId}`,
    scaleVersion: snapshot.profile.scale_version,
    updatedAt: now,
  };
  await db
    .insert(courseCaptureProfiles)
    .values({ courseCode: snapshot.courseCode, createdAt: now, ...fields })
    .onConflictDoUpdate({ target: courseCaptureProfiles.courseCode, set: fields });
  return true;
}

function rowToSnapshot(row: typeof courseCaptureSnapshots.$inferSelect): SnapshotRow {
  return {
    id: row.id,
    courseCode: row.courseCode,
    profile: row.profile,
    inputsMeta: row.inputsMeta,
    transcript: row.transcript,
    caption: row.caption,
    captionNote: row.captionNote,
    reviewerNote: row.reviewerNote,
    transcriptSessionId: row.transcriptSessionId ?? null,
    scaleVersion: row.scaleVersion,
    model: row.model,
    instructorName: row.instructorName ?? null,
    retiredAt: row.retiredAt,
    createdAt: row.createdAt,
  };
}
