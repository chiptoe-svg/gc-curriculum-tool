/**
 * read_wiki's raw/ guard (adversarial round 1, P1): the old literal
 * `startsWith('raw/')` test was bypassed by `..`, `./` and case variants.
 * Every bypass must be refused, and the snapshot content never returned.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let tools: typeof import('@/lib/ai/wiki/tools');
const SECRET = '{"secret":1}';

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikitools-raw-'));
  process.env.WIKI_REPO_PATH = join(ROOT, 'wiki');
  mkdirSync(join(ROOT, 'wiki', 'courses'), { recursive: true });
  mkdirSync(join(ROOT, 'wiki', 'research'), { recursive: true });
  mkdirSync(join(ROOT, 'wiki', 'raw'), { recursive: true });
  writeFileSync(join(ROOT, 'wiki', 'raw', 'snap.json'), SECRET);
  writeFileSync(join(ROOT, 'wiki', 'courses', 'gc-1010.md'), '---\ntype: course\ntitle: "GC 1010"\n---\n# GC 1010\n');
  writeFileSync(join(ROOT, 'outside.md'), 'outside the repo\n');
  tools = await import('@/lib/ai/wiki/tools');
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

const read = (p: string) => tools.wikiReadTool.execute({ path: p }) as Promise<{ content?: string; error?: string; path?: string }>;

describe('read_wiki refuses raw/ however it is spelled', () => {
  it.each([
    'raw/snap.json',
    '/raw/snap.json',
    'research/../raw/snap.json',
    'courses/../raw/snap.json',
    './raw/snap.json',
    './/raw/snap.json',
    'RAW/snap.json',
    'Raw/snap.json',
    'courses\\..\\raw\\snap.json',
  ])('%s', async (p) => {
    const res = await read(p);
    expect(res.content).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});

describe('read_wiki keeps the repo traversal guard', () => {
  it.each(['../outside.md', 'courses/../../outside.md', '<abs>'])('%s', async (p) => {
    const res = await read(p === '<abs>' ? join(ROOT, 'outside.md') : p);
    expect(res.content).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  it('readWikiPage itself still refuses traversal and absolute paths (defense in depth)', async () => {
    const { readWikiPage } = await import('@/lib/wiki/git-ops');
    expect(await readWikiPage('../outside.md')).toBeNull();
    expect(await readWikiPage('courses/../../outside.md')).toBeNull();
    expect(await readWikiPage(join(ROOT, 'outside.md'))).toBeNull();
    expect(await readWikiPage('courses/gc-1010.md')).toContain('# GC 1010');
  });

  it('still reads a normal page, and ./courses/x normalizes to courses/x', async () => {
    expect((await read('courses/gc-1010')).content).toContain('# GC 1010');
    const r = await read('./courses/gc-1010.md');
    expect(r.path).toBe('courses/gc-1010.md');
    expect(r.content).toContain('# GC 1010');
  });
});
