import { describe, it, expect } from 'vitest';
import { accumulateSseContent } from '../sse-accumulate';

/** Build a Response whose body streams the given SSE text. */
function sseResponse(text: string): Response {
  return new Response(text);
}

const chunk = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;

describe('accumulateSseContent', () => {
  it('concatenates delta.content across chunks and stops at [DONE]', async () => {
    const sse = chunk('{"topic"') + chunk(':"x"}') + 'data: [DONE]\n\n';
    expect(await accumulateSseContent(sseResponse(sse))).toBe('{"topic":"x"}');
  });

  it('ignores keep-alive comment lines and non-JSON data', async () => {
    const sse = ': keep-alive\n' + chunk('a') + 'data: not-json\n' + chunk('b') + 'data: [DONE]\n\n';
    expect(await accumulateSseContent(sseResponse(sse))).toBe('ab');
  });

  it('handles chunks with empty/absent content deltas', async () => {
    const sse = 'data: {"choices":[{"delta":{}}]}\n\n' + chunk('ok') + 'data: [DONE]\n\n';
    expect(await accumulateSseContent(sseResponse(sse))).toBe('ok');
  });
});
