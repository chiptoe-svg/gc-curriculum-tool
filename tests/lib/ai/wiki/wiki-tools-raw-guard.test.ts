/**
 * read_wiki's raw/ guard (adversarial round 1, P1): the old literal
 * `startsWith('raw/')` test was bypassed by `..`, `./` and case variants.
 * Every bypass must be refused, and the snapshot content never returned.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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

  // Slash-prefixed variants must hit the raw/ refusal itself, not merely fail
  // later as "page not found" (round 1b: leading slashes are stripped again).
  it.each(['/raw/snap.json', '/RAW/snap.json', '//raw/snap.json', '/./raw/snap.json'])('%s → raw/ refusal', async (p) => {
    const res = await read(p);
    expect(res.content).toBeUndefined();
    expect(res.error).toMatch(/cannot read raw\//);
  });
  it('/research/../raw/snap.json → refused', async () => {
    const res = await read('/research/../raw/snap.json');
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

  it('a leading slash is stripped: /courses/x.md is served as courses/x.md (backward compatible)', async () => {
    const r = await read('/courses/gc-1010.md');
    expect(r.path).toBe('courses/gc-1010.md');
    expect(r.content).toContain('# GC 1010');
  });

  it('still reads a normal page, and ./courses/x normalizes to courses/x', async () => {
    expect((await read('courses/gc-1010')).content).toContain('# GC 1010');
    const r = await read('./courses/gc-1010.md');
    expect(r.path).toBe('courses/gc-1010.md');
    expect(r.content).toContain('# GC 1010');
  });
});

// Adversarial round 2, P2: a symlink inside the wiki must not lead read_wiki
// (or any readWikiPage caller) into raw/ or outside the repo.
describe('readWikiPage follows no symlink into raw/ or out of the repo', () => {
  beforeAll(() => {
    symlinkSync('../raw/snap.json', join(ROOT, 'wiki', 'courses', 'link.json'));
    symlinkSync('../raw/snap.json', join(ROOT, 'wiki', 'courses', 'link.md'));
    symlinkSync('raw', join(ROOT, 'wiki', 'rawlink'));
    symlinkSync('../raw', join(ROOT, 'wiki', 'research', 'r'));
    symlinkSync('../../outside.md', join(ROOT, 'wiki', 'courses', 'out.md'));
    symlinkSync('gc-1010.md', join(ROOT, 'wiki', 'courses', 'alias.md'));
  });

  it.each(['courses/link.json', 'courses/link.md', 'courses/link', 'rawlink/snap.json', 'research/r/snap.json', 'research/r/snap', 'courses/out.md'])('%s → refused', async (p) => {
    const res = await read(p);
    expect(res.content).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  it('readWikiPage returns null for those targets and for raw/ itself; allowRaw opts in', async () => {
    const { readWikiPage } = await import('@/lib/wiki/git-ops');
    expect(await readWikiPage('courses/link.json')).toBeNull();
    expect(await readWikiPage('courses/out.md')).toBeNull();
    expect(await readWikiPage('raw/snap.json')).toBeNull();
    expect(await readWikiPage('raw/snap.json', { allowRaw: true })).toBe(SECRET);
    expect(await readWikiPage('courses/out.md', { allowRaw: true })).toBeNull();
  });

  it('a symlink that stays inside the served sections is still served', async () => {
    const res = await read('courses/alias.md');
    expect(res.content).toContain('# GC 1010');
  });
});

describe('read_wiki with a trailing slash (round 2, N2)', () => {
  it.each(['courses/gc-1010.md/', 'courses/gc-1010/'])('%s → an error result, not a thrown ENOTDIR', async (p) => {
    const res = await read(p);
    expect(res.content).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});
