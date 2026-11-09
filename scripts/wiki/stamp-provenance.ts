/**
 * Backfill provenance onto existing wiki pages (lib/wiki/provenance.ts):
 * per-claim [Source: raw/snapshots/…] on competency, target and concept pages,
 * a `sources:` list, and a quoted `date:` on every page. No AI, no database.
 *
 *   tsx scripts/wiki/stamp-provenance.ts --out <dir>   copy the wiki to <dir> and stamp the copy (default use)
 *   tsx scripts/wiki/stamp-provenance.ts --in-place    stamp the wiki working tree (no commit, no push)
 *
 * The wiki repo is WIKI_REPO_PATH (default /Users/admin/projects/gc-curriculum-wiki).
 * Committing and pushing the wiki is a separate, owner-approved step.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildProvenanceContext, stampProvenance } from '@/lib/wiki/provenance';

const SECTIONS = ['courses', 'competencies', 'targets', 'concepts'];

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
  const files = ['index.md', ...SECTIONS.flatMap(s => {
    const dir = path.join(root, s);
    return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${s}/${f}`) : [];
  })];
  const pages = files.map(rel => ({ path: rel, content: readFileSync(path.join(root, rel), 'utf8') }));
  const ctx = buildProvenanceContext(pages);
  let changed = 0, cited = 0;
  for (const p of pages) {
    const next = stampProvenance(p.content, ctx);
    cited += (next.match(/\[Source: /g) ?? []).length - (p.content.match(/\[Source: /g) ?? []).length;
    if (next !== p.content) { writeFileSync(path.join(root, p.path), next); changed++; }
  }
  console.log(`${changed} of ${pages.length} pages changed; ${cited} source tags added; written under ${root}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
