import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWikiIndex } from '@/lib/wiki/index-data';

let root: string;
const page = (title: string, order?: number) =>
  `---\ntype: research\ntitle: "${title}"\ndescription: "${title} d"\n${order === undefined ? '' : `order: ${order}\n`}---\n# ${title}\n`;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wiki-index-research-'));
  await mkdir(path.join(root, 'research'));
  await writeFile(path.join(root, 'research', 'what-is-changing.md'), page('What is changing', 2));
  await writeFile(path.join(root, 'research', 'ai-careers-brief.md'), page('AI and GC careers brief', 1));
  await writeFile(path.join(root, 'research', 'documents.md'), page('Documents'));
  await writeFile(path.join(root, 'research', 'index.md'), '---\ntype: index\ntitle: "Research"\n---\n');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('loadWikiIndex — research', () => {
  it('lists research pages by order, unordered last, skipping index pages', async () => {
    const d = await loadWikiIndex(root);
    expect(d.research.map(r => r.slug)).toEqual(['ai-careers-brief', 'what-is-changing', 'documents']);
    expect(d.research[0]).toEqual({ slug: 'ai-careers-brief', title: 'AI and GC careers brief', description: 'AI and GC careers brief d' });
  });

  it('returns an empty list when there is no research/ dir', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'wiki-index-empty-'));
    try { expect((await loadWikiIndex(empty)).research).toEqual([]); }
    finally { await rm(empty, { recursive: true, force: true }); }
  });
});
