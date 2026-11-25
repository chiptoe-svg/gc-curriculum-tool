/**
 * Final-review I2: where migration 0076 is not applied, the staged-session lookup reads as "no staged row", so the
 * classic interview, the capture page, the conversation GET and Generate keep working. Other errors still throw
 * (fail-closed stays), and the chat stream never sends raw DB text to the client. Mocked errors, no database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ reject: null as unknown }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (state.reject ? Promise.reject(state.reject) : Promise.resolve([])),
        }),
      }),
    }),
  },
}));

const pgErr = (code: string, message = 'relation "capture_interview_sessions" does not exist') =>
  Object.assign(new Error('Failed query: select "session_id" from "capture_interview_sessions"'), { cause: Object.assign(new Error(message), { code }) });

beforeEach(() => { state.reject = null; });

describe('getInterviewSession without migration 0076', () => {
  it('returns null on undefined_table (42P01)', async () => {
    const { getInterviewSession } = await import('@/lib/db/capture-interview-sessions-queries');
    state.reject = pgErr('42P01');
    expect(await getInterviewSession('s')).toBeNull();
  });

  it('rethrows any other error (fail-closed)', async () => {
    const { getInterviewSession } = await import('@/lib/db/capture-interview-sessions-queries');
    state.reject = pgErr('08006', 'connection failure');
    await expect(getInterviewSession('s')).rejects.toThrow();
  });

  it('the classic staged check proceeds as classic on 42P01', async () => {
    const { stagedSessionFor } = await import('@/lib/ai/agent/audit-agent');
    state.reject = pgErr('42P01');
    expect(await stagedSessionFor('s', 'GC 4060')).toBeNull();
  });

  it('the page/conversation view reads a missing table as classic', async () => {
    vi.doMock('@/lib/db/capture-messages-queries', () => ({ getSessionMessages: vi.fn(async () => []) }));
    const { loadStagedSessionView } = await import('@/lib/capture/staged/session-view');
    state.reject = pgErr('42P01');
    expect(await loadStagedSessionView('GC 4060', 's')).toEqual({ isStaged: false, staged: null, mapStatus: null });
    vi.doUnmock('@/lib/db/capture-messages-queries');
  });
});

describe('streamAuditAgent on a staged-lookup error', () => {
  it('sends a generic message, logs the raw error, and never sends raw DB text', async () => {
    const { streamAuditAgent, STAGED_LOOKUP_FAILED } = await import('@/lib/ai/agent/audit-agent-stream');
    state.reject = pgErr('08006', 'connection to 127.0.0.1:5433 failed: password authentication failed');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = [];
    for await (const e of streamAuditAgent({ sessionId: 's', courseCode: 'GC 4060', auditMode: 'full', userMessage: 'hi' } as never)) events.push(e);
    const last = events.at(-1) as { kind: string; message: string };
    expect(last).toEqual({ kind: 'error', message: STAGED_LOOKUP_FAILED });
    expect(JSON.stringify(events)).not.toMatch(/capture_interview_sessions|5433|password|Failed query/);
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls.flat().map(String))).toMatch(/Failed query/);
    errSpy.mockRestore();
  });
});
