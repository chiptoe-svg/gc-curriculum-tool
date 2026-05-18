import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345678' }));

const listMock = vi.fn();
const getMock = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({
  listCourses: () => listMock(),
  getCourseByCode: (c: string) => getMock(c),
}));

import { GET as listGET } from '@/app/api/courses/route';
import { GET as detailGET } from '@/app/api/courses/[code]/route';

describe('GET /api/courses', () => {
  beforeEach(() => { listMock.mockReset(); getMock.mockReset(); });

  it('lists courses for valid slug', async () => {
    listMock.mockResolvedValue([{ code: 'GC 1010', title: 'x', level: 1, track: 'Core' }]);
    const res = await listGET(new Request('http://x/api/courses?slug=valid-slug-12345678'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ code: 'GC 1010', title: 'x', level: 1, track: 'Core' }]);
  });

  it('returns 401 for missing slug', async () => {
    const res = await listGET(new Request('http://x/api/courses'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/courses/[code]', () => {
  beforeEach(() => { listMock.mockReset(); getMock.mockReset(); });

  it('returns the course detail when found', async () => {
    getMock.mockResolvedValue({ code: 'GC 3460', title: 'Ink & Substrates' });
    const res = await detailGET(
      new Request('http://x/api/courses/GC%203460?slug=valid-slug-12345678'),
      { params: Promise.resolve({ code: 'GC%203460' }) }
    );
    expect(res.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith('GC 3460');
  });

  it('returns 404 when not found', async () => {
    getMock.mockResolvedValue(null);
    const res = await detailGET(
      new Request('http://x/api/courses/GC%209999?slug=valid-slug-12345678'),
      { params: Promise.resolve({ code: 'GC%209999' }) }
    );
    expect(res.status).toBe(404);
  });
});
