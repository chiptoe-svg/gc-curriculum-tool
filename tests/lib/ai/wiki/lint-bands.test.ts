import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wikilint-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await mkdir(join(root, 'concepts'), { recursive: true });
  // course page WITH prose markers but NO structured field → should warn
  await writeFile(join(root, 'courses', 'gc-x.md'),
    '---\ntype: course\nslug: gc-x\n---\n\n# GC X\n\n## Competencies developed\n- Color ·materials\n\n## Source snapshots\n[[gc-x]]');
  // course page WITH markers AND the structured field → clean
  await writeFile(join(root, 'courses', 'gc-y.md'),
    '---\ntype: course\nslug: gc-y\nevidence_bands: [materials_supported]\n---\n\n# GC Y\n\n## Competencies developed\n- Color ·materials\n\n## Source snapshots\n[[gc-y]]');
  // concept page (not course/competency) with a stray marker → no band warning
  await writeFile(join(root, 'concepts', 'pf.md'),
    '---\ntype: concept\nslug: pf\n---\n\n# PF\n\n## The idea\nstuff ·claimed [[gc-y]]');
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('lint evidence-bands-missing', () => {
  it('warns a course page that has band markers but no evidence_bands field', async () => {
    const issues = await lintWiki(root);
    const band = issues.filter(i => i.kind === 'evidence-bands-missing');
    expect(band.map(i => i.page)).toContain('courses/gc-x.md');
    expect(band.map(i => i.page)).not.toContain('courses/gc-y.md');
    expect(band.map(i => i.page)).not.toContain('concepts/pf.md');
  });
});
