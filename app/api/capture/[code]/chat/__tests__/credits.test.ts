import { vi, describe, it, expect } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (code: string) => ({ code, auditMode: 'full' })) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ startNewSession: vi.fn().mockReturnValue('sess') }));
vi.mock('@/lib/ai/agent/audit-agent', () => ({ runAuditAgent: vi.fn() }));
vi.mock('@/lib/ai/agent/audit-agent-stream', () => ({ streamAuditAgent: vi.fn() }));

import { POST } from '@/app/api/capture/[code]/chat/route';
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { streamAuditAgent } from '@/lib/ai/agent/audit-agent-stream';
import { AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE, creditsContact } from '@/lib/ai/credit-status';

const call = (qs = '') => POST(
  new Request(`http://x/api/capture/GC%203800/chat?slug=s${qs}`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }),
  { params: Promise.resolve({ code: 'GC%203800' }) },
);

describe('capture chat route — shared credits exhausted', () => {
  it('non-stream: AiCreditsExhaustedError -> 503 ai_credits_exhausted + message', async () => {
    (runAuditAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new AiCreditsExhaustedError());
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_credits_exhausted', message: CREDITS_EXHAUSTED_MESSAGE(creditsContact()) });
  });

  it('non-stream: other failures stay a 500', async () => {
    (runAuditAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const res = await call();
    expect(res.status).toBe(500);
  });

  it('stream: an exhausted error event carries code + friendly message', async () => {
    (streamAuditAgent as ReturnType<typeof vi.fn>).mockImplementation(async function* () { throw new AiCreditsExhaustedError(); });
    const res = await call('&stream=1');
    const text = await res.text();
    const ev = JSON.parse(text.trim().split('\n')[0]!);
    expect(ev).toEqual({ kind: 'error', code: 'ai_credits_exhausted', message: CREDITS_EXHAUSTED_MESSAGE(creditsContact()) });
  });
});
