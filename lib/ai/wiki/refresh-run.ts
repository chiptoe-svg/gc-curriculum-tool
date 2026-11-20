/**
 * Run a one-pass wiki refresh with the production generators and writer. Shared by
 * scripts/wiki/refresh-all.ts and the /program button's post-scoring rebuild
 * (lib/program/refresh-after-scoring.ts), so both write pages the same way.
 *
 * writeAndPush serializes writers only within one process: do not run the script while the app
 * is rebuilding after a button press.
 */
import { and, eq } from 'drizzle-orm';
import { generateProgramWikiBatch, updateWikiForSnapshot } from '@/lib/ai/wiki/update';
import {
  latestSnapshotPerCourse,
  loadProgramCourseSummaries,
  loadRefreshInputs,
  runRefresh,
  type RefreshInputs,
  type RefreshPlan,
  type RefreshResult,
} from '@/lib/ai/wiki/refresh-all';
import { readWikiPage, writeAndPush } from '@/lib/wiki/git-ops';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { loadProblemSolvingInputs } from '@/lib/db/problem-solving-queries';
import { buildProblemSolvingCommit } from '@/lib/program/problem-solving-profile';

export type LoadedRefreshInputs = Awaited<ReturnType<typeof loadRefreshInputs>>;

export async function runWikiRefresh(
  makePlan: (inputs: RefreshInputs) => RefreshPlan,
  opts: { dryRun: boolean; log?: (line: string) => void },
): Promise<{ inputs: LoadedRefreshInputs; plan: RefreshPlan; result: RefreshResult }> {
  const log = opts.log ?? (line => console.log(line));
  const inputs = await loadRefreshInputs();
  const plan = makePlan(inputs);

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
      const r = await generateProgramWikiBatch(batch, {
        manifest,
        programCourses,
        totals: { totalSnapshots: inputs.snapshots.length, totalCoursesWithSnapshots: allLatest.length },
      });
      return { pages: r.wiki, logEntry: r.logEntry };
    },
    write: writeAndPush,
    problemSolvingCommit: async () => {
      const has = await db.select({ id: subCompetencies.id }).from(subCompetencies)
        .where(and(eq(subCompetencies.id, 'problem-solving'), eq(subCompetencies.retired, false)));
      if (has.length === 0) return null;
      return buildProblemSolvingCommit(await loadProblemSolvingInputs());
    },
    readPage: path => readWikiPage(path),
    log,
  }, { dryRun: opts.dryRun });

  return { inputs, plan, result };
}
