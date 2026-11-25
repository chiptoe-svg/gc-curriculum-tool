/** Task 6: the chat route passes `finish: true` to both agent entry points, and nothing otherwise. */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (code: string) => ({ code, auditMode: 'full' })) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ startNewSession: vi.fn().mockReturnValue('new-sess'), getSessionMessages: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/ai/agent/audit-agent', () => ({ runAuditAgent: vi.fn() }));
vi.mock('@/lib/ai/agent/audit-agent-stream', () => ({ streamAuditAgent: vi.fn() }));
vi.mock('@/lib/db/capture-conversations-queries', () => ({ upsertCaptureConversation: vi.fn() }));

import { POST } from '@/app/api/capture/[code]/chat/route';
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { streamAuditAgent } from '@/lib/ai/agent/audit-agent-stream';

const response = { finding: 'f', question: 'q', citations: [], readiness: { score: 0, covered: [], remaining: [], good_enough_to_generate: false } };
const call = (body: unknown, qs = '&stream=1') => POST(
  new Request(`http://x/api/capture/GC%204060/chat?slug=s${qs}`, { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ code: 'GC%204060' }) },
);
const arg = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  (streamAuditAgent as ReturnType<typeof vi.fn>).mockImplementation(async function* () { yield { kind: 'final', response, toolCallsUsed: 0 }; });
  (runAuditAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ response, toolCallsUsed: 0 });
});

describe('chat route finish', () => {
  it('stream: finish: true is passed through', async () => {
    await (await call({ sessionId: 's1', finish: true })).text();
    expect(arg(streamAuditAgent)).toMatchObject({ sessionId: 's1', finish: true });
  });

  it('non-stream: finish: true is passed through', async () => {
    await call({ sessionId: 's1', message: 'bye', finish: true }, '');
    expect(arg(runAuditAgent)).toMatchObject({ sessionId: 's1', userMessage: 'bye', finish: true });
  });

  it('without finish (or a non-true value) the agent input has no finish key', async () => {
    await (await call({ sessionId: 's1', message: 'x', finish: 'yes' })).text();
    expect('finish' in arg(streamAuditAgent)).toBe(false);
    await call({ sessionId: 's1', message: 'x' }, '');
    expect('finish' in arg(runAuditAgent)).toBe(false);
  });
});
