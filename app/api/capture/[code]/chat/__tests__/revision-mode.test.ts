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
const order: string[] = [];
const h = vi.hoisted(() => ({ stored: null as null | { revisionMode: string; baselineSnapshotId: string | null }, latest: { id: 'snap-9' } as null | { id: string } }));
vi.mock('@/lib/db/capture-sessions-queries', async (orig) => ({
  ...(await orig<typeof import('@/lib/db/capture-sessions-queries')>()),
  recordSessionMode: vi.fn(async (i: { revisionMode: string; baselineSnapshotId: string | null }) => {
    order.push('record');
    if (!h.stored) h.stored = { revisionMode: i.revisionMode, baselineSnapshotId: i.baselineSnapshotId };
  }),
  getSessionMode: vi.fn(async () => h.stored),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: vi.fn(async () => h.latest) }));

import { POST } from '@/app/api/capture/[code]/chat/route';
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { recordSessionMode } from '@/lib/db/capture-sessions-queries';

const response = { finding: 'f', question: 'q', citations: [], readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false } };
const call = (body: unknown) => POST(
  new Request('http://x/api/capture/GC%203460/chat?slug=s', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ code: 'GC%203460' }) },
);
const agentInput = () => (runAuditAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  h.stored = null;
  h.latest = { id: 'snap-9' };
  (runAuditAgent as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('agent'); return { response, toolCallsUsed: 0 }; });
});

describe('chat route revision mode', () => {
  it('records the mode before the agent runs, with the latest snapshot as baseline', async () => {
    await call({ sessionId: 'sess-1', revisionMode: 'targeted' });
    expect(order).toEqual(['record', 'agent']);
    expect(recordSessionMode).toHaveBeenCalledWith({ sessionId: 'sess-1', courseCode: 'GC 3460', revisionMode: 'targeted', baselineSnapshotId: 'snap-9' });
    expect(agentInput()).toMatchObject({ revisionMode: 'targeted', baselineSnapshotId: 'snap-9', includePriorSessions: true });
  });

  it('the stored mode wins over a different one sent later', async () => {
    h.stored = { revisionMode: 'recheck', baselineSnapshotId: 'snap-1' };
    await call({ sessionId: 'sess-1', message: 'hi', revisionMode: 'fresh' });
    expect(agentInput()).toMatchObject({ revisionMode: 'recheck', baselineSnapshotId: 'snap-1', includePriorSessions: true });
  });

  it('fresh session turns prior sessions off', async () => {
    await call({ sessionId: 'sess-1', revisionMode: 'fresh', includePriorSessions: true });
    expect(recordSessionMode).toHaveBeenCalledWith(expect.objectContaining({ revisionMode: 'fresh', baselineSnapshotId: null }));
    expect(agentInput()).toMatchObject({ revisionMode: 'fresh', includePriorSessions: false });
  });

  it('no mode leaves today\'s behavior', async () => {
    await call({ sessionId: 'sess-1', includePriorSessions: false });
    expect(recordSessionMode).not.toHaveBeenCalled();
    expect(agentInput()).toMatchObject({ includePriorSessions: false });
    expect(agentInput().revisionMode ?? null).toBeNull();
  });

  it('targeted on a course with no approved snapshot is ignored', async () => {
    h.latest = null;
    await call({ sessionId: 'sess-1', revisionMode: 'targeted' });
    expect(recordSessionMode).not.toHaveBeenCalled();
    expect(agentInput().revisionMode ?? null).toBeNull();
  });
});
