import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ROOT: string;
let tools: typeof import('@/lib/ai/wiki/tools');

beforeAll(async () => {
  ROOT = mkdtempSync(join(tmpdir(), 'wikitools-research-'));
  process.env.WIKI_REPO_PATH = ROOT;
  mkdirSync(join(ROOT, 'courses'), { recursive: true });
  mkdirSync(join(ROOT, 'research'), { recursive: true });
  writeFileSync(join(ROOT, 'courses', 'gc-1010.md'), '---\ntype: course\ntitle: "GC 1010"\n---\n# GC 1010\n');
  writeFileSync(
    join(ROOT, 'research', 'ai-careers-brief.md'),
    '---\ntype: research\ntitle: "AI and GC careers brief"\n---\n# AI and GC careers brief\n\nEntry-level work is changing.\n',
  );
  tools = await import('@/lib/ai/wiki/tools');
});
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe('wiki tools serve research/', () => {
  it('list_wiki includes research pages, and filters by type research', async () => {
    const all = await tools.wikiListTool.execute({}) as { pages: Array<{ path: string; title: string }> };
    expect(all.pages.map(p => p.path)).toContain('research/ai-careers-brief.md');
    const only = await tools.wikiListTool.execute({ type: 'research' }) as { pages: Array<{ path: string; title: string }> };
    expect(only.pages).toEqual([{ path: 'research/ai-careers-brief.md', title: 'AI and GC careers brief' }]);
  });

  it('search_wiki finds research pages', async () => {
    const res = await tools.wikiSearchTool.execute({ query: 'entry-level work' }) as { hits: Array<{ path: string }> };
    expect(res.hits.map(h => h.path)).toContain('research/ai-careers-brief.md');
  });

  it('read_wiki reads a research page', async () => {
    const res = await tools.wikiReadTool.execute({ path: 'research/ai-careers-brief' }) as { path: string; content: string };
    expect(res.path).toBe('research/ai-careers-brief.md');
    expect(res.content).toContain('Entry-level work');
  });
});
