/**
 * One-time backfill of objective assessment guides (spec 2026-10-05).
 *
 * For every course with a live (unretired) capture snapshot, reports whether it
 * has a usable syllabus and usable Canvas assignments, and — unless --dry-run —
 * builds the guide from the latest snapshot. A course whose syllabus is set
 * aside is never sent to the AI (lib/objective-guide/inputs.ts).
 *
 * Usage (run from the deploy checkout after merge + migration 0051):
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts --course "GC 4440"
 */
import { isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots } from '@/lib/db/schema';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { pickSyllabus, usableAssignmentsText } from '@/lib/objective-guide/inputs';
import { runObjectiveGuideForSnapshot } from '@/lib/objective-guide/run';

function parseArgs(argv: string[]): { dryRun: boolean; courses: string[] } {
  const courses: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--course' && argv[i + 1]) courses.push(argv[++i]!);
  }
  return { dryRun: argv.includes('--dry-run'), courses };
}

async function main(): Promise<void> {
  const { dryRun, courses } = parseArgs(process.argv.slice(2));
  const rows = await db
    .selectDistinct({ courseCode: courseCaptureSnapshots.courseCode })
    .from(courseCaptureSnapshots)
    .where(isNull(courseCaptureSnapshots.retiredAt));
  const codes = rows
    .map((r) => r.courseCode)
    .filter((c) => courses.length === 0 || courses.includes(c))
    .sort();

  console.log(`${dryRun ? '[dry-run] ' : ''}${codes.length} captured course(s)\n`);
  let built = 0;
  let totalCost = 0;
  const allDropped: string[] = [];

  for (const code of codes) {
    try {
      const snap = await getLatestSnapshotByCourse(code);
      if (!snap) {
        console.log(`${code}: skip — no live snapshot`);
        continue;
      }
      const materials = await listMaterialsByCourse(code);
      const syllabus = pickSyllabus(materials);
      const hasAssignments = usableAssignmentsText(materials) !== null;
      const syllabusState = syllabus.status === 'ok'
        ? `syllabus ok (${syllabus.syllabi.map((s) => s.fileName).join(', ')})`
        : syllabus.status;
      const ready = syllabus.status === 'ok' && hasAssignments;

      if (dryRun || !ready) {
        console.log(`${code}: ${syllabusState}; assignments ${hasAssignments ? 'ok' : 'missing'} — ${ready ? 'would build' : 'skip'}`);
        continue;
      }

      const r = await runObjectiveGuideForSnapshot(snap.id);
      if (r.status === 'written') {
        built++;
        totalCost += r.costUsdCents;
        allDropped.push(...r.droppedNames.map((d) => `${code} — ${d}`));
        console.log(`${code}: built — ${r.objectives} objective(s), ${r.droppedNames.length} dropped, $${(r.costUsdCents / 10_000).toFixed(3)}`);
      } else {
        console.log(`${code}: skipped — ${r.reason}`);
      }
    } catch (err) {
      console.error(`${code}: FAILED —`, err instanceof Error ? err.message : err);
    }
  }

  if (!dryRun) {
    console.log(`\nBuilt ${built} guide(s); total $${(totalCost / 10_000).toFixed(2)}.`);
    console.log(allDropped.length === 0 ? 'No names dropped.' : `Dropped names:\n${allDropped.map((d) => `  ${d}`).join('\n')}`);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
