import { describe, it, expect } from 'vitest';
import { backfillOkf, deriveDescription, deriveTitle, backfillRootIndex } from '@/scripts/wiki-backfill-okf';
import { readFrontmatterScalar } from '@/lib/ai/wiki/okf-frontmatter';

const LEGACY = `---
type: competency
slug: aesthetic-judgment
name: "Aesthetic Judgment"
career_target: brand-strategist
updated_at: 2026-06-02T21:52:05.837Z
input_hash: b8586
---

# Aesthetic Judgment

The capacity to discriminate quality in visual work. It develops across studio courses.
`;

describe('deriveDescription', () => {
  it('takes the first non-heading sentence of the body', () => {
    expect(deriveDescription(LEGACY)).toBe('The capacity to discriminate quality in visual work.');
  });

  it('strips wikilink markup from the derived description', () => {
    const withLinks = `---\ntype: competency\n---\n\n# X\n\n[[aesthetic-judgment|Aesthetic judgment]] is the ability to evaluate [[quality-control]] work.`;
    expect(deriveDescription(withLinks)).toBe('Aesthetic judgment is the ability to evaluate quality-control work.');
  });
});

describe('backfillOkf', () => {
  it('migrates a legacy page to full OKF frontmatter', () => {
    const out = backfillOkf(LEGACY, 'aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'title')).toBe('Aesthetic Judgment');
    expect(out).not.toMatch(/^name:/m);
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(out).not.toMatch(/^updated_at:/m);
    expect(readFrontmatterScalar(out, 'tags')).toBe('[competency, brand-strategist]');
    expect(readFrontmatterScalar(out, 'resource')).toContain('/wiki/competencies/aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'description')).toBe('The capacity to discriminate quality in visual work.');
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('b8586');
  });

  it('is idempotent', () => {
    const once = backfillOkf(LEGACY, 'aesthetic-judgment');
    const twice = backfillOkf(once, 'aesthetic-judgment');
    expect(twice).toBe(once);
  });

  it('falls back to title when the body has no prose sentence (never empty)', () => {
    const allStructure = `---\ntype: target\nname: "Brand Strategy"\nupdated_at: 2026-06-02T00:00:00.000Z\n---\n\n# Brand Strategy\n\n## Sub-competencies\n\n- [[brand-strategy]]\n`;
    const out = backfillOkf(allStructure, 'brand-strategy');
    expect(readFrontmatterScalar(out, 'description')).toBe('Brand Strategy');
  });
});

const ROOT_INDEX = `---
type: index
updated_at: 2026-06-02T21:52:05.837Z
total_snapshots: 7
total_courses_with_snapshots: 5
input_hash: bf940566b9d3
---

# GC Curriculum Knowledge Base

This wiki is the curriculum-facing layer for captured GC course evidence. Start with course pages.

## Courses
`;

describe('deriveTitle', () => {
  it('takes the first heading of the body', () => {
    expect(deriveTitle(ROOT_INDEX)).toBe('GC Curriculum Knowledge Base');
  });
  it('falls back when there is no heading', () => {
    expect(deriveTitle('---\ntype: index\n---\n\nno heading here')).toBe('GC Curriculum Knowledge Base');
  });
});

describe('backfillRootIndex', () => {
  it('migrates the root index to full OKF frontmatter, preserving stats', () => {
    const out = backfillRootIndex(ROOT_INDEX);
    expect(readFrontmatterScalar(out, 'type')).toBe('index');
    expect(readFrontmatterScalar(out, 'title')).toBe('GC Curriculum Knowledge Base');
    expect(readFrontmatterScalar(out, 'description')).toBe('This wiki is the curriculum-facing layer for captured GC course evidence.');
    expect(readFrontmatterScalar(out, 'slug')).toBe('index');
    expect(readFrontmatterScalar(out, 'tags')).toBe('[index]');
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(readFrontmatterScalar(out, 'resource')).toContain('/wiki');
    expect(readFrontmatterScalar(out, 'resource')).not.toContain('/wiki/index');
    expect(readFrontmatterScalar(out, 'total_snapshots')).toBe('7');
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('bf940566b9d3');
    expect(out).not.toMatch(/^updated_at:/m);
  });
  it('is idempotent', () => {
    const once = backfillRootIndex(ROOT_INDEX);
    expect(backfillRootIndex(once)).toBe(once);
  });
});
