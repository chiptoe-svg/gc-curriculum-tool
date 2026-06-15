import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolve = vi.fn();
vi.mock('@/lib/sandbox/access', async (orig) => {
  const actual = await orig<typeof import('@/lib/sandbox/access')>();
  return { ...actual, resolveScopedSession: (...a: unknown[]) => mockResolve(...a) };
});
vi.mock('@/lib/slug', () => ({ getPrototypeSlug: () => 'FACULTY-SLUG' }));

import { middleware } from '../middleware';

function req(path: string) { return new NextRequest(`http://host${path}`); }
beforeEach(() => { vi.clearAllMocks(); delete process.env.FACULTY_BASIC_AUTH; });

describe('middleware scoped-session injection', () => {
  it('rewrites with injected slug for a bound session on an allowed path', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/materials'));
    expect(res.headers.get('x-middleware-rewrite')).toContain('slug=FACULTY-SLUG');
  });
  it('does NOT rewrite for a blocked route even with a bound session', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/canvas-import'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
  it('does NOT rewrite for a different course', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/capture/GC%209999'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
