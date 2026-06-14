import { describe, it, expect } from 'vitest';
import { buildSectionIndex } from '@/lib/ai/wiki/okf-frontmatter';

describe('buildSectionIndex', () => {
  const entries = [
    { slug: 'gc-3460', title: 'Typography', description: 'Type systems.' },
    { slug: 'gc-1010', title: 'Orientation', description: 'First-year intro.' },
  ];

  it('emits OKF index frontmatter with slug=type and resource', () => {
    const md = buildSectionIndex('courses', entries, '2026-06-14T00:00:00.000Z', 'http://x');
    expect(md).toMatch(/^type: index$/m);
    expect(md).toMatch(/^title: "Courses"$/m);
    expect(md).toMatch(/^description: "Index of course pages in the GC curriculum wiki."$/m);
    expect(md).toMatch(/^slug: courses$/m);
    expect(md).toMatch(/^tags: \[index, courses\]$/m);
    expect(md).toMatch(/^timestamp: 2026-06-14T00:00:00.000Z$/m);
    expect(md).toMatch(/^resource: http:\/\/x\/wiki\/courses$/m);
  });

  it('courses sort by slug; lists each as a wikilink with description', () => {
    const md = buildSectionIndex('courses', entries, 'ts', 'http://x');
    const body = md.split('\n---\n')[1]!;
    expect(body.indexOf('[[gc-1010]]')).toBeLessThan(body.indexOf('[[gc-3460]]'));
    expect(md).toContain('- [[gc-1010]] — First-year intro.');
  });

  it('non-course sections sort by title', () => {
    const md = buildSectionIndex('competencies', [
      { slug: 'b', title: 'Beta', description: '' },
      { slug: 'a', title: 'Alpha', description: '' },
    ], 'ts', 'http://x');
    const body = md.split('\n---\n')[1]!;
    expect(body.indexOf('[[a]]')).toBeLessThan(body.indexOf('[[b]]'));
  });
});
