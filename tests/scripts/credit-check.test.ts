// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as lib from '../../scripts/ai/credit-check-lib.mjs';

const GATEWAY = JSON.stringify({ error: { code: 'quota_denied', message: 'released OpenAI shared credits are exhausted', type: 'rls_gateway_error' } });

describe('classifyProbe', () => {
  it('2xx -> ok', () => expect(lib.classifyProbe({ status: 200, body: '{"choices":[]}' })).toBe('ok'));
  it('gateway quota_denied body -> exhausted', () => {
    expect(lib.classifyProbe({ status: 403, body: GATEWAY })).toBe('exhausted');
    expect(lib.classifyProbe({ status: 429, body: 'released OpenAI shared credits are exhausted' })).toBe('exhausted');
  });
  it('network error, 5xx, other 4xx -> unknown', () => {
    expect(lib.classifyProbe({ error: new Error('ETIMEDOUT') })).toBe('unknown');
    expect(lib.classifyProbe({ status: 502, body: 'bad gateway' })).toBe('unknown');
    expect(lib.classifyProbe({ status: 401, body: '{"error":{"code":"invalid_api_key"}}' })).toBe('unknown');
    expect(lib.classifyProbe({ status: 429, body: '{"error":{"code":"rate_limit_exceeded"}}' })).toBe('unknown');
  });
});

describe('decideAlert', () => {
  it.each([
    ['exhausted', false, 'open'],
    ['exhausted', true, 'none'],
    ['ok', true, 'close'],
    ['ok', false, 'none'],
    ['unknown', true, 'none'],
    ['unknown', false, 'none'],
    [null, true, 'none'],
  ])('%s, open issue=%s -> %s', (state, open, want) => {
    expect(lib.decideAlert({ state, hasOpenIssue: open })).toBe(want);
  });
});

describe('nextStatus (probe result merged into the status file)', () => {
  const now = '2026-10-19T12:00:00.000Z';
  const exhausted = { status: 'exhausted', since: '2026-10-18T00:00:00.000Z', checkedAt: '2026-10-18T00:00:00.000Z', source: 'request', detail: 'x' };
  it('unknown never overwrites exhausted', () => expect(lib.nextStatus(exhausted, 'unknown', 'timeout', now)).toBeNull());
  it('unknown with no prior status writes unknown', () => expect(lib.nextStatus(null, 'unknown', 'timeout', now)?.status).toBe('unknown'));
  it('exhausted keeps since', () => expect(lib.nextStatus(exhausted, 'exhausted', 'd', now)).toMatchObject({ status: 'exhausted', since: exhausted.since, checkedAt: now, source: 'probe' }));
  it('ok after exhausted resets since', () => expect(lib.nextStatus(exhausted, 'ok', '', now)).toMatchObject({ status: 'ok', since: now, source: 'probe' }));
  it('ok after ok keeps since', () => expect(lib.nextStatus({ ...exhausted, status: 'ok' }, 'ok', '', now)?.since).toBe(exhausted.since));
});

describe('isTriggerRun', () => {
  it('trigger newer than the last run -> alert-only', () => expect(lib.isTriggerRun(2000, 1000)).toBe(true));
  it('trigger older or equal -> scheduled probe', () => { expect(lib.isTriggerRun(1000, 2000)).toBe(false); expect(lib.isTriggerRun(1000, 1000)).toBe(false); });
  it('no trigger file -> scheduled probe', () => expect(lib.isTriggerRun(null, 1000)).toBe(false));
  it('trigger but never run -> alert-only', () => expect(lib.isTriggerRun(1000, null)).toBe(true));
});

describe('issue text', () => {
  it('body carries since/checkedAt/source/detail and what faculty see', () => {
    const b = lib.issueBody({ status: 'exhausted', since: 'S', checkedAt: 'C', source: 'probe', detail: 'D' });
    for (const x of ['S', 'C', 'probe', 'D', "shared OpenAI credits are used up"]) expect(b).toContain(x);
    expect(lib.ISSUE_TITLE).toBe("Clemson shared OpenAI credits are used up");
  });
});

describe('blind monitor', () => {
  const now = '2026-10-19T12:00:00.000Z';
  it('streak counts consecutive unknowns and resets on a verdict', () => {
    let st = lib.nextStatus(null, 'unknown', 'e', now) as any;
    expect(st.unknownStreak).toBe(1);
    st = lib.nextStatus(st, 'unknown', 'e', now); st = lib.nextStatus(st, 'unknown', 'e', now);
    expect(st.unknownStreak).toBe(3);
    expect(lib.nextStatus(st, 'ok', '', now).unknownStreak).toBe(0);
  });
  it.each([
    [2, 'unknown', false, 'none'],
    [3, 'unknown', false, 'open'],
    [5, 'unknown', true, 'none'],
    [0, 'ok', true, 'close'],
    [0, 'exhausted', true, 'close'],
    [0, 'ok', false, 'none'],
    [2, 'unknown', true, 'none'],
  ])('streak %s, %s, open=%s -> %s', (streak, state, open, want) => {
    expect(lib.decideBlind({ streak, state, hasOpenIssue: open })).toBe(want);
  });
  it('body names the last detail', () => {
    expect(lib.blindBody({ unknownStreak: 3, checkedAt: 'C', detail: 'probe error: ETIMEDOUT' })).toContain('ETIMEDOUT');
  });
});
