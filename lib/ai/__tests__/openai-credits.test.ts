// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const gen = vi.fn();
const stream = vi.fn();
vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: (...a: unknown[]) => gen(...a), streamText: (...a: unknown[]) => stream(...a) }));

import { OpenAIProvider } from '../openai';
import { AiCreditsExhaustedError, readCreditStatus, markCreditsExhausted } from '../credit-status';

const BODY = { error: { code: 'quota_denied', message: 'released OpenAI shared credits are exhausted', type: 'rls_gateway_error' } };
const gatewayErr = () => Object.assign(new Error('403 released OpenAI shared credits are exhausted'), { status: 403, code: 'quota_denied', error: BODY.error });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'credits-prov-'));
  process.env.AI_CREDITS_STATUS_FILE = path.join(dir, 's.json');
  process.env.AI_CREDITS_TRIGGER_FILE = path.join(dir, 't.trigger');
});
afterEach(async () => {
  delete process.env.AI_CREDITS_STATUS_FILE; delete process.env.AI_CREDITS_TRIGGER_FILE;
  await rm(dir, { recursive: true, force: true });
  gen.mockReset(); stream.mockReset();
});

function providerWith(create: (...a: unknown[]) => unknown) {
  const p = new OpenAIProvider('gpt-5.4', 'sk-test');
  (p as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return p;
}
const completeArgs = { systemPrompt: 's', userMessage: 'u', schemaName: 'x', jsonSchema: {}, validate: (r: unknown) => r };
const toolArgs = { systemPrompt: 's', messages: [{ role: 'user' as const, content: 'hi' }], tools: [], schemaName: 'x', jsonSchema: { type: 'object' }, validate: (r: unknown) => r };

describe('OpenAIProvider credit detection', () => {
  it('complete(): gateway exhaustion -> AiCreditsExhaustedError, status written, cause kept', async () => {
    const p = providerWith(async () => { throw gatewayErr(); });
    const err = await p.complete(completeArgs).catch(e => e);
    expect(err).toBeInstanceOf(AiCreditsExhaustedError);
    expect((err as Error).cause).toBeTruthy();
    const s = await readCreditStatus();
    expect(s?.status).toBe('exhausted');
    expect(s?.source).toBe('request');
    expect(s?.detail).toContain('gpt-5.4');
  });

  it('complete(): other errors pass through untouched and write nothing', async () => {
    const boom = Object.assign(new Error('429 slow down'), { status: 429, code: 'rate_limit_exceeded' });
    const p = providerWith(async () => { throw boom; });
    await expect(p.complete(completeArgs)).rejects.toBe(boom);
    expect(await readCreditStatus()).toBeNull();
  });

  it('complete(): success after exhaustion flips status to ok', async () => {
    await markCreditsExhausted('request', 'earlier');
    const p = providerWith(async () => ({ choices: [{ message: { content: '{}' } }], usage: {} }));
    await p.complete(completeArgs);
    // markCreditsOk is fire-and-forget; let it settle
    await new Promise(r => setTimeout(r, 50));
    expect((await readCreditStatus())?.status).toBe('ok');
  });

  it('transcribeDocument(): exhaustion maps too', async () => {
    const p = providerWith(async () => { throw gatewayErr(); });
    await expect(p.transcribeDocument({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf' } as never)).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it('completeWithTools(): exhaustion from the AI SDK maps', async () => {
    gen.mockRejectedValue(Object.assign(new Error('x'), { data: BODY }));
    const p = providerWith(async () => ({}));
    await expect(p.completeWithTools(toolArgs)).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect((await readCreditStatus())?.status).toBe('exhausted');
  });

  it('streamWithTools(): exhaustion in an error stream part throws AiCreditsExhaustedError', async () => {
    stream.mockReturnValue({ fullStream: (async function* () { yield { type: 'error', error: BODY }; })() });
    const p = providerWith(async () => ({}));
    const run = async () => { for await (const _ of p.streamWithTools(toolArgs)) void _; };
    await expect(run()).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    expect((await readCreditStatus())?.status).toBe('exhausted');
  });

  it('streamWithTools(): exhaustion thrown mid-stream throws AiCreditsExhaustedError; other errors still yield an error event', async () => {
    stream.mockReturnValue({ fullStream: (async function* () { throw Object.assign(new Error('x'), { data: BODY }); })() });
    const p = providerWith(async () => ({}));
    await expect((async () => { for await (const _ of p.streamWithTools(toolArgs)) void _; })()).rejects.toBeInstanceOf(AiCreditsExhaustedError);

    stream.mockReturnValue({ fullStream: (async function* () { throw new Error('network'); })() });
    const evs = [];
    for await (const e of p.streamWithTools(toolArgs)) evs.push(e);
    expect(evs).toEqual([{ kind: 'error', message: 'network' }]);
  });
});
