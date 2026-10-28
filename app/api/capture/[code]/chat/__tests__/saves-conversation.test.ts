import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (code: string) => ({ code, auditMode: 'full' })) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ startNewSession: vi.fn().mockReturnValue('new-sess'), getSessionMessages: vi.fn() }));
vi.mock('@/lib/ai/agent/audit-agent', () => ({ runAuditAgent: vi.fn() }));
vi.mock('@/lib/ai/agent/audit-agent-stream', () => ({ streamAuditAgent: vi.fn() }));
vi.mock('@/lib/db/capture-conversations-queries', () => ({ upsertCaptureConversation: vi.fn() }));

import { POST } from '@/app/api/capture/[code]/chat/route';
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { streamAuditAgent } from '@/lib/ai/agent/audit-agent-stream';
import { upsertCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { getSessionMessages } from '@/lib/db/capture-messages-queries';

const readiness = { score: 40, covered: ['a'], remaining: ['b'], good_enough_to_generate: false };
const response = {
  finding: 'You grade the box design with a rubric.',
  question: 'How do students get feedback?',
  citations: [{ type: 'chunk', chunkId: 'c1', excerpt: 'rubric' }],
  readiness,
};

const call = (body: unknown, qs = '&stream=1') => POST(
  new Request(`http://x/api/capture/PKSC%202200/chat?slug=s${qs}`, { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ code: 'PKSC%202200' }) },
);

// The session's record after this turn, as the agent stores it: replies are
// the AuditResponse JSON; tool rows carry no transcript text.
const sessionRows = [
  { role: 'assistant', content: JSON.stringify({ finding: 'Welcome.', question: 'Tell me about grading?' }) },
  { role: 'user', content: 'Rubrics.' },
  { role: 'tool', content: null },
  { role: 'user', content: 'We use a rubric.' },
  { role: 'assistant', content: JSON.stringify(response) },
];
// Saved conversations keep role + content only (as the old page autosave did).
const savedTranscript = [
  { role: 'assistant', content: 'Welcome.\n\nTell me about grading?' },
  { role: 'user', content: 'Rubrics.' },
  { role: 'user', content: 'We use a rubric.' },
  { role: 'assistant', content: 'You grade the box design with a rubric.\n\nHow do students get feedback?' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionMessages as ReturnType<typeof vi.fn>).mockResolvedValue(sessionRows);
  (streamAuditAgent as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
    yield { kind: 'session', sessionId: 's1' };
    yield { kind: 'final', response, toolCallsUsed: 1 };
  });
  (runAuditAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ response, toolCallsUsed: 1 });
});

/** The server keeps the conversation (owner, 2026-10-28): the page sends only
 *  the new message, and the chat route rewrites the saved conversation from
 *  the session's own record after each turn, so it can't go stale, miss a
 *  turn after a failed save, or mix two sessions. */
describe('capture chat route — server-side save', () => {
  it('stream: takes the single new message and the session id', async () => {
    const res = await call({ message: 'We use a rubric.', sessionId: 's1' });
    await res.text();
    expect(streamAuditAgent).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', userMessage: 'We use a rubric.' }));
  });

  it("stream: saves the session's whole transcript", async () => {
    const res = await call({ message: 'We use a rubric.', sessionId: 's1' });
    await res.text();
    expect(getSessionMessages).toHaveBeenCalledWith('PKSC 2200', 's1');
    expect(upsertCaptureConversation).toHaveBeenCalledWith({ courseCode: 'PKSC 2200', messages: savedTranscript, readiness });
  });

  it('stream: the opening turn saves the new session', async () => {
    const res = await call({});
    await res.text();
    expect(streamAuditAgent).toHaveBeenCalledWith(expect.not.objectContaining({ userMessage: expect.anything() }));
    expect(getSessionMessages).toHaveBeenCalledWith('PKSC 2200', 'new-sess');
  });

  it('stream: a failed turn saves nothing', async () => {
    (streamAuditAgent as ReturnType<typeof vi.fn>).mockImplementation(async function* () { throw new Error('boom'); });
    const res = await call({ message: 'We use a rubric.', sessionId: 's1' });
    await res.text();
    expect(upsertCaptureConversation).not.toHaveBeenCalled();
  });

  it('non-stream: saves the turn too', async () => {
    const res = await call({ message: 'We use a rubric.', sessionId: 's1' }, '');
    expect(res.status).toBe(200);
    expect(upsertCaptureConversation).toHaveBeenCalledWith({ courseCode: 'PKSC 2200', messages: savedTranscript, readiness });
  });

  it('a page loaded before this change (full history) still works', async () => {
    const res = await call({ messages: [{ role: 'assistant', content: 'Welcome.' }, { role: 'user', content: 'Old tab.' }], sessionId: 's1' });
    await res.text();
    expect(streamAuditAgent).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'Old tab.' }));
  });
});
