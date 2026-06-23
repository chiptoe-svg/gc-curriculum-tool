import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/wiki/curriculum-search-tool', () => ({
  curriculumSearchTool: {
    execute: vi.fn().mockResolvedValue({
      hits: [
        {
          courseCode: 'gc-3460',
          fileName: 'syllabus.pdf',
          sectionTitle: 'Color',
          text: 'Delta E tolerance',
          chunkId: 'c1',
          contextBlurb: '',
          uploadedAt: null,
          score: 0.9,
          materialId: 'm1',
        },
      ],
    }),
  },
}));

import { GET } from '@/app/api/curriculum/search/route';

const req = (url: string, token?: string) =>
  new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('GET /api/curriculum/search', () => {
  beforeEach(() => {
    vi.stubEnv('CURRICULUM_SEARCH_TOKEN', 'secret');
  });

  it('401 without a valid bearer token', async () => {
    const res = await GET(req('http://x/api/curriculum/search?q=color'));
    expect(res.status).toBe(401);
  });

  it('400 when q is missing', async () => {
    const res = await GET(req('http://x/api/curriculum/search', 'secret'));
    expect(res.status).toBe(400);
  });

  it('200 with hits when authorized', async () => {
    const res = await GET(req('http://x/api/curriculum/search?q=color%20management&k=5', 'secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits[0].courseCode).toBe('gc-3460');
  });
});
