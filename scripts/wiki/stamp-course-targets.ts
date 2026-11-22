/**
 * Backfill course pages' `contributes_to_targets` from the wiki's own target
 * pages (lib/ai/wiki/course-targets.ts). No AI, no database.
 *
 *   tsx scripts/wiki/stamp-course-targets.ts --out <dir>   copy the wiki to <dir> and stamp the copy
 *   tsx scripts/wiki/stamp-course-targets.ts --in-place    stamp the wiki working tree (no commit, no push)
 *
 * The wiki repo is WIKI_REPO_PATH (default /Users/admin/projects/gc-curriculum-wiki).
 * Committing and pushing the wiki is a separate, owner-approved step.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { backfillCourseTargets } from '@/lib/ai/wiki/course-targets';

function main(argv: string[]): number {
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
  const files = ['targets', 'courses'].flatMap(s => {
    const dir = path.join(root, s);
    return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${s}/${f}`) : [];
  });
  const changed = backfillCourseTargets(files.map(rel => ({ path: rel, content: readFileSync(path.join(root, rel), 'utf8') })));
  for (const p of changed) writeFileSync(path.join(root, p.path), p.content);
  console.log(`${changed.length} course pages changed; written under ${root}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
