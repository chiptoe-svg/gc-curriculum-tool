import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({ updateCourseClassification: vi.fn() }));

import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { updateCourseClassification } from '@/lib/db/courses-queries';
import { PATCH } from '@/app/api/admin/courses/[code]/route';

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

function req(body: unknown) {
  return new Request('http://x/api/admin/courses/GC%201010?slug=s', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/admin/courses/[code]', () => {
  it('401 when auth fails', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await PATCH(req({ buildsToCareer: true }), ctx('GC 1010'));
    expect(res.status).toBe(401);
  });

  it('400 on invalid category', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await PATCH(req({ category: 'bogus' }), ctx('GC 1010'));
    expect(res.status).toBe(400);
  });

  it('400 on non-http catalogUrl', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await PATCH(req({ catalogUrl: 'javascript:1' }), ctx('GC 1010'));
    expect(res.status).toBe(400);
  });

  it('404 when the course does not exist', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (updateCourseClassification as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await PATCH(req({ buildsToCareer: true }), ctx('NOPE 9999'));
    expect(res.status).toBe(404);
  });

  it('200 + ok on a valid update', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (updateCourseClassification as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await PATCH(req({ category: 'gc_core', buildsToCareer: true, catalogUrl: null }), ctx('GC 1010'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateCourseClassification).toHaveBeenCalledWith('GC 1010', { category: 'gc_core', buildsToCareer: true, catalogUrl: null });
  });
});
