import { describe, it, expect } from 'vitest';
import {
  stampOkfFrontmatter, deriveTags, okfResource, readFrontmatterScalar, setFrontmatterLine,
} from '@/lib/ai/wiki/okf-frontmatter';

const COURSE = `---
type: course
slug: gc-1010
title: "Orientation to Graphic Communications"
level: 1
prerequisites: []
updated_at: 2026-06-04T20:17:27.167Z
contributes_to_targets: [account-management]
develops_competencies: [vendor-management]
input_hash: 4f6771ad1944
evidence_bands: [claimed]
---

# GC 1010

A first-year orientation course.
`;

const COMPETENCY = `---
type: competency
slug: aesthetic-judgment
name: "Aesthetic Judgment"
career_target: brand-strategist
contributing_courses: [gc-4440]
updated_at: 2026-06-02T21:52:05.837Z
input_hash: b85864426669
---

# Aesthetic Judgment
`;

describe('deriveTags', () => {
  it('course → type + level + contributes_to_targets', () => {
    expect(deriveTags('course', COURSE)).toEqual(['course', 'level-1', 'account-management']);
  });
  it('competency → type + career_target when set', () => {
    expect(deriveTags('competency', COMPETENCY)).toEqual(['competency', 'brand-strategist']);
  });
  it('target/concept → type only', () => {
    expect(deriveTags('target', '---\ntype: target\n---')).toEqual(['target']);
    expect(deriveTags('concept', '---\ntype: concept\n---')).toEqual(['concept']);
  });
});

describe('okfResource', () => {
  it('maps singular type → plural dir with base', () => {
    expect(okfResource('competency', 'aesthetic-judgment', 'http://x')).toBe('http://x/wiki/competencies/aesthetic-judgment');
  });
  it('defaults base to the LAN origin', () => {
    expect(okfResource('course', 'gc-1010')).toBe('http://gcworkflow.clemson.edu:3000/wiki/courses/gc-1010');
  });
  it('maps the root index type to the wiki home (not /wiki/index/index)', () => {
    expect(okfResource('index', 'index', 'http://x')).toBe('http://x/wiki');
  });
});

describe('stampOkfFrontmatter', () => {
  it('renames name→title, updated_at→timestamp; adds tags + resource; keeps domain keys', () => {
    const out = stampOkfFrontmatter(COMPETENCY, { slug: 'aesthetic-judgment', base: 'http://x' });
    expect(readFrontmatterScalar(out, 'title')).toBe('Aesthetic Judgment');
    expect(out).not.toMatch(/^name:/m);
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-02T21:52:05.837Z');
    expect(out).not.toMatch(/^updated_at:/m);
    expect(readFrontmatterScalar(out, 'tags')).toBe('[competency, brand-strategist]');
    expect(readFrontmatterScalar(out, 'resource')).toBe('http://x/wiki/competencies/aesthetic-judgment');
    expect(readFrontmatterScalar(out, 'career_target')).toBe('brand-strategist');
    expect(readFrontmatterScalar(out, 'input_hash')).toBe('b85864426669');
    expect(out).toContain('# Aesthetic Judgment');
  });

  it('uses an explicit timestamp opt when given (overrides updated_at)', () => {
    const out = stampOkfFrontmatter(COURSE, { slug: 'gc-1010', timestamp: '2026-06-14T00:00:00.000Z' });
    expect(readFrontmatterScalar(out, 'timestamp')).toBe('2026-06-14T00:00:00.000Z');
  });

  it('is idempotent (no timestamp opt → preserves prior value)', () => {
    const once = stampOkfFrontmatter(COURSE, { slug: 'gc-1010', base: 'http://x' });
    const twice = stampOkfFrontmatter(once, { slug: 'gc-1010', base: 'http://x' });
    expect(twice).toBe(once);
  });

  it('does not touch description (author/backfill owned)', () => {
    const withDesc = COURSE.replace('title: "Orientation to Graphic Communications"', 'title: "Orientation to Graphic Communications"\ndescription: "hand-written"');
    const out = stampOkfFrontmatter(withDesc, { slug: 'gc-1010' });
    expect(readFrontmatterScalar(out, 'description')).toBe('hand-written');
  });
});

describe('setFrontmatterLine', () => {
  it('appends a key when absent and replaces when present', () => {
    const added = setFrontmatterLine(COMPETENCY, 'description', '"d"');
    expect(readFrontmatterScalar(added, 'description')).toBe('d');
    const replaced = setFrontmatterLine(added, 'description', '"e"');
    expect(readFrontmatterScalar(replaced, 'description')).toBe('e');
  });
});
