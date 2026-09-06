import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * search_wiki term matching + read_wiki path forgiveness.
 *
 * 2026-09-06 (gc-wiki MCP consumer report): search_wiki was an exact
 * SUBSTRING match of the whole query — "GC 3700 major projects assignments"
 * had to appear verbatim in a page, so any query with extra words returned
 * 0 hits and the calling agent concluded the wiki had nothing for the course.
 * It must instead match by terms, ranking pages that match more terms first.
 * read_wiki rejected "courses/gc-3700" (no .md) with a not-found error.
 */

let ROOT: string;
let wikiSearchTool: any;
let wikiReadTool: any;

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikitools-terms-'));
  process.env.WIKI_REPO_PATH = ROOT;
  mkdirSync(join(ROOT, 'courses'), { recursive: true });
  writeFileSync(
    join(ROOT, 'courses', 'gc-3700.md'),
    '---\ntype: course\n---\n\n# GC 3700 — Brand Communications\n\n## Major projects\n\nBrand playbook, purpose campaign.\n',
  );
  writeFileSync(
    join(ROOT, 'courses', 'gc-9999.md'),
    '---\ntype: course\n---\n\n# GC 9999 — Unrelated\n\nNothing shared with the query here.\n',
  );
  const mod = await import('@/lib/ai/wiki/tools');
  wikiSearchTool = mod.wikiSearchTool;
  wikiReadTool = mod.wikiReadTool;
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('search_wiki multi-term queries', () => {
  it('returns the course page when the query carries extra words (the reported failure)', async () => {
    const res = await wikiSearchTool.execute({ query: 'GC 3700 major projects assignments' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).toContain('courses/gc-3700.md');
  });

  it('matches on topic terms that never appear as one contiguous phrase', async () => {
    const res = await wikiSearchTool.execute({ query: 'brand communications projects' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).toContain('courses/gc-3700.md');
  });

  it('still excludes pages sharing no terms with the query', async () => {
    const res = await wikiSearchTool.execute({ query: 'brand communications projects' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).not.toContain('courses/gc-9999.md');
  });

  it('exact single-term behavior unchanged', async () => {
    const res = await wikiSearchTool.execute({ query: 'playbook' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).toEqual(['courses/gc-3700.md']);
  });
});

describe('read_wiki path forgiveness', () => {
  it('accepts a path without the .md extension', async () => {
    const res = await wikiReadTool.execute({ path: 'courses/gc-3700' }) as { content?: string; error?: string };
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('Brand Communications');
  });
});
