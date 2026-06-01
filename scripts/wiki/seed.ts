/**
 * One-off wiki seeder.
 *
 * Iterates over every non-retired snapshot in the DB, calls
 * updateWikiForSnapshot() for each one, then commits + pushes via
 * writeAndPush(). Idempotent — re-running regenerates wiki pages from the
 * current snapshot state; the raw layer is deterministic from profile JSON.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/wiki/seed.ts
 */

import { isNull, asc } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { courseCaptureSnapshots } from '@/lib/db/schema';
import { updateWikiForSnapshot, courseCodeToSlug } from '@/lib/ai/wiki/update';
import { writeAndPush } from '@/lib/wiki/git-ops';

// ---------------------------------------------------------------------------
// List all non-retired snapshots across all courses.
// ---------------------------------------------------------------------------

interface SnapshotStub {
  id: string;
  courseCode: string;
  caption: string | null;
  createdAt: Date;
}

async function listAllActiveSnapshots(): Promise<SnapshotStub[]> {
  const rows = await db
    .select({
      id: courseCaptureSnapshots.id,
      courseCode: courseCaptureSnapshots.courseCode,
      caption: courseCaptureSnapshots.caption,
      createdAt: courseCaptureSnapshots.createdAt,
    })
    .from(courseCaptureSnapshots)
    .where(isNull(courseCaptureSnapshots.retiredAt))
    .orderBy(asc(courseCaptureSnapshots.createdAt));
  return rows as SnapshotStub[];
}

// ---------------------------------------------------------------------------
// Commit message builder
// ---------------------------------------------------------------------------

function buildCommitMessage(snapshot: SnapshotStub): string {
  const courseSlug = courseCodeToSlug(snapshot.courseCode);
  const dateStr = snapshot.createdAt instanceof Date
    ? snapshot.createdAt.toISOString().slice(0, 10)
    : String(snapshot.createdAt).slice(0, 10);
  const caption = snapshot.caption?.trim() || 'untitled';
  return `feat(${courseSlug}): seed snapshot ${dateStr} — ${caption}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Wiki seed — loading all non-retired snapshots...');

  const snapshots = await listAllActiveSnapshots();

  if (snapshots.length === 0) {
    console.log('No non-retired snapshots found. Nothing to seed.');
    process.exit(0);
  }

  console.log(`Found ${snapshots.length} snapshot(s). Starting seed run.\n`);

  let successCount = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]!;
    const label = `[${i + 1}/${snapshots.length}] snapshot ${snapshot.id} for ${snapshot.courseCode}`;
    process.stdout.write(`${label}\n`);

    try {
      // (a) Call AI orchestrator — builds raw writes + regenerates wiki pages.
      const result = await updateWikiForSnapshot(snapshot.id);

      // (b) Merge raw + wiki arrays for the commit.
      const allPages = [...result.raw, ...result.wiki];

      // (c) Commit + push to the wiki repo.
      const commitMessage = buildCommitMessage(snapshot);
      const { sha } = await writeAndPush({
        pages: allPages,
        logEntry: result.logEntry,
        commitMessage,
      });

      console.log(`  → committed ${sha}`);
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠ failed: ${message}`);
    }
  }

  console.log(`\nSeed complete: ${successCount}/${snapshots.length} succeeded.`);
  process.exit(successCount === snapshots.length ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
