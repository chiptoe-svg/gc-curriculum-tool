/**
 * Tests for lib/capture/slide-vision.ts
 *
 * All HTTP I/O is mocked via vi.spyOn(globalThis, 'fetch') — the same
 * pattern used in tests/ai/embeddings.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { describeSlide, describeSlides, notesToExtractedText } from '@/lib/capture/slide-vision';
import type { SlideNote } from '@/lib/capture/slide-vision';

// Stub canonicalize (sharp can't read the tiny magic-byte buffers); pass through.
vi.mock('@/lib/ai/vision-canonicalize', () => ({
  canonicalize: vi.fn(async (raw: Buffer, budget: number) => ({
    png: raw, tokens: 520, budget, width: 1248, height: 960,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(note: Partial<SlideNote>) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(note),
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// The offload path streams (gcspark forwarder stalls non-streamed) — build a fresh
// SSE Response per call (a reused Response locks its body on the 2nd getReader()).
function makeSseResponse(note: Partial<SlideNote>) {
  const sse =
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(note) } }] })}\n\n` +
    `data: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const SAMPLE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  // Default env — tests can override per-case
  process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
  process.env.LOCAL_API_KEY = 'test-omlx-key';
  delete process.env.SLIDE_VISION_MODEL;
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.LOCAL_BASE_URL;
  delete process.env.LOCAL_API_KEY;
  delete process.env.SLIDE_VISION_MODEL;
});

// ---------------------------------------------------------------------------
// Happy path — well-formed JSON response
// ---------------------------------------------------------------------------

describe('describeSlide — well-formed response', () => {
  it('parses topic, teaches, keyVisual, contentLevel from a substantive slide', async () => {
    const expected: SlideNote = {
      topic: 'Color Theory',
      teaches: 'How warm/cool contrast creates visual depth',
      keyVisual: 'Color wheel with annotated warm/cool zones',
      text: 'Warm colors advance; cool colors recede.',
      contentLevel: 'substantive',
    };

    fetchSpy.mockResolvedValueOnce(makeOkResponse(expected));

    const result = await describeSlide(SAMPLE_PNG);

    expect(result.topic).toBe('Color Theory');
    expect(result.teaches).toBe('How warm/cool contrast creates visual depth');
    expect(result.keyVisual).toBe('Color wheel with annotated warm/cool zones');
    expect(result.text).toBe('Warm colors advance; cool colors recede.');
    expect(result.contentLevel).toBe('substantive');
  });

  it('parses contentLevel:"low" for a title slide', async () => {
    const titleSlide: SlideNote = {
      topic: '',
      teaches: '',
      keyVisual: 'Title text only',
      text: '',
      contentLevel: 'low',
    };

    fetchSpy.mockResolvedValueOnce(makeOkResponse(titleSlide));

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Request shape — image_url data-URI + Authorization header
// ---------------------------------------------------------------------------

describe('describeSlide — request shape', () => {
  it('sends an image_url part with a data:image/png;base64, URI', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);

    // Find the image_url part inside messages[0].content
    const contentParts: Array<{ type: string; image_url?: { url: string } }> =
      body.messages[0].content;
    const imagePart = contentParts.find((p) => p.type === 'image_url');

    expect(imagePart).toBeDefined();
    const dataUri = imagePart!.image_url!.url;
    expect(dataUri).toMatch(/^data:image\/png;base64,/);

    // The base64 payload must match the input buffer
    const expectedBase64 = SAMPLE_PNG.toString('base64');
    expect(dataUri).toBe(`data:image/png;base64,${expectedBase64}`);
  });

  it('includes Authorization: Bearer <LOCAL_API_KEY> header', async () => {
    process.env.LOCAL_API_KEY = 'secret-key-xyz';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-xyz');
  });

  it('POSTs to LOCAL_BASE_URL/chat/completions', async () => {
    process.env.LOCAL_BASE_URL = 'http://localhost:9999/v1';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:9999/v1/chat/completions');
  });

  it('uses SLIDE_VISION_MODEL env override when set', async () => {
    process.env.SLIDE_VISION_MODEL = 'my-custom-vision-model';
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('my-custom-vision-model');
  });

  it('falls back to gemma-4-12B-it-qat-4bit when SLIDE_VISION_MODEL is unset', async () => {
    // E4B-8bit is a broken-for-vision MLX conversion (silently drops the image);
    // 12B-qat-4bit ingests images. See lib/capture/slide-vision.ts. (2026-06-23)
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse({ topic: 'x', teaches: 'x', keyVisual: 'x', contentLevel: 'substantive' }),
    );

    await describeSlide(SAMPLE_PNG);

    const [_url, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gemma-4-12B-it-qat-4bit');
  });
});

// ---------------------------------------------------------------------------
// Error handling — non-OK status → safe default, no throw
// ---------------------------------------------------------------------------

describe('describeSlide — non-OK HTTP status', () => {
  it('returns safe default on 500 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await describeSlide(SAMPLE_PNG);

    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      text: '',
      contentLevel: 'unknown',
    });
  });

  it('returns safe default on 503 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 }),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('unknown');
    expect(result.topic).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Error handling — non-JSON content → safe default, no throw
// ---------------------------------------------------------------------------

describe('describeSlide — non-JSON response body', () => {
  it('returns safe default when body is plain text', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const result = await describeSlide(SAMPLE_PNG);

    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      text: '',
      contentLevel: 'unknown',
    });
  });

  it('returns safe default when choices[0].message.content is invalid JSON on BOTH attempts', async () => {
    const broken = () => new Response(
      JSON.stringify({ choices: [{ message: { content: '{ broken json' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    fetchSpy.mockResolvedValueOnce(broken()).mockResolvedValueOnce(broken());

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('unknown');
    expect(result.topic).toBe('');
    // retry-once: unparseable content is re-requested once before giving up
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries once and succeeds when the first content is a truncated-JSON runaway', async () => {
    // Simulates the keyVisual verbosity runaway (2026-07-27): 1st draw overruns the
    // token cap → truncated JSON; the retry draws cleanly and parses.
    const good: SlideNote = {
      topic: 'Bleed & Trim', teaches: 'Why bleed prevents white edges',
      keyVisual: 'Diagram of trim/bleed marks', text: 'Bleed 0.125in beyond trim.',
      contentLevel: 'substantive',
    };
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"topic":"Bleed","keyVisual":"a very long ' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(makeOkResponse(good));

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.topic).toBe('Bleed & Trim');
    expect(result.contentLevel).toBe('substantive');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns safe default when fetch itself rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await describeSlide(SAMPLE_PNG);
    expect(result).toEqual<SlideNote>({
      topic: '',
      teaches: '',
      keyVisual: '',
      text: '',
      contentLevel: 'unknown',
    });
  });
});

// ---------------------------------------------------------------------------
// Field coercion — contentLevel coercion
// ---------------------------------------------------------------------------

describe('describeSlide — field coercion', () => {
  it('coerces unknown contentLevel values to "low"', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  topic: 'Density',
                  teaches: 'Mass vs volume',
                  keyVisual: 'Diagram',
                  contentLevel: 'high',  // not a valid enum value
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.contentLevel).toBe('low');
    expect(result.topic).toBe('Density');
  });

  it('coerces missing string fields to empty string', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  // topic and teaches are missing
                  keyVisual: 'Some visual',
                  contentLevel: 'substantive',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await describeSlide(SAMPLE_PNG);
    expect(result.topic).toBe('');
    expect(result.teaches).toBe('');
    expect(result.keyVisual).toBe('Some visual');
    expect(result.text).toBe(''); // missing verbatim text coerces to '' (never a narration)
    expect(result.contentLevel).toBe('substantive');
  });
});

describe('describeSlides — canonical render + per-backend budget', () => {
  beforeEach(() => {
    process.env.VISION_OFFLOAD_BASE_URL = 'http://127.0.0.1:38001/v1';
    process.env.VISION_OFFLOAD_MODEL = 'gemma-4-26b';
    process.env.VISION_OFFLOAD_MIN_ITEMS = '1'; // always offload for the test
  });
  afterEach(() => {
    delete process.env.VISION_OFFLOAD_BASE_URL;
    delete process.env.VISION_OFFLOAD_MODEL;
    delete process.env.VISION_OFFLOAD_MIN_ITEMS;
  });

  it('sends max_soft_tokens=560 to the DGX (not the omlx knob)', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(makeSseResponse({ topic: 't', teaches: 'x', keyVisual: '', contentLevel: 'low' })),
    );
    await describeSlides([SAMPLE_PNG, SAMPLE_PNG]);
    const bodies = fetchSpy.mock.calls
      // resolveOffloadConcurrency does a bodyless GET /models — keep only the POSTs.
      .filter((c: unknown[]) => (c[1] as { body?: string })?.body)
      .map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);
    expect(bodies.length).toBeGreaterThan(0);
    // All succeeded on the DGX offload → max_soft_tokens set, knob absent, thinking off.
    expect(bodies.every((b: Record<string, unknown>) => b['max_soft_tokens'] === 560)).toBe(true);
    expect(bodies.every((b: Record<string, unknown>) => b['vision_soft_tokens_per_image'] === undefined)).toBe(true);
    expect(bodies.every((b: Record<string, unknown>) =>
      (b['chat_template_kwargs'] as { enable_thinking?: boolean })?.enable_thinking === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notesToExtractedText — derive extracted_text from one adaptive pass
// ---------------------------------------------------------------------------

describe('notesToExtractedText', () => {
  it('concatenates verbatim text per page and appends a one-line imagery note', () => {
    const notes: SlideNote[] = [
      { topic: 'Vectors', teaches: 'scaling', keyVisual: 'a bar chart of file sizes', text: 'Vectors scale without loss.', contentLevel: 'substantive' },
      { topic: 'Title', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    ];
    const out = notesToExtractedText(notes);
    expect(out).toContain('Vectors scale without loss.');
    expect(out).toMatch(/bar chart of file sizes/);
    // never narrates absence — the empty second page contributes nothing
    expect(out).not.toMatch(/blank|no content|nothing to transcribe/i);
  });

  it('emits nothing for a genuinely empty slide (no narration)', () => {
    const notes: SlideNote[] = [
      { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    ];
    expect(notesToExtractedText(notes).trim()).toBe('');
  });
});
