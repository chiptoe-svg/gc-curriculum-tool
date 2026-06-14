import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintWiki } from '@/lib/ai/wiki/lint';

let root: string;
const okfCourse = (slug: string) =>
  `---\ntype: course\ntitle: "T"\ndescription: "d"\nslug: ${slug}\ntags: [course]\ntimestamp: 2026-06-14T00:00:00.000Z\nresource: http://x/wiki/courses/${slug}\n---\n\n## Competencies developed\n\n[[${slug === 'gc-1010' ? 'gc-3460' : 'gc-1010'}]]\n\n## Source snapshots\n`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-lint-'));
  await mkdir(join(root, 'courses'), { recursive: true });
  await writeFile(join(root, 'courses', 'gc-1010.md'), okfCourse('gc-1010'));
  await writeFile(join(root, 'courses', 'gc-3460.md'), okfCourse('gc-3460'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('lint — okf-frontmatter-missing', () => {
  it('is clean when every OKF key is present', async () => {
    const issues = await lintWiki(root);
    expect(issues.filter(i => i.kind === 'okf-frontmatter-missing')).toEqual([]);
  });

  it('fires an error listing the missing keys', async () => {
    await writeFile(join(root, 'courses', 'gc-1010.md'),
      `---\ntype: course\ntitle: "T"\nslug: gc-1010\ntimestamp: x\nresource: y\n---\n\n## Competencies developed\n\n[[gc-3460]]\n\n## Source snapshots\n`);
    const issues = await lintWiki(root);
    const okf = issues.find(i => i.kind === 'okf-frontmatter-missing' && i.page.endsWith('gc-1010.md'));
    expect(okf?.severity).toBe('error');
    expect(okf?.detail).toContain('description');
    expect(okf?.detail).toContain('tags');
  });

  it('treats a section index.md as type:index — no orphan / no course missing-section, but OKF-checked', async () => {
    await writeFile(join(root, 'courses', 'index.md'),
      `---\ntype: index\ntitle: "Courses"\ndescription: "d"\nslug: courses\ntags: [index, courses]\ntimestamp: t\nresource: http://x/wiki/courses\n---\n\n# Courses\n\n- [[gc-1010]]\n- [[gc-3460]]\n`);
    const issues = await lintWiki(root);
    const idxIssues = issues.filter(i => i.page.endsWith('courses/index.md'));
    expect(idxIssues.filter(i => i.kind === 'orphan')).toEqual([]);
    expect(idxIssues.filter(i => i.kind === 'missing-section')).toEqual([]);
    expect(idxIssues.filter(i => i.kind === 'okf-frontmatter-missing')).toEqual([]);
  });
});
