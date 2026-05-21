import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/courses-queries', () => ({
  listCourses: vi.fn().mockResolvedValue([
    { code: 'GC 1010', title: 'Intro', level: 1, track: 'Core', builderStatus: 'draft' },
    { code: 'GC 3460', title: 'Ink', level: 3, track: 'Print', builderStatus: 'approved' },
  ]),
  listApprovedCourses: vi.fn().mockResolvedValue([
    { code: 'GC 3460', title: 'Ink', level: 3, track: 'Print', builderStatus: 'approved' },
  ]),
}));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { GET } from '@/app/api/courses/route';

describe('GET /api/courses', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses?slug=bad');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns all courses when no approved param', async () => {
    const req = new Request('http://test/api/courses?slug=valid-slug');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('returns only approved courses when ?approved=true', async () => {
    const req = new Request('http://test/api/courses?slug=valid-slug&approved=true');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].code).toBe('GC 3460');
  });
});
