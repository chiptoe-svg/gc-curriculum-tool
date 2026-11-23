/**
 * Backfill course pages' `contributes_to_targets` and `target_skill_shares`
 * from the skill tree (lib/ai/wiki/course-targets.ts,
 * lib/db/course-target-shares-queries.ts). No AI; reads the database only
 * (needs the app's DATABASE_URL).
 *
 *   tsx scripts/wiki/stamp-course-targets.ts --out <dir>   copy the wiki to <dir> and stamp the copy
 *   tsx scripts/wiki/stamp-course-targets.ts --in-place    stamp the wiki working tree (no commit, no push)
 *
 * The wiki repo is WIKI_REPO_PATH (default /Users/admin/projects/gc-curriculum-wiki).
 * Committing and pushing the wiki is a separate, owner-approved step.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { backfillCourseTargetShares } from '@/lib/ai/wiki/course-targets';
import { loadPairedSlugMap } from '@/lib/ai/wiki/paired-links';
import { loadAllCourseTargetShares } from '@/lib/db/course-target-shares-queries';

async function main(argv: string[]): Promise<number> {
  const repo = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
  const outIdx = argv.indexOf('--out');
  const inPlace = argv.includes('--in-place');
  if ((outIdx < 0) === !inPlace) { console.error('usage: --out <dir> | --in-place'); return 2; }
  let root = repo;
  if (outIdx >= 0) {
    root = path.resolve(argv[outIdx + 1] ?? '');
    if (!argv[outIdx + 1] || existsSync(root)) { console.error(`--out needs a new directory (${root} exists or is missing)`); return 2; }
    cpSync(repo, root, { recursive: true, filter: src => !src.split(path.sep).includes('.git') });
  }
  const shares = await loadAllCourseTargetShares(await loadPairedSlugMap());
  if (!shares) { console.error('could not read the skill tree shares; nothing written'); return 1; }
  const files = ['courses'].flatMap(s => {
    const dir = path.join(root, s);
    return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${s}/${f}`) : [];
  });
  const changed = backfillCourseTargetShares(files.map(rel => ({ path: rel, content: readFileSync(path.join(root, rel), 'utf8') })), shares);
  for (const p of changed) writeFileSync(path.join(root, p.path), p.content);
  console.log(`${changed.length} course pages changed; written under ${root}`);
  return 0;
}

main(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(err); process.exit(1); });
