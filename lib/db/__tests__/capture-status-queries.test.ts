import { describe, it, expect, vi, beforeEach } from 'vitest';

const courseRows = [
  { code: 'GC 1010', title: 'Intro', level: 1, category: 'gc_core', buildsToCareer: true, catalogUrl: 'https://catalog.clemson.edu/gc1010' },
  { code: 'STAT 2220', title: 'Stats', level: 2, category: 'major_req', buildsToCareer: false, catalogUrl: null },
];

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn() },
}));

vi.mock('@/lib/db/schema', () => ({
  courses: {},
  courseCaptureProfiles: {},
  courseCaptureSnapshots: { retiredAt: 'retired_at', createdAt: 'created_at' },
  captureMessages: { courseCode: 'course_code', createdAt: 'created_at' },
}));

beforeEach(() => vi.clearAllMocks());

describe('listCoursesWithStatus carries category + buildsToCareer + catalogUrl', () => {
  it('maps the new fields straight through', async () => {
    const { db } = await import('@/lib/db/client');
    // The function runs 4 selects via Promise.all in order: courses, profiles, snapshots, messages.
    let call = 0;
    (db.select as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      call += 1;
      if (call === 1) return { from: () => courseRows };                                   // courses
      if (call === 2) return { from: () => [] };                                           // profiles
      if (call === 3) return { from: () => ({ where: () => ({ orderBy: () => [] }) }) };    // snapshots
      return { from: () => ({ orderBy: () => ({ limit: () => [] }) }) };                    // messages
    });

    const { listCoursesWithStatus } = await import('@/lib/db/capture-status-queries');
    const rows = await listCoursesWithStatus();
    const gc = rows.find((r) => r.code === 'GC 1010')!;
    expect(gc.category).toBe('gc_core');
    expect(gc.buildsToCareer).toBe(true);
    expect(gc.catalogUrl).toBe('https://catalog.clemson.edu/gc1010');
    const stat = rows.find((r) => r.code === 'STAT 2220')!;
    expect(stat.buildsToCareer).toBe(false);
    expect(stat.catalogUrl).toBeNull();
  });
});
