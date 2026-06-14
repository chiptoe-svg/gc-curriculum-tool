/**
 * One-shot, pure (no AI / no DB) backfill: stamp the structured
 * `evidence_bands:` frontmatter onto every existing wiki course/competency
 * page, derived from the prose markers already on the page. Idempotent — a
 * page that already carries the field is left untouched. After this runs once,
 * `update.ts` stamps the field on every subsequent regen.
 *
 * Run: pnpm wiki:backfill-bands   (operator commits the wiki repo afterward)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wikiRepoPath } from '@/lib/wiki/git-ops';
import { detectBands, readEvidenceBandsFrontmatter, stampEvidenceBands } from '@/lib/ai/wiki/evidence-band-markers';

/** Pure transform: stamp evidence_bands from prose markers unless already present. */
export function backfillContent(content: string): string {
  if (readEvidenceBandsFrontmatter(content) !== null) return content; // idempotent
  return stampEvidenceBands(content, detectBands(content));
}

async function main(): Promise<void> {
  const root = wikiRepoPath();
  let changed = 0;
  let scanned = 0;
  for (const dir of ['courses', 'competencies']) {
    let files: string[] = [];
    try { files = (await readdir(join(root, dir))).filter(f => f.endsWith('.md') && f !== 'index.md'); }
    catch { continue; }
    for (const f of files) {
      const path = join(root, dir, f);
      const before = await readFile(path, 'utf8');
      scanned++;
      const after = backfillContent(before);
      if (after !== before) { await writeFile(path, after); changed++; console.log(`  stamped ${dir}/${f}`); }
    }
  }
  console.log(`wiki:backfill-bands — scanned ${scanned}, stamped ${changed}`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('wiki-backfill-bands.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
