import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import {
  isCreditsExhaustedError, readCreditStatus, markCreditsExhausted, markCreditsOk,
  AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE,
} from '../credit-status';

const BODY = { error: { code: 'quota_denied', message: 'released OpenAI shared credits are exhausted', type: 'rls_gateway_error' } };

describe('isCreditsExhaustedError', () => {
  it('true for the real OpenAI SDK APIError shape', () => {
    const err = OpenAI.APIError.generate(403, BODY, 'x', new Headers());
    expect(isCreditsExhaustedError(err)).toBe(true);
  });
  it('true for an AI SDK style error (data / responseBody / wrapped)', () => {
    expect(isCreditsExhaustedError(Object.assign(new Error('boom'), { data: BODY }))).toBe(true);
    expect(isCreditsExhaustedError(Object.assign(new Error('boom'), { responseBody: JSON.stringify(BODY) }))).toBe(true);
    expect(isCreditsExhaustedError(new Error('retry failed', { cause: Object.assign(new Error('x'), { data: BODY }) }))).toBe(true);
    expect(isCreditsExhaustedError(new Error('released OpenAI shared credits are exhausted'))).toBe(true);
    expect(isCreditsExhaustedError(BODY)).toBe(true); // stream error part is a plain body object
  });
  it('false for rate limit, 500, network, junk', () => {
    expect(isCreditsExhaustedError(OpenAI.APIError.generate(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 'x', new Headers()))).toBe(false);
    expect(isCreditsExhaustedError(OpenAI.APIError.generate(500, { error: { message: 'oops' } }, 'x', new Headers()))).toBe(false);
    expect(isCreditsExhaustedError(new Error('fetch failed'))).toBe(false);
    expect(isCreditsExhaustedError(null)).toBe(false);
    expect(isCreditsExhaustedError(undefined)).toBe(false);
  });
});

describe('status file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'credits-'));
    process.env.AI_CREDITS_STATUS_FILE = path.join(dir, 's.json');
    process.env.AI_CREDITS_TRIGGER_FILE = path.join(dir, 't.trigger');
  });
  afterEach(async () => {
    delete process.env.AI_CREDITS_STATUS_FILE; delete process.env.AI_CREDITS_TRIGGER_FILE;
    await rm(dir, { recursive: true, force: true });
  });

  it('missing and corrupt files read as null', async () => {
    expect(await readCreditStatus()).toBeNull();
    await writeFile(process.env.AI_CREDITS_STATUS_FILE!, '{not json');
    expect(await readCreditStatus()).toBeNull();
  });
  it('exhausted keeps since on repeat and touches the trigger', async () => {
    await markCreditsExhausted('request', 'a');
    const first = await readCreditStatus();
    expect(first?.status).toBe('exhausted');
    await new Promise(r => setTimeout(r, 15));
    await markCreditsExhausted('probe', 'b');
    const second = await readCreditStatus();
    expect(second?.since).toBe(first?.since);
    expect(second?.detail).toBe('b');
    expect(second!.checkedAt > first!.checkedAt).toBe(true);
    await stat(process.env.AI_CREDITS_TRIGGER_FILE!);
  });
  it('trigger is touched only when the status changes to exhausted', async () => {
    await markCreditsExhausted('request', 'a');
    const t1 = (await stat(process.env.AI_CREDITS_TRIGGER_FILE!)).mtimeMs;
    await new Promise(r => setTimeout(r, 25));
    await markCreditsExhausted('request', 'b');
    expect((await stat(process.env.AI_CREDITS_TRIGGER_FILE!)).mtimeMs).toBe(t1);
  });
  it('concurrent marks: the file always parses and since is preserved', async () => {
    await markCreditsExhausted('request', 'seed');
    const since = (await readCreditStatus())!.since;
    for (let round = 0; round < 40; round++) {
      let bad = 0;
      const reader = (async () => {
        for (let i = 0; i < 20; i++) {
          try { JSON.parse(await readFile(process.env.AI_CREDITS_STATUS_FILE!, 'utf8')); } catch { bad++; }
        }
      })();
      await Promise.all([reader, ...Array.from({ length: 8 }, (_, i) => markCreditsExhausted('request', `c${i}`))]);
      expect(bad).toBe(0);
      expect((await readCreditStatus())?.since).toBe(since);
    }
  });
  it('ok writes only on a change', async () => {
    await markCreditsOk('request');
    const first = await readFile(process.env.AI_CREDITS_STATUS_FILE!, 'utf8');
    await new Promise(r => setTimeout(r, 15));
    await markCreditsOk('request');
    expect(await readFile(process.env.AI_CREDITS_STATUS_FILE!, 'utf8')).toBe(first);
  });
  it('never throws on an unwritable path', async () => {
    process.env.AI_CREDITS_STATUS_FILE = '/dev/null/nope/s.json';
    await expect(markCreditsExhausted('request', 'x')).resolves.toBeUndefined();
    await expect(markCreditsOk('request')).resolves.toBeUndefined();
  });
});

describe('inert under tests without env overrides', () => {
  it('reads null and does not write', async () => {
    expect(await readCreditStatus()).toBeNull();
    await expect(markCreditsExhausted('request', 'x')).resolves.toBeUndefined();
    expect(await readCreditStatus()).toBeNull();
  });
});

describe('error + message', () => {
  it('carries the code and the friendly message', () => {
    const e = new AiCreditsExhaustedError(undefined, { cause: 1 });
    expect(e.code).toBe('ai_credits_exhausted');
    expect(e.message).toContain('shared OpenAI credits are used up');
    expect(CREDITS_EXHAUSTED_MESSAGE('Chip')).toContain('Chip has been notified');
  });
});
