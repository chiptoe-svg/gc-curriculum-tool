import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100 }),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('testhash') }));

import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
const mockRateLimit = checkIpRateLimit as ReturnType<typeof vi.fn>;
const mockHashIp = hashIp as ReturnType<typeof vi.fn>;

import { POST } from '@/app/api/extract-syllabus/route';
import { extractText } from '@/lib/courses/extract-text';

const mockExtract = extractText as ReturnType<typeof vi.fn>;

function makeReq(slug: string, hasFile: boolean, mimeType = 'application/pdf') {
  const form = new FormData();
  form.set('slug', slug);
  if (hasFile) {
    form.set('file', new Blob(['%PDF-content'], { type: mimeType }), 'syllabus.pdf');
  }
  return new Request('http://x/api/extract-syllabus', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  // re-arm the ip-rate-limit mock — resetAllMocks wipes the factory defaults
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 100 });
  mockHashIp.mockReturnValue('testhash');
});

describe('POST /api/extract-syllabus', () => {
  it('returns 401 for invalid slug', async () => {
    const res = await POST(makeReq('bad', true));
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file provided', async () => {
    const res = await POST(makeReq('valid-slug', false));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported mime type', async () => {
    const res = await POST(makeReq('valid-slug', true, 'text/plain'));
    expect(res.status).toBe(400);
  });

  it('returns 422 when extraction fails', async () => {
    mockExtract.mockResolvedValue({ status: 'failed' });
    const res = await POST(makeReq('valid-slug', true));
    expect(res.status).toBe(422);
  });

  it('returns extracted text on success', async () => {
    mockExtract.mockResolvedValue({ status: 'ok', text: 'Syllabus content here.' });
    const res = await POST(makeReq('valid-slug', true));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toBe('Syllabus content here.');
  });
});
