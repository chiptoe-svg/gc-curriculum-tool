import { describe, it, expect } from 'vitest';
import { formatCourseSyllabus } from '@/lib/courses/formatCourseSyllabus';

describe('formatCourseSyllabus', () => {
  it('produces labeled markdown from structured fields', () => {
    const out = formatCourseSyllabus({
      code: 'GC 3460',
      title: 'Ink and Substrates',
      track: 'Core',
      level: 3,
      description: 'Substrates and inks.',
      prerequisites: 'GC 2070',
      learningObjectives: ['Identify substrates.', 'Specify inks.'],
      majorProjects: ['Compatibility matrix.'],
      skillsRequired: ['Chemistry basics.'],
    });
    expect(out).toContain('# GC 3460 — Ink and Substrates');
    expect(out).toContain('**Level:** 3');
    expect(out).toContain('**Track:** Core');
    expect(out).toContain('**Prerequisites:** GC 2070');
    expect(out).toContain('## Description\nSubstrates and inks.');
    expect(out).toContain('## Learning Objectives\n- Identify substrates.\n- Specify inks.');
    expect(out).toContain('## Major Projects\n- Compatibility matrix.');
    expect(out).toContain('## Skills / Competencies Required\n- Chemistry basics.');
  });

  it('omits empty sections', () => {
    const out = formatCourseSyllabus({
      code: 'GC 1010', title: 'Orientation', track: 'Core', level: 1,
      description: 'x', prerequisites: '', learningObjectives: [],
      majorProjects: [], skillsRequired: [],
    });
    expect(out).not.toContain('## Learning Objectives');
    expect(out).not.toContain('## Major Projects');
    expect(out).not.toContain('## Skills');
    expect(out).not.toContain('Prerequisites');
  });
});
