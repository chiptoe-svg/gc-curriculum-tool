import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbInsertReturning = vi.fn();
const dbOnConflict = vi.fn();
const dbUpdateWhere = vi.fn();
const dbSelectFromWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: dbInsertReturning, onConflictDoUpdate: dbOnConflict }) }),
    update: () => ({ set: () => ({ where: dbUpdateWhere }) }),
    select: () => ({
      from: () => ({
        where: dbSelectFromWhere,
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  courseMaterials: {},
  courseProfiles: {},
  courseProfileRuns: {},
}));

import {
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
  getLatestRunForCourse,
  getCourseProfile,
  updateProfileFromEdit,
  listRunsForCourse,
  getRunById,
} from '@/lib/db/course-profile-queries';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

beforeEach(() => {
  vi.clearAllMocks();
});

const fakeFinding = {
  materialType: 'rubric',
  competencies: [],
  skills: ['Color management'],
  notes: '',
};

const fakeProfile: CourseProfileResult = {
  summary: 'Develops press fluency.',
  learningObjectives: ['Operate a press'],
  skills: ['Color management'],
  competencies: [],
  catalogDivergence: { reinforced: [], additions: [], gaps: [] },
};

describe('cacheAnalysisFinding', () => {
  it('updates the course_materials row with the finding + model + cost', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await cacheAnalysisFinding({
      materialId: 'mat-uuid-1',
      finding: fakeFinding,
      model: 'gpt-5.4-mini',
      costUsdCents: 7,
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('insertProfileRun', () => {
  it('inserts a run row and returns the new id', async () => {
    dbInsertReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);
    const id = await insertProfileRun({
      courseCode: 'GC 4060',
      result: fakeProfile,
      materialCount: 2,
      model: 'gpt-5.4-mini',
      costUsdCents: 42,
    });
    expect(id).toBe('run-uuid-1');
    expect(dbInsertReturning).toHaveBeenCalledTimes(1);
  });

  it('throws when no row is returned', async () => {
    dbInsertReturning.mockResolvedValue([]);
    await expect(
      insertProfileRun({ courseCode: 'GC 4060', result: fakeProfile, materialCount: 1, model: 'gpt', costUsdCents: 5 })
    ).rejects.toThrow('insertProfileRun: no row returned');
  });
});

describe('upsertCourseProfile', () => {
  // Atomic onConflictDoUpdate (no select-then-branch) — closes the TOCTOU race.
  it('issues a single atomic insert...onConflictDoUpdate (no select branch)', async () => {
    dbOnConflict.mockResolvedValue(undefined);
    await upsertCourseProfile({
      courseCode: 'GC 4060',
      result: fakeProfile,
      runId: 'run-uuid-1',
    });
    expect(dbOnConflict).toHaveBeenCalledTimes(1);
    // No pre-read select, no separate update branch.
    expect(dbSelectFromWhere).not.toHaveBeenCalled();
    expect(dbUpdateWhere).not.toHaveBeenCalled();
  });
});

describe('getLatestRunForCourse', () => {
  it('returns null when no runs exist', async () => {
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => ({ limit: () => Promise.resolve([]) }),
    });
    const result = await getLatestRunForCourse('GC 4060');
    expect(result).toBeNull();
  });

  it('returns the run row when one exists', async () => {
    const row = {
      id: 'run-uuid-1',
      courseCode: 'GC 4060',
      result: fakeProfile,
      materialCount: 2,
      model: 'gpt-5.4-mini',
      costUsdCents: 42,
      createdAt: new Date('2026-05-20T10:00:00Z'),
    };
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => ({ limit: () => Promise.resolve([row]) }),
    });
    const result = await getLatestRunForCourse('GC 4060');
    expect(result?.id).toBe('run-uuid-1');
    expect(result?.materialCount).toBe(2);
  });
});

describe('getCourseProfile', () => {
  it('returns null when no profile exists', async () => {
    dbSelectFromWhere.mockResolvedValue([]);
    const result = await getCourseProfile('GC 4060');
    expect(result).toBeNull();
  });

  it('returns the profile row when it exists', async () => {
    const row = {
      courseCode: 'GC 4060',
      summary: 'Develops press fluency.',
      learningObjectives: ['Operate a press'],
      skills: ['Color management'],
      competencies: [],
      catalogDivergence: { reinforced: [], additions: [], gaps: [] },
      sourceRunId: 'run-uuid-1',
      manuallyEdited: false,
      updatedAt: new Date('2026-05-20T10:00:00Z'),
    };
    dbSelectFromWhere.mockResolvedValue([row]);
    const result = await getCourseProfile('GC 4060');
    expect(result?.courseCode).toBe('GC 4060');
    expect(result?.manuallyEdited).toBe(false);
  });
});

describe('updateProfileFromEdit', () => {
  it('updates summary, learningObjectives, skills, competencies and sets manuallyEdited=true', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await updateProfileFromEdit({
      courseCode: 'GC 1010',
      summary: 'Revised summary.',
      learningObjectives: ['New objective'],
      skills: ['New skill'],
      competencies: [
        {
          name: 'Color Management',
          description: 'Revised.',
          level: 'developed',
          evidence: [{ fileName: 'rubric.pdf', quote: 'quote text' }],
        },
      ],
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it('does not touch sourceRunId or catalogDivergence', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await updateProfileFromEdit({
      courseCode: 'GC 4060',
      summary: 'Test',
      learningObjectives: [],
      skills: [],
      competencies: [],
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
    expect(dbInsertReturning).not.toHaveBeenCalled();
  });
});

describe('listRunsForCourse', () => {
  it('returns empty array when no runs exist', async () => {
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => Promise.resolve([]),
    });
    const result = await listRunsForCourse('GC 4060');
    expect(result).toEqual([]);
  });

  it('returns all runs ordered newest-first via mock', async () => {
    const rows = [
      { id: 'run-2', courseCode: 'GC 4060', result: {}, materialCount: 3, model: 'gpt', costUsdCents: 30, createdAt: new Date('2026-05-21') },
      { id: 'run-1', courseCode: 'GC 4060', result: {}, materialCount: 2, model: 'gpt', costUsdCents: 20, createdAt: new Date('2026-05-20') },
    ];
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => Promise.resolve(rows),
    });
    const result = await listRunsForCourse('GC 4060');
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('run-2');
  });
});

describe('getRunById', () => {
  it('returns null when run not found', async () => {
    dbSelectFromWhere.mockResolvedValue([]);
    const result = await getRunById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('returns the run row when found', async () => {
    const row = { id: 'run-1', courseCode: 'GC 4060', result: {}, materialCount: 2, model: 'gpt', costUsdCents: 20, createdAt: new Date() };
    dbSelectFromWhere.mockResolvedValue([row]);
    const result = await getRunById('run-1');
    expect(result?.id).toBe('run-1');
    expect(result?.courseCode).toBe('GC 4060');
  });
});
