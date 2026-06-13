import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_r: unknown, o: { slug?: string }) => o.slug === 'good' }));
vi.mock('@/lib/http/is-http-url', () => ({ isHttpUrl: (u: string) => u.startsWith('http') }));
const createCourse = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/db/courses-queries', () => ({
  createCourse: (...a: unknown[]) => createCourse(...a),
  bulkCreateCourses: vi.fn(),
}));
import { POST } from '@/app/api/admin/courses/roster/route';
beforeEach(() => vi.clearAllMocks());

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
