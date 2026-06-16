import { describe, it, expect } from 'vitest';
import { config } from '@/middleware';

// The matcher string is already a regex-style pattern. Anchor it and test which
// pathnames middleware runs for. This validates the *precision* of the
// /materials exclusion: the bare path is excluded (the route self-auths), while
// its subpaths must STAY gated by middleware (they do not self-auth).
const matcherRe = new RegExp('^' + config.matcher[0] + '$');
const runsMiddleware = (path: string) => matcherRe.test(path);

describe('middleware matcher — /materials exclusion precision', () => {
  it('excludes the bare /materials path (route self-enforces Basic Auth)', () => {
    expect(runsMiddleware('/api/courses/GC%202400/materials')).toBe(false);
  });

  it('STILL gates /materials/<id> — it does not self-auth, so it must stay behind middleware', () => {
    expect(runsMiddleware('/api/courses/GC%202400/materials/3f46c056-a1f2-44c6-9456-50edfefaf5ee')).toBe(true);
  });

  it('STILL gates /materials/compress', () => {
    expect(runsMiddleware('/api/courses/GC%202400/materials/compress')).toBe(true);
  });

  it('keeps the prior exclusions (imscc-import, transcribe)', () => {
    expect(runsMiddleware('/api/courses/GC%202400/imscc-import')).toBe(false);
    expect(runsMiddleware('/api/transcribe')).toBe(false);
  });

  it('still gates ordinary faculty surfaces', () => {
    expect(runsMiddleware('/capture/GC%202400')).toBe(true);
    expect(runsMiddleware('/program')).toBe(true);
    expect(runsMiddleware('/admin')).toBe(true);
  });
});
