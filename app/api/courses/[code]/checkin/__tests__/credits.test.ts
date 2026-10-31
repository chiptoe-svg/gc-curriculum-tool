import { vi, describe, it, expect } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (code: string) => ({ code, title: 'T', learningObjectives: [], majorProjects: [] })) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/ai/analyze/ingestion-checkin', () => ({ generateIngestionCheckIn: vi.fn() }));

import { GET } from '@/app/api/courses/[code]/checkin/route';
import { generateIngestionCheckIn } from '@/lib/ai/analyze/ingestion-checkin';
import { AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE, creditsContact } from '@/lib/ai/credit-status';

const call = () => GET(new Request('http://x/api/courses/GC%203800/checkin?slug=s'), { params: Promise.resolve({ code: 'GC%203800' }) });

describe('check-in route — shared credits exhausted', () => {
  it('AiCreditsExhaustedError -> 503 ai_credits_exhausted + message (not a silent empty result)', async () => {
    (generateIngestionCheckIn as ReturnType<typeof vi.fn>).mockRejectedValue(new AiCreditsExhaustedError());
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_credits_exhausted', message: CREDITS_EXHAUSTED_MESSAGE(creditsContact()) });
  });

  it('other failures stay silent (empty result)', async () => {
    (generateIngestionCheckIn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBeNull();
  });
});
