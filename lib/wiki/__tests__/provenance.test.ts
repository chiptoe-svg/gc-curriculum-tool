import { describe, expect, it } from 'vitest';
import {
  buildProvenanceContext,
  stampDate,
  stampProvenance,
  stripSourceTags,
} from '../provenance';

const course = (slug: string, snap: string) => ({
  path: `courses/${slug}.md`,
  content: `---\ntype: course\ntitle: "X"\nlast_snapshot_path: ${snap}\ntimestamp: 2026-06-16T19:41:03.773Z\n---\n\n# X\n`,
});
const competency = `---
type: competency
title: "Aesthetic Judgment"
timestamp: 2026-10-22T19:36:05.668Z
slug: aesthetic-judgment
---

# Aesthetic Judgment

## Across the program

- [[gc-3400|Digital Imaging]] — K1/U1/D2 ·claimed — Students critique photographs.
- [[gc-1020|Intro]] — K2/U2/D3 ·materials — Students research logos.
- [[gc-9999|Unknown]] — K1/U0/D1 ·claimed — No snapshot known.
`;

const ctx = buildProvenanceContext([
  course('gc-3400', 'raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json'),
  course('gc-1020', 'raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json'),
  { path: 'competencies/aesthetic-judgment.md', content: competency },
]);

describe('stampProvenance', () => {
  it('cites the snapshot of the course each competency bullet names', () => {
    const out = stampProvenance(competency, ctx);
    expect(out).toContain('Students critique photographs. [Source: raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json]');
    expect(out).toContain('Students research logos. [Source: raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json]');
    expect(out).toMatch(/No snapshot known\.\n/);
  });

  it('lists every cited file in a sources frontmatter list, vault-relative', () => {
    const out = stampProvenance(competency, ctx);
    expect(out).toContain('sources: [raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json, raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json]');
    expect(out).not.toMatch(/\/Users\//);
  });

  it('is idempotent', () => {
    const once = stampProvenance(competency, ctx);
    expect(stampProvenance(once, ctx)).toBe(once);
  });

  it('cites, on a target page, the courses that reach the stated depth for that competency', () => {
    const target = `---\ntype: target\ntitle: "T"\ntimestamp: 2026-10-22T19:38:00.777Z\n---\n\n- [[aesthetic-judgment|Aesthetic judgment]] (provisional) — well-developed (D3) — Specialists review creative work.\n- [[problem-solving|Problem solving]] (provisional) — not yet scored — Analysts solve problems.\n`;
    const out = stampProvenance(target, ctx);
    expect(out).toContain('Specialists review creative work. [Source: raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json]');
    expect(out).toContain('Analysts solve problems.\n');
  });

  it('cites course snapshots for course links on a concept page', () => {
    const concept = `---\ntype: concept\ntitle: "C"\ntimestamp: 2026-10-29T17:22:11.716Z\n---\n\n- **Consolidation.** [[gc-3400]] structures post-mortems; [[resilience]] grows.\n`;
    const out = stampProvenance(concept, ctx);
    expect(out).toContain('grows. [Source: raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json]');
  });

  it('leaves course pages alone apart from the date', () => {
    const c = course('gc-3400', 'raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json').content;
    expect(stampProvenance(c, ctx)).toBe(stampDate(c));
  });
});

describe('stampDate', () => {
  it('adds a quoted date from the timestamp', () => {
    expect(stampDate(competency)).toContain('date: "2026-10-22"');
  });
  it('replaces an existing date', () => {
    const once = stampDate(competency);
    expect(stampDate(once).match(/^date:/gm)).toHaveLength(1);
  });
});

describe('stripSourceTags', () => {
  it('removes source tags for readers', () => {
    expect(stripSourceTags('Students do X. [Source: raw/snapshots/a/b.json]\nNext')).toBe('Students do X.\nNext');
  });
});

describe('synthesis and catalog labels', () => {
  const page = `---\ntype: competency\ntitle: "A"\ntimestamp: 2026-10-22T19:36:05.668Z\n---\n\n# A\n\n## Definition\n\nA moves evaluation beyond preference.\n\n## Across the program\n\n- [[gc-3400|Digital Imaging]] — K1/U1/D2 ·claimed — Critique.\n- [[gc-1020|Intro]] — K2/U2/D3 ·materials — Logos.\n\nBest recorded coverage is developing (D2) at two courses.\n\nThe reshoot in [[gc-3400]] and the logos in [[gc-1020]] are complementary.\n`;

  it('labels a definition as catalog text with no snapshot source', () => {
    const out = stampProvenance(page, ctx);
    expect(out).toContain('A moves evaluation beyond preference. [Catalog: competency descriptor]');
  });

  it('labels program-wide prose as synthesis and cites every course on the page', () => {
    const out = stampProvenance(page, ctx);
    expect(out).toContain('at two courses. [Synthesis] [Source: raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json] [Source: raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json]');
  });

  it('labels a line naming two courses as synthesis and cites both', () => {
    const out = stampProvenance(page, ctx);
    expect(out).toContain('are complementary. [Synthesis] [Source: raw/snapshots/gc-3400/2026-06-01_aaaaaaa.json] [Source: raw/snapshots/gc-1020/2026-06-02_bbbbbbb.json]');
  });

  it('labels course-sheet wording in a course page syllabus section as catalog text', () => {
    const c = `---\ntype: course\ntitle: "X"\ntimestamp: 2026-06-16T19:41:03.773Z\n---\n\n## Syllabus\n\nThe course sheet describes ink manufacturing.\n\n**Learning objectives:**\n\n- Demonstrate understanding of manufacturing.\n\n**Links:** [Syllabus PDF](https://x)\n\n## Source snapshots\n\n- [2026-06-16](raw/snapshots/x.json)\n`;
    const out = stampProvenance(c, ctx);
    expect(out).toContain('The course sheet describes ink manufacturing. [Catalog: course sheet]');
    expect(out).toContain('- Demonstrate understanding of manufacturing. [Catalog: course sheet]');
    expect(out).toContain('**Links:** [Syllabus PDF](https://x)\n');
    expect(out).toContain('- [2026-06-16](raw/snapshots/x.json)\n');
  });

  it('labels what a career target does as career-target text', () => {
    const t = `---\ntype: target\ntitle: "T"\ntimestamp: 2026-10-22T19:38:00.777Z\n---\n\n## What this person does\n\nBrand strategists position brands.\n`;
    expect(stampProvenance(t, ctx)).toContain('position brands. [Catalog: career target]');
  });

  it('stays idempotent with labels', () => {
    const once = stampProvenance(page, ctx);
    expect(stampProvenance(once, ctx)).toBe(once);
  });

  it('strips every label for readers', () => {
    expect(stripSourceTags('X. [Synthesis] [Source: a.json] [Catalog: course sheet]')).toBe('X.');
  });
});

