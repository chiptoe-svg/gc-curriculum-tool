import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/ai/vision-canonicalize', () => ({
  canonicalizeAdaptive: vi.fn(async () => ({
    png: Buffer.from('CANON'), tokens: 270, budget: 280, width: 864, height: 720,
  })),
}));
vi.mock('@/lib/ai/vision-offload', () => ({
  visionOffloadConfig: () => ({
    baseURL: 'http://127.0.0.1:38001/v1', model: 'gemma-4-26b', apiKey: 'none', concurrency: 12, minItems: 4,
  }),
}));
vi.mock('@/lib/ai/vision-offload-health', () => ({
  recordRealSuccess: vi.fn(), recordRealFallback: vi.fn(),
}));

import { POST } from '@/app/api/vision-proxy/route';

function req(body: unknown): NextRequest {
  return new Request('http://localhost/api/vision-proxy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest;
}

describe('vision-proxy — adaptive caption canonicalize', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.DOCLING_VLM_API_KEY; // fail-open for the test
  });

  it('canonicalizes the crop, swaps the image, sends max_soft_tokens=B to the DGX', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'a bar chart' } }] }), { status: 200 }),
    );
    const res = await POST(req({
      model: 'x',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } },
      ] }],
    }));
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body) as {
      max_soft_tokens?: number;
      model?: string;
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(sent.max_soft_tokens).toBe(280);
    expect(sent.model).toBe('gemma-4-26b');
    // the crop was replaced with the canonical png
    const img = sent.messages[0]!.content.find((c) => c.type === 'image_url');
    expect(img?.image_url?.url).toBe('data:image/png;base64,' + Buffer.from('CANON').toString('base64'));
  });
});
