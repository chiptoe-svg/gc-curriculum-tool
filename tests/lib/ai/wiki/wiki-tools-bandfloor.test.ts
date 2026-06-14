import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let wikiSearchTool: any;

beforeAll(async () => {
  // Set the wiki repo root to a temp fixture BEFORE the tool module loads,
  // so git-ops' module-const WIKI_REPO_PATH (read once at import) picks it up.
  ROOT = mkdtempSync(join(tmpdir(), 'wikitools-'));
  process.env.WIKI_REPO_PATH = ROOT;
  mkdirSync(join(ROOT, 'courses'), { recursive: true });
  writeFileSync(join(ROOT, 'courses', 'gc-low.md'),    '---\ntype: course\nevidence_bands: [claimed]\n---\n\nspot color here');
  writeFileSync(join(ROOT, 'courses', 'gc-high.md'),   '---\ntype: course\nevidence_bands: [artifact_verified]\n---\n\nspot color here');
  writeFileSync(join(ROOT, 'courses', 'gc-legacy.md'), '---\ntype: course\ninput_hash: z\n---\n\nspot color here, no markers');
  const mod = await import('@/lib/ai/wiki/tools');
  wikiSearchTool = mod.wikiSearchTool;
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('search_wiki bandFloor reads structured frontmatter', () => {
  it('drops a page whose frontmatter bands are all below the floor', async () => {
    const res = await wikiSearchTool.execute({ query: 'spot color', bandFloor: 'artifact_verified' }) as { hits: Array<{ path: string }> };
    const paths = res.hits.map((h: { path: string }) => h.path);
    expect(paths).toContain('courses/gc-high.md');     // artifact_verified ≥ floor
    expect(paths).toContain('courses/gc-legacy.md');   // no field + no markers → passes (legacy)
    expect(paths).not.toContain('courses/gc-low.md');  // claimed < artifact_verified → dropped
  });
});
