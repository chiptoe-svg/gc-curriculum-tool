import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_r: unknown, o: { slug?: string }) => o.slug === 'good' }));
vi.mock('@/lib/http/is-http-url', () => ({ isHttpUrl: (u: string) => u.startsWith('http') }));
const createCourse = vi.fn(async (..._a: unknown[]) => {});
const bulkCreateCourses = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({
  createCourse: (...a: unknown[]) => createCourse(...a),
  bulkCreateCourses: (...a: unknown[]) => bulkCreateCourses(...a),
}));
import { POST } from '@/app/api/admin/courses/roster/route';
beforeEach(() => vi.clearAllMocks());

const CREATOR_AUTH = 'Basic ' + Buffer.from('cufaculty:tigers').toString('base64');
const FACULTY_AUTH = 'Basic ' + Buffer.from('gcfaculty:godfrey').toString('base64');

describe('roster bulk gating by role', () => {
  beforeEach(() => {
    vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
    vi.stubEnv('CREATE_ONLY_AUTH', 'cufaculty:tigers');
    bulkCreateCourses.mockResolvedValue({ created: [], skipped: [] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('blocks bulk preload for the creator role (403)', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: CREATOR_AUTH },
      body: JSON.stringify({ mode: 'bulk', text: 'GC 1010 — Intro' }),
    }));
    expect(res.status).toBe(403);
  });

  it('allows bulk preload for the faculty role', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: FACULTY_AUTH },
      body: JSON.stringify({ mode: 'bulk', text: 'GC 1010 — Intro' }),
    }));
    expect(res.status).toBe(200);
  });

  it('still allows single-add for the creator role', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: CREATOR_AUTH },
      body: JSON.stringify({ mode: 'one', code: 'GC 1010', title: 'Intro' }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('roster one-add with paired course', () => {
  it('passes pairedCode/pairedRole through to createCourse', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      body: JSON.stringify({ mode: 'one', code: 'GC 3460', title: 'Lecture', pairedCode: 'GC 3461', pairedRole: 'lab' }),
    }));
    expect(res.status).toBe(200);
    expect(createCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'GC 3460', pairedCode: 'GC 3461', pairedRole: 'lab' }));
  });
  it('rejects an invalid pairedRole when a pairedCode is given', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      body: JSON.stringify({ mode: 'one', code: 'GC 3460', title: 'L', pairedCode: 'GC 3461', pairedRole: 'bogus' }),
    }));
    expect(res.status).toBe(400);
  });
  it('still works for a plain course with no paired code', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      body: JSON.stringify({ mode: 'one', code: 'GC 1010', title: 'Intro' }),
    }));
    expect(res.status).toBe(200);
    expect(createCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'GC 1010' }));
    expect((createCourse.mock.calls[0] as unknown[])[0]).not.toHaveProperty('pairedCode');
  });
});
