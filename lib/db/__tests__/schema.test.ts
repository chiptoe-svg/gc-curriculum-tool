import { describe, it, expect } from 'vitest';
import { courses, sheetSyncState } from '@/lib/db/schema';

describe('courses schema', () => {
  it('has the expected columns', () => {
    const cols = Object.keys(courses);
    for (const c of ['code', 'title', 'level', 'track', 'description', 'prerequisites',
                     'syllabusUrl', 'learningObjectives', 'majorProjects',
                     'skillsRequired', 'lastSyncedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('sheet_sync_state has the expected columns', () => {
    const cols = Object.keys(sheetSyncState);
    for (const c of ['key', 'lastSyncedAt', 'lastSyncedCount', 'lastErrors']) {
      expect(cols).toContain(c);
    }
  });
});
