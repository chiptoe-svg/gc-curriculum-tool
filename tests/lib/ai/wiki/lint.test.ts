import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintWiki, summarizeLint, type LintIssue } from '@/lib/ai/wiki/lint';

let root: string;

async function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wikilint-'));
  // course → links a real competency + a broken one; has required sections
  await write(
    'courses/gc-100.md',
    `---\ntype: course\n---\n# GC 100\n## Competencies developed\n- [[good-comp|Good]] — K3/U2/D2\n- [[missing-comp|Ghost]] — K1/U0/D0\n## Source snapshots\n- x\n`,
  );
  // competency → links back to the course (so gc-100 isn't an orphan); has required section
  await write(
    'competencies/good-comp.md',
    `---\ntype: competency\n---\n# Good Comp\n## Across the program\n- [[gc-100|GC 100]] — K3/U2/D2\n`,
  );
  // concept promoted from only ONE course → ungated; nobody links it → orphan
  await write(
    'concepts/weak-concept.md',
    `---\ntype: concept\nrelated_courses: [gc-100]\n---\n# Weak Concept\n## The idea\nsomething\n`,
  );
  // target missing a required section ("Program-level rollup"); nobody links it → orphan
  await write(
    'targets/lonely.md',
    `---\ntype: target\n---\n# Lonely\n## Sub-competencies\n- a\n`,
  );
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function kinds(issues: LintIssue[], page: string) {
  return issues.filter(i => i.page === page).map(i => i.kind).sort();
}

describe('lintWiki', () => {
  it('flags a broken wikilink', async () => {
    const issues = await lintWiki(root);
    const broken = issues.filter(i => i.kind === 'broken-wikilink');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.page).toBe('courses/gc-100.md');
    expect(broken[0]!.detail).toContain('missing-comp');
  });

  it('does NOT flag a wikilink that resolves', async () => {
    const issues = await lintWiki(root);
    expect(issues.some(i => i.kind === 'broken-wikilink' && i.detail.includes('good-comp'))).toBe(false);
  });

  it('flags orphans (nothing links to the page), excluding linked pages', async () => {
    const issues = await lintWiki(root);
    const orphans = issues.filter(i => i.kind === 'orphan').map(i => i.page).sort();
    expect(orphans).toEqual(['concepts/weak-concept.md', 'targets/lonely.md']);
    // gc-100 (linked by good-comp) and good-comp (linked by gc-100) are NOT orphans
    expect(orphans).not.toContain('courses/gc-100.md');
    expect(orphans).not.toContain('competencies/good-comp.md');
  });

  it('flags a missing required section', async () => {
    const issues = await lintWiki(root);
    const missing = issues.filter(i => i.kind === 'missing-section');
    expect(missing.some(i => i.page === 'targets/lonely.md' && i.detail.includes('Program-level rollup'))).toBe(true);
  });

  it('flags a concept promoted from < 2 source courses', async () => {
    const issues = await lintWiki(root);
    const ungated = issues.filter(i => i.kind === 'ungated-concept');
    expect(ungated).toHaveLength(1);
    expect(ungated[0]!.page).toBe('concepts/weak-concept.md');
    expect(ungated[0]!.severity).toBe('error');
  });

  it('summarizes counts', async () => {
    const issues = await lintWiki(root);
    const s = summarizeLint(issues);
    expect(s).toMatch(/error/);
    expect(summarizeLint([])).toBe('wiki-lint: clean ✓');
  });

  it('gc-100 has its required sections (no missing-section for it)', async () => {
    const issues = await lintWiki(root);
    expect(kinds(issues, 'courses/gc-100.md')).not.toContain('missing-section');
  });
});
