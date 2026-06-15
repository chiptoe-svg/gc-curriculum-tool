import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolve = vi.fn();
vi.mock('@/lib/sandbox/access', async (orig) => {
  const actual = await orig<typeof import('@/lib/sandbox/access')>();
  return { ...actual, resolveScopedSession: (...a: unknown[]) => mockResolve(...a) };
});

import { middleware } from '../middleware';

function req(path: string) { return new NextRequest(`http://host${path}`); }
// Basic Auth ACTIVE so the faculty gate returns 401 for un-skipped paths;
// a bound scoped session on an allowed path is the only thing that skips it.
beforeEach(() => { vi.clearAllMocks(); process.env.FACULTY_BASIC_AUTH = 'user:pass'; });

describe('middleware scoped-session access (skip Basic Auth, no slug injection)', () => {
  it('does NOT inject the faculty slug (no rewrite) — the slug is never materialized', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/materials'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
  it('skips Basic Auth (no 401) for a bound session on an allowed path', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/materials'));
    expect(res.status).not.toBe(401);
  });
  it('skips Basic Auth for the whole capture engine namespace', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/capture/GC%202400/scores'));
    expect(res.status).not.toBe(401);
  });
  it('401s a blocked route even with a bound session', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/canvas-import'));
    expect(res.status).toBe(401);
  });
  it('401s a different course', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/capture/GC%209999'));
    expect(res.status).toBe(401);
  });
  it('401s a program-wide surface even with a bound session', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/program'));
    expect(res.status).toBe(401);
  });
  it('401s a gated path with no scoped session', async () => {
    mockResolve.mockResolvedValue(null);
    const res = await middleware(req('/capture/GC%202400'));
    expect(res.status).toBe(401);
  });
});
