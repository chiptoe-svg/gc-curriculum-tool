import { describe, it, expect } from 'vitest';
import {
  shapeCoverageForTarget,
  prereqNeighborhood,
} from '@/lib/ai/wiki/graph-tools';
import type { MatrixData } from '@/lib/db/program-coverage-queries';

// ── shapeCoverageForTarget ──────────────────────────────────────────────────

function fixture(): MatrixData {
  return {
    courses: [
      {
        courseCode: 'GC 1040',
        courseTitle: 'Intro',
        level: 1,
        snapshotId: 'snap-a',
        snapshotCaption: null,
        snapshotCreatedAt: new Date('2026-01-01'),
        instructorName: null,
      },
      {
        courseCode: 'GC 4400',
        courseTitle: 'Capstone',
        level: 4,
        snapshotId: 'snap-b',
        snapshotCaption: null,
        snapshotCreatedAt: new Date('2026-01-02'),
        instructorName: null,
      },
    ],
    targets: [
      { id: 't1', name: 'Production Operations', displayOrder: 0 },
      { id: 't2', name: 'Account Management', displayOrder: 1 },
    ],
    subCompetencies: [
      { id: 's1', name: 'Press Operation', careerTargetId: 't1', careerTargetName: 'Production Operations', displayOrder: 0 },
      { id: 's2', name: 'Client Comms', careerTargetId: 't2', careerTargetName: 'Account Management', displayOrder: 0 },
    ],
    cells: [
      // two courses cover s1 under t1, at different depths
      { snapshotId: 'snap-a', careerTargetId: 't1', subCompetencyId: 's1', kDepth: 2, uDepth: 1, dDepth: 1, matchedCompetency: null, evidenceExcerpt: 'intro press', confidence: 'low', rationale: 'r' },
      { snapshotId: 'snap-b', careerTargetId: 't1', subCompetencyId: 's1', kDepth: 4, uDepth: 3, dDepth: 4, matchedCompetency: null, evidenceExcerpt: 'runs the press', confidence: 'high', rationale: 'r' },
      // a zero-everywhere cell that must be filtered out
      { snapshotId: 'snap-a', careerTargetId: 't1', subCompetencyId: 's1', kDepth: 0, uDepth: 0, dDepth: 0, matchedCompetency: null, evidenceExcerpt: null, confidence: 'low', rationale: 'r' },
      // a cell for the OTHER target — must not leak in
      { snapshotId: 'snap-a', careerTargetId: 't2', subCompetencyId: 's2', kDepth: 1, uDepth: 1, dDepth: 2, matchedCompetency: null, evidenceExcerpt: 'emails', confidence: 'medium', rationale: 'r' },
    ],
  };
}

describe('shapeCoverageForTarget', () => {
  it('returns null when no target matches', () => {
    expect(shapeCoverageForTarget(fixture(), 'Nonexistent Target')).toBeNull();
  });

  it('matches a target case-insensitively and by substring', () => {
    const exact = shapeCoverageForTarget(fixture(), 'production operations');
    const sub = shapeCoverageForTarget(fixture(), 'Production');
    expect(exact?.target).toBe('Production Operations');
    expect(sub?.target).toBe('Production Operations');
  });

  it('groups courses under the target sub-competencies, sorted by Do depth desc', () => {
    const shaped = shapeCoverageForTarget(fixture(), 'Production Operations')!;
    expect(shaped.subCompetencies).toHaveLength(1);
    const sc = shaped.subCompetencies[0]!;
    expect(sc.subCompetency).toBe('Press Operation');
    expect(sc.courses.map(c => c.course)).toEqual(['GC 4400', 'GC 1040']); // d=4 before d=1
    expect(sc.courses[0]).toMatchObject({ course: 'GC 4400', d: 4, confidence: 'high' });
  });

  it('drops cells where K, U, and D are all zero/absent', () => {
    const shaped = shapeCoverageForTarget(fixture(), 'Production Operations')!;
    const sc = shaped.subCompetencies[0]!;
    // snap-a appears once (the scored cell), not twice (the all-zero cell is dropped)
    expect(sc.courses.filter(c => c.course === 'GC 1040')).toHaveLength(1);
  });

  it('does not leak cells from a different target', () => {
    const shaped = shapeCoverageForTarget(fixture(), 'Production Operations')!;
    const codes = shaped.subCompetencies.flatMap(s => s.courses.map(c => c.course));
    // 'Client Comms' belongs to Account Management; its course must not appear here
    expect(shaped.subCompetencies.some(s => s.subCompetency === 'Client Comms')).toBe(false);
    expect(codes).not.toContain('emails');
  });
});

// ── prereqNeighborhood ──────────────────────────────────────────────────────

describe('prereqNeighborhood', () => {
  const pairs = [
    { focal: 'GC 4400', prereq: 'GC 3460' },
    { focal: 'GC 3460', prereq: 'GC 2470' },
    { focal: 'GC 2470', prereq: 'GC 1040' },
    { focal: 'GC 4040', prereq: 'GC 4400' }, // something requires 4400
  ];

  it('returns direct prerequisites', () => {
    const n = prereqNeighborhood(pairs, 'GC 4400');
    expect(n.directPrereqs).toEqual(['GC 3460']);
  });

  it('walks the transitive upstream chain', () => {
    const n = prereqNeighborhood(pairs, 'GC 4400');
    expect(n.allUpstreamPrereqs.sort()).toEqual(['GC 1040', 'GC 2470', 'GC 3460']);
  });

  it('lists courses that require the target', () => {
    const n = prereqNeighborhood(pairs, 'GC 4400');
    expect(n.requiredBy).toEqual(['GC 4040']);
  });

  it('normalizes course-code spacing/case on input and in edges', () => {
    const n = prereqNeighborhood(pairs, '  gc   4400 ');
    expect(n.course).toBe('GC 4400');
    expect(n.directPrereqs).toEqual(['GC 3460']);
  });

  it('returns empties for a course with no edges', () => {
    const n = prereqNeighborhood(pairs, 'GC 9999');
    expect(n).toMatchObject({ directPrereqs: [], allUpstreamPrereqs: [], requiredBy: [] });
  });

  it('does not loop forever on a cyclic edge set', () => {
    const cyclic = [
      { focal: 'A', prereq: 'B' },
      { focal: 'B', prereq: 'A' },
    ];
    const n = prereqNeighborhood(cyclic, 'A');
    expect(n.allUpstreamPrereqs.sort()).toEqual(['A', 'B']);
  });
});
