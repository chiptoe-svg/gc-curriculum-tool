/**
 * Deterministic (re)builder of the per-section index.md hub pages from the
 * full on-disk page set. Pure-builder lives in okf-frontmatter.ts; this is the
 * thin fs wrapper. Called by the wiki disk-writer (git-ops) on every regen and
 * by the one-time backfill. Excludes the top-level index.md (out of scope).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WIKI_PAGE_TYPES } from './schema';
import { buildSectionIndex, readFrontmatterScalar, type IndexEntry } from './okf-frontmatter';

export async function rebuildSectionIndexes(root: string): Promise<void> {
  for (const type of WIKI_PAGE_TYPES) {
    const dir = path.join(root, type);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter(f => f.endsWith('.md') && f !== 'index.md');
    } catch {
      continue; // section dir absent — nothing to index
    }
    if (files.length === 0) continue;

    const entries: IndexEntry[] = [];
    let maxTs = '';
    for (const f of files) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      const slug = f.replace(/\.md$/, '');
      const title = readFrontmatterScalar(text, 'title') ?? slug;
      const description = readFrontmatterScalar(text, 'description') ?? '';
      const ts = readFrontmatterScalar(text, 'timestamp') ?? '';
      if (ts > maxTs) maxTs = ts; // ISO strings sort lexicographically
      entries.push({ slug, title, description });
    }
    await fs.writeFile(path.join(dir, 'index.md'), buildSectionIndex(type, entries, maxTs));
  }
}
