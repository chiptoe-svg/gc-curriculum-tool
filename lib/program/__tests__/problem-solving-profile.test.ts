import { describe, it, expect, vi } from 'vitest';
import {
  buildProblemSolvingProfile,
  renderProblemSolvingPage,
  writeProblemSolvingPage,
  type PsCourseInput,
  type PsDepthInput,
} from '../problem-solving-profile';

const course = (courseCode: string, area7: PsCourseInput['area7'], level = 3): PsCourseInput =>
  ({ courseCode, courseTitle: `Title ${courseCode}`, level, area7 });

const ALL_PRESENT = {
  generate_then_consolidate: 'present', open_ended_problems: 'present', revision_cycles: 'present',
  structured_post_mortem: 'present', abstraction_bridging: 'present',
} as const;

describe('buildProblemSolvingProfile', () => {
  it('buckets bands; a null area7 is no_data, never none', () => {
    const p = buildProblemSolvingProfile([
      course('GC 1010', null),
      course('GC 2010', { generate_then_consolidate: 'absent' }),
      course('GC 3010', { open_ended_problems: 'present' }),
      course('GC 4010', { ...ALL_PRESENT }),
    ], []);
    expect(p.bands.no_data).toEqual(['GC 1010']);
    expect(p.bands.none).toEqual(['GC 2010']);
    expect(p.bands.slight).toEqual(['GC 3010']);
    expect(p.bands.significant).toEqual(['GC 4010']);
    expect(p.coursesWithData).toBe(3);
  });

  it('counts conditions; a missing condition is unassessed, never absent', () => {
    const p = buildProblemSolvingProfile([
      course('GC 1', { generate_then_consolidate: 'present', revision_cycles: 'partial', open_ended_problems: 'absent' }),
    ], []);
    expect(p.conditionCounts.generate_then_consolidate).toEqual({ present: 1, partial: 0, absent: 0, unassessed: 0 });
    expect(p.conditionCounts.revision_cycles.partial).toBe(1);
    expect(p.conditionCounts.open_ended_problems.absent).toBe(1);
    expect(p.conditionCounts.abstraction_bridging).toEqual({ present: 0, partial: 0, absent: 0, unassessed: 1 });
  });

  it('D list keeps depth 4+ only and groups by competency', () => {
    const depths: PsDepthInput[] = [
      { competencyId: 'color', competencyName: 'Color', courseCode: 'GC 3460', dDepth: 4 },
      { competencyId: 'color', competencyName: 'Color', courseCode: 'GC 4440', dDepth: 5 },
      { competencyId: 'color', competencyName: 'Color', courseCode: 'GC 1040', dDepth: 3 },
      { competencyId: 'prepress', competencyName: 'Prepress', courseCode: 'GC 3460', dDepth: 3 },
    ];
    const p = buildProblemSolvingProfile([], depths);
    expect(p.d4ByCompetency).toEqual([{ competencyId: 'color', competencyName: 'Color', courses: ['GC 3460', 'GC 4440'] }]);
  });
});

describe('renderProblemSolvingPage', () => {
  const profile = buildProblemSolvingProfile(
    [course('GC 3460', { ...ALL_PRESENT }), course('GC 1040', null)],
    [{ competencyId: 'color', competencyName: 'Color Management', courseCode: 'GC 3460', dDepth: 4 }],
  );
  const page = renderProblemSolvingPage(profile, new Date('2026-10-19T00:00:00Z'));

  it('has frontmatter, program-level framing, wikilinks and the scaffolding link', () => {
    expect(page).toContain('type: competency');
    expect(page).toContain('slug: problem-solving');
    expect(page).toContain('program-level');
    expect(page).toContain('not scored course by course');
    expect(page).toContain('[[gc-3460]]');
    expect(page).toContain('https://gcworkflow.clemson.edu:8443/program/scaffolding');
  });
  it('contains no K/U/D score token', () => {
    expect(page).not.toMatch(/\b[KUD]\d/);
  });
  it('empty input renders a no-data page, not an error', () => {
    const empty = renderProblemSolvingPage(buildProblemSolvingProfile([], []), new Date('2026-10-19T00:00:00Z'));
    expect(empty).toContain('no captured course has condition data yet');
    expect(empty).toContain('slug: problem-solving');
  });
});

describe('writeProblemSolvingPage', () => {
  it('writes competencies/problem-solving.md through the injected writer', async () => {
    const write = vi.fn(async () => ({ sha: 'abc' }));
    const r = await writeProblemSolvingPage(
      { courses: [course('GC 3460', { ...ALL_PRESENT })], depths: [] },
      write,
      new Date('2026-10-19T00:00:00Z'),
    );
    expect(r.sha).toBe('abc');
    const arg = (write.mock.calls[0] as unknown as [{ pages: Array<{ path: string; content: string }> }])[0];
    expect(arg.pages).toHaveLength(1);
    expect(arg.pages[0]!.path).toBe('competencies/problem-solving.md');
    expect(arg.pages[0]!.content).toContain('[[gc-3460]]');
  });
});
