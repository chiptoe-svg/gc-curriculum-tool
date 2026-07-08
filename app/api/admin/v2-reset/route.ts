import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  captureMessages,
  courseMaterials,
  courseCaptureProfiles,
  courseCaptureSnapshots,
  snapshotTargetCoverage,
} from '@/lib/db/schema';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { getWeaviateClient } from '@/lib/capture/weaviate-client';
import {
  MATERIAL_CHUNK_CLASS,
  MATERIAL_SECTION_CLASS,
} from '@/lib/capture/weaviate-schema';
import { tenantForCourse } from '@/lib/capture/vector-store';

/**
 * POST /api/admin/v2-reset
 * Body: {
 *   courseCode: string,
 *   scope?: 'session' | 'materials' | 'everything',  // default 'session'
 *   includeSnapshots?: boolean,
 * }
 *
 * Three reset scopes — pick the gentlest one that solves your problem:
 *
 *   - scope='session' (DEFAULT, what the in-page "Reset audit" button calls).
 *     Drops the working draft (course_capture_profiles row). Preserves all
 *     prior capture_messages transcripts (the agent reads them as continuity
 *     context on the next session). Preserves Weaviate index + material
 *     columns. Cheap, no re-backfill needed. Use when an audit took a wrong
 *     turn and you want to start the conversation fresh while keeping the
 *     prior session's record.
 *
 *   - scope='materials'. Everything in 'session' PLUS resets material
 *     columns (indexing_status, digest, ferpa_risk, auto_set_aside) and
 *     drops the Weaviate tenant. Forces re-backfill. Use when ingestion
 *     produced bad chunks or digests.
 *
 *   - scope='everything'. Everything in 'materials' PLUS deletes all
 *     capture_messages for the course (loses prior session transcripts).
 *     Use for true clean-slate scenarios (e.g., resetting a course you're
 *     using as a test fixture).
 *
 * Optional flags (independent of scope):
 *   - includeSnapshots: ALSO drops course_capture_snapshots + dependent
 *     rows (snapshot_target_coverage). Snapshots are the system of record;
 *     dropping them is destructive.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH).
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    courseCode?: unknown;
    scope?: unknown;
    includeSnapshots?: unknown;
    slug?: unknown;
  };
  // Slug gate (second factor behind Basic Auth). This is a one-request,
  // irrecoverable data-loss endpoint (it can delete the snapshot system of
  // record), so it must not rely on middleware Basic Auth alone.
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }
  const scope: 'session' | 'materials' | 'everything' =
    body.scope === 'materials' ? 'materials'
      : body.scope === 'everything' ? 'everything'
      : 'session';
  const includeSnapshots = body.includeSnapshots === true;

  const result: Record<string, unknown> = { courseCode, scope };

  // 1. Delete capture_messages only at the deepest scope. The 'session'
  //    and 'materials' scopes preserve prior session transcripts so the
  //    agent has continuity context on the next session.
  if (scope === 'everything') {
    const captureMessagesDeleted = await db
      .delete(captureMessages)
      .where(eq(captureMessages.courseCode, courseCode))
      .returning({ id: captureMessages.id });
    result.captureMessagesDeleted = captureMessagesDeleted.length;
  } else {
    result.captureMessagesDeleted = 0;
    result.priorSessionsPreserved = true;
  }

  // 2. Delete the working draft profile.
  const profilesDeleted = await db
    .delete(courseCaptureProfiles)
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .returning({ courseCode: courseCaptureProfiles.courseCode });
  result.workingDraftDeleted = profilesDeleted.length;

  // 3. Optional: snapshots.
  if (includeSnapshots) {
    // snapshot_target_coverage has snapshotId FK; clear it first.
    const snapshotIds = await db
      .select({ id: courseCaptureSnapshots.id })
      .from(courseCaptureSnapshots)
      .where(eq(courseCaptureSnapshots.courseCode, courseCode));
    let coverageDeleted = 0;
    for (const { id } of snapshotIds) {
      const rows = await db
        .delete(snapshotTargetCoverage)
        .where(eq(snapshotTargetCoverage.snapshotId, id))
        .returning({ snapshotId: snapshotTargetCoverage.snapshotId });
      coverageDeleted += rows.length;
    }
    const snapshotsDeleted = await db
      .delete(courseCaptureSnapshots)
      .where(eq(courseCaptureSnapshots.courseCode, courseCode))
      .returning({ id: courseCaptureSnapshots.id });
    result.snapshotsDeleted = snapshotsDeleted.length;
    result.snapshotCoverageDeleted = coverageDeleted;
  }

  // 4. Reset material rows + drop Weaviate tenant only at 'materials' or
  //    'everything' scope. The 'session' scope leaves both intact so we don't
  //    have to re-backfill on every reset.
  if (scope === 'session') {
    result.materialsReset = 0;
    result.weaviate = 'preserved (scope=session)';
    return NextResponse.json(result);
  }

  const materialsReset = await db
    .update(courseMaterials)
    .set({
      indexingStatus: 'pending',
      indexedAt: null,
      digest: null,
      digestModel: null,
      digestGeneratedAt: null,
      useDigest: false,
      ferpaRisk: 'low',
      autoSetAside: false,
      setAsideReason: null,
    })
    .where(eq(courseMaterials.courseCode, courseCode))
    .returning({ id: courseMaterials.id });
  result.materialsReset = materialsReset.length;

  // 5. Drop the Weaviate tenant on both classes.
  const tenant = tenantForCourse(courseCode);
  const weaviateStatus: Record<string, string> = {};
  try {
    const client = await getWeaviateClient();
    for (const cls of [MATERIAL_CHUNK_CLASS, MATERIAL_SECTION_CLASS]) {
      try {
        const col = client.collections.use(cls);
        await col.tenants.remove(tenant);
        weaviateStatus[cls] = `tenant ${tenant} removed`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('not found') || msg.includes('does not exist')) {
          weaviateStatus[cls] = `tenant ${tenant} did not exist`;
        } else {
          weaviateStatus[cls] = `failed: ${msg}`;
        }
      }
    }
  } catch (e) {
    weaviateStatus.error = e instanceof Error ? e.message : String(e);
  }
  result.weaviate = weaviateStatus;

  return NextResponse.json(result);
}
