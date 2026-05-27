import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  captureMessages,
  courseMaterials,
  courseCaptureProfiles,
  courseCaptureSnapshots,
  courseExploreAnalyses,
  courseExploreTargets,
  courseExploreWhatIfs,
  snapshotTargetCoverage,
} from '@/lib/db/schema';
import { getWeaviateClient } from '@/lib/capture/weaviate-client';
import {
  MATERIAL_CHUNK_CLASS,
  MATERIAL_SECTION_CLASS,
} from '@/lib/capture/weaviate-schema';
import { tenantForCourse } from '@/lib/capture/vector-store';

/**
 * POST /api/admin/v2-reset
 * Body: { courseCode: string, includeSnapshots?: boolean, includeExplore?: boolean }
 *
 * Drops the v2 audit state for one course so you can start from scratch:
 *   - capture_messages rows (the v2 transcript)
 *   - course_capture_profiles row (the working draft)
 *   - Weaviate tenant for the course (MaterialChunk + MaterialSection)
 *   - course_materials columns reset: indexing_status='pending', indexed_at=null,
 *     digest=null, digest_model=null, digest_generated_at=null,
 *     ferpa_risk='low', auto_set_aside=false, set_aside_reason=null,
 *     use_digest=false. The material rows themselves stay (extracted_text
 *     preserved) so re-running the backfill is cheap.
 *
 * Optional flags:
 *   - includeSnapshots: ALSO drops course_capture_snapshots + any
 *     dependent rows (snapshot_target_coverage, explore_analyses). Snapshots
 *     are the system of record per the spec — only use this for true reset
 *     scenarios (e.g., resetting a course you're using as a test fixture).
 *   - includeExplore: drops explore analyses, targets, what-ifs for the
 *     course. Implied by includeSnapshots.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH).
 *
 * Returns the counts of what was deleted, plus the Weaviate tenant status.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    courseCode?: unknown;
    includeSnapshots?: unknown;
    includeExplore?: unknown;
  };
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }
  const includeSnapshots = body.includeSnapshots === true;
  const includeExplore = body.includeExplore === true || includeSnapshots;

  const result: Record<string, unknown> = { courseCode };

  // 1. Delete capture_messages.
  const captureMessagesDeleted = await db
    .delete(captureMessages)
    .where(eq(captureMessages.courseCode, courseCode))
    .returning({ id: captureMessages.id });
  result.captureMessagesDeleted = captureMessagesDeleted.length;

  // 2. Delete the working draft profile.
  const profilesDeleted = await db
    .delete(courseCaptureProfiles)
    .where(eq(courseCaptureProfiles.courseCode, courseCode))
    .returning({ courseCode: courseCaptureProfiles.courseCode });
  result.workingDraftDeleted = profilesDeleted.length;

  // 3. Optional: explore + snapshots.
  if (includeExplore) {
    const exploreAnalyses = await db
      .delete(courseExploreAnalyses)
      .where(eq(courseExploreAnalyses.courseCode, courseCode))
      .returning({ id: courseExploreAnalyses.id });
    const exploreTargets = await db
      .delete(courseExploreTargets)
      .where(eq(courseExploreTargets.courseCode, courseCode))
      .returning({ id: courseExploreTargets.id });
    const exploreWhatIfs = await db
      .delete(courseExploreWhatIfs)
      .where(eq(courseExploreWhatIfs.courseCode, courseCode))
      .returning({ id: courseExploreWhatIfs.id });
    result.exploreAnalysesDeleted = exploreAnalyses.length;
    result.exploreTargetsDeleted = exploreTargets.length;
    result.exploreWhatIfsDeleted = exploreWhatIfs.length;
  }

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

  // 4. Reset material rows: clear v2 columns, keep extracted_text + blob.
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
