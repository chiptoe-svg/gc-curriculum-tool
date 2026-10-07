// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// The sheet says GC 3460 needs GC 1040; the Clemson catalog says GC 2070.
// The wiki must follow the shared prerequisite map (catalog first), not the
// raw sheet line (owner, 2026-10-06).
vi.mock('@/lib/curriculum/prereq-map', () => ({ prereqCodesFor: vi.fn(async () => ['GC 2070']) }));
vi.mock('@/lib/sheets/fetchLiveCourse', () => ({ fetchLiveCourseFromSheet: vi.fn(async () => null) }));
vi.mock('@/lib/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ title: 'Ink and Substrates', level: 3, prerequisites: 'GC 1040' }] }) }) }) },
}));

import { loadCourseInfo } from '@/lib/ai/wiki/update';

describe('loadCourseInfo prerequisites', () => {
  it('uses the prerequisite map, not the raw sheet line', async () => {
    const info = await loadCourseInfo('GC 3460');
    expect(info.prerequisites).toEqual(['gc-2070']);
  });
});
