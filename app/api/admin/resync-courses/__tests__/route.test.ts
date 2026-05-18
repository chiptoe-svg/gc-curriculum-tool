import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345678' }));

const upsertMock = vi.fn(async (rows: unknown[]) => (rows as unknown[]).length);
const recordMock = vi.fn(async (_count: number, _errors: string[]) => undefined);
vi.mock('@/lib/db/courses-queries', () => ({
  upsertCourses: (rows: unknown[]) => upsertMock(rows),
  recordSyncResult: (count: number, errors: string[]) => recordMock(count, errors),
}));

import { POST } from '@/app/api/admin/resync-courses/route';

function mockSheetFetches(indexCsv: string, tabResponses: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('sheet=Index')) return new Response(indexCsv, { status: 200 });
    for (const [code, csv] of Object.entries(tabResponses)) {
      if (url.includes(`sheet=${encodeURIComponent(code)}`)) return new Response(csv, { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
}

describe('POST /api/admin/resync-courses', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'TEST_SHEET';
    process.env.PROTOTYPE_SLUG = 'valid-slug-12345678';
    upsertMock.mockClear();
    recordMock.mockClear();
  });

  it('rejects invalid slug', async () => {
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'wrong' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when GOOGLE_SHEET_ID is missing', async () => {
    delete process.env.GOOGLE_SHEET_ID;
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('syncs the courses found in the index tab', async () => {
    mockSheetFetches(
      `"Code","Title"\n"GC 1010","Orientation"\n"GC 3460","Ink & Substrates"\n`,
      {
        'GC 1010': `"Course Code","GC 1010"\n"Title","Orientation"\n"Level","1"\n"Track","Core"\n"Description","x"\n`,
        'GC 3460': `"Course Code","GC 3460"\n"Title","Ink & Substrates"\n"Level","3"\n"Track","Core"\n"Description","x"\n`,
      }
    );
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.synced).toBe(2);
    expect(json.skipped).toBe(0);
    expect(upsertMock).toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith(2, []);
  });

  it('reports tab fetch errors without failing the whole sync', async () => {
    mockSheetFetches(
      `"Code","Title"\n"GC 1010","x"\n"GC 9999","missing"\n`,
      {
        'GC 1010': `"Course Code","GC 1010"\n"Title","x"\n"Level","1"\n"Track","Core"\n"Description","x"\n`,
        // GC 9999 deliberately missing → 404
      }
    );
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.synced).toBe(1);
    expect(json.skipped).toBe(1);
    expect(json.errors[0]).toContain('GC 9999');
  });
});
