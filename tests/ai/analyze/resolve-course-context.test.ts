import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/course-profile-queries');

import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';
import * as courseProfileQueries from '@/lib/db/course-profile-queries';

const getCourseProfile = vi.mocked(courseProfileQueries.getCourseProfile);

describe('resolveCourseContext', () => {
  it('returns fallbackSyllabusText unchanged when no profile found', async () => {
    getCourseProfile.mockResolvedValueOnce(null);
    const out = await resolveCourseContext('GC 1010', 'raw syllabus text here');
    expect(out).toBe('raw syllabus text here');
    expect(getCourseProfile).toHaveBeenCalledWith('GC 1010');
  });

  it('returns a formatted profile string when profile found', async () => {
    getCourseProfile.mockResolvedValueOnce({
      courseCode: 'GC 1010',
      summary: 'A course about digital printing.',
      learningObjectives: ['Understand RIP software', 'Operate a digital press'],
      skills: ['PDF preflight', 'Color management'],
      competencies: [
        {
          name: 'Color Management',
          description: 'Profile press output using ICC profiles.',
          level: 'developed',
          evidence: [{ fileName: 'rubric.pdf', quote: 'Students profile a press.' }],
        },
      ],
      catalogDivergence: { reinforced: ['Color theory'], additions: [], gaps: [] },
      sourceRunId: 'run-1',
      manuallyEdited: false,
      updatedAt: new Date(),
    });

    const out = await resolveCourseContext('GC 1010', 'raw syllabus text here');

    expect(out).not.toBe('raw syllabus text here');
    expect(out).toContain('[Course profile: GC 1010]');
    expect(out).toContain('A course about digital printing.');
    expect(out).toContain('Understand RIP software');
    expect(out).toContain('Operate a digital press');
    expect(out).toContain('PDF preflight');
    expect(out).toContain('Color management');
    expect(out).toContain('Color Management (developed): Profile press output using ICC profiles.');
  });

  it('handles empty learningObjectives, skills, and competencies arrays', async () => {
    getCourseProfile.mockResolvedValueOnce({
      courseCode: 'GC 2020',
      summary: 'Short summary.',
      learningObjectives: [],
      skills: [],
      competencies: [],
      catalogDivergence: { reinforced: [], additions: [], gaps: [] },
      sourceRunId: null,
      manuallyEdited: false,
      updatedAt: new Date(),
    });

    const out = await resolveCourseContext('GC 2020', 'fallback');
    expect(out).toContain('[Course profile: GC 2020]');
    expect(out).toContain('Short summary.');
  });

  it('passes the courseLabel argument to getCourseProfile as-is (case-sensitive)', async () => {
    getCourseProfile.mockResolvedValueOnce(null);
    await resolveCourseContext('GC 4060ap', 'fallback');
    expect(getCourseProfile).toHaveBeenCalledWith('GC 4060ap');
  });
});
