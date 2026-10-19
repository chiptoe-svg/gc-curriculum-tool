/**
 * Regenerate wiki page competencies/problem-solving.md (program-level evidence
 * profile; spec 2026-10-19 §2.6). Pure DB read + template, no model calls.
 *
 * Usage (DATABASE_URL must already be in the environment, e.g. via
 * `tsx --env-file=.env.local` for the live app, or the scratch URL):
 *   tsx scripts/wiki/write-problem-solving-page.ts --expect-db <name>           (dry run, prints markdown)
 *   tsx scripts/wiki/write-problem-solving-page.ts --expect-db <name> --apply   (commit + push to the wiki)
 *
 * This script never loads .env.local itself.
 */
import { assertExpectedDb, isMainModule } from '@/scripts/catalog/catalog-source';
import { loadProblemSolvingInputs } from '@/lib/db/problem-solving-queries';
import { writeProblemSolvingPage, renderProblemSolvingPage, buildProblemSolvingProfile } from '@/lib/program/problem-solving-profile';

export function parseArgs(argv: string[]): { expectDb: string; apply: boolean } {
  let expectDb = '';
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') apply = true;
    else if (a === '--expect-db') expectDb = argv[++i] ?? '';
    else if (a.startsWith('--expect-db=')) expectDb = a.slice('--expect-db='.length);
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!expectDb) throw new Error('--expect-db <database name> is required');
  return { expectDb, apply };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  await assertExpectedDb(args.expectDb);
  const inputs = await loadProblemSolvingInputs();
  if (!args.apply) {
    console.log(renderProblemSolvingPage(buildProblemSolvingProfile(inputs.courses, inputs.depths), new Date()));
    console.log('Dry run: nothing written. Pass --apply to commit and push.');
    return 0;
  }
  const { writeAndPush } = await import('@/lib/wiki/git-ops');
  const { sha } = await writeProblemSolvingPage(inputs, writeAndPush);
  console.log(`Committed ${sha}`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2)).then(c => process.exit(c), e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
