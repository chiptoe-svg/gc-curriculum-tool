import { describe, it, expect } from 'vitest';
import { backfillOkf, deriveDescription } from '@/scripts/wiki-backfill-okf';
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
