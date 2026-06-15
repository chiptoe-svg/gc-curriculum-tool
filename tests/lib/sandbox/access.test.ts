import { describe, it, expect } from 'vitest';
import { courseFromScopedPath } from '@/lib/sandbox/access';

describe('courseFromScopedPath (the allowlist)', () => {
  it('allows the capture page + the whole capture engine namespace', () => {
    expect(courseFromScopedPath('/capture/GC%202400')).toBe('GC 2400');
    expect(courseFromScopedPath('/api/capture/GC%202400/scores')).toBe('GC 2400');
    expect(courseFromScopedPath('/api/capture/GC%202400/snapshots/abc/use-as-draft')).toBe('GC 2400');
  });
  it('allows allowlisted /api/courses/<c> segments', () => {
    for (const seg of ['materials', 'imscc-import', 'kuds', 'scan-linked-docs', 'checkin', 'analyze-materials', 'parse-profile']) {
      expect(courseFromScopedPath(`/api/courses/GC%202400/${seg}`)).toBe('GC 2400');
    }
    expect(courseFromScopedPath('/api/courses/GC%202400/materials/some-id')).toBe('GC 2400');
  });
  it('BLOCKS institution-bound + course-admin + everything else', () => {
    for (const seg of ['canvas-import', 'canvas-reextract', 'sync-from-sheet']) {
      expect(courseFromScopedPath(`/api/courses/GC%202400/${seg}`)).toBeNull();
    }
    expect(courseFromScopedPath('/api/courses/GC%202400')).toBeNull();
    expect(courseFromScopedPath('/program')).toBeNull();
    expect(courseFromScopedPath('/admin')).toBeNull();
    expect(courseFromScopedPath('/explore/GC%202400')).toBeNull();
  });
});
