import { describe, it, expect } from 'vitest';
import { stampCourseTargets, courseTargetMap } from '@/lib/ai/wiki/course-targets';

const PAGE = `---
type: course
slug: gc-1010
title: "Intro"
contributes_to_targets: []
develops_competencies: [agency]
---

# GC 1010 — Intro
`;

describe('stampCourseTargets', () => {
  it('replaces the model-written list with the given targets', () => {
    const out = stampCourseTargets(PAGE, ['account-management', 'brand-strategy']);
    expect(out).toContain('contributes_to_targets: [account-management, brand-strategy]\n');
    expect(out).not.toContain('contributes_to_targets: []');
    expect(out).toContain('develops_competencies: [agency]');
    expect(out).toContain('# GC 1010 — Intro');
  });

  it('adds the field when the model left it out', () => {
    const page = PAGE.replace('contributes_to_targets: []\n', '');
    expect(stampCourseTargets(page, ['ai-workflow'])).toMatch(/^---\n[\s\S]*contributes_to_targets: \[ai-workflow\]\n---\n/);
  });

  it('replaces a multi-line YAML list, not just the first line', () => {
    const page = PAGE.replace('contributes_to_targets: []', 'contributes_to_targets:\n  - brand-strategy\n  - made-up-target');
    const out = stampCourseTargets(page, ['ai-workflow']);
    expect(out).toContain('contributes_to_targets: [ai-workflow]\n');
    expect(out).not.toContain('made-up-target');
    expect(out).toContain('develops_competencies: [agency]');
  });

  it('writes an empty list when the course feeds no target', () => {
    expect(stampCourseTargets(PAGE.replace('[]', '[brand-strategy]'), [])).toContain('contributes_to_targets: []\n');
  });

  it('leaves a page without frontmatter unchanged', () => {
    expect(stampCourseTargets('# no frontmatter\n', ['ai-workflow'])).toBe('# no frontmatter\n');
  });
});

describe('courseTargetMap', () => {
  it('inverts target → courses into course → sorted targets', () => {
    const m = courseTargetMap({ 'brand-strategy': ['gc-1010', 'gc-3730'], 'ai-workflow': ['gc-1010'] }, new Map());
    expect(m.get('gc-1010')).toEqual(['ai-workflow', 'brand-strategy']);
    expect(m.get('gc-3730')).toEqual(['brand-strategy']);
  });

  it('folds a paired lab/lecture code onto its parent course page', () => {
    const m = courseTargetMap({ 'production-operations': ['gc-2071'], 'brand-strategy': ['gc-2070'] }, new Map([['gc-2071', 'gc-2070']]));
    expect(m.get('gc-2070')).toEqual(['brand-strategy', 'production-operations']);
    expect(m.has('gc-2071')).toBe(false);
  });
});

import { backfillCourseTargets, contributingCoursesOf } from '@/lib/ai/wiki/course-targets';

describe('contributingCoursesOf', () => {
  it('reads inline and YAML-list forms, ignoring comments', () => {
    expect(contributingCoursesOf('---\ncontributing_courses: [gc-4800, mkt-3310]   # highest first\n---\n')).toEqual(['gc-4800', 'mkt-3310']);
    expect(contributingCoursesOf('---\ncontributing_courses:\n  - gc-1010\n  - gc-2070\ntype: target\n---\n')).toEqual(['gc-1010', 'gc-2070']);
    expect(contributingCoursesOf('---\ntype: target\n---\n')).toEqual([]);
  });
});

describe('backfillCourseTargets', () => {
  it('stamps course pages from the target pages and reports only changed pages', () => {
    const pages = [
      { path: 'targets/brand-strategy.md', content: '---\ntype: target\ncontributing_courses: [gc-1010, gc-3730]\n---\n' },
      { path: 'targets/ai-workflow.md', content: '---\ntype: target\ncontributing_courses: [gc-1010]\n---\n' },
      { path: 'targets/index.md', content: '---\ntype: index\n---\n' },
      { path: 'courses/gc-1010.md', content: PAGE },
      { path: 'courses/gc-3730.md', content: PAGE.replace('gc-1010', 'gc-3730').replace('[]', '[brand-strategy]') },
      { path: 'courses/gc-4800.md', content: PAGE.replace('gc-1010', 'gc-4800').replace('[]', '[brand-strategy]') },
    ];
    const out = backfillCourseTargets(pages);
    expect(out.map(p => p.path)).toEqual(['courses/gc-1010.md', 'courses/gc-4800.md']);
    expect(out[0]!.content).toContain('contributes_to_targets: [ai-workflow, brand-strategy]');
    expect(out[1]!.content).toContain('contributes_to_targets: []');
  });

  it('keeps OKF tags in step with the new targets', () => {
    const page = PAGE.replace('develops_competencies', 'level: 1\ntags: [course, level-1]\ndevelops_competencies');
    const out = backfillCourseTargets([
      { path: 'targets/brand-strategy.md', content: '---\ncontributing_courses: [gc-1010]\n---\n' },
      { path: 'courses/gc-1010.md', content: page },
    ]);
    expect(out[0]!.content).toContain('tags: [course, level-1, brand-strategy]');
  });
});
