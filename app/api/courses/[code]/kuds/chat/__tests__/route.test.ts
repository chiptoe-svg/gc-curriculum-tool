import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn() }));
vi.mock('@/lib/ai/analyze/kud-chat', () => ({ kudChatTurn: vi.fn() }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('testhash') }));

import { POST } from '@/app/api/courses/[code]/kuds/chat/route';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { kudChatTurn } from '@/lib/ai/analyze/kud-chat';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

const mockIsValidSlug = isValidSlug as ReturnType<typeof vi.fn>;
const mockGetCourseByCode = getCourseByCode as ReturnType<typeof vi.fn>;
const mockKudChatTurn = kudChatTurn as ReturnType<typeof vi.fn>;
const mockCheckIpRateLimit = checkIpRateLimit as ReturnType<typeof vi.fn>;
const mockHashIp = hashIp as ReturnType<typeof vi.fn>;

const FAKE_COURSE = {
  code: 'GC 3460',
  title: 'Offset Lithography',
  description: 'An introduction to offset printing.',
  learningObjectives: ['Operate a press', 'Mix ink'],
  majorProjects: ['Final press run'],
  skillsRequired: ['Basic color theory'],
};

function makeReq(
  slug: string,
  body: unknown,
  code = 'GC%203460',
) {
  return [
    new Request(`http://x/api/courses/${code}/kuds/chat?slug=${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockIsValidSlug.mockReturnValue(true);
  mockGetCourseByCode.mockResolvedValue(FAKE_COURSE);
  mockKudChatTurn.mockResolvedValue('Here are my questions...');
  mockCheckIpRateLimit.mockResolvedValue({ allowed: true });
  mockHashIp.mockReturnValue('testhash');
});

describe('POST /api/courses/[code]/kuds/chat', () => {
  it('returns 401 when isValidSlug returns false', async () => {
    mockIsValidSlug.mockReturnValue(false);
    const [req, ctx] = makeReq('bad-slug', { messages: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when getCourseByCode returns null', async () => {
    mockGetCourseByCode.mockResolvedValue(null);
    const [req, ctx] = makeReq('valid-slug', { messages: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 400 when body.messages is not an array', async () => {
    const [req, ctx] = makeReq('valid-slug', { messages: 'bad' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 200 with reply on a valid request with messages: []', async () => {
    const [req, ctx] = makeReq('valid-slug', { messages: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ reply: 'Here are my questions...' });
  });

  it('returns 429 when rate limited', async () => {
    mockCheckIpRateLimit.mockResolvedValueOnce({ allowed: false });
    const [req, ctx] = makeReq('valid-slug', { messages: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(429);
  });

  it('returns 500 when kudChatTurn throws', async () => {
    mockKudChatTurn.mockRejectedValueOnce(new Error('AI down'));
    const [req, ctx] = makeReq('valid-slug', { messages: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
  });
});
