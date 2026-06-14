import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-idx-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await writeFile(join(root, 'courses', 'gc-1010.md'),
    `---\ntype: course\nslug: gc-1010\ntitle: "Orientation"\ndescription: "Intro."\ntimestamp: 2026-06-04T00:00:00.000Z\n---\n\n# x\n`);
  await writeFile(join(root, 'courses', 'gc-3460.md'),
    `---\ntype: course\nslug: gc-3460\ntitle: "Typography"\ndescription: "Type."\ntimestamp: 2026-06-12T00:00:00.000Z\n---\n\n# y\n`);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('rebuildSectionIndexes', () => {
  it('writes courses/index.md listing members with the max member timestamp', async () => {
    await rebuildSectionIndexes(root);
    const idx = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    expect(idx).toMatch(/^type: index$/m);
    expect(idx).toMatch(/^timestamp: 2026-06-12T00:00:00.000Z$/m);
    expect(idx).toContain('[[gc-1010]]');
    expect(idx).toContain('[[gc-3460]]');
  });

  it('is idempotent (second run produces identical bytes)', async () => {
    await rebuildSectionIndexes(root);
    const first = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    await rebuildSectionIndexes(root);
    const second = await readFile(join(root, 'courses', 'index.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('skips a section dir with no member pages', async () => {
    await rebuildSectionIndexes(root);
    await expect(readFile(join(root, 'targets', 'index.md'), 'utf8')).rejects.toThrow();
  });
});
