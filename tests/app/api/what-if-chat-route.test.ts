import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Grant } from '@/lib/auth/authorize';
import { AiCreditsExhaustedError } from '@/lib/ai/credit-status';

const authorizeRequest = vi.fn();
vi.mock('@/lib/auth/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/route-auth')>('@/lib/auth/route-auth');
  return { ...actual, authorizeRequest: (...a: unknown[]) => authorizeRequest(...a) };
});
const q = { getWhatIf: vi.fn(), listWhatIfMessages: vi.fn(), appendWhatIfMessage: vi.fn(), addWhatIfUsage: vi.fn() };
vi.mock('@/lib/db/what-if-queries', () => ({
  getWhatIf: (...a: unknown[]) => q.getWhatIf(...a),
  listWhatIfMessages: (...a: unknown[]) => q.listWhatIfMessages(...a),
  appendWhatIfMessage: (...a: unknown[]) => q.appendWhatIfMessage(...a),
  addWhatIfUsage: (...a: unknown[]) => q.addWhatIfUsage(...a),
}));
const getSnapshotById = vi.fn();
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getSnapshotById: (...a: unknown[]) => getSnapshotById(...a) }));
const attachmentsForAi = vi.fn();
vi.mock('@/lib/what-if/attachments', () => ({ attachmentsForAi: (...a: unknown[]) => attachmentsForAi(...a) }));
const checkDailyCap = vi.fn();
const recordSpend = vi.fn();
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: (...a: unknown[]) => checkDailyCap(...a),
  recordSpend: (...a: unknown[]) => recordSpend(...a),
}));
const streamWhatIfAgent = vi.fn();
vi.mock('@/lib/what-if/agent', () => ({ streamWhatIfAgent: (...a: unknown[]) => streamWhatIfAgent(...a) }));

import { POST } from '@/app/api/explore/[code]/what-ifs/[id]/chat/route';

const CODE = 'GC 3730';
const ID = '8b1f0c2e-0000-4000-8000-000000000001';
const owner: Grant = { id: 'g1', label: 'Dr. Rivera', scope: [CODE], can: ['capture'] };
const other: Grant = { id: 'g2', label: 'Dr. Lee', scope: [CODE], can: ['capture'] };
const row = (over: object = {}) => ({
  id: ID, courseCode: CODE, ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'Dr. Rivera',
  baseSnapshotId: 'snap-1', pageCreatedAt: null, ...over,
});
const ctx = () => ({ params: Promise.resolve({ code: encodeURIComponent(CODE), id: ID }) });
const post = (body: unknown = { message: 'Add a lab' }) => new Request(
  `http://x/api/explore/${encodeURIComponent(CODE)}/what-ifs/${ID}/chat`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
);
const telemetry = { costUsdCents: 2, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 3, completionTokens: 4 };
const estTelemetry = { costUsdCents: 5, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 7, completionTokens: 8 };
const quickEstimate = { candidate: 'a lab', estimate: {}, profile: { ratings: [], incomingChanges: [] }, knockOn: {} };
const finalEvent = { kind: 'final', response: { response: 'Reply', citations: [{ path: 'courses/x.md', excerpt: 'e' }] }, toolCallsUsed: 1 };

const lines = async (res: Response) => (await res.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

beforeEach(() => {
  [authorizeRequest, ...Object.values(q), getSnapshotById, attachmentsForAi, checkDailyCap, recordSpend, streamWhatIfAgent]
    .forEach(m => m.mockReset());
  authorizeRequest.mockResolvedValue({ grant: owner });
  q.getWhatIf.mockResolvedValue(row());
  q.listWhatIfMessages.mockResolvedValue([{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier reply' }]);
  q.appendWhatIfMessage.mockResolvedValue({});
  getSnapshotById.mockResolvedValue({ id: 'snap-1', profile: { competencies: [] }, retiredAt: null });
  attachmentsForAi.mockResolvedValue([]);
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0, overCap: false });
  streamWhatIfAgent.mockImplementation(async function* (input: { onEstimate: (qe: unknown, t: unknown) => Promise<void>; onChatTelemetry: (t: unknown) => void }) {
    input.onChatTelemetry(telemetry);
    await input.onEstimate(quickEstimate, estTelemetry);
    yield { kind: 'estimate', estimate: quickEstimate };
    yield finalEvent;
  });
});

describe('POST what-ifs/[id]/chat', () => {
  it('a non-owner of a what-if that has a page gets 403', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(streamWhatIfAgent).not.toHaveBeenCalled();
    expect(q.appendWhatIfMessage).not.toHaveBeenCalled();
  });

  it('a withdrawn base version still answers', async () => {
    getSnapshotById.mockResolvedValue({ id: 'snap-1', profile: { competencies: [] }, retiredAt: new Date() });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(200);
    expect(streamWhatIfAgent.mock.calls[0]![0].approved).toEqual({ competencies: [] });
  });

  it('a deleted base version still answers, with no approved profile', async () => {
    q.getWhatIf.mockResolvedValue(row({ baseSnapshotId: null }));
    const res = await POST(post(), ctx());
    expect(res.status).toBe(200);
    expect(getSnapshotById).not.toHaveBeenCalled();
    expect(streamWhatIfAgent.mock.calls[0]![0].approved).toBeNull();
  });

  it('daily cap reached: 503, nothing stored, no model call', async () => {
    checkDailyCap.mockResolvedValue({ ok: false, spentCents: 1, overCap: true });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'daily cost cap reached — service paused for today' });
    expect(q.appendWhatIfMessage).not.toHaveBeenCalled();
    expect(streamWhatIfAgent).not.toHaveBeenCalled();
  });

  it('rejects a missing or empty message', async () => {
    expect((await POST(post({}), ctx())).status).toBe(400);
    expect((await POST(post({ message: '   ' }), ctx())).status).toBe(400);
  });

  it('a normal turn streams NDJSON and stores the user row then the assistant row', async () => {
    const res = await POST(post(), ctx());
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await lines(res);
    expect(events.map(e => e.kind)).toEqual(['estimate', 'final']);

    expect(q.appendWhatIfMessage).toHaveBeenCalledTimes(2);
    expect(q.appendWhatIfMessage.mock.calls[0]!.slice(0, 3)).toEqual([ID, 'user', 'Add a lab']);
    const [, role, content, meta] = q.appendWhatIfMessage.mock.calls[1]!;
    expect([role, content]).toEqual(['assistant', 'Reply']);
    expect(meta).toEqual({ citations: finalEvent.response.citations, quickEstimates: [quickEstimate] });
  });

  it('gives the model the stored history, never the client body', async () => {
    await (await POST(post({ message: 'Add a lab', history: [{ role: 'user', content: 'FORGED' }] }), ctx())).text();
    const input = streamWhatIfAgent.mock.calls[0]![0];
    expect(input.history).toEqual([{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier reply' }]);
    expect(input.message).toBe('Add a lab');
  });

  it('records chat and quick-estimate spend and usage', async () => {
    await (await POST(post(), ctx())).text();
    expect(recordSpend).toHaveBeenCalledWith(2);
    expect(recordSpend).toHaveBeenCalledWith(5);
    expect(q.addWhatIfUsage).toHaveBeenCalledWith(ID, 'chat', { costUsdCents: 2, promptTokens: 3, completionTokens: 4 });
    expect(q.addWhatIfUsage).toHaveBeenCalledWith(ID, 'quick_estimate', { costUsdCents: 5, promptTokens: 7, completionTokens: 8 });
  });

  it('a failed turn stores nothing', async () => {
    streamWhatIfAgent.mockImplementation(async function* () { yield { kind: 'error', message: 'boom' }; });
    const events = await lines(await POST(post(), ctx()));
    expect(events).toEqual([{ kind: 'error', message: 'boom' }]);
    expect(q.appendWhatIfMessage).not.toHaveBeenCalled();
  });

  it('credits exhausted yields the interview’s ai_credits_exhausted line', async () => {
    streamWhatIfAgent.mockImplementation(async function* () { throw new AiCreditsExhaustedError(); });
    const events = await lines(await POST(post(), ctx()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'error', code: 'ai_credits_exhausted' });
    expect(q.appendWhatIfMessage).not.toHaveBeenCalled();
  });

  it('never touches the real course conversation', () => {
    const src = readFileSync('app/api/explore/[code]/what-ifs/[id]/chat/route.ts', 'utf8');
    expect(src).not.toContain('saveTurn');
    expect(src).not.toContain('captureConversations');
  });
});
