import { describe, it, expect, vi, beforeEach } from 'vitest';

// The OpenAI SDK constructor throws in jsdom (browser-like) test environments.
// Mock it so LocalProvider can be constructed without network access.
vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(_opts: unknown) {}
  },
}));

// Stub the renderer: two fake page PNGs.
vi.mock('@/lib/capture/render-pages', () => ({
  MAX_SLIDES: 60,
  renderToImages: vi.fn(async () => [Buffer.from('png1'), Buffer.from('png2')]),
}));

import { LocalProvider } from '../local';

function fakeClient(contents: string[]) {
  const create = vi.fn(async () => ({
    choices: [{ message: { content: contents.shift() ?? '' } }],
  }));
  return { create, chat: { completions: { create } } };
}

describe('LocalProvider.transcribeDocument', () => {
  let p: LocalProvider;
  beforeEach(() => {
    p = new LocalProvider('Qwen3.6-35B-A3B-UD-MLX-4bit', 'http://localhost:8000/v1', 'godfrey');
  });

  it('concatenates page texts in order, sends enable_thinking:false, cost 0', async () => {
    const client = fakeClient(['PAGE ONE', 'PAGE TWO']);
    (p as unknown as { client: typeof client }).client = client;

    const res = await p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf' });

    expect(res.text).toBe('PAGE ONE\n\nPAGE TWO');
    expect(res.costUsdCents).toBe(0);
    expect(res.truncated).toBe(false);
    // chat_template_kwargs.enable_thinking === false on every call
    for (const call of client.create.mock.calls) {
      expect((call[0] as { chat_template_kwargs?: { enable_thinking?: boolean } }).chat_template_kwargs?.enable_thinking).toBe(false);
    }
  });

  it('truncates at maxPages and flags truncated', async () => {
    const client = fakeClient(['ONLY ONE']);
    (p as unknown as { client: typeof client }).client = client;
    const res = await p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf', maxPages: 1 });
    expect(res.text).toBe('ONLY ONE');
    expect(res.truncated).toBe(true); // 2 rendered, capped to 1
  });
});
