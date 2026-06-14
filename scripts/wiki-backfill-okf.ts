/**
 * One-shot, pure (no AI / no DB) backfill: migrate every existing wiki
 * course/competency/target/concept page to OKF v0.1 frontmatter (name→title,
 * updated_at→timestamp, + tags/resource/slug via stampOkfFrontmatter, +
 * description derived from the body when absent), then (re)build the four
 * per-section index.md hubs. Idempotent — a re-run produces no diff. After this
 * runs once, update.ts/git-ops stamp the fields on every subsequent regen.
 *
 * Run: pnpm wiki:backfill-okf   (operator commits + pushes the wiki repo after)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wikiRepoPath } from '@/lib/wiki/git-ops';
import { WIKI_PAGE_TYPES } from '@/lib/ai/wiki/schema';
import { stampOkfFrontmatter, setFrontmatterLine, readFrontmatterScalar } from '@/lib/ai/wiki/okf-frontmatter';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

/** First non-heading/non-list sentence of the body (after frontmatter). */
export function deriveDescription(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t || t.startsWith('#') || t.startsWith('-') || t.startsWith('|') || t.startsWith('>')) continue;
    const sentence = t.split(/(?<=[.!?])\s/)[0]!.replace(/\s+/g, ' ').trim();
    if (sentence) {
      // Strip wikilink markup ([[slug|label]] → label, [[slug]] → slug) so the
      // OKF description reads as plain prose for external consumers; collapse "→ '".
      return sentence
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/"/g, "'")
        .trim();
    }
  }
  return '';
}

/** First `# ` heading of the body (wikilink-stripped); fallback for the root index. */
export function deriveTitle(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const m = body.match(/^#\s+(.+)$/m);
  if (!m) return 'GC Curriculum Knowledge Base';
  return m[1]!
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/"/g, "'")
    .trim();
}

/** Pure: migrate the root index.md to OKF (stamp + derive title/description if absent). */
export function backfillRootIndex(content: string): string {
  let out = stampOkfFrontmatter(content, { slug: 'index' }); // no timestamp opt → preserve updated_at
  if (readFrontmatterScalar(out, 'title') === null) {
    out = setFrontmatterLine(out, 'title', `"${deriveTitle(content)}"`);
  }
  if (readFrontmatterScalar(out, 'description') === null) {
    const desc = deriveDescription(content) || readFrontmatterScalar(out, 'title') || 'index';
    out = setFrontmatterLine(out, 'description', `"${desc}"`);
  }
  return out;
}

/** Pure: migrate one page's content to OKF (stamp + derive description if absent). */
export function backfillOkf(content: string, slug: string): string {
  let out = stampOkfFrontmatter(content, { slug }); // no timestamp opt → preserve updated_at value
  if (readFrontmatterScalar(out, 'description') === null) {
    // Fall back to title → slug so an all-structure body (no prose sentence)
    // never yields an empty description that would silently pass the lint.
    const desc = deriveDescription(content) || readFrontmatterScalar(out, 'title') || slug;
    out = setFrontmatterLine(out, 'description', `"${desc}"`);
  }
  return out;
}

async function main(): Promise<void> {
  const root = wikiRepoPath();
  let scanned = 0, migrated = 0;
  for (const dir of WIKI_PAGE_TYPES) {
    let files: string[] = [];
    try { files = (await readdir(join(root, dir))).filter(f => f.endsWith('.md') && f !== 'index.md'); }
    catch { continue; }
    for (const f of files) {
      const path = join(root, dir, f);
      const before = await readFile(path, 'utf8');
      scanned++;
      const after = backfillOkf(before, f.replace(/\.md$/, ''));
      if (after !== before) { await writeFile(path, after); migrated++; console.log(`  migrated ${dir}/${f}`); }
    }
  }
  // Root index.md (the LLM dashboard) — migrate it too.
  const rootIndexPath = join(root, 'index.md');
  try {
    const before = await readFile(rootIndexPath, 'utf8');
    scanned++;
    const after = backfillRootIndex(before);
    if (after !== before) { await writeFile(rootIndexPath, after); migrated++; console.log('  migrated index.md'); }
  } catch { /* no root index — skip */ }

  await rebuildSectionIndexes(root);
  console.log(`wiki:backfill-okf — scanned ${scanned}, migrated ${migrated}, rebuilt section indexes`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('wiki-backfill-okf.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
