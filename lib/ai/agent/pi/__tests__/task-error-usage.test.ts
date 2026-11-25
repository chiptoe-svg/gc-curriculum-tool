import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ errorMessage: 'upstream 500' as string | undefined, aborted: false }));
vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class {
    state = { errorMessage: undefined as string | undefined, messages: [] as unknown[] };
    constructor() {}
    abort() { h.aborted = true; }
    async prompt() {
      this.state.messages = [{ role: 'assistant', usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 } }];
      this.state.errorMessage = h.errorMessage;
    }
    followUp() {}
  },
}));
vi.mock('@earendil-works/pi-ai', () => ({
  createModels: () => ({ setProvider() {} }),
  createProvider: () => ({}),
  envApiKeyAuth: () => ({}),
}));
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({ openAICompletionsApi: () => ({}) }));
vi.mock('@earendil-works/pi-ai/api/openai-responses.lazy', () => ({ openAIResponsesApi: () => ({}) }));

import { runPiTask } from '../task';

const input = () => ({
  systemPrompt: 's', userMessage: 'u', tools: [], submitSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  submitDescription: 'd', endpoint: { baseUrl: 'u', apiKey: 'k', model: 'gpt-5.4', api: 'openai-completions' as const },
});

describe('runPiTask failures carry the usage so far', () => {
  it('attaches tokens and usdUnits to the error when the run fails', async () => {
    const err = await runPiTask(input()).then(() => null, e => e as { usage?: { tokens: { freshInput: number; output: number }; usdUnits: number } });
    expect(err).toBeInstanceOf(Error);
    expect(err!.usage?.tokens.freshInput).toBe(1000);
    expect(err!.usage?.tokens.output).toBe(500);
    expect(typeof err!.usage?.usdUnits).toBe('number');
  });
  it('also on abort', async () => {
    h.errorMessage = undefined;
    const c = new AbortController(); c.abort();
    const err = await runPiTask({ ...input(), signal: c.signal }).then(() => null, e => e as { usage?: { tokens: { output: number } } });
    expect(err!.usage?.tokens.output).toBe(500);
  });
});
