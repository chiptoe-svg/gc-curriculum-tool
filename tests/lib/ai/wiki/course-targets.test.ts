import { describe, it, expect } from 'vitest';
import { backfillCourseTargetShares, stampCourseTargetShares } from '@/lib/ai/wiki/course-targets';
import type { CourseTargetShares } from '@/lib/skill-tree/course-target-shares';

const PAGE = `---
type: course
slug: gc-1010
title: "Intro"
contributes_to_targets: []
develops_competencies: [agency]
---

# GC 1010 — Intro
`;

const shares = (targets: Array<[string, number]>, total = 8): CourseTargetShares => ({
  totalSkills: total, confirmedPlacements: 0, totalPlacements: total,
  targets: targets.map(([targetId, pct]) => ({ targetId, skills: Math.round((pct * total) / 100), pct })),
});
const EMPTY: CourseTargetShares = { totalSkills: 0, confirmedPlacements: 0, totalPlacements: 0, targets: [{ targetId: 'T1', skills: 0, pct: 0 }] };

describe('stampCourseTargetShares', () => {
  it('stamps targets in bar order and the shares map', () => {
    const out = stampCourseTargetShares(PAGE, shares([['T2', 100], ['T1', 38], ['T3', 0]]));
    expect(out).toContain('contributes_to_targets: [T2, T1]\n');
    expect(out).toContain('target_skill_shares: {T2: 100, T1: 38, T3: 0}\n');
    expect(out).toContain('develops_competencies: [agency]');
    expect(out).toContain('# GC 1010 — Intro');
  });

  it('replaces existing fields', () => {
    const page = PAGE.replace('contributes_to_targets: []', 'contributes_to_targets:\n  - brand-strategy\n  - made-up-target\ntarget_skill_shares: {old: 5}');
    const out = stampCourseTargetShares(page, shares([['T1', 50]]));
    expect(out).toContain('contributes_to_targets: [T1]\n');
    expect(out).toContain('target_skill_shares: {T1: 50}\n');
    expect(out).not.toContain('made-up-target');
    expect(out).not.toContain('old: 5');
    expect(out.match(/target_skill_shares/g)).toHaveLength(1);
  });

  it('adds the fields when the model left them out', () => {
    const out = stampCourseTargetShares(PAGE.replace('contributes_to_targets: []\n', ''), shares([['T1', 50]]));
    expect(out).toMatch(/^---\n[\s\S]*contributes_to_targets: \[T1\]\ntarget_skill_shares: \{T1: 50\}\n---\n/);
  });

  it('zero skills gives empty fields', () => {
    const out = stampCourseTargetShares(PAGE.replace('[]', '[brand-strategy]'), EMPTY);
    expect(out).toContain('contributes_to_targets: []\n');
    expect(out).toContain('target_skill_shares: {}\n');
  });

  it('leaves pages without front matter unchanged', () => {
    expect(stampCourseTargetShares('# no frontmatter\n', shares([['T1', 50]]))).toBe('# no frontmatter\n');
  });
});

describe('backfillCourseTargetShares', () => {
  it('re-derives tags and returns only changed course pages', () => {
    const tagged = PAGE.replace('develops_competencies', 'level: 1\ntags: [course, level-1]\ndevelops_competencies');
    const done = stampCourseTargetShares(PAGE.replace('gc-1010', 'gc-2070'), shares([['T1', 50]]));
    const pages = [
      { path: 'courses/gc-1010.md', content: tagged },
      { path: 'courses/gc-2070.md', content: done },
      { path: 'courses/gc-4800.md', content: PAGE.replace('gc-1010', 'gc-4800').replace('[]', '[T9]') },
      { path: 'courses/index.md', content: '---\ntype: index\n---\n' },
      { path: 'targets/T1.md', content: '---\ntype: target\n---\n' },
    ];
    const out = backfillCourseTargetShares(pages, new Map([
      ['gc-1010', shares([['brand-strategy', 75], ['T1', 0]])],
      ['gc-2070', shares([['T1', 50]])],
    ]));
    expect(out.map(p => p.path)).toEqual(['courses/gc-1010.md', 'courses/gc-4800.md']);
    expect(out[0]!.content).toContain('tags: [course, level-1, brand-strategy]');
    expect(out[1]!.content).toContain('contributes_to_targets: []');
    expect(out[1]!.content).toContain('target_skill_shares: {}');
  });
});
