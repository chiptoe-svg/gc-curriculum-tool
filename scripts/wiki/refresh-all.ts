/**
 * One-pass wiki refresh — use this instead of seed.ts after a program-wide
 * re-score.
 *
 * seed.ts calls updateWikiForSnapshot() once per non-retired snapshot, and each
 * call regenerates every program-wide page that snapshot's coverage touches
 * (competencies, targets, concepts, index), so those pages are regenerated once
 * per snapshot: O(captures × pages). This script regenerates:
 *   - each course page ONCE, from that course's latest non-retired snapshot
 *     (one LLM call per course; also rewrites that snapshot's raw layer);
 *   - each competency / target / concept page and the index ONCE, from the
 *     program-wide substrate, in WIKI_PAGES_PER_CALL batches (index last).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/wiki/refresh-all.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/wiki/refresh-all.ts
 *   ... --only courses | --only program
 *   ... --course "GC 4800"          (that course page only)
 *
 * --dry-run reads Postgres only: it prints the pages and batches it would
 * generate and the call estimate (vs the old per-snapshot path), with no model
 * calls and no wiki writes.
 *
 * Writes: one writeAndPush per course and per program batch, awaited in turn.
 * writeAndPush serializes writers only WITHIN a process, so do not run this
 * concurrently with seed.ts or another refresh, and prefer a quiet window: a
 * capture or coverage re-score in the app process also writes the wiki clone.
 */

import {
  generateProgramWikiBatch,
  updateWikiForSnapshot,
} from '@/lib/ai/wiki/update';
import {
  latestSnapshotPerCourse,
  loadProgramCourseSummaries,
  loadRefreshInputs,
  oldPathCallCount,
  parseRefreshArgs,
  planRefresh,
  runRefresh,
} from '@/lib/ai/wiki/refresh-all';
import { writeAndPush } from '@/lib/wiki/git-ops';

async function main() {
  const args = parseRefreshArgs(process.argv.slice(2));
  const inputs = await loadRefreshInputs();
  const plan = planRefresh(inputs, args);

  const oldCalls = oldPathCallCount(inputs.oldPathPagesPerSnapshot);
  console.log(
    `Old per-snapshot path (seed.ts): ${inputs.snapshots.length} snapshot(s), ` +
    `${inputs.oldPathPagesPerSnapshot.reduce((a, b) => a + b, 0)} page generations, ~${oldCalls} LLM calls.`,
  );

  // Course summaries feed the index and concept pages; built from ALL courses
  // (not just this run's selection) so the index stays complete.
  const allLatest = latestSnapshotPerCourse(inputs.snapshots).map(s => ({
    courseCode: s.courseCode, snapshotId: s.id, createdAt: s.createdAt,
  }));
  const programCourses = plan.programPages.length > 0
    ? await loadProgramCourseSummaries(allLatest, inputs.latestProfiles)
    : [];

  const result = await runRefresh(plan, {
    generateCourse: async snapshotId => {
      const r = await updateWikiForSnapshot(snapshotId, { pageTypes: ['course'] });
      return { pages: [...r.raw, ...r.wiki], logEntry: r.logEntry };
    },
    generateProgramBatch: async (batch, manifest) => {
      const r = await generateProgramWikiBatch(batch, { manifest, programCourses });
      return { pages: r.wiki, logEntry: r.logEntry };
    },
    write: writeAndPush,
    log: line => console.log(line),
  }, { dryRun: args.dryRun });

  console.log(`One-pass estimate: ${result.estimatedCalls} LLM calls vs ~${oldCalls} on the old path.`);
  if (!args.dryRun) {
    console.log(`\nRefresh complete: ${result.succeeded}/${result.succeeded + result.failed} unit(s) succeeded.`);
  }
  process.exit(result.failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
