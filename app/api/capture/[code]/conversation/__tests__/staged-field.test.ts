import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ conv: vi.fn(), latest: vi.fn(), msgs: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 4060' }) }));
vi.mock('@/lib/db/capture-conversations-queries', () => ({ getCaptureConversation: h.conv, deleteCaptureConversation: vi.fn() }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ getLatestSessionId: h.latest, getSessionMessages: h.msgs }));
vi.mock('@/lib/db/capture-interview-sessions-queries', () => ({ getInterviewSession: h.session }));

import { GET } from '../route';

const ctx = { params: Promise.resolve({ code: 'GC%204060' }) };
const req = () => new Request('http://x/api/capture/GC%204060/conversation?slug=s');
const staged = {
  stage: 2, stageTitle: 'Evidence walk', questionsAsked: 3, cap: 20, slotAsked: 'conditions', kind: 'question',
  stageProgress: [1, 2, 3, 4, 5, 6].map(id => ({ id, title: `t${id}`, status: id < 2 ? 'done' : id === 2 ? 'active' : 'upcoming' })),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.conv.mockResolvedValue({ messages: [{ role: 'assistant', content: 'hi' }], readiness: null, updatedAt: new Date('2026-11-25') });
  h.latest.mockResolvedValue('sess-1');
});

describe('conversation GET — staged field', () => {
  it('returns the latest assistant row\'s staged block and the map status for a staged session', async () => {
    h.session.mockResolvedValue({ sessionId: 'sess-1', courseCode: 'GC 4060', mapStatus: 'ready' });
    h.msgs.mockResolvedValue([
      { role: 'assistant', content: JSON.stringify({ staged: { ...staged, stage: 1 } }) },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: JSON.stringify({ staged }) },
    ]);
    const body = await (await GET(req(), ctx)).json();
    expect(body.staged.stage).toBe(2);
    expect(body.mapStatus).toBe('ready');
    expect(body.messages).toHaveLength(1);
  });

  it('a staged session with no turns yet has staged null and its map status', async () => {
    h.session.mockResolvedValue({ sessionId: 'sess-1', courseCode: 'GC 4060', mapStatus: 'failed' });
    h.msgs.mockResolvedValue([]);
    const body = await (await GET(req(), ctx)).json();
    expect(body.staged).toBeNull();
    expect(body.mapStatus).toBe('failed');
  });

  it('a classic session has staged null and mapStatus null', async () => {
    h.session.mockResolvedValue(null);
    const body = await (await GET(req(), ctx)).json();
    expect(body.staged).toBeNull();
    expect(body.mapStatus).toBeNull();
    expect(h.msgs).not.toHaveBeenCalled();
  });

  it('a session row for another course is treated as classic', async () => {
    h.session.mockResolvedValue({ sessionId: 'sess-1', courseCode: 'GC 1010', mapStatus: 'ready' });
    const body = await (await GET(req(), ctx)).json();
    expect(body.mapStatus).toBeNull();
  });

  it('no saved conversation still answers (empty, not staged)', async () => {
    h.conv.mockResolvedValue(null);
    const body = await (await GET(req(), ctx)).json();
    expect(body).toMatchObject({ messages: [], readiness: null, staged: null, mapStatus: null });
  });
});
