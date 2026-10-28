import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/capture-conversations-queries', () => ({
  getCaptureConversation: vi.fn(),
  upsertCaptureConversation: vi.fn(),
  deleteCaptureConversation: vi.fn(),
}));

import * as route from '@/app/api/capture/[code]/conversation/route';

/** The chat route saves each turn itself (owner, 2026-10-28). The page's
 *  full-copy autosave (PUT) is gone, so a failed autosave can no longer leave
 *  a stale conversation for a reload to restore. Read and clear remain. */
describe('conversation route', () => {
  it('has no PUT (no client-side autosave)', () => {
    expect((route as Record<string, unknown>).PUT).toBeUndefined();
  });
  it('keeps GET and DELETE', () => {
    expect(typeof route.GET).toBe('function');
    expect(typeof route.DELETE).toBe('function');
  });
});
