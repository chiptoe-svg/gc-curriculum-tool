import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

let root: string;
const BRIEF = '---\ntype: research\ntitle: "Brief"\ntimestamp: 2026-10-14T00:00:00Z\n---\n# Brief\n';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-gen-skip-'));
  await fs.mkdir(path.join(root, 'courses'), { recursive: true });
  await fs.mkdir(path.join(root, 'research'), { recursive: true });
  await fs.writeFile(path.join(root, 'courses', 'gc-1010.md'), '---\ntype: course\ntitle: "GC 1010"\ntimestamp: 2026-10-01T00:00:00Z\n---\n# GC 1010\n');
  await fs.writeFile(path.join(root, 'research', 'ai-careers-brief.md'), BRIEF);
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('generators never write research/', () => {
  it('rebuildSectionIndexes writes generated section hubs only', async () => {
    await rebuildSectionIndexes(root);
    expect(await fs.readdir(path.join(root, 'courses'))).toContain('index.md');
    expect((await fs.readdir(path.join(root, 'research'))).sort()).toEqual(['ai-careers-brief.md']);
    expect(await fs.readFile(path.join(root, 'research', 'ai-careers-brief.md'), 'utf8')).toBe(BRIEF);
  });
});
