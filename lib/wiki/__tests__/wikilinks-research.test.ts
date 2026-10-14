import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let resolveWikilinks: typeof import('@/lib/wiki/markdown-helpers').resolveWikilinks;

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikilinks-research-'));
  process.env.WIKI_REPO_PATH = ROOT; // markdown-helpers reads this at module load
  mkdirSync(join(ROOT, 'research'), { recursive: true });
  mkdirSync(join(ROOT, 'targets'), { recursive: true });
  writeFileSync(join(ROOT, 'research', 'career-paths.md'), '---\ntype: research\n---\n');
  writeFileSync(join(ROOT, 'targets', 'brand-strategy.md'), '---\ntype: target\n---\n');
  ({ resolveWikilinks } = await import('@/lib/wiki/markdown-helpers'));
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('resolveWikilinks — research + escaped pipe', () => {
  it('resolves a research slug to /wiki/research/<slug>', () => {
    expect(resolveWikilinks('see [[career-paths]]', '')).toBe('see [career-paths](/wiki/research/career-paths)');
  });

  it('resolves the escaped-pipe table form [[slug\\|Label]]', () => {
    const md = '| Target | Page |\n|---|---|\n| Brand | [[brand-strategy\\|Brand strategy]] |';
    const out = resolveWikilinks(md, '');
    expect(out).toContain('[Brand strategy](/wiki/targets/brand-strategy)');
    expect(out).not.toContain('`');
  });

  it('still resolves the plain pipe form', () => {
    expect(resolveWikilinks('[[brand-strategy|Brand]]', '')).toBe('[Brand](/wiki/targets/brand-strategy)');
  });

  it('never resolves a nested slug', () => {
    expect(resolveWikilinks('[[research/career-paths]]', '')).toBe('`research/career-paths`');
  });
});
