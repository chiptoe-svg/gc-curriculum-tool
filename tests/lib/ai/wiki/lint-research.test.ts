import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
const OKF = (type: string, slug: string) =>
  `---\ntype: ${type}\ntitle: "${slug}"\ndescription: "d"\nslug: ${slug}\ntags: [${type}]\ntimestamp: 2026-10-14T00:00:00Z\nresource: https://example.test/wiki/x/${slug}\n---\n`;

async function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wikilint-research-'));
  await write('targets/brand-strategy.md', `${OKF('target', 'brand-strategy')}# Brand\n## Sub-competencies\n- [[ai-careers-brief]]\n## Program-level rollup\nx\n`);
  // research hub: links a target via the escaped-pipe table form, a sibling, and a ghost
  await write('research/ai-careers-brief.md',
    `${OKF('research', 'ai-careers-brief')}# Brief\n\n| Target | Page |\n|---|---|\n| Brand | [[brand-strategy\\|Brand strategy]] |\n\nSee [[career-paths]] and [[ghost-page\\|Ghost]].\n`);
  await write('research/career-paths.md', `${OKF('research', 'career-paths')}# Career paths\n[[ai-careers-brief]]\n`);
  // research page missing OKF keys
  await write('research/bare.md', `---\ntype: research\ntitle: "Bare"\n---\n# Bare\n[[ai-careers-brief]]\n`);
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('lintWiki — research/', () => {
  it('validates escaped-pipe links from research pages (ghost is broken, brand-strategy is not)', async () => {
    const issues = await lintWiki(root);
    const broken = issues.filter(i => i.kind === 'broken-wikilink').map(i => `${i.page} ${i.detail}`);
    expect(broken).toEqual(['research/ai-careers-brief.md [[ghost-page]] → no wiki page has slug "ghost-page"']);
  });

  it('resolves links INTO research from other sections', async () => {
    const issues = await lintWiki(root);
    expect(issues.some(i => i.page === 'targets/brand-strategy.md' && i.kind === 'broken-wikilink')).toBe(false);
  });

  it('applies OKF frontmatter checks to research pages, and no generated-page section rules', async () => {
    const issues = await lintWiki(root);
    expect(issues.find(i => i.page === 'research/bare.md' && i.kind === 'okf-frontmatter-missing')).toBeTruthy();
    expect(issues.some(i => i.page.startsWith('research/') && i.kind === 'missing-section')).toBe(false);
  });
});
