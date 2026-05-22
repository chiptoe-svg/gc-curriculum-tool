import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));
vi.mock('@/lib/ai/analyze/parse-profile-fields', () => ({ parseProfileFields: vi.fn() }));

import { POST } from '@/app/api/courses/[code]/parse-profile/route';
import { extractText } from '@/lib/courses/extract-text';
import { parseProfileFields } from '@/lib/ai/analyze/parse-profile-fields';

const mockExtract = extractText as ReturnType<typeof vi.fn>;
const mockParse = parseProfileFields as ReturnType<typeof vi.fn>;

const FAKE_FIELDS = {
  learningObjectives: ['Operate a press', 'Mix ink'],
  majorProjects: ['Final press run'],
  skillsRequired: ['Basic color theory'],
};

function makeReq(slug: string, hasFile: boolean, mimeType = 'application/pdf', code = 'GC 3460') {
  const form = new FormData();
  form.set('slug', slug);
  if (hasFile) {
    form.set('file', new Blob(['%PDF-content'], { type: mimeType }), 'syllabus.pdf');
  }
  return [
    new Request('http://x/api/courses/GC%203460/parse-profile', { method: 'POST', body: form }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => { vi.resetAllMocks(); });

describe('POST /api/courses/[code]/parse-profile', () => {
  it('returns 401 for invalid slug', async () => {
    const [req, ctx] = makeReq('bad', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file provided', async () => {
    const [req, ctx] = makeReq('valid-slug', false);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported mime type', async () => {
    const [req, ctx] = makeReq('valid-slug', true, 'text/plain');
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 422 when extraction fails', async () => {
    mockExtract.mockResolvedValue({ status: 'failed' });
    const [req, ctx] = makeReq('valid-slug', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
  });

  it('returns structured fields on success', async () => {
    mockExtract.mockResolvedValue({ status: 'ok', text: 'Syllabus content here.' });
    mockParse.mockResolvedValue(FAKE_FIELDS);
    const [req, ctx] = makeReq('valid-slug', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.learningObjectives).toEqual(['Operate a press', 'Mix ink']);
    expect(json.majorProjects).toEqual(['Final press run']);
    expect(json.skillsRequired).toEqual(['Basic color theory']);
  });
});
